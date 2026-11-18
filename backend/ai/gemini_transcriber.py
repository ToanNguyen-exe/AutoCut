"""Module bóc băng âm thanh/video sử dụng Google Gemini API (gemini-3.5-flash).
Được thiết kế để thay thế hoặc làm giải pháp song hành với Faster-Whisper:
- Hoạt động 100% qua Cloud REST API, không phụ thuộc C++ DLLs (tránh lỗi Windows Smart App Control).
- Xử lý được video/audio dung lượng lớn (lên tới 2GB).
- Tự động đánh mã định danh câu S0001, S0002... theo Mục 5.1.
- Mồi thuật ngữ từ đề cương vào prompt (P03).
- Cơ chế Cache SHA-256 (P04).
"""

import json
import logging
import time
from pathlib import Path
from typing import Optional, List

from google import genai
from google.genai import types

from .models import Sentence, TranscriptOutput
from .prompt_builder import extract_terms_from_outline
from .config_loader import default_ai_config, log_ai_api_error
from .post_processor import post_process_sentence, merge_fragmented_segments, sanitize_transcript_stem
from .whisper_service import compute_file_sha256

logger = logging.getLogger("AutoCut.AI.GeminiSTT")


AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".wmv", ".ts", ".m4v"}


def extract_audio_if_needed(media_path: Path, cache_dir: Path, file_hash: str) -> Path:
    """Nếu tệp là video, trích xuất luồng âm thanh sang cache để giảm dung lượng tải lên Gemini."""
    ext = media_path.suffix.lower()
    if ext in AUDIO_EXTENSIONS:
        return media_path

    # File audio đích trong cache
    out_audio_path = cache_dir / f"{file_hash}_audio.m4a"
    if out_audio_path.exists() and out_audio_path.stat().st_size > 0:
        logger.info(f"[AUDIO CACHE HIT] Da co file audio trich xuat san: {out_audio_path.name}")
        return out_audio_path

    out_mp3_path = cache_dir / f"{file_hash}_audio.mp3"
    if out_mp3_path.exists() and out_mp3_path.stat().st_size > 0:
        logger.info(f"[AUDIO CACHE HIT] Da co file audio trich xuat san: {out_mp3_path.name}")
        return out_mp3_path

    logger.info(f"[AUDIO EXTRACT] Dang trich xuat luong am thanh tu video {media_path.name} de toi uu upload...")
    try:
        import av
        with av.open(str(media_path)) as input_c:
            if not input_c.streams.audio:
                logger.warning("Khong tim thay luong am thanh trong video! Tiep tuc su dung tep goc.")
                return media_path

            in_audio = input_c.streams.audio[0]
            codec = in_audio.codec_context.name
            cache_dir.mkdir(parents=True, exist_ok=True)

            # Nếu codec gốc là aac, stream-copy vào m4a cực nhanh không cần re-encode
            if codec == "aac":
                with av.open(str(out_audio_path), mode="w", format="ipod") as output_c:
                    out_audio = output_c.add_stream_from_template(in_audio)
                    for packet in input_c.demux(in_audio):
                        if packet.dts is None:
                            continue
                        packet.stream = out_audio
                        output_c.mux(packet)
                target_path = out_audio_path
            else:
                # Nếu codec khác, encode sang mp3 64kbps mono để dung lượng tối thiểu
                target_path = out_mp3_path
                with av.open(str(target_path), mode="w", format="mp3") as output_c:
                    out_audio = output_c.add_stream("libmp3lame", rate=16000)
                    out_audio.bit_rate = 64000
                    out_audio.layout = "mono"
                    for frame in input_c.decode(in_audio):
                        for packet in out_audio.encode(frame):
                            output_c.mux(packet)
                    for packet in out_audio.encode():
                        output_c.mux(packet)

        orig_mb = media_path.stat().st_size / (1024 * 1024)
        new_mb = target_path.stat().st_size / (1024 * 1024)
        logger.info(
            f"[AUDIO EXTRACT THANH CONG] Giam dung luong tu {orig_mb:.1f} MB xuong {new_mb:.1f} MB "
            f"(tiet kiem {orig_mb - new_mb:.1f} MB bang thong upload)."
        )
        return target_path
    except Exception as e:
        logger.warning(f"Khong the trich xuat audio qua PyAV ({e}). Se su dung tep video goc de upload.")
        return media_path


