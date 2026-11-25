"""Cấu hình cho AI Module từ config.yaml và .env
"""

import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import yaml
from dotenv import load_dotenv

# Tải biến môi trường từ .env (ưu tiên cấu hình trong .env hơn biến môi trường hệ thống)
load_dotenv(override=True)


def load_yaml_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Tải file config.yaml của dự án."""
    if not config_path:
        # Tìm config.yaml từ thư mục gốc dự án
        current_dir = Path(__file__).resolve().parent
        for parent in [current_dir, current_dir.parent, current_dir.parent.parent]:
            candidate = parent / "config.yaml"
            if candidate.exists():
                config_path = str(candidate)
                break

    if not config_path or not Path(config_path).exists():
        return {}

    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


class AIConfig:
    """Quản lý các thông số cấu hình của AI Module."""

    def __init__(self, config_dict: Optional[Dict[str, Any]] = None):
        cfg = config_dict or load_yaml_config()
        self.raw_config = cfg

        transcript_cfg = cfg.get("transcript", {})
        # Cho phép lấy model_size từ config hoặc biến môi trường hoặc mặc định 'small'
        self.whisper_model_size: str = (
            os.getenv("WHISPER_MODEL")
            or transcript_cfg.get("model_size")
            or ("small" if "large" in str(transcript_cfg.get("model", "")) else transcript_cfg.get("model", "small"))
        )
        self.whisper_language: str = transcript_cfg.get("language", "vi")
        self.use_outline_as_prompt: bool = transcript_cfg.get("use_outline_as_prompt", True)

        # Cấu hình VAD lọc khoảng lặng (tránh bẻ vụn câu khi giảng viên ngừng nghỉ ngắn)
        self.vad_min_silence_duration_ms: int = int(
            os.getenv("VAD_MIN_SILENCE_MS")
            or transcript_cfg.get("min_silence_duration_ms")
            or 1000
        )
        self.vad_speech_pad_ms: int = int(
            os.getenv("VAD_SPEECH_PAD_MS")
            or transcript_cfg.get("speech_pad_ms")
            or 500
        )

        self.whisper_api_key: str = (
            os.getenv("WHISPER_API_KEY")
            or transcript_cfg.get("api_key")
            or ""
        )
        self.whisper_api_url: str = (
            os.getenv("WHISPER_API_URL")
            or transcript_cfg.get("api_url")
            or "https://api.groq.com/openai/v1/audio/transcriptions"
        )

        # Gemini API Key & Model
        self.gemini_api_key: str = (
            os.getenv("GEMINI_API_KEY")
            or os.getenv("LLM_API_KEY")
            or ""
        )
        self.gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

        # Thư mục cache, output và segments duy nhất tại thư mục gốc AutoCut
        project_root = Path(__file__).resolve().parent.parent.parent
        self.cache_dir: str = os.getenv("CACHE_DIR", str(project_root / "cache"))
        self.output_dir: str = os.getenv("OUTPUT_DIR", str(project_root / "output"))
        self.segments_dir: str = os.getenv("SEGMENTS_DIR", str(project_root / "segments"))

        # Đảm bảo các thư mục tồn tại
        os.makedirs(self.cache_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(self.segments_dir, exist_ok=True)


# Singleton config instance
default_ai_config = AIConfig()

_API_ERROR_RULES: Tuple[Tuple[str, str, re.Pattern[str]], ...] = (
    (
        "TOKEN_OR_QUOTA_EXHAUSTED",
        "Het token/quota",
        re.compile(
            r"(?<![\w.])(?:429|413)(?![\w.])|resource_exhausted|quota|rate_limit|rate limit"
            r"|too many requests|insufficient_quota|context_length|context length|max_tokens"
            r"|payload too large|token limit|token quota|het token"
        ),
    ),
    (
        "API_KEY_ERROR",
        "Loi API key",
        re.compile(
            r"(?<![\w.])(?:401|403)(?![\w.])|unauthenticated|permission_denied|permission denied"
            r"|api_key|api key|invalid_api_key|unauthorized|key expired"
        ),
    ),
    (
        "TOKEN_OR_QUOTA_EXHAUSTED",
        "Het token/quota",
        re.compile(r"\btokens?\b"),
    ),
    (
        "API_UNREACHABLE",
        "Loi ket noi/model",
        re.compile(
            r"(?<![\w.])(?:503|404)(?![\w.])|unavailable|not_found|not found"
            r"|timeout|timed out|connecterror|connection|getaddrinfo"
        ),
    ),
)


def classify_ai_api_error(err: Exception) -> Tuple[str, str]:
    """Phan loai loi goi AI API thanh (ma_loi, mo_ta_ngan) dua tren regex uu tien."""
    err_lower = to_ascii_log(str(err)).lower()
    for code, description, pattern in _API_ERROR_RULES:
        if pattern.search(err_lower):
            return code, description
    return "API_ERROR", "Loi AI API"


def to_ascii_log(text: str) -> str:
    """Chuyen chuoi log ve dang ASCII khong dau, gon tren 1 dong."""
    normalized = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    ascii_chars = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(ascii_chars.encode("ascii", errors="ignore").decode("ascii").split())


def summarize_error(err: Exception, max_len: int = 80) -> str:
    """Tom gon thong diep loi thanh 1 dong ngan de log sach se."""
    clean = to_ascii_log(str(err))
    return clean if len(clean) <= max_len else f"{clean[:max_len - 3]}..."


def log_ai_api_error(
    target_logger: logging.Logger,
    provider: str,
    target_model: str,
    err: Exception,
    is_fatal: bool = True,
) -> str:
    """Ghi log tom gon (khong dau, 1 dong) cho loi goi AI API; tra ve ma loi."""
    code, reason = classify_ai_api_error(err)
    log_fn = target_logger.error if is_fatal else target_logger.warning
    log_fn(f"[{provider}-{code}] {target_model}: {reason} ({summarize_error(err)})")
    return code
