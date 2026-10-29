"""Module xử lý Speech-to-Text (STT) nâng cao với faster-whisper (Tính năng P02, P03, P04).

Đã được nâng cấp toàn diện:
1. P02: Chống hiện tượng lặp từ vô tận ('kênh kênh kênh...') và ảo giác tiếng Hàn/ngoại ngữ rác (습니다, 로).
2. P03: initial_prompt tích hợp từ điển thuật ngữ CNTT / Web3 / Blockchain chuyên sâu.
3. P04: Cache transcript theo SHA-256 của file video/audio.
4. Tầng hậu xử lý: Tự động chuẩn hóa thuật ngữ chuyên ngành (blockchain, Web3, tech stack, airdrop...).
5. Tự động vá tương thích PyAV 14+ (khử lỗi metadata_errors).
6. Tinh chỉnh VAD & Hậu xử lý gộp các segment vụn không có dấu chấm câu.
"""

import hashlib
import json
import logging

from pathlib import Path
from typing import Optional, List

# Bản vá tương thích giữa faster-whisper và PyAV 14+ (bỏ metadata_errors)
try:
    import av
    _orig_av_open = av.open

    def _patched_av_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)

    av.open = _patched_av_open
except Exception:
    pass

from .models import Sentence, TranscriptOutput
from .prompt_builder import build_initial_prompt
from .config_loader import default_ai_config
from .post_processor import post_process_sentence, post_process_transcript, merge_fragmented_segments

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("AutoCut.AI.Whisper")


