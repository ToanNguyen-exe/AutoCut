"""Unit tests (TDD) for Groq dual-model LLM pipeline (refine: gpt-oss-20b, segment: gpt-oss-120b) with Gemini fallback."""

import io
import json
import logging
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backend.ai.config_loader as config_mod
import backend.ai.transcript_refiner as refiner_mod
from backend.ai.models import Sentence, TranscriptOutput
from backend.ai.transcript_refiner import TranscriptRefiner


class _FakeHTTPResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


@pytest.fixture(autouse=True)
def _isolate_default_ai_config(monkeypatch):
    """Đảm bảo unit test không phụ thuộc vào .env cục bộ trên máy lập trình viên."""
    monkeypatch.setattr(refiner_mod.default_ai_config, "groq_refine_model", "openai/gpt-oss-20b", raising=False)
    monkeypatch.setattr(refiner_mod.default_ai_config, "groq_segment_model", "openai/gpt-oss-120b", raising=False)
    monkeypatch.setattr(
        refiner_mod.default_ai_config,
        "groq_api_url",
        "https://api.groq.com/openai/v1/chat/completions",
        raising=False,
    )
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_model", "gemini-3.8-flash", raising=False)


def test_config_defaults_groq_dual_models_and_removes_openrouter(monkeypatch):
    """AIConfig mặc định dùng 2 model Groq (gpt-oss-20b refine, gpt-oss-120b segment) và không còn thuộc tính OpenRouter."""
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_REFINE_MODEL", raising=False)
    monkeypatch.delenv("GROQ_SEGMENT_MODEL", raising=False)
    monkeypatch.delenv("GROQ_API_URL", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)

    monkeypatch.setenv("GROQ_API_KEY", "gsk_from_groq_env")
    cfg = config_mod.AIConfig(config_dict={})
    assert cfg.groq_api_key == "gsk_from_groq_env"
    assert cfg.groq_refine_model == "openai/gpt-oss-20b"
    assert cfg.groq_segment_model == "openai/gpt-oss-120b"
    assert cfg.groq_api_url == "https://api.groq.com/openai/v1/chat/completions"
    assert cfg.gemini_model == "gemini-3.8-flash"
    assert not hasattr(cfg, "openrouter_api_key")
    assert not hasattr(cfg, "openrouter_model")
    assert not hasattr(cfg, "openrouter_api_url")

    # Nếu chỉ có WHISPER_API_KEY (key Groq cũ), vẫn tự dùng làm groq_api_key
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("WHISPER_API_KEY", "gsk_from_whisper_env")
    cfg_fallback = config_mod.AIConfig(config_dict={})
    assert cfg_fallback.groq_api_key == "gsk_from_whisper_env"


def test_refiner_builds_distinct_groq_priority_lists_for_refine_and_segment(monkeypatch):
    """Chau chuốt ưu tiên gpt-oss-20b -> gpt-oss-120b -> Gemini; phân đoạn ưu tiên gpt-oss-120b -> gpt-oss-20b -> Gemini."""
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: object())

    refiner = TranscriptRefiner(
        api_key="fake-gemini-key",
        groq_api_key="gsk_fake_test",
    )

    expected_gemini = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash-lite",
        "gemini-pro-latest",
    ]
    assert refiner.refine_models_to_try == ["openai/gpt-oss-20b", "openai/gpt-oss-120b", *expected_gemini]
    assert refiner.segment_models_to_try == ["openai/gpt-oss-120b", "openai/gpt-oss-20b", *expected_gemini]
    assert refiner.models_to_try == refiner.refine_models_to_try
    assert refiner.model_name == "openai/gpt-oss-20b"


def test_refiner_works_with_only_groq_key_without_gemini(monkeypatch):
    """Có thể khởi tạo và chạy chỉ với GROQ_API_KEY mà không bắt buộc phải có GEMINI_API_KEY."""
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")
    monkeypatch.setattr(refiner_mod.default_ai_config, "groq_api_key", "gsk_only", raising=False)

    refiner = TranscriptRefiner()
    assert refiner.refine_models_to_try == ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]
    assert refiner.segment_models_to_try == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    assert refiner.client is None


