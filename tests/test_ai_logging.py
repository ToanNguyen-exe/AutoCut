"""Unit tests for AI model usage, token exhaustion, and API key error logging."""

import io
import json
import logging
import sys
import urllib.error
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backend.ai.transcript_refiner as refiner_mod
from backend.ai.models import Sentence, TranscriptOutput
from backend.ai.transcript_refiner import TranscriptRefiner
from backend.ai.groq_service import call_groq_whisper_api, transcribe_with_groq


def test_generate_with_fallback_logs_active_model_on_fallback(caplog):
    """Kiểm tra: Khi model 1 hết token (429) và chuyển sang model dự phòng thành công, phải log cả lỗi hết token lẫn tên model thành công."""
    caplog.set_level(logging.INFO)

    class FakeModels:
        def generate_content(self, model, contents, config):
            if model == "gemini-3.5-flash":
                raise RuntimeError("429 RESOURCE_EXHAUSTED: Quota and token limit exceeded")
            class Resp:
                text = '{"sections": []}'
            return Resp()

    class FakeClient:
        models = FakeModels()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash", "gemini-flash-latest"]
    refiner.model_name = "gemini-3.5-flash"
    refiner.client = FakeClient()

    resp = refiner._generate_with_fallback("test prompt")
    assert resp is not None
    assert refiner.model_name == "gemini-flash-latest"

    log_messages = [rec.getMessage() for rec in caplog.records]
    assert all(msg.isascii() for msg in log_messages), f"Log khong duoc co dau: {log_messages}"
    assert any("gemini-3.5-flash" in msg and ("token" in msg.lower() or "quota" in msg.lower()) for msg in log_messages), (
        f"Phải log cảnh báo model hết token/quota, thực tế: {log_messages}"
    )
    assert any("[GEMINI]" in msg and "gemini-flash-latest" in msg and "model" in msg.lower() for msg in log_messages), (
        f"Phải log tên model thực tế đã phản hồi thành công, thực tế: {log_messages}"
    )


def test_segment_transcript_writes_model_to_llm_raw_json(tmp_path, monkeypatch, caplog):
    """Kiểm tra: Khi phân đoạn thành công, cache/llm_raw.json phải lưu kèm trường 'model' và ghi log model."""
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(refiner_mod, "PROJECT_ROOT", tmp_path)

    sentences = [
        Sentence(id="S0001", start=0.0, end=15.0, text="Giới thiệu tổng quan bài học."),
        Sentence(id="S0002", start=15.0, end=45.0, text="Nội dung chính và kết luận."),
    ]
    transcript = TranscriptOutput(video="demo.mp4", duration=45.0, sentences=sentences)

    class MockLLMResponse:
        text = json.dumps({
            "sections": [
                {
                    "label": "Giới thiệu",
                    "topics": [
                        {
                            "title": "Mở đầu",
                            "slug": "mo-dau",
                            "start_id": "S0001",
                            "end_id": "S0002",
                        }
                    ],
                }
            ]
        })

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-flash-latest"]
    refiner.model_name = "gemini-flash-latest"
    refiner._generate_with_fallback = lambda *a, **kw: MockLLMResponse()

    TranscriptRefiner.segment_transcript(
        refiner,
        transcript=transcript,
        lesson_name="Demo",
        force_ai=True,
        max_retries=1,
    )

    llm_raw_file = tmp_path / "cache" / "llm_raw.json"
    assert llm_raw_file.exists(), "Phải tạo tệp cache/llm_raw.json"
    raw_data = json.loads(llm_raw_file.read_text(encoding="utf-8"))
    assert raw_data.get("model") == "gemini-flash-latest"
    assert "sections" in raw_data

    log_messages = [rec.getMessage() for rec in caplog.records]
    assert all(msg.isascii() for msg in log_messages), f"Log khong duoc co dau: {log_messages}"
    assert any("gemini-flash-latest" in msg for msg in log_messages), (
        f"Phải ghi log tên model khi phân đoạn, thực tế: {log_messages}"
    )


