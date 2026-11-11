"""Unit tests for Gemini TranscriptRefiner smart sentence merging and timestamp alignment."""

import json
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai.models import Sentence, TranscriptOutput
from backend.ai.transcript_refiner import TranscriptRefiner


def test_refine_transcript_merges_fragmented_sentences():
    """Kiểm tra: Gemini gộp các câu vụn lửng lơ và tự động map start_id -> start, end_id -> end."""
    sentences = [
        Sentence(id="S0001", start=0.0, end=5.0, text="JavaScript là ngôn ngữ rất phổ biến."),
        Sentence(id="S0002", start=5.0, end=8.0, text="Anh em có thể viết app từ desktop."),
        Sentence(id="S0003", start=8.0, end=9.5, text="Cho đến mobile."),
        Sentence(id="S0004", start=9.5, end=15.0, text="Cộng đồng lập trình viên rất đông đảo.")
    ]

    transcript = TranscriptOutput(
        video="test.mp4",
        duration=15.0,
        sentences=sentences
    )

    class MockLLMResponse:
        text = json.dumps({
            "sentences": [
                {
                    "start_id": "S0001",
                    "end_id": "S0001",
                    "text": "JavaScript là ngôn ngữ rất phổ biến."
                },
                {
                    "start_id": "S0002",
                    "end_id": "S0003",
                    "text": "Anh em có thể viết app từ desktop cho đến mobile."
                },
                {
                    "start_id": "S0004",
                    "end_id": "S0004",
                    "text": "Cộng đồng lập trình viên rất đông đảo."
                }
            ]
        })

    dummy_refiner = object.__new__(TranscriptRefiner)
    dummy_refiner.models_to_try = []
    dummy_refiner._generate_with_fallback = lambda *a, **kw: MockLLMResponse()

    result = TranscriptRefiner.refine_transcript(dummy_refiner, transcript)

    # 4 câu đầu vào được gộp thành 3 câu hoàn chỉnh
    assert len(result.sentences) == 3

    # Câu thứ 2 gộp từ S0002 và S0003
    s2 = result.sentences[1]
    assert s2.id == "S0002"
    assert s2.start == 5.0
    assert s2.end == 9.5
    assert "desktop cho đến mobile" in s2.text

    # Không có trường words trong JSON xuất ra
    json_str = result.model_dump_json()
    assert '"words"' not in json_str


def test_refine_transcript_preserves_independent_sentences_and_verbatim_words():
    """Kiểm tra: Giữ nguyên vẹn từng câu đơn độc lập và bảo toàn từ ngữ gốc (không gọt câu quá tay)."""
    sentences = [
        Sentence(id="S0001", start=0.0, end=3.0, text="Xếp hạng tất cả các món phở."),
        Sentence(id="S0002", start=3.0, end=6.0, text="Thế nhưng mà cái trải nghiệm một buổi sáng đi ăn phở."),
        Sentence(id="S0003", start=6.0, end=9.0, text="Vẫn là một trải nghiệm khó món nào thay thế được.")
    ]

    transcript = TranscriptOutput(
        video="food_review.mp4",
        duration=9.0,
        sentences=sentences
    )

    class MockLLMResponseGranular:
        text = json.dumps({
            "sentences": [
                {
                    "start_id": "S0001",
                    "end_id": "S0001",
                    "text": "Xếp hạng tất cả các món phở."
                },
                {
                    "start_id": "S0002",
                    "end_id": "S0003",
                    "text": "Thế nhưng mà cái trải nghiệm một buổi sáng đi ăn phở vẫn là một trải nghiệm khó món nào thay thế được."
                }
            ]
        })

    dummy_refiner = object.__new__(TranscriptRefiner)
    dummy_refiner.models_to_try = []
    dummy_refiner._generate_with_fallback = lambda *a, **kw: MockLLMResponseGranular()

    result = TranscriptRefiner.refine_transcript(dummy_refiner, transcript)

    # Câu độc lập S0001 được giữ riêng
    assert result.sentences[0].id == "S0001"
    assert result.sentences[0].text == "Xếp hạng tất cả các món phở."

    # Câu S0002 và S0003 bị vỡ vế câu được gộp lại, bảo toàn các từ đệm 'Thế nhưng mà'
    assert result.sentences[1].id == "S0002"
    assert "Thế nhưng mà" in result.sentences[1].text
    assert result.sentences[1].end == 9.0