def test_refiner_falls_back_to_gemini_list_when_groq_key_missing(monkeypatch):
    """Nếu chưa cấu hình GROQ_API_KEY nhưng có GEMINI_API_KEY thì chạy thẳng danh sách Gemini."""
    monkeypatch.setattr(refiner_mod.default_ai_config, "groq_api_key", "", raising=False)
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: object())

    refiner = TranscriptRefiner(api_key="fake-gemini-key")
    expected_gemini = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash-lite",
        "gemini-pro-latest",
    ]
    assert refiner.refine_models_to_try == expected_gemini
    assert refiner.segment_models_to_try == expected_gemini
    assert refiner.model_name == "gemini-3.8-flash"


def test_groq_dual_models_use_20b_for_refine_and_120b_for_segment(monkeypatch, caplog):
    """Trên cùng 1 TranscriptRefiner: refine_transcript gọi gpt-oss-20b, segment_transcript gọi gpt-oss-120b qua Groq."""
    caplog.set_level(logging.INFO)
    captured_requests = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        captured_requests.append({
            "url": req.full_url,
            "auth": req.get_header("Authorization"),
            "ua": req.get_header("User-agent"),
            "timeout": timeout,
            "body": body,
        })
        prompt_text = body["messages"][0]["content"]
        if "Semantic Video Segmentation" in prompt_text:
            content = (
                "<think>Phân đoạn bài giảng từ S0001 đến S0002.</think>\n"
                "```json\n"
                + json.dumps({
                    "sections": [
                        {
                            "label": "Giới thiệu",
                            "topics": [
                                {
                                    "title": "Mở đầu khóa học",
                                    "slug": "mo-dau-khoa-hoc",
                                    "start_id": "S0001",
                                    "end_id": "S0002",
                                }
                            ],
                        }
                    ]
                }, ensure_ascii=False)
                + "\n```"
            )
        else:
            content = json.dumps({
                "sentences": [
                    {"start_id": "S0001", "end_id": "S0001", "text": "Xin chào các bạn."},
                    {"start_id": "S0002", "end_id": "S0002", "text": "Hôm nay ta học về JavaScript."},
                ]
            }, ensure_ascii=False)
        return _FakeHTTPResponse({
            "choices": [{"message": {"content": content}, "finish_reason": "stop"}]
        })

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")

    refiner = TranscriptRefiner(groq_api_key="gsk_test_dual")
    transcript = TranscriptOutput(
        video="demo.mp4",
        duration=20.0,
        sentences=[
            Sentence(id="S0001", start=0.0, end=10.0, text="xin chao cac ban"),
            Sentence(id="S0002", start=10.0, end=20.0, text="hom nay ta hoc ve javascript"),
        ],
    )

    refined = refiner.refine_transcript(transcript)
    assert [s.text for s in refined.sentences] == [
        "Xin chào các bạn.",
        "Hôm nay ta học về JavaScript.",
    ]

    segments_data = refiner.segment_transcript(refined, lesson_name="Demo JS", force_ai=True, max_retries=1)
    assert len(segments_data["segments"]) == 1
    assert segments_data["segments"][0]["topic"] == "Mở đầu khóa học"

    assert len(captured_requests) == 2
    assert all(r["url"] == "https://api.groq.com/openai/v1/chat/completions" for r in captured_requests)
    assert all(r["auth"] == "Bearer gsk_test_dual" for r in captured_requests)
    assert all(bool(r["ua"]) for r in captured_requests), "Groq request phải gửi User-Agent tránh Cloudflare 403"
    assert captured_requests[0]["body"]["model"] == "openai/gpt-oss-20b"
    assert captured_requests[1]["body"]["model"] == "openai/gpt-oss-120b"

    log_messages = [rec.getMessage() for rec in caplog.records]
    assert all(msg.isascii() for msg in log_messages), f"Log khong duoc co dau: {log_messages}"
    assert any("[GROQ]" in msg and "openai/gpt-oss-20b" in msg for msg in log_messages)
    assert any("[GROQ]" in msg and "openai/gpt-oss-120b" in msg for msg in log_messages)


