"""Tìm transcript có sẵn trong cache theo tên video.

Trước đây pipeline chỉ tra cache khi backend truyền `--hash`. Video phát từ R2
không có hash nên cache bị bỏ qua, và một video 2 giờ bị bóc băng lại từ đầu
(Whisper trên CPU: hàng giờ) dù transcript 756 câu đã nằm sẵn trong cache.
"""

import json
from pathlib import Path

from backend.ai import cli

VIDEO = "Bài giảng Lập trình Web Full khóa (2 Giờ - Vibe-Coding-4.mp4)"


def _write(path: Path, video: str, sentences: int = 3):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "video": video,
        "duration": 7200.0,
        "sentences": [
            {"id": f"S{i:04d}", "start": i * 10.0, "end": i * 10.0 + 9.0,
             "text": f"câu số {i}"}
            for i in range(1, sentences + 1)
        ],
    }
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def test_tim_theo_ten_video(tmp_path):
    hit = _write(tmp_path / "hash_full_2hours_r2_transcript.json", VIDEO)
    _write(tmp_path / "khac_transcript.json", "video khác.mp4")

    found = cli._cache_transcripts_for(VIDEO, tmp_path)
    assert found == [hit]


def test_khop_khong_phan_biet_hoa_thuong_va_duoi_tep(tmp_path):
    hit = _write(tmp_path / "a_transcript.json", VIDEO.lower())

    assert cli._cache_transcripts_for(VIDEO, tmp_path) == [hit]
    # tên gọi không có đuôi .mp4 vẫn khớp theo stem
    assert cli._cache_transcripts_for(Path(VIDEO).stem, tmp_path) == [hit]


def test_bo_qua_tep_hong_thay_vi_no(tmp_path):
    _write(tmp_path / "tot_transcript.json", VIDEO)
    (tmp_path / "hong_transcript.json").write_text("{ khong phai json", encoding="utf-8")

    found = cli._cache_transcripts_for(VIDEO, tmp_path)
    assert [p.name for p in found] == ["tot_transcript.json"]


def test_khong_khop_thi_tra_rong(tmp_path):
    _write(tmp_path / "khac_transcript.json", "video khác.mp4")

    assert cli._cache_transcripts_for(VIDEO, tmp_path) == []
    assert cli._cache_transcripts_for("", tmp_path) == []


def test_cache_that_cua_du_an_van_tim_duoc():
    """Chạy trên cache thật của repo (nếu còn tệp), không thì bỏ qua."""
    cache_dir = cli.PROJECT_ROOT / "cache"
    hit = cache_dir / "hash_full_2hours_r2_transcript.json"
    if not hit.exists():
        import pytest
        pytest.skip("cache thật không còn tệp này")

    found = cli._cache_transcripts_for(VIDEO, cache_dir)
    assert hit in found
