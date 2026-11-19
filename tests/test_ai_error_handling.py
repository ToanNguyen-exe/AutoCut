"""Kiểm thử phân loại lỗi rõ ràng cho AI pipeline (SV2):
- Không phát sinh transcript/phân đoạn giả khi gặp lỗi thật (thiếu tiếng, hết quota Groq/Gemini).
- Xuất mã lỗi chuẩn `@@ERROR {...}` và exit code tương ứng để Java/Frontend xử lý đúng.
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai import cli
from backend.ai.models import TranscriptOutput


def test_cli_analyze_backend_emits_quota_error_and_exits_3(capsys, tmp_path):
    """Khi Groq/AI hết quota, cli --analyze-backend phải phát @@ERROR AI_QUOTA_EXHAUSTED và exit(3)."""
    out_file = tmp_path / "out.json"
    argv = [
        "backend.ai.cli",
        "--analyze-backend",
        "--video-name", "test.mp4",
        "--lesson", "test",
        "--output", str(out_file),
    ]

    with patch.object(sys, "argv", argv), \
         patch.object(cli, "_find_matching_transcript_or_video", side_effect=RuntimeError("Groq API trả về lỗi 429: rate_limit_exceeded")):
        with pytest.raises(SystemExit) as exc_info:
            cli.main()

    assert exc_info.value.code == 3
    captured = capsys.readouterr().out
    err_lines = [line for line in captured.splitlines() if line.startswith("@@ERROR ")]
    assert err_lines, f"Phải in dòng @@ERROR, stdout={captured}"
    payload = json.loads(err_lines[-1][len("@@ERROR "):])
    assert payload["code"] == "AI_QUOTA_EXHAUSTED"
    assert payload["message"]
    assert payload["suggestion"]
    assert not out_file.exists(), "Không được xuất file kết quả phân đoạn giả khi lỗi"


def test_cli_analyze_backend_emits_no_audio_error_and_exits_2(capsys, tmp_path):
    """Khi video không có âm thanh / không phát hiện lời nói, cli phải phát @@ERROR NO_AUDIO_STREAM và exit(2)."""
    out_file = tmp_path / "out.json"
    argv = [
        "backend.ai.cli",
        "--analyze-backend",
        "--video-name", "silent.mp4",
        "--lesson", "silent",
        "--output", str(out_file),
    ]

    with patch.object(sys, "argv", argv), \
         patch.object(cli, "_find_matching_transcript_or_video", side_effect=ValueError("NO_AUDIO_STREAM: Output file #0 does not contain any stream")):
        with pytest.raises(SystemExit) as exc_info:
            cli.main()

    assert exc_info.value.code == 2
    captured = capsys.readouterr().out
    err_lines = [line for line in captured.splitlines() if line.startswith("@@ERROR ")]
    assert err_lines, f"Phải in dòng @@ERROR, stdout={captured}"
    payload = json.loads(err_lines[-1][len("@@ERROR "):])
    assert payload["code"] == "NO_AUDIO_STREAM"
    assert not out_file.exists()


def test_cli_analyze_backend_rejects_empty_transcript_sentences(capsys, tmp_path):
    """Nếu transcript bóc băng có 0 câu thoại (video câm), phải phát @@ERROR NO_SPEECH_DETECTED và exit(2)."""
    out_file = tmp_path / "out.json"
    argv = [
        "backend.ai.cli",
        "--analyze-backend",
        "--video-name", "muted.mp4",
        "--lesson", "muted",
        "--output", str(out_file),
    ]
    empty_transcript = TranscriptOutput(video="muted.mp4", duration=30.0, sentences=[])

    with patch.object(sys, "argv", argv), \
         patch.object(cli, "_find_matching_transcript_or_video", return_value=empty_transcript):
        with pytest.raises(SystemExit) as exc_info:
            cli.main()

    assert exc_info.value.code == 2
    captured = capsys.readouterr().out
    err_lines = [line for line in captured.splitlines() if line.startswith("@@ERROR ")]
    assert err_lines
    payload = json.loads(err_lines[-1][len("@@ERROR "):])
    assert payload["code"] == "NO_SPEECH_DETECTED"
    assert not out_file.exists()


def test_whisper_preserves_groq_quota_when_offline_fallback_unavailable(tmp_path, monkeypatch):
    """Nếu Groq hết quota (429) và Whisper offline không sẵn sàng, lỗi ném ra phải giữ thông tin Groq quota."""
    from backend.ai.whisper_service import WhisperTranscriber

    dummy_video = tmp_path / "sample.mp4"
    dummy_video.write_bytes(b"fake video bytes")

    monkeypatch.setenv("WHISPER_API_KEY", "gsk_test_dummy_key_123456")
    transcriber = WhisperTranscriber(cache_dir=str(tmp_path / "cache"))
    monkeypatch.setattr("backend.ai.whisper_service.default_ai_config.whisper_api_key", "gsk_test_dummy_key_123456")

    def fake_groq(*args, **kwargs):
        raise RuntimeError("Groq API tra ve loi 429: rate_limit_exceeded")

    def fake_get_model(*args, **kwargs):
        raise RuntimeError("faster_whisper not available")

    with patch("backend.ai.groq_service.transcribe_with_groq", side_effect=fake_groq), \
         patch.object(transcriber, "_get_model", side_effect=fake_get_model):
        with pytest.raises(RuntimeError) as exc_info:
            transcriber.transcribe(str(dummy_video))

    err_msg = str(exc_info.value)
    assert "429" in err_msg or "quota" in err_msg.lower() or "rate_limit" in err_msg.lower()