def test_groq_segment_413_falls_back_to_other_groq_then_gemini(monkeypatch):
    """Khi phân đoạn video dài gặp 413 (vượt 8K TPM) ở cả 2 model Groq, tự rơi về Gemini dự phòng."""
    call_trace = []

    def failing_413_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        call_trace.append(("groq", body["model"]))
        raise urllib.error.HTTPError(
            url=req.full_url,
            code=413,
            msg="Payload Too Large",
            hdrs={},
            fp=io.BytesIO(b'{"error": {"message": "Request too large for model: Limit 8000, Requested 15000"}}'),
        )

    class FakeGeminiModels:
        def generate_content(self, model, contents, config):
            call_trace.append(("gemini", model))
            class Resp:
                text = json.dumps({
                    "sections": [
                        {
                            "label": "Lý thuyết",
                            "topics": [
                                {"title": "Bài 1", "slug": "bai-1", "start_id": "S0001", "end_id": "S0002"}
                            ],
                        }
                    ]
                })
            return Resp()

    class FakeGeminiClient:
        models = FakeGeminiModels()

    monkeypatch.setattr(urllib.request, "urlopen", failing_413_urlopen)
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: FakeGeminiClient())

    refiner = TranscriptRefiner(api_key="fake-gemini-key", groq_api_key="gsk_test")
    transcript = TranscriptOutput(
        video="long.mp4",
        duration=1200.0,
        sentences=[
            Sentence(id="S0001", start=0.0, end=600.0, text="Phần một."),
            Sentence(id="S0002", start=600.0, end=1200.0, text="Phần hai."),
        ],
    )
    seg = refiner.segment_transcript(transcript, lesson_name="Long", force_ai=True, max_retries=1)
    assert len(seg["segments"]) >= 1
    assert call_trace == [
        ("groq", "openai/gpt-oss-120b"),
        ("groq", "openai/gpt-oss-20b"),
        ("gemini", "gemini-3.8-flash"),
    ]
    assert "openai/gpt-oss-120b" in refiner.exhausted_models
    assert "openai/gpt-oss-20b" in refiner.exhausted_models


def test_groq_refine_429_falls_back_to_120b_before_gemini(monkeypatch):
    """Khi gpt-oss-20b bị 429 ở bước chau chuốt, tự chuyển sang gpt-oss-120b trước khi đụng Gemini."""
    call_trace = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        call_trace.append(("groq", body["model"]))
        if body["model"] == "openai/gpt-oss-20b":
            raise urllib.error.HTTPError(
                url=req.full_url,
                code=429,
                msg="Too Many Requests",
                hdrs={},
                fp=io.BytesIO(b'{"error": {"message": "Rate limit reached for tokens"}}'),
            )
        return _FakeHTTPResponse({
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "sentences": [{"start_id": "S0001", "end_id": "S0001", "text": "Câu đã sửa."}]
                    })
                },
                "finish_reason": "stop",
            }]
        })

    class NeverCalledGeminiModels:
        def generate_content(self, model, contents, config):
            raise AssertionError("Không được gọi Gemini khi model Groq còn lại vẫn thành công")

    class NeverCalledGeminiClient:
        models = NeverCalledGeminiModels()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: NeverCalledGeminiClient())

    refiner = TranscriptRefiner(api_key="fake-gemini-key", groq_api_key="gsk_test")
    tr = TranscriptOutput(
        video="demo.mp4",
        duration=10.0,
        sentences=[Sentence(id="S0001", start=0.0, end=10.0, text="cau chua sua")],
    )
    refined = refiner.refine_transcript(tr)
    assert [s.text for s in refined.sentences] == ["Câu đã sửa."]
    assert call_trace == [("groq", "openai/gpt-oss-20b"), ("groq", "openai/gpt-oss-120b")]


