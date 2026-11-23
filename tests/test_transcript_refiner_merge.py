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


def test_refiner_client_uses_at_least_60s_timeout(monkeypatch):
    """Kiểm tra (#3): Client Gemini Refiner phải dùng timeout >= 60000ms (60s) để tránh 504 DEADLINE_EXCEEDED."""
    import backend.ai.transcript_refiner as refiner_mod

    captured_kwargs = {}

    def fake_client(**kwargs):
        captured_kwargs.update(kwargs)
        return object()

    monkeypatch.setattr(refiner_mod.genai, "Client", fake_client)
    TranscriptRefiner(api_key="fake-test-key")

    timeout_ms = captured_kwargs.get("http_options", {}).get("timeout", 0)
    assert timeout_ms >= 60000.0, f"Timeout phải >= 60000ms, thực tế: {timeout_ms}"


def test_refine_transcript_continues_after_two_transient_503_failures():
    """Kiểm tra (#4): Sau 2 lô gặp 503 tạm thời, Refiner vẫn tiếp tục hiệu đính các lô còn lại."""
    sentences = [
        Sentence(id=f"S{i:04d}", start=float(i * 2), end=float(i * 2 + 2), text=f"cau tho {i}")
        for i in range(1, 5)
    ]
    transcript = TranscriptOutput(video="demo.mp4", duration=10.0, sentences=sentences)

    def mock_generate(prompt: str):
        if "cau tho 1" in prompt or "cau tho 2" in prompt:
            raise RuntimeError("503 UNAVAILABLE: Model overloaded")
        for idx, sid in ((3, "S0003"), (4, "S0004")):
            if f"cau tho {idx}" in prompt:
                class Resp:
                    text = json.dumps({
                        "sentences": [{"start_id": sid, "end_id": sid, "text": f"Da hieu dinh {sid}."}]
                    })
                return Resp()
        raise AssertionError(f"Unexpected prompt: {prompt}")

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite"]
    refiner.model_name = "gemini-3.5-flash-lite"
    refiner.exhausted_models = set()
    refiner._build_char_batches = lambda sents, **kw: [[s] for s in sents]
    refiner._generate_with_fallback = mock_generate

    result = TranscriptRefiner.refine_transcript(refiner, transcript, max_workers=1)

    assert [s.id for s in result.sentences] == ["S0001", "S0002", "S0003", "S0004"]
    assert result.sentences[2].text == "Da hieu dinh S0003."
    assert result.sentences[3].text == "Da hieu dinh S0004."


def test_refine_transcript_processes_batches_concurrently_preserving_order():
    """Kiểm tra (#4): Refiner xử lý song song có giới hạn nhiều lô và giữ nguyên thứ tự câu."""
    import threading
    import time

    sentences = [
        Sentence(id=f"S{i:04d}", start=float(i * 2), end=float(i * 2 + 2), text=f"cau goc {i}")
        for i in range(1, 5)
    ]
    transcript = TranscriptOutput(video="long_lecture.mp4", duration=10.0, sentences=sentences)

    lock = threading.Lock()
    active = 0
    max_active = 0

    def slow_mock_generate(prompt: str):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.12)
        with lock:
            active -= 1
        for i in range(1, 5):
            sid = f"S{i:04d}"
            if f"cau goc {i}" in prompt:
                class Resp:
                    text = json.dumps({
                        "sentences": [{"start_id": sid, "end_id": sid, "text": f"Chuan hoa {sid}."}]
                    })
                return Resp()
        raise AssertionError("Unexpected prompt")

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite"]
    refiner.model_name = "gemini-3.5-flash-lite"
    refiner.exhausted_models = set()
    refiner._build_char_batches = lambda sents, **kw: [[s] for s in sents]
    refiner._generate_with_fallback = slow_mock_generate

    result = TranscriptRefiner.refine_transcript(refiner, transcript)

    assert max_active >= 2, f"Các lô phải chạy song song (max_active >= 2), thực tế: {max_active}"
    assert [s.id for s in result.sentences] == ["S0001", "S0002", "S0003", "S0004"]
    assert [s.text for s in result.sentences] == [
        "Chuan hoa S0001.",
        "Chuan hoa S0002.",
        "Chuan hoa S0003.",
        "Chuan hoa S0004.",
    ]