def test_logs_error_when_gemini_api_key_missing_or_invalid(monkeypatch, caplog):
    """Kiểm tra: Ghi log ERROR khi thiếu GEMINI_API_KEY hoặc API key không hợp lệ / bị từ chối quyền."""
    caplog.set_level(logging.ERROR)

    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "")
    with pytest.raises(ValueError):
        TranscriptRefiner(api_key="")

    assert any("GEMINI_API_KEY" in rec.getMessage() for rec in caplog.records), (
        "Phải log lỗi khi thiếu GEMINI_API_KEY"
    )

    caplog.clear()

    class BadKeyModels:
        def generate_content(self, model, contents, config):
            raise RuntimeError("401 UNAUTHENTICATED: API_KEY_INVALID")

    class BadKeyClient:
        models = BadKeyModels()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash", "gemini-flash-latest"]
    refiner.model_name = "gemini-3.5-flash"
    refiner.client = BadKeyClient()

    with pytest.raises(RuntimeError):
        refiner._generate_with_fallback("test prompt")

    err_logs = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert all(msg.isascii() for msg in err_logs), f"Log khong duoc co dau: {err_logs}"
    assert any("API key" in msg or "GEMINI_API_KEY" in msg for msg in err_logs), (
        f"Phải log ERROR rõ ràng khi không gọi được AI do API key không hợp lệ, thực tế: {err_logs}"
    )


def test_groq_logs_missing_key_and_http_errors(tmp_path, monkeypatch, caplog):
    """Kiểm tra: Groq STT phải log ERROR khi thiếu API key, hết token/quota (429) hoặc lỗi API key (401)."""
    caplog.set_level(logging.ERROR)
    dummy_media = tmp_path / "audio.mp3"
    dummy_media.write_bytes(b"fake-mp3")

    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    import backend.ai.groq_service as groq_mod
    monkeypatch.setattr(groq_mod.default_ai_config, "whisper_api_key", "")

    with pytest.raises(ValueError):
        transcribe_with_groq(str(dummy_media))

    assert any("GROQ_API_KEY" in rec.getMessage() for rec in caplog.records), (
        "Phải log lỗi khi thiếu GROQ_API_KEY/WHISPER_API_KEY"
    )

    caplog.clear()

    def raise_429(*args, **kwargs):
        raise urllib.error.HTTPError(
            url="https://api.groq.com/openai/v1/audio/transcriptions",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=io.BytesIO(b'{"error": {"message": "Rate limit reached for tokens"}}'),
        )

    monkeypatch.setattr(urllib.request, "urlopen", raise_429)
    with pytest.raises(RuntimeError):
        call_groq_whisper_api(str(dummy_media), api_key="gsk_test_fake")

    err_logs = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert any("token" in msg.lower() or "quota" in msg.lower() for msg in err_logs), (
        f"Phải log lỗi Groq hết token/quota khi gặp HTTP 429, thực tế: {err_logs}"
    )

    caplog.clear()

    def raise_401(*args, **kwargs):
        raise urllib.error.HTTPError(
            url="https://api.groq.com/openai/v1/audio/transcriptions",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=io.BytesIO(b'{"error": {"message": "Invalid API Key"}}'),
        )

    monkeypatch.setattr(urllib.request, "urlopen", raise_401)
    with pytest.raises(RuntimeError):
        call_groq_whisper_api(str(dummy_media), api_key="gsk_test_fake")

    err_logs_401 = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert all(msg.isascii() for msg in err_logs_401), f"Log khong duoc co dau: {err_logs_401}"
    assert any("api key" in msg.lower() for msg in err_logs_401), (
        f"Phải log lỗi Groq API key khi gặp HTTP 401, thực tế: {err_logs_401}"
    )