def test_groq_invalid_key_skips_all_groq_models_and_falls_back_to_gemini(monkeypatch):
    """Nếu GROQ_API_KEY trả về 401, bỏ qua tất cả model Groq suốt phiên và chuyển thẳng sang Gemini."""
    call_trace = []

    def bad_key_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        call_trace.append(("groq", body["model"]))
        raise urllib.error.HTTPError(
            url=req.full_url,
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=io.BytesIO(b'{"error": {"message": "Invalid API Key"}}'),
        )

    class FakeGeminiModels:
        def generate_content(self, model, contents, config):
            call_trace.append(("gemini", model))
            class Resp:
                text = '{"sections": []}'
            return Resp()

    class FakeGeminiClient:
        models = FakeGeminiModels()

    monkeypatch.setattr(urllib.request, "urlopen", bad_key_urlopen)
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: FakeGeminiClient())

    refiner = TranscriptRefiner(api_key="fake-gemini-key", groq_api_key="gsk_bad")
    resp = refiner._generate_with_fallback("prompt 1")
    assert resp is not None
    assert call_trace == [("groq", "openai/gpt-oss-20b"), ("gemini", "gemini-3.8-flash")]
    assert "openai/gpt-oss-20b" in refiner._unavailable_models
    assert "openai/gpt-oss-120b" in refiner._unavailable_models

    # Lần sau bỏ qua toàn bộ Groq trong suốt phiên
    call_trace.clear()
    resp2 = refiner._generate_with_fallback("prompt 2")
    assert resp2 is not None
    assert call_trace == [("gemini", "gemini-3.8-flash")]


def test_groq_retries_without_response_format_on_400(monkeypatch):
    """Nếu model Groq từ chối response_format=json_object bằng HTTP 400, tự thử lại không kèm field đó."""
    attempts = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        attempts.append(body)
        if "response_format" in body:
            raise urllib.error.HTTPError(
                url=req.full_url,
                code=400,
                msg="Bad Request",
                hdrs={},
                fp=io.BytesIO(b'{"error": {"message": "response_format json_object is not supported"}}'),
            )
        return _FakeHTTPResponse({
            "choices": [{"message": {"content": '{"sections": []}'}, "finish_reason": "stop"}]
        })

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")

    refiner = TranscriptRefiner(groq_api_key="gsk_test")
    resp = refiner._generate_with_fallback("test prompt")
    assert resp is not None
    assert len(attempts) == 2
    assert "response_format" in attempts[0]
    assert "response_format" not in attempts[1]


def test_groq_refine_uses_smaller_batches_and_sequential_workers(monkeypatch):
    """Với Groq Free (8.000 TPM), refine_transcript tự chọn lô nhỏ (<=20 câu) và chạy tuần tự (1 worker) để tránh 429."""
    sentences = [
        Sentence(id=f"S{i:04d}", start=float(i * 2), end=float(i * 2 + 2), text=f"cau so {i}")
        for i in range(1, 46)
    ]
    transcript = TranscriptOutput(video="lecture.mp4", duration=100.0, sentences=sentences)

    lock = threading.Lock()
    active = 0
    max_active = 0
    batch_sizes = []

    def fake_urlopen(req, timeout=None):
        nonlocal active, max_active
        body = json.loads(req.data.decode("utf-8"))
        prompt = body["messages"][0]["content"]
        ids = [f"S{i:04d}" for i in range(1, 46) if f'"S{i:04d}"' in prompt]
        with lock:
            batch_sizes.append(len(ids))
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        return _FakeHTTPResponse({
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "sentences": [{"start_id": sid, "end_id": sid, "text": f"Chuan {sid}."} for sid in ids]
                    })
                },
                "finish_reason": "stop",
            }]
        })

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")

    refiner = TranscriptRefiner(groq_api_key="gsk_test")
    result = refiner.refine_transcript(transcript)

    assert len(result.sentences) == 45
    assert max(batch_sizes) <= 20, f"Lô cho Groq phải <= 20 câu, thực tế: {batch_sizes}"
    assert max_active == 1, f"Groq mặc định phải chạy tuần tự 1 worker để tránh vượt 8K TPM, thực tế: {max_active}"


