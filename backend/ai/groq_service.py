"""
Module tích hợp Groq Cloud Whisper API (whisper-large-v3) cho AutoCut.
Bóc băng âm thanh siêu tốc (~1-3 giây) trực tiếp từ Groq Cloud mà không cần tải model nặng về máy.
"""

import os
import re
import json
import logging
import urllib.request
import urllib.error
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List

from .models import TranscriptOutput, Sentence
from .config_loader import default_ai_config
from .post_processor import sanitize_transcript_stem

logger = logging.getLogger("AutoCut.AI.Groq")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CACHE_DIR = PROJECT_ROOT / "cache"
TRANSCRIPTS_DIR = PROJECT_ROOT / "transcripts"


def extract_audio_mp3(video_path: str, output_mp3_path: str) -> bool:
    """
    Trích xuất âm thanh từ video sang định dạng mp3 mono 64kbps bằng ffmpeg
    để giảm dung lượng tối đa (file 5 phút chỉ khoảng 2.5MB), đảm bảo giới hạn 25MB của Groq.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        str(output_mp3_path)
    ]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            check=True
        )
        return Path(output_mp3_path).exists() and Path(output_mp3_path).stat().st_size > 0
    except Exception as e:
        logger.warning(f"Không thể trích xuất mp3 bằng ffmpeg: {e}. Sẽ dùng file gốc.")
        return False


def call_groq_whisper_api(
    audio_path: str,
    api_key: str,
    model: str = "whisper-large-v3",
    language: str = "vi",
    prompt: Optional[str] = None
) -> Dict[str, Any]:
    """
    Gửi file âm thanh đến Groq Whisper API qua multipart/form-data.
    Sử dụng User-Agent chuẩn để không bị chặn bởi Cloudflare.
    """
    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    
    body = bytearray()
    
    def add_field(name: str, val: str):
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.extend(f"{val}\r\n".encode("utf-8"))

    def add_file(name: str, filepath: str):
        filename = Path(filepath).name
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"))
        body.extend(b"Content-Type: audio/mpeg\r\n\r\n")
        with open(filepath, "rb") as f:
            body.extend(f.read())
        body.extend(b"\r\n")

    add_field("model", model)
    add_field("response_format", "verbose_json")
    if language:
        add_field("language", language)
    if prompt:
        add_field("prompt", prompt)
    add_file("file", audio_path)
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(url, data=bytes(body), method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    # Header User-Agent để vượt qua Cloudflare (tránh lỗi 403 error code 1010)
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as http_err:
        err_body = http_err.read().decode("utf-8", errors="ignore")
        logger.error(f"Groq API HTTP Error {http_err.code}: {err_body}")
        raise RuntimeError(f"Groq API trả về lỗi {http_err.code}: {err_body}")
    except Exception as e:
        logger.error(f"Lỗi khi gọi Groq API: {e}")
        raise e


def transcribe_with_groq(
    media_path: str,
    api_key: Optional[str] = None,
    output_file: Optional[str] = None
) -> TranscriptOutput:
    """Thực thi bóc băng hoàn chỉnh với Groq Whisper và lưu kết quả vào file."""
    p = Path(media_path)
    if not p.exists():
        raise FileNotFoundError(f"Không tìm thấy file: {media_path}")

    groq_key = (
        api_key
        or os.getenv("WHISPER_API_KEY")
        or getattr(default_ai_config, "whisper_api_key", "")
    )
    if not groq_key or not groq_key.startswith("gsk_"):
        raise ValueError("Chưa cấu hình WHISPER_API_KEY của Groq (bắt đầu bằng gsk_...) trong .env!")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Trích xuất âm thanh nhẹ sang file tạm
    temp_mp3 = CACHE_DIR / f"groq_audio_{p.stem}_{os.getpid()}.mp3"
    logger.info(f"[*] Đang chuẩn bị âm thanh nén cho Groq từ: {p.name}...")
    extracted = extract_audio_mp3(str(p), str(temp_mp3))
    target_audio = str(temp_mp3) if extracted else str(p)

    try:
        logger.info(f"[*] Đang gọi Groq Whisper Cloud API cho {p.name}...")
        api_res = call_groq_whisper_api(
            audio_path=target_audio,
            api_key=groq_key,
            model="whisper-large-v3",
            language="vi"
        )
    finally:
        if temp_mp3.exists():
            try:
                temp_mp3.unlink()
            except Exception:
                pass

    raw_segments = api_res.get("segments", [])
    total_duration = float(api_res.get("duration") or 0.0)

    # 2. Xử lý và trích xuất TOÀN BỘ câu thực tế từ Groq Whisper (không dùng dữ liệu cứng)
    clean_name = p.name
    clean_name = re.sub(r"^[0-9a-fA-F]{64}_", "", clean_name)
    stem = Path(clean_name).stem

    sentences: List[Sentence] = []
    idx = 1

    for seg in raw_segments:
        raw_text = str(seg.get("text") or "").strip()
        if not raw_text or len(raw_text) < 2:
            continue
        # Lọc bỏ các câu watermark/ảo giác vô nghĩa thường gặp trong nhạc nền của Whisper
        if re.search(r"subscribe|hãy đăng ký|ghiền mì gõ", raw_text, re.I) and seg.get("no_speech_prob", 0) > 0.2:
            continue

        s_start = round(float(seg.get("start") or 0.0), 2)
        s_end = round(float(seg.get("end") or (s_start + 1.0)), 2)
        if s_end <= s_start:
            s_end = round(s_start + 1.0, 2)

        sentences.append(
            Sentence(
                id=f"S{idx:04d}",
                start=s_start,
                end=s_end,
                text=raw_text
            )
        )
        idx += 1

    # Nếu video không có lời thoại (hoàn toàn là nhạc nền beat không lời)
    if not sentences and total_duration > 0:
        sentences.append(
            Sentence(
                id="S0001",
                start=0.0,
                end=round(total_duration, 2),
                text=f"Âm thanh nền / Nhạc cụ (Không phát hiện lời thoại)"
            )
        )

    transcript_out = TranscriptOutput(
        video=clean_name,
        duration=round(total_duration if total_duration > 0 else 180.0, 2),
        sentences=sentences
    )

    # 3. Ghi ra các file theo yêu cầu:
    # 3.1. transcripts/<tên_video>_transcript.json (chuẩn hóa không dấu, không khoảng cách)
    safe_stem = sanitize_transcript_stem(stem)
    dedicated_file = TRANSCRIPTS_DIR / f"{safe_stem}_transcript.json"
    json_str = transcript_out.model_dump_json(indent=2, exclude_none=True)
    with open(dedicated_file, "w", encoding="utf-8") as f:
        f.write(json_str)
    logger.info(f"[+] Đã lưu transcript tại: {dedicated_file}")

    # 3.2. transcript.json ở thư mục gốc (để người dùng mở kiểm tra trực tiếp)
    root_file = PROJECT_ROOT / "transcript.json"
    with open(root_file, "w", encoding="utf-8") as f:
        f.write(json_str)
    logger.info(f"[+] Đã đồng bộ vào: {root_file}")

    # 3.3. File output chỉ định (nếu có)
    if output_file:
        out_p = Path(output_file)
        if out_p.parent.resolve() == TRANSCRIPTS_DIR.resolve():
            clean_stem = sanitize_transcript_stem(out_p.name.replace("_transcript.json", "").replace(".json", ""))
            out_p = TRANSCRIPTS_DIR / f"{clean_stem}_transcript.json"
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with open(out_p, "w", encoding="utf-8") as f:
            f.write(json_str)

    return transcript_out
