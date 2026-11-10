"""Unit tests for mandatory AI segmentation with retry loop."""

import json
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai.models import Sentence, TranscriptOutput
from backend.ai.transcript_refiner import TranscriptRefiner


def test_segment_transcript_retries_until_ai_succeeds():
    """Kiểm tra: Nếu AI gặp lỗi ở các lần thử đầu, hệ thống phải tự động thử lại cho đến khi AI thành công."""
    sentences = [
        Sentence(id="S0001", start=0.0, end=10.0, text="Giới thiệu khóa học."),
        Sentence(id="S0002", start=10.0, end=60.0, text="Khái niệm biến và kiểu dữ liệu."),
        Sentence(id="S0003", start=60.0, end=120.0, text="Tổng kết bài giảng.")
    ]
    transcript = TranscriptOutput(video="test.mp4", duration=120.0, sentences=sentences)

    attempt_count = 0

    class MockResponse:
        text = json.dumps({
            "sections": [
                {
                    "label": "Bài học",
                    "topics": [
                        {
                            "title": "Nội dung bài học",
                            "slug": "noi-dung-bai-hoc",
                            "start_id": "S0001",
                            "end_id": "S0003"
                        }
                    ]
                }
            ]
        })

    def mock_generate(*args, **kwargs):
        nonlocal attempt_count
        attempt_count += 1
        if attempt_count < 3:
            # Giả lập 2 lần đầu gặp lỗi 429 hoặc lỗi mạng
            raise RuntimeError(f"Lỗi thử nghiệm lần {attempt_count}")
        return MockResponse()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash"]
    refiner._generate_with_fallback = mock_generate

    # Gọi segment_transcript với force_ai=True
    segments_data = TranscriptRefiner.segment_transcript(
        refiner,
        transcript=transcript,
        lesson_name="TestLesson",
        force_ai=True,
        max_retries=5
    )

    # Đảm bảo hệ thống đã kiên trì thử lại 3 lần cho đến khi thành công
    assert attempt_count == 3
    assert "segments" in segments_data
    assert len(segments_data["segments"]) > 0


def test_segment_transcript_raises_when_ai_fails_and_force_ai_is_true():
    """Kiểm tra: Bắt buộc dùng AI, nếu AI thử hết số lần mà vẫn lỗi thì phải raise lỗi chứ không dùng fallback giả."""
    sentences = [
        Sentence(id="S0001", start=0.0, end=10.0, text="Mở đầu."),
        Sentence(id="S0002", start=10.0, end=20.0, text="Kết thúc.")
    ]
    transcript = TranscriptOutput(video="test.mp4", duration=20.0, sentences=sentences)

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash"]
    refiner._generate_with_fallback = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("API Quota 429"))

    with pytest.raises(RuntimeError) as exc_info:
        TranscriptRefiner.segment_transcript(
            refiner,
            transcript=transcript,
            lesson_name="TestFail",
            force_ai=True,
            max_retries=2
        )

    assert "Bắt buộc phân đoạn bằng AI" in str(exc_info.value)