def test_groq_sends_low_reasoning_effort_only_for_gpt_oss_models(monkeypatch):
    """Chỉ gửi reasoning_effort='low' cho dòng openai/gpt-oss-* để tiết kiệm reasoning token; không gửi cho Qwen."""
    captured = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        captured.append(body)
        return _FakeHTTPResponse({
            "choices": [{"message": {"content": '{"sections": []}'}, "finish_reason": "stop"}]
        })

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")

    ref_gpt = TranscriptRefiner(groq_api_key="gsk_test", refine_model="openai/gpt-oss-20b")
    ref_gpt._generate_with_fallback("prompt 1")

    ref_qwen = TranscriptRefiner(groq_api_key="gsk_test", refine_model="qwen/qwen3.8-27b")
    ref_qwen._generate_with_fallback("prompt 2")

    assert captured[0]["model"] == "openai/gpt-oss-20b"
    assert captured[0].get("reasoning_effort") == "low"
    assert captured[1]["model"] == "qwen/qwen3.8-27b"
    assert "reasoning_effort" not in captured[1]


def test_groq_retries_without_response_format_on_json_validate_failed_400(monkeypatch):
    """Khi Groq trả HTTP 400 json_validate_failed / Failed to validate JSON, tự retry bỏ response_format."""
    attempts = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        attempts.append(body)
        if "response_format" in body:
            raise urllib.error.HTTPError(
                url=req.full_url,
                code=400,
                msg="Bad Request",
                hdrs={},
                fp=io.BytesIO(
                    b'{"error": {"message": "Failed to validate JSON. Please adjust your prompt.", "code": "json_validate_failed"}}'
                ),
            )
        return _FakeHTTPResponse({
            "choices": [{"message": {"content": '{"sentences": []}'}, "finish_reason": "stop"}]
        })

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")

    refiner = TranscriptRefiner(groq_api_key="gsk_test")
    resp = refiner._generate_with_fallback("test prompt")
    assert resp is not None
    assert len(attempts) == 2
    assert "response_format" in attempts[0]
    assert "response_format" not in attempts[1]


def test_refine_prompt_is_compact_without_indented_json_and_logs_max_tokens_once(monkeypatch, caplog):
    """Prompt chau chuốt phải gọn (không indent JSON, khung hướng dẫn < 900 ký tự) và không in lặp cảnh báo MAX_TOKENS."""
    caplog.set_level(logging.WARNING)
    captured_prompts = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        captured_prompts.append(body["messages"][0]["content"])
        return _FakeHTTPResponse({
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "sentences": [
                            {"start_id": "S0001", "end_id": "S0001", "text": "Xin chào các bạn."},
                            {"start_id": "S0002", "end_id": "S0002", "text": "Hôm nay ta học Python."},
                        ]
                    })
                },
                "finish_reason": "length",
            }]
        })

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")

    refiner = TranscriptRefiner(groq_api_key="gsk_test")
    tr = TranscriptOutput(
        video="demo.mp4",
        duration=10.0,
        sentences=[
            Sentence(id="S0001", start=0.0, end=5.0, text="xin chao cac ban"),
            Sentence(id="S0002", start=5.0, end=10.0, text="hom nay ta hoc python"),
        ],
    )
    res = refiner.refine_transcript(tr)
    assert len(res.sentences) == 2
    assert len(captured_prompts) == 1

    prompt = captured_prompts[0]
    raw_input_len = sum(len(s.text) for s in tr.sentences)
    assert len(prompt) - raw_input_len < 900, f"Khung prompt chau chuốt vẫn quá dài ({len(prompt) - raw_input_len} ký tự)"
    assert '\n  {\n    "id":' not in prompt, "Không được dùng indent=2 lãng phí token trong JSON đầu vào"
    assert '{"id":"S0001"' in prompt and '{"id":"S0002"' in prompt

    max_tok_warnings = [rec.getMessage() for rec in caplog.records if "MAX_TOKENS" in rec.getMessage()]
    assert len(max_tok_warnings) == 1, f"Cảnh báo MAX_TOKENS chỉ được in 1 lần, thực tế: {len(max_tok_warnings)}"