def test_logs_error_when_all_models_exhausted_and_warns_on_max_tokens(caplog):
    """Kiểm tra: Khi tất cả model hết token phải log ERROR tổng kết, và khi finish_reason=MAX_TOKENS phải log WARNING."""
    caplog.set_level(logging.WARNING)

    class Always429Models:
        def generate_content(self, model, contents, config):
            long_dump = "429 RESOURCE_EXHAUSTED.\n{'error': {'code': 429, 'message': 'Quota exceeded', 'details': [" + ("'x': 1, " * 80) + "]}}"
            raise RuntimeError(long_dump)

    class Always429Client:
        models = Always429Models()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash", "gemini-flash-latest"]
    refiner.model_name = "gemini-3.5-flash"
    refiner.client = Always429Client()

    with pytest.raises(RuntimeError):
        refiner._generate_with_fallback("prompt")

    fatal_logs = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert any("TOKEN_OR_QUOTA_EXHAUSTED" in msg and "gemini-flash-latest" in msg for msg in fatal_logs), (
        f"Phải log ERROR tổng kết hết token cho tất cả model, thực tế: {fatal_logs}"
    )
    assert all("\n" not in msg and len(msg) <= 200 for msg in fatal_logs), (
        f"Log phai duoc tom gon 1 dong <= 200 ky tu, thuc te: {[len(m) for m in fatal_logs]}"
    )

    caplog.clear()

    class TruncatedCandidate:
        finish_reason = "MAX_TOKENS"

    class TruncatedResponse:
        text = '{"sections": []}'
        candidates = [TruncatedCandidate()]

    parsed = refiner_mod._parse_json_response(TruncatedResponse(), "gemini-3.5-flash")
    assert parsed == {"sections": []}
    warn_logs = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.WARNING]
    assert all(msg.isascii() for msg in warn_logs), f"Log khong duoc co dau: {warn_logs}"
    assert any("MAX_TOKENS" in msg and "token" in msg.lower() for msg in warn_logs), (
        f"Phải cảnh báo khi chạm MAX_TOKENS, thực tế: {warn_logs}"
    )


def test_gemini_transcriber_logs_missing_key_and_upload_api_key_error(tmp_path, monkeypatch, caplog):
    """Kiểm tra: GeminiTranscriber phải log ERROR khi thiếu key hoặc lỗi API key lúc upload."""
    caplog.set_level(logging.ERROR)
    import backend.ai.gemini_transcriber as gtrans_mod
    from backend.ai.gemini_transcriber import GeminiTranscriber

    monkeypatch.setattr(gtrans_mod.default_ai_config, "gemini_api_key", "")
    with pytest.raises(ValueError):
        GeminiTranscriber(api_key="")

    assert any("GEMINI_API_KEY" in rec.getMessage() for rec in caplog.records)

    caplog.clear()
    media = tmp_path / "sample.mp3"
    media.write_bytes(b"fake-audio-bytes")

    class FailingFiles:
        def upload(self, file):
            raise RuntimeError("403 PERMISSION_DENIED: API key rejected")

    class FailingClient:
        files = FailingFiles()

    gt = object.__new__(GeminiTranscriber)
    gt.model_name = "gemini-3.5-flash"
    gt.cache_dir = str(tmp_path / "cache")
    gt.client = FailingClient()

    with pytest.raises(RuntimeError):
        gt.transcribe(str(media), force_recompute=True)

    err_logs = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert all(msg.isascii() for msg in err_logs), f"Log khong duoc co dau: {err_logs}"
    assert any("API_KEY_ERROR" in msg for msg in err_logs), (
        f"Phải log ERROR API_KEY_ERROR khi upload lên Gemini bị từ chối key, thực tế: {err_logs}"
    )


def test_classify_429_with_401_or_403_in_retry_delay_is_quota_error():
    """Kiểm tra: Lỗi 429 có số 401/403 trong retryDelay hoặc URL KHÔNG được nhận nhầm thành API_KEY_ERROR."""
    from backend.ai.config_loader import classify_ai_api_error

    err_429_with_403_delay = RuntimeError(
        "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'You exceeded your current quota', "
        "'details': [{'retryDelay': '14.403s'}, {'id': 18401}]}}"
    )
    code, _ = classify_ai_api_error(err_429_with_403_delay)
    assert code == "TOKEN_OR_QUOTA_EXHAUSTED"

    code_auth_tok, _ = classify_ai_api_error(RuntimeError("401 Unauthorized: Invalid auth token"))
    assert code_auth_tok == "API_KEY_ERROR"

    code_403, _ = classify_ai_api_error(RuntimeError("403 PERMISSION_DENIED: API key rejected"))
    assert code_403 == "API_KEY_ERROR"


