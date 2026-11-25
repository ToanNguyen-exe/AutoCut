"""Chọn tệp nguồn để bóc băng: chỉ nhận media, không nhận transcript.

Lỗi thực tế: backend phân tích "Bài giảng Lập trình Web Full khóa (2 Giờ ...)"
nhưng hàm tìm ứng viên glob `cache/hash_full_2hours_r2*` và khớp trúng
`hash_full_2hours_r2_transcript.json`. Pipeline bèn đem chính bản transcript đi
bóc băng: Groq trả 400 "unsupported_audio_format", rồi Whisper cục bộ chết với
`InvalidDataError`, cuối cùng `/analyze` trả 502.
"""

from pathlib import Path

import pytest

from backend.ai import cli


@pytest.mark.parametrize("name", [
    "vibe_short.mp4",
    "VIDEO.MP4",
    "clip.webm",
    "bai-giang.mkv",
    "audio.m4a",
    "voice.mp3",
    "sound.wav",
])
def test_media_hop_le(name):
    assert cli._is_media_file(Path(name)) is True


@pytest.mark.parametrize("name", [
    "hash_full_2hours_r2_transcript.json",   # đúng tệp đã gây lỗi
    "segments_javascript.json",
    "cut_points.json",
    "notes.txt",
    "video.mp4.txt",
    "config.yaml",
    "archive.zip",
    "clip.mp4.part",
])
def test_khong_phai_media(name):
    assert cli._is_media_file(Path(name)) is False


def test_json_transcript_bi_loai_khoi_ung_vien(tmp_path):
    """Mô phỏng đúng glob đã khớp nhầm, rồi khẳng định bộ lọc loại nó ra."""
    cache = tmp_path / "cache"
    cache.mkdir()
    transcript = cache / "hash_full_2hours_r2_transcript.json"
    transcript.write_text('{"video": "x", "sentences": []}', encoding="utf-8")
    real_video = cache / "hash_full_2hours_r2.mp4"
    real_video.write_bytes(b"\x00\x00\x00\x18ftypmp42")

    matched = sorted(cache.glob("hash_full_2hours_r2*"))
    assert len(matched) == 2, "glob phải khớp cả tệp json lẫn mp4"

    kept = [p for p in matched if cli._is_media_file(p)]
    assert kept == [real_video]
