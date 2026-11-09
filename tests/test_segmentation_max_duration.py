"""Test Suite: Giới hạn phân đoạn tối đa 7 phút (420s) và tự động xuất JSON vào folder output.

Yêu cầu kiểm thử:
1. Mỗi video / phân đoạn không được dài quá 7 phút (420.0 giây).
2. Nếu một chủ đề dài hơn 7 phút, tự động chia thành các phân đoạn nhỏ trong chủ đề đó (Phần 1, Phần 2...).
3. Khi phân tích AI (run_backend_analysis), file segments_<lesson>.json và segments.json phải được tự động tạo trong folder output/.
4. Tên file trong folder output/ không chứa dấu tiếng Việt và không chứa khoảng trắng.
"""

import json
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai.models import Sentence, TranscriptOutput
from backend.ai.transcript_refiner import TranscriptRefiner
from backend.ai.cli import run_backend_analysis


def test_segment_duration_limit_and_sub_segments():
    """Kiểm tra: Chủ đề dài hơn 7 phút (420s) phải được tách thành nhiều đoạn nhỏ <= 420s."""
    # Tạo một transcript giả định dài 900 giây (15 phút) gồm 1 chủ đề dài
    total_dur = 900.0
    num_sentences = 60
    step = total_dur / num_sentences

    sentences = [
        Sentence(
            id=f"S{i:04d}",
            start=round((i - 1) * step, 2),
            end=round(i * step, 2),
            text=f"Nội dung câu thứ {i} về cấu trúc điều khiển nâng cao."
        )
        for i in range(1, num_sentences + 1)
    ]

    transcript = TranscriptOutput(
        video="BaiHocDai.mp4",
        duration=total_dur,
        sentences=sentences
    )

    # Giả lập Gemini LLM phân tích ra 1 chủ đề dài 15 phút (900s)
    class MockLLMResponse:
        text = json.dumps({
            "sections": [
                {
                    "label": "Lý thuyết",
                    "topics": [
                        {
                            "title": "Cấu trúc điều khiển nâng cao",
                            "slug": "cau-truc-dieu-khien-nang-cao",
                            "start_id": "S0001",
                            "end_id": f"S{num_sentences:04d}"
                        }
                    ]
                }
            ]
        })

    dummy_refiner = object.__new__(TranscriptRefiner)
    dummy_refiner.models_to_try = []
    dummy_refiner._generate_with_fallback = lambda *a, **kw: MockLLMResponse()

    segments_data = TranscriptRefiner.segment_transcript(
        dummy_refiner,
        transcript=transcript,
        lesson_name="Cấu trúc điều khiển",
        max_part_duration=420.0
    )

    segments = segments_data.get("segments", [])
    assert len(segments) > 0, "Danh sách phân đoạn không được rỗng"

    # Kiểm tra quy tắc 1: Không có phân đoạn nào dài hơn 420.0 giây
    for seg in segments:
        dur = seg["end"] - seg["start"]
        assert dur <= 420.0 + 1e-2, f"Phân đoạn {seg['id']} dài {dur}s > 420.0s (7 phút)"
        for part in seg.get("parts", []):
            part_dur = part["end"] - part["start"]
            assert part_dur <= 420.0 + 1e-2, f"Part {part['part']} dài {part_dur}s > 420.0s"

    # Kiểm tra quy tắc 2: Chủ đề 15 phút phải được chia thành 3 phần (900 / 3 = 300s <= 420s)
    assert len(segments) == 3, f"Chủ đề 900s phải được chia thành 3 đoạn nhỏ <= 420s, thực tế có {len(segments)} đoạn"
    assert "Cấu trúc điều khiển nâng cao (Phần 1)" in segments[0]["topic"]
    assert "Cấu trúc điều khiển nâng cao (Phần 2)" in segments[1]["topic"]
    assert "Cấu trúc điều khiển nâng cao (Phần 3)" in segments[2]["topic"]
    assert segments[0]["parts"][0]["file"].endswith("_Phan1.mp4")


