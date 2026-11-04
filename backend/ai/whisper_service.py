"""Module xử lý Speech-to-Text (STT) nâng cao với faster-whisper (Tính năng P02, P03, P04).

Đã được nâng cấp toàn diện:
1. P02: Chống hiện tượng lặp từ vô tận ('kênh kênh kênh...') và ảo giác tiếng Hàn/ngoại ngữ rác (습니다, 로).
2. P03: initial_prompt tích hợp từ điển thuật ngữ CNTT / Web3 / Blockchain chuyên sâu.
3. P04: Cache transcript theo SHA-256 của file video/audio.
<<<<<<< HEAD
4. Tầng hậu xử lý: Tự động chuẩn hóa thuật ngữ chuyên ngành và tách câu đơn chuẩn xác.
5. Tự động vá tương thích PyAV 14+ (khử lỗi metadata_errors).
6. Bộ hiển thị tiến trình thời gian thực (Progress %, tốc độ x realtime, thời gian đã chạy & ETA).
=======
4. Tầng hậu xử lý: Tự động chuẩn hóa thuật ngữ chuyên ngành (blockchain, Web3, JavaScript, DOM...).
5. Tự động vá tương thích PyAV 14+ (khử lỗi metadata_errors).
6. Bộ đo tiến độ thời gian thực (Real-time Progress Bar, Tốc độ xử lý x-realtime, Thời gian đã chạy & ETA dự kiến hoàn thành).
>>>>>>> origin/feature/sv2-whisper-stt
"""

