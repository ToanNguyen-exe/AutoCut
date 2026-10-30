"""Module xử lý Speech-to-Text (STT) nâng cao với faster-whisper (Tính năng P02, P03, P04).

Đã được nâng cấp toàn diện:
1. P02: Chống hiện tượng lặp từ vô tận ('kênh kênh kênh...') và ảo giác tiếng Hàn/ngoại ngữ rác (습니다, 로).
2. P03: initial_prompt tích hợp từ điển thuật ngữ CNTT / Web3 / Blockchain chuyên sâu.
3. P04: Cache transcript theo SHA-256 của file video/audio.
4. Tầng hậu xử lý: Tự động chuẩn hóa thuật ngữ chuyên ngành và tách câu đơn chuẩn xác.
5. Tự động vá tương thích PyAV 14+ (khử lỗi metadata_errors).
6. Bộ hiển thị tiến trình thời gian thực (Progress %, tốc độ x realtime, thời gian đã chạy & ETA).
"""

import hashlib
import json
import logging
import sys
import time
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
from .post_processor import post_process_transcript, merge_fragmented_segments

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("AutoCut.AI.Whisper")


def format_duration(seconds: float) -> str:
    """Định dạng số giây thành chuỗi MM:SS hoặc HH:MM:SS dễ đọc."""
    seconds = max(0, int(round(seconds)))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def build_progress_bar(percent: float, width: int = 22) -> str:
    """Tạo thanh tiến trình ASCII trực quan."""
    p = max(0.0, min(100.0, percent))
    filled = int(round(width * p / 100.0))
    return "█" * filled + "░" * (width - filled)


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

    @staticmethod
    def _consume_segments_with_progress(segments_gen, total_duration: float) -> list:
        """Duyệt từng segment từ generator của Whisper và hiển thị thanh tiến trình + ETA theo thời gian thực."""
        raw_segments = []
        start_wall = time.perf_counter()

        for seg in segments_gen:
            raw_segments.append(seg)
            elapsed = max(0.001, time.perf_counter() - start_wall)
            processed_audio_sec = float(getattr(seg, "end", 0.0) or 0.0)

            if total_duration and total_duration > 0:
                percent = min(100.0, (processed_audio_sec / total_duration) * 100.0)
                speed_x = processed_audio_sec / elapsed
                remaining_audio = max(0.0, total_duration - processed_audio_sec)
                eta_sec = (remaining_audio / speed_x) if speed_x > 0.01 else 0.0
                bar = build_progress_bar(percent)
                sys.stdout.write(
                    f"\r[Whisper STT] [{bar}] {percent:5.1f}% | "
                    f"Video: {format_duration(processed_audio_sec)}/{format_duration(total_duration)} | "
                    f"Tốc độ: {speed_x:4.1f}x | Đã chạy: {format_duration(elapsed)} | "
                    f"Còn lại (ETA): ~{format_duration(eta_sec)}   "
                )
                sys.stdout.flush()

        if raw_segments and total_duration and total_duration > 0:
            total_elapsed = time.perf_counter() - start_wall
            bar = build_progress_bar(100.0)
            sys.stdout.write(
                f"\r[Whisper STT] [{bar}] 100.0% | "
                f"Video: {format_duration(total_duration)}/{format_duration(total_duration)} | "
                f"Hoàn tất trong: {format_duration(total_elapsed)}                        \n"
            )
            sys.stdout.flush()

        return raw_segments

    def transcribe(
        self,
        media_path: str,
        outline_text: Optional[str] = None,
        force_recompute: bool = False,
        output_file: Optional[str] = None
    ) -> TranscriptOutput:
        """Thực hiện bóc băng video/audio và trả về TranscriptOutput theo chuẩn Mục 5.1."""
        media_p = Path(media_path)
        if not media_p.exists():
            raise FileNotFoundError(f"Không tìm thấy tệp phương tiện: {media_path}")

        logger.info(f"Đang tính SHA-256 hash cho tệp {media_p.name}...")
        file_hash = compute_file_sha256(str(media_p))
        cache_file = self.get_cache_path(file_hash)

        if not force_recompute and cache_file.exists():
            logger.info(f"[CACHE HIT] Đã tìm thấy transcript có sẵn cho hash {file_hash[:8]}... Đang tải từ cache.")
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            transcript_obj = TranscriptOutput.model_validate(data)
            transcript_obj = post_process_transcript(transcript_obj)

            if output_file:
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write(transcript_obj.model_dump_json(indent=2, exclude_none=True))
            return transcript_obj

        logger.info(f"[CACHE MISS] Chưa có cache cho {media_p.name}. Tiến hành bóc băng với Whisper...")

        initial_prompt = build_initial_prompt(outline_text)
        logger.info(f"Đã tạo initial_prompt nâng cao: '{initial_prompt}'")

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
            condition_on_previous_text=False,
            no_repeat_ngram_size=3,
            repetition_penalty=1.2,
            beam_size=5,
            best_of=5,
            temperature=[0.0, 0.2, 0.4],
            compression_ratio_threshold=2.2,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            initial_prompt=initial_prompt
        )

        try:
            segments_gen, info = model.transcribe(str(media_p), **transcribe_kwargs)
            media_duration = float(info.duration) if info and info.duration else 0.0
            raw_segments = self._consume_segments_with_progress(segments_gen, media_duration)
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
                media_duration = float(info.duration) if info and info.duration else 0.0
                raw_segments = self._consume_segments_with_progress(segments_gen, media_duration)
            else:
                raise

        total_segments = len(raw_segments)
        logger.info(f"Whisper hoàn thành: nhận diện được {total_segments} raw segments.")

        merged_items = merge_fragmented_segments(raw_segments)
        total_merged = len(merged_items)
        logger.info(f"Sau khi chuẩn hóa & tách câu đơn: {total_merged} câu hoàn chỉnh (từ {total_segments} segments).")

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

        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
        logger.info(f"Đã lưu transcript vào cache: {cache_file}")

        if output_file:
            out_p = Path(output_file)
            out_p.parent.mkdir(parents=True, exist_ok=True)
            with open(out_p, "w", encoding="utf-8") as f:
                f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
            logger.info(f"Đã xuất tệp transcript: {output_file}")

        return transcript_output