class GeminiTranscriber:
    """Bộ bóc băng âm thanh/video tự động sử dụng Google Gemini API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        cache_dir: Optional[str] = None
    ):
        self.api_key = api_key or default_ai_config.gemini_api_key
        if not self.api_key:
            logger.error("[GEMINI-API_KEY_ERROR] Thieu GEMINI_API_KEY trong .env")
            raise ValueError("Không tìm thấy GEMINI_API_KEY trong .env hoặc cấu hình!")
        self.model_name = model_name or getattr(default_ai_config, "gemini_model", "gemini-3.5-flash")
        self.cache_dir = cache_dir or default_ai_config.cache_dir
        # Lưu ý quan trọng: Trong SDK google-genai, HttpOptions.timeout được tính bằng MILI-GIÂY (ms)!
        # Đặt timeout 600_000 ms (tương đương 600 giây = 10 phút).
        self.client = genai.Client(
            api_key=self.api_key,
            http_options={"timeout": 600000.0}
        )

    def get_cache_path(self, file_hash: str) -> Path:
        """Đường dẫn tệp cache theo mã hash SHA-256."""
        return Path(self.cache_dir) / f"{file_hash}_transcript.json"

    def transcribe(
        self,
        media_path: str,
        outline_text: Optional[str] = None,
        force_recompute: bool = False,
        output_file: Optional[str] = None
    ) -> TranscriptOutput:
        """Bóc băng video/audio sang TranscriptOutput theo định dạng chuẩn Mục 5.1."""
        media_p = Path(media_path)
        if not media_p.exists():
            raise FileNotFoundError(f"Không tìm thấy tệp phương tiện: {media_path}")

        # Bước 1: Kiểm tra Cache SHA-256 (P04)
        logger.info(f"Dang tinh SHA-256 hash cho tep {media_p.name}...")
        file_hash = compute_file_sha256(str(media_p))
        cache_file = self.get_cache_path(file_hash)

        if not force_recompute and cache_file.exists():
            logger.info(f"[CACHE HIT] Da tim thay transcript co san cho hash {file_hash[:8]}... Dang tai tu cache.")
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            transcript_obj = TranscriptOutput.model_validate(data)

            if output_file:
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write(transcript_obj.model_dump_json(indent=2))
            return transcript_obj

        # Tách audio từ video để giảm tối đa kích thước upload, tránh lỗi X-Goog-Upload-Command timeout
        upload_target = extract_audio_if_needed(media_p, Path(self.cache_dir), file_hash)
        logger.info(f"[CACHE MISS] Chua co cache. Dang tai tep {upload_target.name} len Gemini API...")

        # Bước 2: Tải file lên Gemini Files API
        try:
            uploaded_file = self.client.files.upload(file=str(upload_target))
        except Exception as err:
            log_ai_api_error(logger, "GEMINI", self.model_name, err, is_fatal=True)
            raise
        logger.info(f"Da upload len Gemini: {uploaded_file.name}. Dang doi xu ly...")

        while uploaded_file.state.name == "PROCESSING":
            time.sleep(2)
            uploaded_file = self.client.files.get(name=uploaded_file.name)

        if uploaded_file.state.name != "ACTIVE":
            raise RuntimeError(f"Tệp không sẵn sàng trên Gemini, trạng thái: {uploaded_file.state.name}")

        logger.info("Tep tren Gemini da o trang thai ACTIVE. Bat dau boc bang...")

        try:
            # Bước 3: Chuẩn bị prompt với mồi thuật ngữ từ đề cương (P03)
            terms = extract_terms_from_outline(outline_text) if outline_text else []
            terms_hint = f"Thuật ngữ chuyên ngành trong bài giảng: {', '.join(terms)}" if terms else ""

            prompt = f"""