import hashlib
import json
import logging
<<<<<<< HEAD
import os
import sys
import time
from pathlib import Path
from typing import Optional, List
=======
import sys
import time
from pathlib import Path
from typing import Optional, List, Callable
>>>>>>> origin/feature/sv2-whisper-stt

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
<<<<<<< HEAD
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
=======
    if seconds < 0 or seconds == float("inf"):
        return "--:--"
    total_sec = int(round(seconds))
    hrs, rem = divmod(total_sec, 3600)
    mins, secs = divmod(rem, 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def build_progress_bar(percent: float, width: int = 20) -> str:
    """Tạo thanh tiến độ trực quan trên giao diện dòng lệnh."""
    pct = max(0.0, min(100.0, percent))
    filled = int(round(width * pct / 100.0))
>>>>>>> origin/feature/sv2-whisper-stt
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
<<<<<<< HEAD
=======
            t0 = time.perf_counter()
>>>>>>> origin/feature/sv2-whisper-stt
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
<<<<<<< HEAD
            logger.info("Đã tải xong model Whisper.")
=======
            load_sec = time.perf_counter() - t0
            logger.info(f"Đã tải xong model Whisper trong {load_sec:.2f}s.")
>>>>>>> origin/feature/sv2-whisper-stt
        return self._model

    def get_cache_path(self, file_hash: str) -> Path:
        """Đường dẫn tệp cache theo mã hash SHA-256."""
        return Path(self.cache_dir) / f"{file_hash}_transcript.json"

<<<<<<< HEAD
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
=======
    def _consume_segments_with_progress(
        self,
        segments_gen,
        total_duration: float,
        progress_callback: Optional[Callable[[dict], None]] = None
    ) -> list:
        """Duyệt từng segment từ Whisper và cập nhật thanh tiến độ + ETA theo thời gian thực."""
        raw_segments = []
        start_wall = time.perf_counter()
        last_print_wall = 0.0

        for seg in segments_gen:
            raw_segments.append(seg)
            now_wall = time.perf_counter()
            elapsed = max(0.001, now_wall - start_wall)

            # Tránh I/O quá dày: chỉ cập nhật hiển thị tối đa 2 lần/giây
            if now_wall - last_print_wall < 0.5 and (not total_duration or seg.end < total_duration):
                continue
            last_print_wall = now_wall

            if total_duration and total_duration > 0:
                pct = min(100.0, (seg.end / total_duration) * 100.0)
                speed_x = seg.end / elapsed
                remaining_video_sec = max(0.0, total_duration - seg.end)
                eta_sec = remaining_video_sec / speed_x if speed_x > 0 else 0.0
                bar = build_progress_bar(pct)

                status_line = (
                    f"\r[Whisper STT] [{bar}] {pct:5.1f}% "
                    f"({seg.end:.0f}s/{total_duration:.0f}s) | "
                    f"Tốc độ: {speed_x:.1f}x | "
                    f"Đã chạy: {format_duration(elapsed)} | "
                    f"Còn lại (ETA): ~{format_duration(eta_sec)}   "
                )
                sys.stdout.write(status_line)
                sys.stdout.flush()

                if progress_callback:
                    progress_callback({
                        "stage": "whisper_stt",
                        "percent": round(pct, 1),
                        "elapsed_sec": round(elapsed, 2),
                        "eta_sec": round(eta_sec, 2),
                        "speed_x": round(speed_x, 2)
                    })

        total_elapsed = time.perf_counter() - start_wall
        if total_duration and total_duration > 0:
            avg_speed = total_duration / max(0.001, total_elapsed)
            bar = build_progress_bar(100.0)
            sys.stdout.write(
                f"\r[Whisper STT] [{bar}] 100.0% "
                f"({total_duration:.0f}s/{total_duration:.0f}s) | "
                f"Tốc độ TB: {avg_speed:.1f}x | "
                f"Hoàn thành trong: {format_duration(total_elapsed)} ({total_elapsed:.2f}s)      \n"
>>>>>>> origin/feature/sv2-whisper-stt
            )
            sys.stdout.flush()

        return raw_segments

    def transcribe(
        self,
        media_path: str,
        outline_text: Optional[str] = None,
        force_recompute: bool = False,
<<<<<<< HEAD
        output_file: Optional[str] = None
=======
        output_file: Optional[str] = None,
        progress_callback: Optional[Callable[[dict], None]] = None
>>>>>>> origin/feature/sv2-whisper-stt
    ) -> TranscriptOutput:
        """Thực hiện bóc băng video/audio và trả về TranscriptOutput theo chuẩn Mục 5.1."""
        media_p = Path(media_path)
        if not media_p.exists():
            raise FileNotFoundError(f"Không tìm thấy tệp phương tiện: {media_path}")

<<<<<<< HEAD
        groq_api_key = (
            getattr(default_ai_config, "whisper_api_key", None)
            or os.getenv("WHISPER_API_KEY")
        )
        if groq_api_key and groq_api_key.startswith("gsk_"):
            try:
                from .groq_service import transcribe_with_groq
                logger.info(f"[*] Sử dụng Groq Whisper Cloud API cho {media_p.name}...")
                return transcribe_with_groq(media_path, api_key=groq_api_key, output_file=output_file)
            except Exception as groq_err:
                logger.warning(f"[!] Groq API gặp sự cố ({groq_err}), chuyển sang chạy offline Faster-Whisper...")

=======
        # Bước 1: Tính SHA-256 hash để kiểm tra Cache (P04)
>>>>>>> origin/feature/sv2-whisper-stt
        logger.info(f"Đang tính SHA-256 hash cho tệp {media_p.name}...")
        file_hash = compute_file_sha256(str(media_p))
        cache_file = self.get_cache_path(file_hash)

        if not force_recompute and cache_file.exists():
<<<<<<< HEAD
=======
            t_cache = time.perf_counter()
>>>>>>> origin/feature/sv2-whisper-stt
            logger.info(f"[CACHE HIT] Đã tìm thấy transcript có sẵn cho hash {file_hash[:8]}... Đang tải từ cache.")
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            transcript_obj = TranscriptOutput.model_validate(data)
            transcript_obj = post_process_transcript(transcript_obj)

            if output_file:
                with open(output_file, "w", encoding="utf-8") as f:
                    f.write(transcript_obj.model_dump_json(indent=2, exclude_none=True))
<<<<<<< HEAD
=======
            logger.info(f"Đã tải và chuẩn hóa dữ liệu từ cache trong {time.perf_counter() - t_cache:.2f}s.")
>>>>>>> origin/feature/sv2-whisper-stt
            return transcript_obj

        logger.info(f"[CACHE MISS] Chưa có cache cho {media_p.name}. Tiến hành bóc băng với Whisper...")

<<<<<<< HEAD
        initial_prompt = build_initial_prompt(outline_text)
        logger.info(f"Đã tạo initial_prompt nâng cao: '{initial_prompt}'")

=======
        # Bước 2: Tạo initial_prompt nâng cao kết hợp từ điển CNTT (P03)
        initial_prompt = build_initial_prompt(outline_text)
        logger.info(f"Đã tạo initial_prompt nâng cao: '{initial_prompt}'")

        # Bước 3: Cấu hình siêu tham số chống ảo giác & tăng độ chính xác phát âm
>>>>>>> origin/feature/sv2-whisper-stt
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
<<<<<<< HEAD
            condition_on_previous_text=False,
            no_repeat_ngram_size=3,
            repetition_penalty=1.2,
            beam_size=5,
            best_of=5,
            temperature=[0.0, 0.2, 0.4],
            compression_ratio_threshold=2.2,
            log_prob_threshold=-1.0,
=======
            condition_on_previous_text=False,  # Chống lan truyền lỗi lặp từ
            no_repeat_ngram_size=3,            # Ngăn lặp lại cụm 3 từ giống nhau
            repetition_penalty=1.2,            # Phạt nặng lặp từ
            beam_size=5,                       # Beam search tìm từ ngữ chính xác nhất
            best_of=5,
            temperature=[0.0, 0.2, 0.4],
            compression_ratio_threshold=2.2,   # Phát hiện và loại bỏ đoạn lặp nén cao
            log_prob_threshold=-1.0,           # Bỏ qua các đoạn không tự tin
>>>>>>> origin/feature/sv2-whisper-stt
            no_speech_threshold=0.6,
            initial_prompt=initial_prompt
        )

