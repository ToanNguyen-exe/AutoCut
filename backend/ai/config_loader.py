"""Cấu hình cho AI Module từ config.yaml và .env
"""

import os
from pathlib import Path
from typing import Any, Dict, Optional
import yaml
from dotenv import load_dotenv

# Tải biến môi trường từ .env
load_dotenv()


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

        # Gemini API Key & Model
        self.gemini_api_key: str = (
            os.getenv("GEMINI_API_KEY")
            or os.getenv("LLM_API_KEY")
            or ""
        )
        self.gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

        # Thư mục cache và output
        self.cache_dir: str = os.getenv("CACHE_DIR", "./cache")
        self.output_dir: str = os.getenv("OUTPUT_DIR", "./output")

        # Đảm bảo các thư mục tồn tại
        os.makedirs(self.cache_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)


# Singleton config instance
default_ai_config = AIConfig()