def test_auto_generate_segments_json_in_output(tmp_path):
    """Kiểm tra: run_backend_analysis tự động xuất file JSON vào folder output/."""
    # Tạo video name và lesson có dấu và khoảng trắng để test cả việc sanitize tên file
    video_name = "BaiGiang_Test_Output.mp4"
    lesson_name = "Bài Học 01: Giới Thiệu Khóa Học"

    output_path = tmp_path / "temp_analyze.json"

    run_backend_analysis(
        video_name=video_name,
        lesson=lesson_name,
        file_hash="dummy_hash_test_auto_output_123456",
        duration=300.0,
        output_path=str(output_path)
    )

    # File trả về cho Spring Boot phải tồn tại
    assert output_path.exists(), "Tệp analyze tạm phải tồn tại"

    # Folder output/ của dự án phải có các file segments
    project_output = Path(__file__).resolve().parent.parent / "output"
    assert project_output.exists(), "Thư mục output/ phải tồn tại"

    # Tên file cho bài học không được có dấu và khoảng trắng
    clean_stem = "bai-hoc-01-gioi-thieu-khoa-hoc"
    lesson_segments_file = project_output / f"segments_{clean_stem}.json"
    assert lesson_segments_file.exists(), f"output/segments_{clean_stem}.json phải được tạo tự động"

    # Mỗi video chỉ có duy nhất 1 file segment trong output/ (không tạo file thừa segments.json)
    root_segments_file = project_output / "segments.json"
    assert not root_segments_file.exists(), "Không được tạo tệp trùng lặp output/segments.json"

    # Mỗi video chỉ có duy nhất 1 file transcript trong transcripts/ (không tạo file thừa transcript.json ở root)
    root_transcript_file = Path(__file__).resolve().parent.parent / "transcript.json"
    assert not root_transcript_file.exists(), "Không được tạo tệp trùng lặp transcript.json ở thư mục gốc"

    # Đọc nội dung kiểm tra tính hợp lệ
    with open(lesson_segments_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["lesson"] == lesson_name
    assert "segments" in data

    # Đảm bảo không tạo folder con trong output/ và không có folder backend/output
    assert not (project_output / clean_stem).exists(), f"Không được tạo thư mục con {clean_stem} trong output/"
    assert not (Path(__file__).resolve().parent.parent / "backend" / "output").exists(), "Không được tạo thư mục backend/output"


def test_fallback_segmentation_respects_max_duration():
    """Kiểm tra: Khi Gemini offline, cơ chế fallback cũng đảm bảo mọi đoạn <= 420s."""
    total_dur = 1200.0  # 20 phút
    sentences = [
        Sentence(id="S0001", start=0.0, end=10.0, text="Mở đầu bài giảng."),
        Sentence(id="S0002", start=10.0, end=20.0, text="Nội dung chính."),
        Sentence(id="S0003", start=20.0, end=1190.0, text="Thực hành chi tiết kéo dài."),
        Sentence(id="S0004", start=1190.0, end=1200.0, text="Tổng kết bài giảng.")
    ]
    transcript = TranscriptOutput(video="Video20Phut.mp4", duration=total_dur, sentences=sentences)

    dummy_refiner = object.__new__(TranscriptRefiner)
    dummy_refiner.models_to_try = []
    dummy_refiner._generate_with_fallback = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Offline"))

    segments_data = TranscriptRefiner.segment_transcript(
        dummy_refiner,
        transcript=transcript,
        lesson_name="BaiHocDai20Phut",
        max_part_duration=420.0
    )

    segments = segments_data.get("segments", [])
    assert len(segments) >= 3, "20 phút (1200s) phải có ít nhất 3 phân đoạn"
    for seg in segments:
        dur = seg["end"] - seg["start"]
        assert dur <= 420.0 + 1e-2, f"Phân đoạn {seg['id']} dài {dur}s > 420s"

