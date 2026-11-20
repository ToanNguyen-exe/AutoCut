"""Kiểm thử tính sẵn sàng chạy Docker & Linux container cho phân hệ AI (SV2):
1. requirements.txt loại bỏ 2 thư viện thừa (fastapi, uvicorn) và giữ đủ gói AI cần thiết.
2. Script healthcheck (backend/ai/healthcheck.py) kiểm tra sống HTTP + Python/FFmpeg nhanh (< 1s) và --check-deps.
3. backend/ai/* tương thích môi trường Linux container (AUTOCUT_HOME, FFMPEG_PATH, non-root cache dirs).
"""

import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def test_requirements_excludes_unused_fastapi_uvicorn():
    """requirements.txt không được chứa fastapi và uvicorn mà repo không sử dụng."""
    req_path = PROJECT_ROOT / "requirements.txt"
    content = req_path.read_text(encoding="utf-8")
    packages = [
        line.strip().split(">=")[0].split("==")[0].split("<")[0].strip().lower()
        for line in content.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    assert "fastapi" not in packages, "Phải xóa fastapi khỏi requirements.txt"
    assert "uvicorn" not in packages, "Phải xóa uvicorn khỏi requirements.txt"
    for required in ("faster-whisper", "google-genai", "pydantic", "pyyaml", "python-dotenv", "pytest"):
        assert required in packages, f"Thiếu thư viện bắt buộc: {required}"


def test_config_loader_honors_autocut_home_in_container(tmp_path, monkeypatch):
    """Nếu biến môi trường AUTOCUT_HOME được đặt (Docker), config_loader phải ưu tiên nó."""
    from backend.ai import config_loader

    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text("transcript:\n  model_size: tiny\n", encoding="utf-8")

    monkeypatch.setenv("AUTOCUT_HOME", str(tmp_path))
    monkeypatch.delenv("WHISPER_MODEL", raising=False)
    monkeypatch.delenv("CACHE_DIR", raising=False)
    monkeypatch.delenv("OUTPUT_DIR", raising=False)

    assert config_loader.get_project_root() == tmp_path.resolve()
    cfg = config_loader.AIConfig()
    assert cfg.whisper_model_size == "tiny"
    assert Path(cfg.cache_dir) == tmp_path / "cache"
    assert Path(cfg.output_dir) == tmp_path / "output"


def test_groq_service_respects_ffmpeg_path_env(tmp_path, monkeypatch):
    """extract_audio_mp3 phải đọc FFMPEG_PATH từ biến môi trường Linux container."""
    from backend.ai import groq_service

    monkeypatch.setenv("FFMPEG_PATH", "/usr/local/bin/ffmpeg-custom")
    video_file = tmp_path / "vid.mp4"
    video_file.write_bytes(b"00")
    out_mp3 = tmp_path / "out.mp3"

    captured_cmds = []

    def fake_run(cmd, **kwargs):
        captured_cmds.append(cmd)
        out_mp3.write_bytes(b"mp3data")
        return subprocess.CompletedProcess(cmd, 0)

    with patch("subprocess.run", side_effect=fake_run):
        ok = groq_service.extract_audio_mp3(str(video_file), str(out_mp3))

    assert ok is True
    assert captured_cmds and captured_cmds[0][0] == "/usr/local/bin/ffmpeg-custom"


def test_healthcheck_liveness_returns_0_when_backend_up_and_ffmpeg_present():
    """Script healthcheck trả mã 0 khi backend HTTP GET / trả 200 và tìm thấy Python + FFmpeg."""
    from unittest.mock import MagicMock
    from backend.ai import healthcheck

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("backend.ai.healthcheck.shutil.which", return_value=sys.executable), \
         patch("backend.ai.healthcheck.urllib.request.urlopen", return_value=mock_resp):
        exit_code = healthcheck.run_healthcheck(
            url="http://127.0.0.1:8080/",
            timeout=2.0,
            check_deps=False,
        )
    assert exit_code == 0


def test_healthcheck_liveness_returns_1_when_backend_down():
    """Script healthcheck trả mã 1 nếu HTTP endpoint không phản hồi."""
    import urllib.error
    from backend.ai import healthcheck

    with patch("backend.ai.healthcheck.shutil.which", return_value=sys.executable), \
         patch("backend.ai.healthcheck.urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        exit_code = healthcheck.run_healthcheck(
            url="http://127.0.0.1:8080/",
            timeout=0.5,
            check_deps=False,
        )
    assert exit_code == 1


def test_healthcheck_check_deps_verifies_required_ai_packages():
    """Chế độ --check-deps kiểm tra được toàn bộ thư viện AI cốt lõi (faster_whisper, google.genai, ...)."""
    from backend.ai import healthcheck

    with patch("backend.ai.healthcheck.shutil.which", return_value=sys.executable), \
         patch("backend.ai.healthcheck.subprocess.run", return_value=subprocess.CompletedProcess(["ffmpeg", "-version"], 0)):
        ok, details = healthcheck.check_dependencies(run_ffmpeg_version=True)

    assert ok is True, f"Kiểm tra dependencies thất bại: {details}"


def test_healthcheck_check_deps_fails_clearly_if_package_missing():
    """Nếu thiếu một thư viện bắt buộc trong container, check_dependencies phải trả False kèm tên gói."""
    import importlib
    from backend.ai import healthcheck

    orig_import = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "faster_whisper":
            raise ImportError("No module named 'faster_whisper'")
        return orig_import(name, *args, **kwargs)

    with patch("backend.ai.healthcheck.shutil.which", return_value=sys.executable), \
         patch("backend.ai.healthcheck.importlib.import_module", side_effect=fake_import):
        ok, details = healthcheck.check_dependencies(run_ffmpeg_version=False)

    assert ok is False
    assert "faster_whisper" in details


def test_backend_dockerfile_installs_venv_requirements_and_healthcheck():
    """backend/Dockerfile phải cài requirements.txt vào /opt/venv, chạy non-root và gắn HEALTHCHECK."""
    dockerfile = PROJECT_ROOT / "backend" / "Dockerfile"
    assert dockerfile.exists(), "Phải tồn tại backend/Dockerfile"

    text = dockerfile.read_text(encoding="utf-8")
    assert "eclipse-temurin:17-jdk" in text
    assert "eclipse-temurin:17-jre" in text
    assert "python3-venv" in text
    assert "ffmpeg" in text
    assert "python3 -m venv /opt/venv" in text
    assert "/opt/venv/bin/pip install" in text
    assert "requirements.txt" in text
    assert "PYTHON_EXE=/opt/venv/bin/python" in text
    assert "HF_HOME=/opt/models" in text
    assert "backend.ai.healthcheck --check-deps --skip-http" in text
    assert "HEALTHCHECK" in text
    assert "backend.ai.healthcheck" in text
    assert "USER autocut" in text


def test_dockerignore_excludes_secrets_and_runtime_bloat():
    """.dockerignore phải loại trừ .env, video upload, cache và thư mục build nặng."""
    dockerignore = PROJECT_ROOT / ".dockerignore"
    assert dockerignore.exists(), "Phải tồn tại .dockerignore ở gốc repo"

    lines = [line.strip() for line in dockerignore.read_text(encoding="utf-8").splitlines() if line.strip() and not line.strip().startswith("#")]
    for pattern in (".env", "uploads", "output", "cache", "backend/target"):
        assert any(pattern in line for line in lines), f".dockerignore phải loại trừ {pattern}"