def test_exhausted_models_skipped_across_transcript_and_segment_session(tmp_path, monkeypatch):
    """Kiểm tra: Model hết quota ở bước transcript sẽ bị bỏ qua ở cả phần transcript còn lại và bước segment."""
    monkeypatch.setattr(refiner_mod, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(refiner_mod.default_ai_config, "gemini_api_key", "fake-test-key")
    monkeypatch.setattr(refiner_mod.genai, "Client", lambda **kwargs: None)

    call_history = []
    shared_exhausted = set()

    class SessionFakeModels:
        def generate_content(self, model, contents, config):
            call_history.append(model)
            if model in ("gemini-3.5-flash", "gemini-flash-latest"):
                raise RuntimeError("429 RESOURCE_EXHAUSTED: You exceeded your current quota, retryDelay: 12.403s")
            if "sections" in contents or "Semantic Video Segmentation" in contents:
                class SegResp:
                    text = json.dumps({
                        "sections": [{
                            "label": "Gioi thieu",
                            "topics": [{"title": "Mo dau", "slug": "mo-dau", "start_id": "S0001", "end_id": "S0002"}],
                        }]
                    })
                return SegResp()
            class RefResp:
                text = json.dumps({
                    "sentences": [{"start_id": "S0001", "end_id": "S0001", "text": "Cau 1."}]
                })
            return RefResp()

    class SessionFakeClient:
        models = SessionFakeModels()

    # 1. Phiên transcript (2 lượt gọi liên tiếp trên cùng instance)
    refiner_1 = TranscriptRefiner(api_key="fake-test-key", exhausted_models=shared_exhausted)
    refiner_1.models_to_try = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"]
    refiner_1.client = SessionFakeClient()

    refiner_1._generate_with_fallback("batch 1")
    refiner_1._generate_with_fallback("batch 2")

    # 2. Sang phiên segment (khởi tạo refiner mới nhưng dùng chung shared_exhausted của phiên chạy)
    refiner_2 = TranscriptRefiner(api_key="fake-test-key", exhausted_models=shared_exhausted)
    refiner_2.models_to_try = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"]
    refiner_2.client = SessionFakeClient()

    sentences = [
        Sentence(id="S0001", start=0.0, end=5.0, text="Mo dau."),
        Sentence(id="S0002", start=5.0, end=10.0, text="Ket thuc."),
    ]
    TranscriptRefiner.segment_transcript(
        refiner_2,
        transcript=TranscriptOutput(video="demo.mp4", duration=10.0, sentences=sentences),
        lesson_name="Demo",
        force_ai=True,
        max_retries=1,
    )

    # Batch 1 gọi 3 model (1 fail, 2 fail, 3 ok); Batch 2 chỉ gọi flash-lite; Segment chỉ gọi flash-lite
    assert call_history == [
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash-lite",
    ], f"Thứ tự gọi model thực tế không tối ưu: {call_history}"


def test_exhausted_models_resets_when_all_models_exhausted_for_retry():
    """Kiểm tra: Nếu TẤT CẢ model đều từng báo hết quota và hệ thống retry lại, không được crash (raise None)."""
    attempt = 0

    class RecoveringModels:
        def generate_content(self, model, contents, config):
            nonlocal attempt
            attempt += 1
            if attempt <= 2:
                raise RuntimeError("429 RESOURCE_EXHAUSTED: RPM burst")
            class Resp:
                text = '{"sections": []}'
            return Resp()

    class RecoveringClient:
        models = RecoveringModels()

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash", "gemini-flash-latest"]
    refiner.model_name = "gemini-3.5-flash"
    refiner.exhausted_models = set()
    refiner.client = RecoveringClient()

    with pytest.raises(RuntimeError):
        refiner._generate_with_fallback("lan 1 fail het")

    # Lần retry tiếp theo không được raise TypeError(None) mà phải reset danh sách để thử lại thành công
    resp = refiner._generate_with_fallback("lan 2 hoi phuc")
    assert resp is not None
    assert refiner.model_name == "gemini-3.5-flash"


def test_cli_run_backend_analysis_shares_exhausted_models_set(tmp_path, monkeypatch):
    """Kiểm tra: cli.run_backend_analysis truyền chung set exhausted_models từ bước transcript sang bước segment."""
    import backend.ai.cli as cli_mod

    monkeypatch.setattr(cli_mod, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(cli_mod, "TRANSCRIPTS_DIR", tmp_path / "transcripts")
    monkeypatch.setattr(cli_mod, "SEGMENTS_DIR", tmp_path / "segments")
    monkeypatch.setattr(refiner_mod, "PROJECT_ROOT", tmp_path)

    captured_exhausted_ids = []

    def fake_find_transcript(video_name, lesson, file_hash, duration, exhausted_models=None):
        assert exhausted_models is not None
        captured_exhausted_ids.append(id(exhausted_models))
        exhausted_models.add("gemini-3.5-flash")
        return TranscriptOutput(
            video=video_name,
            duration=30.0,
            sentences=[Sentence(id="S0001", start=0.0, end=30.0, text="Noi dung bai hoc.")],
        )

    class SpyRefiner:
        def __init__(self, exhausted_models=None):
            assert exhausted_models is not None
            captured_exhausted_ids.append(id(exhausted_models))
            assert "gemini-3.5-flash" in exhausted_models

        def segment_transcript(self, transcript, lesson_name, force_ai=True):
            return {
                "video": transcript.video,
                "lesson": lesson_name,
                "mode": "analyzed",
                "reviewed": False,
                "segments": [],
            }

    monkeypatch.setattr(cli_mod, "_find_matching_transcript_or_video", fake_find_transcript)
    monkeypatch.setattr(refiner_mod, "TranscriptRefiner", SpyRefiner)

    out_file = tmp_path / "out.json"
    cli_mod.run_backend_analysis("demo.mp4", "DemoLesson", None, 30.0, str(out_file))

    assert len(captured_exhausted_ids) == 2
    assert captured_exhausted_ids[0] == captured_exhausted_ids[1]


def test_config_loader_prefers_dotenv_over_existing_env(monkeypatch):
    """Kiểm tra: .env của dự án phải ghi đè biến GEMINI_API_KEY cũ có sẵn trong môi trường hệ thống."""
    import importlib
    from dotenv import dotenv_values
    import backend.ai.config_loader as config_loader

    project_env = Path(__file__).resolve().parent.parent / ".env"
    expected_key = dotenv_values(project_env).get("GEMINI_API_KEY") or dotenv_values(project_env).get("LLM_API_KEY")
    assert expected_key, "Can co GEMINI_API_KEY hoac LLM_API_KEY trong .env de kiem thu"

    try:
        with monkeypatch.context() as m:
            m.setenv("GEMINI_API_KEY", "stale-windows-env-key")
            importlib.reload(config_loader)
            assert config_loader.default_ai_config.gemini_api_key == expected_key
    finally:
        importlib.reload(config_loader)


def test_cli_main_transcription_defines_whisper_start(monkeypatch, tmp_path):
    """Kiểm tra: cli.main() khi bóc băng không bị lỗi NameError: name 'whisper_start' is not defined."""
    import backend.ai.cli as cli_mod
    from backend.ai.models import Sentence, TranscriptOutput

    dummy_res = TranscriptOutput(
        video="demo.mp4",
        duration=10.0,
        sentences=[Sentence(id="S0001", start=0.0, end=10.0, text="Noi dung test.")],
    )

    monkeypatch.setattr(sys, "argv", ["cli.py", "--input", "demo.mp4", "--engine", "groq"])
    monkeypatch.setattr("backend.ai.groq_service.transcribe_with_groq", lambda *a, **kw: dummy_res)
    monkeypatch.setattr(cli_mod, "TRANSCRIPTS_DIR", tmp_path)
    monkeypatch.setattr(cli_mod, "PROJECT_ROOT", tmp_path)

    # Nếu whisper_start chưa được khai báo trước khi bóc băng, dòng tính whisper_elapsed sẽ quăng NameError
    cli_mod.main()