Bạn là chuyên gia chuyển âm thanh/video bài giảng lập trình tiếng Việt thành văn bản.
NHIỆM VỤ:
1. Hãy nghe và bóc băng toàn bộ lời nói trong video/audio một cách chính xác tuyệt đối từng câu.
2. {terms_hint}
3. Chia bài giảng thành các câu độc lập, tự nhiên. Mỗi câu phải có:
   - start: mốc bắt đầu (giây, số thực với 2 chữ số thập phân).
   - end: mốc kết thúc (giây, số thực với 2 chữ số thập phân).
   - text: nội dung câu nói tiếng Việt chuẩn chính tả.
4. Ước lượng tổng duration của video (giây).

ĐỊNH DẠNG JSON BẮT BUỘC TRẢ VỀ:
{{
  "duration": 1820.0,
  "sentences": [
    {{
      "start": 0.0,
      "end": 4.5,
      "text": "Chào các bạn, hôm nay chúng ta sẽ học về vòng lặp for.",
    }}
  ]
}}
LƯU Ý QUAN TRỌNG:
- Chỉ trả về chuỗi JSON thuần túy, không có giải thích, không bọc markdown.
- Thời gian start, end phải tăng dần theo thời gian thực của video.
"""

            # Gọi Gemini API với cơ chế retry nếu gặp 503 UNAVAILABLE
            max_retries = 3
            response = None
            for attempt in range(1, max_retries + 1):
                try:
                    response = self.client.models.generate_content(
                        model=self.model_name,
                        contents=[uploaded_file, prompt],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.2
                        )
                    )
                    logger.info(f"[GEMINI] Boc bang xong: {self.model_name}")
                    break
                except Exception as err:
                    if ("503" in str(err) or "UNAVAILABLE" in str(err)) and attempt < max_retries:
                        wait_s = attempt * 5
                        log_ai_api_error(logger, "GEMINI", self.model_name, err, is_fatal=False)
                        time.sleep(wait_s)
                        continue
                    log_ai_api_error(logger, "GEMINI", self.model_name, err, is_fatal=True)
                    raise

            raw_text = response.text.strip()
            # Bỏ markdown nếu có (T10)
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            raw_text = raw_text.strip()

            parsed = json.loads(raw_text)
            raw_sentences = parsed.get("sentences", [])
            total_duration = float(parsed.get("duration", 0.0))

            # Bước 4: Hậu xử lý gộp các đoạn vụn và đánh mã câu S0001, S0002... theo Mục 5.1
            merged_items = merge_fragmented_segments(raw_sentences)
            digit_count = 5 if len(merged_items) > 9999 else 4
            sentences: List[Sentence] = []

            for idx, item in enumerate(merged_items, start=1):
                sentence_id = f"S{idx:0{digit_count}d}"
                sentences.append(
                    Sentence(
                        id=sentence_id,
                        start=item["start"],
                        end=item["end"],
                        text=item["text"]
                    )
                )

            if not total_duration and sentences:
                total_duration = sentences[-1].end

            transcript_output = TranscriptOutput(
                video=media_p.name,
                duration=round(total_duration, 2),
                sentences=sentences
            )

            # Lưu vào cache file (P04)
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            with open(cache_file, "w", encoding="utf-8") as f:
                f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
            logger.info(f"Da luu transcript vao cache: {cache_file}")

            # Lưu vào file đầu ra chỉ định nếu có
            if output_file:
                out_p = Path(output_file)
                if out_p.parent.name == "transcripts":
                    clean_stem = sanitize_transcript_stem(out_p.name.replace("_transcript.json", "").replace(".json", ""))
                    out_p = out_p.parent / f"{clean_stem}_transcript.json"
                out_p.parent.mkdir(parents=True, exist_ok=True)
                with open(out_p, "w", encoding="utf-8") as f:
                    f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
                logger.info(f"Đã xuất tệp transcript: {out_p}")

            return transcript_output

        finally:
            # Dọn dẹp tệp trên Gemini sau khi xử lý xong
            if 'uploaded_file' in locals() and uploaded_file is not None:
                try:
                    self.client.files.delete(name=uploaded_file.name)
                    logger.info(f"Da don dep file tam tren Gemini: {uploaded_file.name}")
                except Exception as e:
                    logger.warning(f"Khong the xoa tep tam tren Gemini: {e}")
