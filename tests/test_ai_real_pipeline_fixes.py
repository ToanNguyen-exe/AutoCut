"""Tests for Step 3 AI pipeline fixes (#5 no synthetic transcript in real runs, #6 stem sanitization)."""

import json
import sys
import time
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backend.ai.cli as cli_mod
import backend.ai.groq_service as groq_mod
from backend.ai.models import Sentence, TranscriptOutput
from backend.ai.post_processor import sanitize_transcript_stem
from backend.ai.transcript_refiner import TranscriptRefiner


def test_cli_does_not_fabricate_fake_transcript_when_video_missing_outside_pytest(tmp_path, monkeypatch):
    """Kiểm tra (#5): Ngoài pytest, nếu không tìm thấy video thật thì KHÔNG bịa 8 câu giả và KHÔNG ghi rác vào transcripts/."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(cli_mod, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(cli_mod, "TRANSCRIPTS_DIR", tmp_path / "transcripts")
    monkeypatch.setattr(cli_mod, "SEGMENTS_DIR", tmp_path / "segments")

    out_file = tmp_path / "out.json"
    with pytest.raises(SystemExit) as exc_info:
        cli_mod.run_backend_analysis(
            video_name="MissingRealVideo.mp4",
            lesson="MissingRealLesson",
            file_hash=None,
            duration=120.0,
            output_path=str(out_file),
        )

    assert exc_info.value.code == 2
    transcripts_dir = tmp_path / "transcripts"
    written_files = list(transcripts_dir.glob("*_transcript.json")) if transcripts_dir.exists() else []
    assert written_files == [], f"Không được ghi file transcript giả vào transcripts/, nhưng tìm thấy: {written_files}"


def test_is_valid_real_transcript_rejects_legacy_synthetic_sentences():
    """Kiểm tra (#5): Bộ kiểm tra transcript thật phải từ chối 8 câu giả lập kiểu cũ."""
    fake_data = {
        "video": "Demo.mp4",
        "duration": 180.0,
        "sentences": [
            {"id": "S0001", "start": 0.0, "end": 22.5, "text": "Chào mừng các bạn đến với nội dung Demo.mp4."},
            {"id": "S0002", "start": 22.5, "end": 45.0, "text": "Trong phần này, chúng ta sẽ tìm hiểu tổng quan về Demo.mp4."},
            {"id": "S0003", "start": 45.0, "end": 67.5, "text": "Tiếp theo, chúng ta đi sâu vào các nội dung trọng tâm và cú pháp cốt lõi."},
            {"id": "S0004", "start": 67.5, "end": 180.0, "text": "Nội dung Demo.mp4 đến đây là hoàn thành."},
        ],
    }
    assert cli_mod.is_valid_real_transcript(fake_data) is False


def test_sanitize_transcript_stem_preserves_dots_in_titles_and_strips_only_media_extensions():
    """Kiểm tra (#6): Không cắt nhầm tên bài có dấu chấm như YTSave.to_... hay Node.js, chỉ cắt đuôi media thật."""
    with_ext = sanitize_transcript_stem("YTSave.to_YouTube_Media_NEgDBzHg9_c_Tự-học-JS.mp4")
    without_ext = sanitize_transcript_stem("YTSave.to_YouTube_Media_NEgDBzHg9_c_Tự-học-JS")
    assert with_ext == "ytsave-to_youtube_media_negdbzhg9_c_tu-hoc-js"
    assert without_ext == with_ext
    assert sanitize_transcript_stem("Node.js cơ bản") == "node-js-co-ban"
    assert sanitize_transcript_stem("Bài Học 01: Giới Thiệu Khóa Học") == "bai-hoc-01-gioi-thieu-khoa-hoc"


def test_transcribe_with_groq_can_skip_writing_raw_transcript_to_transcripts_dir(tmp_path, monkeypatch):
    """Kiểm tra: Khi cli gọi Groq làm bước trung gian (save_to_transcripts=False), không ghi thừa file thô vào transcripts/."""
    media = tmp_path / "5c3248_ytsave_to_demo.mp4"
    media.write_bytes(b"fake-mp4")
    transcripts_dir = tmp_path / "transcripts"

    monkeypatch.setattr(groq_mod, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(groq_mod, "TRANSCRIPTS_DIR", transcripts_dir)
    monkeypatch.setattr(groq_mod, "extract_audio_mp3", lambda src, dst: False)
    monkeypatch.setattr(groq_mod, "get_video_duration_seconds", lambda p: 10.0)
    monkeypatch.setattr(
        groq_mod,
        "call_groq_whisper_api",
        lambda **kw: {
            "duration": 10.0,
            "segments": [{"start": 0.0, "end": 5.0, "text": "Xin chào các bạn."}],
        },
    )

    result = groq_mod.transcribe_with_groq(
        str(media),
        api_key="gsk_test_key",
        save_to_transcripts=False,
    )

    assert len(result.sentences) == 1
    written = list(transcripts_dir.glob("*_transcript.json")) if transcripts_dir.exists() else []
    assert written == [], f"Không được xuất file thô thừa vào transcripts/, tìm thấy: {written}"


def test_generate_with_fallback_recovers_previously_429_models_when_remaining_model_returns_503():
    """Kiểm tra: Khi model còn lại duy nhất bị 503 UNAVAILABLE, hệ thống phải thử lại các model từng 429 trước đó thay vì chết ngay."""
    called = []

    class FakeModels:
        def generate_content(self, model, contents, config):
            called.append(model)
            if model == "gemini-flash-latest":
                raise RuntimeError("503 UNAVAILABLE: This model is currently experiencing high demand.")
            if model == "gemini-3.5-flash-lite":
                class Resp:
                    text = '{"sections": []}'
                return Resp()
            raise RuntimeError("429 RESOURCE_EXHAUSTED")

    class FakeClient:
        models = FakeModels()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"]
    refiner.model_name = "gemini-flash-latest"
    refiner.exhausted_models = {"gemini-3.5-flash-lite", "gemini-3.5-flash"}
    refiner.client = FakeClient()

    resp = refiner._generate_with_fallback("segment prompt")
    assert resp is not None
    assert refiner.model_name == "gemini-3.5-flash-lite"
    assert "gemini-3.5-flash-lite" in called
    assert "gemini-3.5-flash-lite" not in refiner.exhausted_models


def test_generate_with_fallback_evicts_429_model_after_cooldown():
    """Kiểm tra: Model từng 429 quá thời gian hồi (60s) phải tự động được mở lại để dùng trước model dự phòng."""
    called = []

    class FakeModels:
        def generate_content(self, model, contents, config):
            called.append(model)
            class Resp:
                text = '{"sections": []}'
            return Resp()

    class FakeClient:
        models = FakeModels()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite", "gemini-flash-latest"]
    refiner.model_name = "gemini-flash-latest"
    refiner.exhausted_models = {"gemini-3.5-flash-lite"}
    refiner._exhausted_at = {"gemini-3.5-flash-lite": time.monotonic() - 65.0}
    refiner.client = FakeClient()

    resp = refiner._generate_with_fallback("segment prompt")
    assert resp is not None
    assert called == ["gemini-3.5-flash-lite"]


def test_segment_transcript_respects_max_llm_chars_limit():
    """Kiểm tra: Prompt phân đoạn cho video dài (~90.000 ký tự) phải được nén gọn theo ngưỡng max_llm_chars (60.000 ký tự)."""
    sentences = [
        Sentence(
            id=f"S{i:04d}",
            start=float((i - 1) * 3),
            end=float(i * 3),
            text=f"Đây là nội dung bài giảng lập trình JavaScript câu số {i} rất dài và chi tiết để kiểm tra giới hạn ký tự đầu vào LLM.",
        )
        for i in range(1, 751)
    ]
    transcript = TranscriptOutput(video="long_js.mp4", duration=2250.0, sentences=sentences)

    captured_prompts = []

    def fake_generate(prompt: str):
        captured_prompts.append(prompt)
        class Resp:
            text = json.dumps({
                "sections": [
                    {
                        "label": "Lý thuyết",
                        "topics": [
                            {"title": "Tổng quan", "slug": "tong-quan", "start_id": "S0001", "end_id": "S0750"}
                        ],
                    }
                ]
            })
        return Resp()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite"]
    refiner.model_name = "gemini-3.5-flash-lite"
    refiner._generate_with_fallback = fake_generate

    TranscriptRefiner.segment_transcript(refiner, transcript, lesson_name="LongJS", force_ai=True, max_retries=1)

    assert len(captured_prompts) == 1
    assert len(captured_prompts[0]) <= 64000, f"Prompt quá dài: {len(captured_prompts[0])} ký tự"
    assert "S0001" in captured_prompts[0]
    assert "S0750" in captured_prompts[0]


def test_refine_transcript_splits_overmerged_multi_sentence_item():
    """Kiểm tra: Nếu Gemini lỡ gộp 3 câu độc lập thành 1 mục dài, Refiner phải tự tách lại thành 3 câu đơn có mốc thời gian."""
    sentences = [
        Sentence(id="S0001", start=0.0, end=5.0, text="Câu mở đầu."),
        Sentence(id="S0002", start=5.0, end=12.0, text="JavaScript viết được nhiều app"),
        Sentence(id="S0003", start=12.0, end=20.0, text="Cộng đồng lập trình viên rất lớn"),
        Sentence(id="S0004", start=20.0, end=29.0, text="Nhu cầu tuyển dụng ở Việt Nam rất cao"),
    ]
    transcript = TranscriptOutput(video="js.mp4", duration=29.0, sentences=sentences)

    class OverMergedResp:
        text = json.dumps({
            "sentences": [
                {"start_id": "S0001", "end_id": "S0001", "text": "Câu mở đầu."},
                {
                    "start_id": "S0002",
                    "end_id": "S0004",
                    "text": (
                        "JavaScript viết được nhiều app từ desktop đến mobile. "
                        "Cộng đồng lập trình viên rất lớn với kho thư viện khổng lồ. "
                        "Nhu cầu tuyển dụng ở Việt Nam rất cao."
                    ),
                },
            ]
        })

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite"]
    refiner.model_name = "gemini-3.5-flash-lite"
    refiner.exhausted_models = set()
    refiner._generate_with_fallback = lambda *a, **kw: OverMergedResp()

    result = TranscriptRefiner.refine_transcript(refiner, transcript)
    assert len(result.sentences) == 4, f"Phải tách thành 4 câu đơn, thực tế: {[s.text for s in result.sentences]}"
    assert result.sentences[1].start == 5.0
    assert result.sentences[3].end == 29.0
    assert result.sentences[1].end <= result.sentences[2].start + 0.01
    assert result.sentences[2].end <= result.sentences[3].start + 0.01


def test_model_priority_matches_week2_branch(monkeypatch):
    """Kiểm tra: 3 model Groq (20B chau chuốt, 120B phân đoạn, Qwen dự phòng) làm chính và chuỗi Gemini (flash-lite đầu) dự phòng."""
    import backend.ai.config_loader as config_mod
    import backend.ai.transcript_refiner as refiner_mod

    expected_gemini = [
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-pro-latest",
    ]
    expected_refine_order = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", *expected_gemini]
    expected_segment_order = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", *expected_gemini]

    monkeypatch.delenv("GROQ_REFINE_MODEL", raising=False)
    monkeypatch.delenv("GROQ_SEGMENT_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    fresh_cfg = config_mod.AIConfig(config_dict={})
    assert fresh_cfg.groq_refine_model == "openai/gpt-oss-20b"
    assert fresh_cfg.groq_segment_model == "openai/gpt-oss-120b"
    assert fresh_cfg.gemini_model == "gemini-3.5-flash-lite"

    monkeypatch.setattr(refiner_mod.default_ai_config, "groq_refine_model", fresh_cfg.groq_refine_model)
    monkeypatch.setattr(refiner_mod.default_ai_config, "groq_segment_model", fresh_cfg.groq_segment_model)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_model", fresh_cfg.gemini_model)
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: object())

    refiner = TranscriptRefiner(api_key="fake-test-key", groq_api_key="gsk_fake_test")
    assert refiner_mod.FALLBACK_MODELS == expected_refine_order
    assert refiner.refine_models_to_try == expected_refine_order
    assert refiner.segment_models_to_try == expected_segment_order
    assert refiner.models_to_try == expected_refine_order
    assert refiner.model_name == "openai/gpt-oss-20b"


def test_generate_with_fallback_skips_404_not_found_models_for_rest_of_session():
    """Kiểm tra: Model trả về 404 NOT_FOUND chỉ bị thử 1 lần rồi bỏ qua suốt phiên, không gây gọi lại vô ích."""
    called = []

    class FakeModels:
        def generate_content(self, model, contents, config):
            called.append(model)
            if model in ("gemini-3.8-flash", "gemini-3.6-flash"):
                raise RuntimeError("404 NOT_FOUND. models/gemini-3.8-flash is not found for API version v1beta")
            class Resp:
                text = '{"sections": []}'
            return Resp()

    class FakeClient:
        models = FakeModels()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"]
    refiner.model_name = "gemini-3.8-flash"
    refiner.exhausted_models = set()
    refiner._unavailable_models = set()
    refiner.client = FakeClient()

    resp1 = refiner._generate_with_fallback("batch 1")
    resp2 = refiner._generate_with_fallback("batch 2")

    assert resp1 is not None and resp2 is not None
    assert called == ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash"]
    assert refiner._unavailable_models == {"gemini-3.8-flash", "gemini-3.6-flash"}


def test_segment_transcript_compacts_very_long_1600_sentence_transcript_within_budget():
    """Kiểm tra: Video dài 1.650 câu vẫn nằm gọn trong ngân sách max_llm_chars (~60.000) và giữ đủ S0001..S1650."""
    sentences = [
        Sentence(
            id=f"S{i:04d}",
            start=float((i - 1) * 2),
            end=float(i * 2),
            text=f"Đây là nội dung giảng bài lập trình JavaScript phần câu {i} giải thích chi tiết về biến và hàm trong thực tế.",
        )
        for i in range(1, 1651)
    ]
    transcript = TranscriptOutput(video="js_1h.mp4", duration=3300.0, sentences=sentences)

    captured = []

    def fake_generate(prompt: str):
        captured.append(prompt)
        class Resp:
            text = json.dumps({
                "sections": [
                    {
                        "label": "Lý thuyết",
                        "topics": [
                            {"title": "Tổng quan JS", "slug": "tong-quan-js", "start_id": "S0001", "end_id": "S1650"}
                        ],
                    }
                ]
            })
        return Resp()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash"]
    refiner.model_name = "gemini-3.5-flash"
    refiner._generate_with_fallback = fake_generate

    TranscriptRefiner.segment_transcript(refiner, transcript, lesson_name="JS 1h", force_ai=True, max_retries=1)

    assert len(captured) == 1
    assert len(captured[0]) <= 64000, f"Prompt 1650 câu vượt ngân sách: {len(captured[0])} ký tự"
    assert "S0001" in captured[0]
    assert "S1650" in captured[0]
