"""Test cho 2 điểm sửa: xếp hạng mức khớp transcript và giữ model Whisper giữa các video.

Không đổi chất lượng AI: chỉ loại trường hợp lấy nhầm transcript và tránh nạp lại model.
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai import cli
from backend.ai.whisper_service import WhisperTranscriber


def _write(path: Path, video: str, duration: float = 100.0, n: int = 5) -> Path:
    data = {
        "video": video,
        "duration": duration,
        "sentences": [
            {"id": f"S{i:04d}", "start": float(i), "end": float(i + 1), "text": f"Câu {i}"}
            for i in range(1, n + 1)
        ],
    }
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------------------------------------------------------- mức khớp

def test_match_rank_exact_name_beats_stem():
    assert cli._match_rank("bai1.mp4", "bai1.mp4") == 3
    assert cli._match_rank("bai1.mkv", "bai1.mp4") == 1
    assert cli._match_rank("khac.mp4", "bai1.mp4") == 0


def test_match_rank_uses_duration_to_confirm_or_reject():
    # Cùng stem, duration khớp → mức 2 (đủ tin)
    assert cli._match_rank("bai1.mkv", "bai1.mp4", 100.0, 100.4) == 2
    # Cùng stem nhưng duration lệch xa → chắc chắn là video khác
    assert cli._match_rank("bai1.mkv", "bai1.mp4", 60.0, 7200.0) == 0


def test_two_ambiguous_transcripts_are_skipped_instead_of_guessed(tmp_path):
    """Hai bản cùng stem khác đuôi, không có duration để phân định → trả [] để bóc băng lại."""
    _write(tmp_path / "a_transcript.json", "bai1.mkv")
    _write(tmp_path / "b_transcript.json", "bai1.webm")

    found = cli._cache_transcripts_for("bai1.mp4", tmp_path)
    assert found == [], f"Không được đoán bừa, thực tế trả về: {found}"


def test_ambiguous_is_resolved_when_duration_matches(tmp_path):
    good = _write(tmp_path / "a_transcript.json", "bai1.mkv", duration=100.0)
    _write(tmp_path / "b_transcript.json", "bai1.webm", duration=60.0)

    found = cli._cache_transcripts_for("bai1.mp4", tmp_path, expected_duration=100.2)
    assert found == [good]


def test_exact_name_wins_over_same_stem(tmp_path):
    exact = _write(tmp_path / "a_transcript.json", "bai1.mp4")
    _write(tmp_path / "b_transcript.json", "bai1.mkv")

    assert cli._cache_transcripts_for("bai1.mp4", tmp_path) == [exact]


# ------------------------------------------------------- giữ model Whisper

def _fake_ok():
    class FakeModel:
        def transcribe(self, path, **kwargs):
            gen = iter([SimpleNamespace(start=0.0, end=3.0, text="Câu thử.")])
            return gen, SimpleNamespace(duration=3.0)

    return FakeModel()


def test_release_after_use_false_keeps_model_for_next_video(tmp_path, monkeypatch):
    media = tmp_path / "a.mp3"
    media.write_bytes(b"x")

    t = WhisperTranscriber(cache_dir=str(tmp_path / "cache"))
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    monkeypatch.setattr("backend.ai.whisper_service.default_ai_config.whisper_api_key", "")

    t._model = _fake_ok()
    t.transcribe(str(media), force_recompute=True, release_after_use=False)
    assert t._model is not None, "Phải giữ model để video kế tiếp không nạp lại"

    # Lần hai dùng lại đúng instance, không nạp model mới
    second = _fake_ok()
    t._model = second
    t.transcribe(str(media), force_recompute=True, release_after_use=True)
    assert t._model is None, "Video cuối phải giải phóng model"


def test_model_is_released_even_when_keeping_is_requested_but_call_fails(tmp_path, monkeypatch):
    media = tmp_path / "b.mp3"
    media.write_bytes(b"x")

    t = WhisperTranscriber(cache_dir=str(tmp_path / "cache"))
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    monkeypatch.setattr("backend.ai.whisper_service.default_ai_config.whisper_api_key", "")

    class Boom:
        def transcribe(self, path, **kwargs):
            raise RuntimeError("Out of memory simulated")

    t._model = Boom()
    with pytest.raises(RuntimeError):
        t.transcribe(str(media), force_recompute=True, release_after_use=False)
    assert t._model is None, "Lỗi thì phải trả RAM ngay, kể cả khi xin giữ model"