<<<<<<< HEAD
        try:
            segments_gen, info = model.transcribe(str(media_p), **transcribe_kwargs)
            media_duration = float(info.duration) if info and info.duration else 0.0
            raw_segments = self._consume_segments_with_progress(segments_gen, media_duration)
=======
        stt_start_wall = time.perf_counter()
        try:
            segments_gen, info = model.transcribe(str(media_p), **transcribe_kwargs)
            media_duration = float(info.duration) if info and info.duration else 0.0
            raw_segments = self._consume_segments_with_progress(
                segments_gen,
                total_duration=media_duration,
                progress_callback=progress_callback
            )
>>>>>>> origin/feature/sv2-whisper-stt
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
<<<<<<< HEAD
                raw_segments = self._consume_segments_with_progress(segments_gen, media_duration)
            else:
                raise

        total_segments = len(raw_segments)
        logger.info(f"Whisper hoàn thành: nhận diện được {total_segments} raw segments.")

        merged_items = merge_fragmented_segments(raw_segments)
        total_merged = len(merged_items)
        logger.info(f"Sau khi chuẩn hóa & tách câu đơn: {total_merged} câu hoàn chỉnh (từ {total_segments} segments).")
=======
                raw_segments = self._consume_segments_with_progress(
                    segments_gen,
                    total_duration=media_duration,
                    progress_callback=progress_callback
                )
            else:
                raise

        stt_elapsed = time.perf_counter() - stt_start_wall
        total_segments = len(raw_segments)
        logger.info(
            f"Whisper hoàn thành trong {format_duration(stt_elapsed)} ({stt_elapsed:.2f}s): "
            f"nhận diện được {total_segments} raw segments."
        )

        # Bước 4: Hậu xử lý gộp các đoạn bị tách vụn và chuẩn hóa mã định danh câu Sxxxx
        merged_items = merge_fragmented_segments(raw_segments)
        total_merged = len(merged_items)
        logger.info(f"Sau khi hậu xử lý: {total_merged} câu (tối ưu từ {total_segments} segments).")
>>>>>>> origin/feature/sv2-whisper-stt

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

<<<<<<< HEAD
=======
        # Lưu vào cache file (P04)
>>>>>>> origin/feature/sv2-whisper-stt
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
        logger.info(f"Đã lưu transcript vào cache: {cache_file}")

<<<<<<< HEAD
=======
        # Lưu vào file đầu ra chỉ định nếu có
>>>>>>> origin/feature/sv2-whisper-stt
        if output_file:
            out_p = Path(output_file)
            out_p.parent.mkdir(parents=True, exist_ok=True)
            with open(out_p, "w", encoding="utf-8") as f:
                f.write(transcript_output.model_dump_json(indent=2, exclude_none=True))
            logger.info(f"Đã xuất tệp transcript: {output_file}")

        return transcript_output