def compute_file_sha256(file_path: str, chunk_size: int = 65536) -> str:
    """Tính mã băm SHA-256 của file bằng luồng dữ liệu (chunked 64KB) để giữ RAM dưới 10MB."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


def clear_all_cache(cache_dir: Optional[str] = None) -> int:
    """Xóa toàn bộ các tệp transcript và audio tạm trong thư mục cache."""
    target_dir = Path(cache_dir or default_ai_config.cache_dir)
    if not target_dir.exists():
        return 0

    count = 0
    for f in target_dir.glob("*_transcript.json"):
        try:
            f.unlink()
            count += 1
        except Exception:
            pass
    for f in target_dir.glob("*_audio.*"):
        try:
            f.unlink()
            count += 1
        except Exception:
            pass
    logger.info(f"Đã dọn dẹp sạch sẽ {count} tệp cache tại: {target_dir}")
    return count


class WhisperTranscriber:
    """Bộ chuyển đổi giọng nói sang văn bản sử dụng faster-whisper (Bản nâng cấp chất lượng cao)."""

    def __init__(
        self,
        model_size: Optional[str] = None,
        language: Optional[str] = None,
        cache_dir: Optional[str] = None,
        device: str = "auto",
        compute_type: str = "auto"
    ):
        self.model_size = model_size or default_ai_config.whisper_model_size
        self.language = language or default_ai_config.whisper_language
        self.cache_dir = cache_dir or default_ai_config.cache_dir
        self.device = device
        self.compute_type = compute_type
        self._model = None

    def _get_model(self):
        """Khởi tạo mô hình Whisper (lazy loading)."""
        if self._model is None:
            from faster_whisper import WhisperModel
            import ctranslate2

            chosen_device = self.device
            chosen_compute = self.compute_type

            if chosen_device == "auto":
                if ctranslate2.get_cuda_device_count() > 0:
                    chosen_device = "cuda"
                    chosen_compute = "float16" if chosen_compute == "auto" else chosen_compute
                else:
                    chosen_device = "cpu"
                    chosen_compute = "int8" if chosen_compute == "auto" else chosen_compute

            logger.info(
                f"Đang tải Faster-Whisper model '{self.model_size}' trên thiết bị: {chosen_device} "
                f"(compute_type: {chosen_compute})..."
            )
            self._model = WhisperModel(
                self.model_size,
                device=chosen_device,
                compute_type=chosen_compute
            )
            logger.info("Đã tải xong model Whisper.")
        return self._model

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
        """Thực hiện bóc băng video/audio và trả về TranscriptOutput theo chuẩn Mục 5.1.

        Args:
            media_path: Đường dẫn tệp video hoặc audio.
            outline_text: Văn bản đề cương (nếu có) để tạo initial_prompt.
            force_recompute: Bỏ qua cache và chạy lại Whisper.
            output_file: Đường dẫn lưu tệp transcript.json.
        """
        media_p = Path(media_path)
        if not media_p.exists():
            raise FileNotFoundError(f"Không tìm thấy tệp phương tiện: {media_path}")

        # Bước 1: Tính SHA-256 hash để kiểm tra Cache (P04)
        logger.info(f"Đang tính SHA-256 hash cho tệp {media_p.name}...")
        file_hash = compute_file_sha256(str(media_p))
        cache_file = self.get_cache_path(file_hash)

        if not force_recompute and cache_file.exists():
            logger.info(f"[CACHE HIT] Đã tìm thấy transcript có sẵn cho hash {file_hash[:8]}... Đang tải từ cache.")
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            transcript_obj = TranscriptOutput.model_validate(data)
            # Luôn tự động chuẩn hóa làm sạch ngay cả khi nạp từ cache cũ
            transcript_obj = post_process_transcript(transcript_obj)

            if output_file:
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write(transcript_obj.model_dump_json(indent=2, exclude_none=True))
            return transcript_obj

        logger.info(f"[CACHE MISS] Chưa có cache cho {media_p.name}. Tiến hành bóc băng với Whisper...")

        # Bước 2: Tạo initial_prompt nâng cao kết hợp từ điển CNTT (P03)
        initial_prompt = build_initial_prompt(outline_text)
        logger.info(f"Đã tạo initial_prompt nâng cao: '{initial_prompt}'")

        # Bước 3: Cấu hình siêu tham số chống ảo giác & tăng độ chính xác phát âm
        model = self._get_model()
        transcribe_kwargs = dict(
            language=self.language,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=default_ai_config.vad_min_silence_duration_ms,
                speech_pad_ms=default_ai_config.vad_speech_pad_ms,
                threshold=0.5
            ),
            word_timestamps=False,
            condition_on_previous_text=False,  # Chống lan truyền lỗi lặp từ
            no_repeat_ngram_size=3,            # Ngăn lặp lại cụm 3 từ giống nhau
            repetition_penalty=1.2,            # Phạt nặng lặp từ
            beam_size=5,                       # Beam search tìm từ ngữ chính xác nhất
            best_of=5,
            temperature=[0.0, 0.2, 0.4],
            compression_ratio_threshold=2.2,   # Phát hiện và loại bỏ đoạn lặp nén cao
            log_prob_threshold=-1.0,           # Bỏ qua các đoạn không tự tin
            no_speech_threshold=0.6,
            initial_prompt=initial_prompt
        )

        try:
            segments_gen, info = model.transcribe(str(media_p), **transcribe_kwargs)
            raw_segments = list(segments_gen)
        except RuntimeError as e:
            if ("cublas" in str(e).lower() or "cudnn" in str(e).lower() or "cuda" in str(e).lower()) and self.device in ("auto", "cuda"):
                logger.warning(
                    f"[CUDA WARNING] Không tìm thấy thư viện CUDA DLLs ({e}). "
                    f"Tự động chuyển sang chạy bằng CPU (int8)..."
                )
                from faster_whisper import WhisperModel
                self.device = "cpu"
                self.compute_type = "int8"
                self._model = WhisperModel(self.model_size, device="cpu", compute_type="int8")
                segments_gen, info = self._model.transcribe(str(media_p), **transcribe_kwargs)
                raw_segments = list(segments_gen)
            else:
                raise

        total_segments = len(raw_segments)
        logger.info(f"Whisper hoàn thành: nhận diện được {total_segments} raw segments.")

        # Bước 4: Hậu xử lý gộp các đoạn bị tách vụn và chuẩn hóa mã định danh câu Sxxxx
        merged_items = merge_fragmented_segments(raw_segments)
        total_merged = len(merged_items)
        logger.info(f"Sau khi gộp câu vụn: còn lại {total_merged} câu hoàn chỉnh (tối ưu từ {total_segments} segments).")

        digit_count = 5 if total_merged > 9999 else 4
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

        total_duration = round(info.duration, 2) if info and info.duration else (
            sentences[-1].end if sentences else 0.0
        )

        transcript_output = TranscriptOutput(
            video=media_p.name,
            duration=total_duration,
            sentences=sentences
        )

        # Lưu vào cache file (P04)
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
        logger.info(f"Đã lưu transcript vào cache: {cache_file}")

        # Lưu vào file đầu ra chỉ định nếu có
        if output_file:
            out_p = Path(output_file)
            out_p.parent.mkdir(parents=True, exist_ok=True)
            with open(out_p, "w", encoding="utf-8") as f:
                f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
            logger.info(f"Đã xuất tệp transcript: {output_file}")

        return transcript_output
