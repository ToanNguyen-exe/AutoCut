"""Unit tests verifying AI memory optimizations while preserving 100% transcript fidelity."""

import sys
from pathlib import Path
from types import SimpleNamespace
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai.whisper_service import WhisperTranscriber


def test_consume_segments_with_progress_extracts_lightweight_dicts():
    """Đảm bảo _consume_segments_with_progress không giữ nguyên object Segment nặng trong RAM."""

    class HeavyWhisperSegment:
        def __init__(self, start, end, text):
            self.start = start
            self.end = end
            self.text = text
            self.tokens = list(range(500))  # Giả lập payload nặng đi kèm Segment gốc

    gen = (
        s
        for s in [
            HeavyWhisperSegment(0.0, 2.5, "Xin chào các bạn."),
            HeavyWhisperSegment(2.5, 6.0, "Hôm nay học về tối ưu bộ nhớ."),
        ]
    )

    extracted = WhisperTranscriber._consume_segments_with_progress(gen, total_duration=6.0)

    assert len(extracted) == 2
    assert all(isinstance(item, dict) for item in extracted)
    assert extracted[0] == {"start": 0.0, "end": 2.5, "text": "Xin chào các bạn."}
    assert extracted[1] == {"start": 2.5, "end": 6.0, "text": "Hôm nay học về tối ưu bộ nhớ."}


def test_whisper_transcribe_releases_model_after_completion_and_on_error(tmp_path, monkeypatch):
    """Đảm bảo WhisperTranscriber tự giải phóng _model (1-4GB RAM) sau khi transcribe xong hoặc khi gặp lỗi."""
    media = tmp_path / "sample.mp3"
    media.write_bytes(b"fake-audio")

    transcriber = WhisperTranscriber(cache_dir=str(tmp_path / "cache"))
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    monkeypatch.setattr("backend.ai.whisper_service.default_ai_config.whisper_api_key", "")

    class FakeModelOk:
        def transcribe(self, path, **kwargs):
            gen = iter([SimpleNamespace(start=0.0, end=3.0, text="Câu thử nghiệm.")])
            return gen, SimpleNamespace(duration=3.0)

    transcriber._model = FakeModelOk()
    result = transcriber.transcribe(str(media), force_recompute=True)
    assert len(result.sentences) == 1
    assert transcriber._model is None, "Model Whisper phải được giải phóng về None sau khi transcribe xong"

    class FakeModelFail:
        def transcribe(self, path, **kwargs):
            raise RuntimeError("Out of memory simulated")

    transcriber._model = FakeModelFail()
    with pytest.raises(RuntimeError):
        transcriber.transcribe(str(media), force_recompute=True)
    assert transcriber._model is None, "Model Whisper vẫn phải được giải phóng khi transcribe gặp lỗi"


def test_cache_lookup_skips_full_json_parse_for_unrelated_videos(tmp_path, monkeypatch):
    """Đảm bảo _cache_transcripts_for không parse toàn bộ file JSON của các video khác."""
    import json
    from backend.ai import cli

    def make_big_transcript(video_name: str, video_at_end: bool = False):
        sents = [{"id": f"S{i:04d}", "start": float(i), "end": float(i + 1), "text": f"Câu thứ {i}"} for i in range(1, 50)]
        if video_at_end:
            return {"duration": 100.0, "sentences": sents, "video": video_name}
        return {"video": video_name, "duration": 100.0, "sentences": sents}

    (tmp_path / "other1_transcript.json").write_text(json.dumps(make_big_transcript("khac_1.mp4")), encoding="utf-8")
    (tmp_path / "other2_transcript.json").write_text(json.dumps(make_big_transcript("khac_2.mp4")), encoding="utf-8")
    target_file = tmp_path / "target_transcript.json"
    target_file.write_text(json.dumps(make_big_transcript("target_video.mp4")), encoding="utf-8")

    # Đếm số lần json.loads/json.load bị gọi để parse object đầy đủ có key "sentences"
    full_parses = []
    orig_loads = cli.json.loads
    orig_load = cli.json.load

    def spy_loads(s, *args, **kwargs):
        res = orig_loads(s, *args, **kwargs)
        if isinstance(res, dict) and "sentences" in res:
            full_parses.append(res.get("video"))
        return res

    def spy_load(fp, *args, **kwargs):
        res = orig_load(fp, *args, **kwargs)
        if isinstance(res, dict) and "sentences" in res:
            full_parses.append(res.get("video"))
        return res

    monkeypatch.setattr(cli.json, "loads", spy_loads)
    monkeypatch.setattr(cli.json, "load", spy_load)

    found = cli._cache_transcripts_for("target_video.mp4", tmp_path)
    assert found == [target_file]
    # Trước khi fix: full_parses sẽ chứa cả khac_1.mp4, khac_2.mp4, target_video.mp4 (3 lần)
    # Sau khi fix: chỉ parse full khi cần hoặc không parse full khac_1/khac_2
    assert "khac_1.mp4" not in full_parses and "khac_2.mp4" not in full_parses, (
        f"Không được parse full JSON của video khác, thực tế đã parse: {full_parses}"
    )

    # Kiểm tra fallback an toàn: file đặt key 'video' ở cuối vẫn phải tìm ra
    end_file = tmp_path / "tail_transcript.json"
    end_file.write_text(json.dumps(make_big_transcript("tail_video.mp4", video_at_end=True)), encoding="utf-8")
    assert cli._cache_transcripts_for("tail_video.mp4", tmp_path) == [end_file]


def test_call_groq_whisper_api_streams_multipart_without_doubling_bytes(tmp_path, monkeypatch):
    """Đảm bảo upload Groq truyền stream file-like + Content-Length thay vì bytes(bytearray) nhân đôi RAM."""
    import io
    import json
    import urllib.request
    from backend.ai.groq_service import call_groq_whisper_api

    big_audio = tmp_path / "chunk_test.mp3"
    audio_payload = b"ID3" + (b"\x55" * (1024 * 1024))  # ~1 MB > spooled threshold
    big_audio.write_bytes(audio_payload)

    captured = {}

    class FakeHttpResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"segments": [], "duration": 10.0}).encode("utf-8")

    def fake_urlopen(req, timeout=120):
        captured["is_stream"] = hasattr(req.data, "read")
        captured["is_bytes"] = isinstance(req.data, (bytes, bytearray))
        captured["content_length"] = req.get_header("Content-length")
        if hasattr(req.data, "read"):
            captured["raw_body"] = req.data.read()
        else:
            captured["raw_body"] = bytes(req.data)
        return FakeHttpResponse()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    res = call_groq_whisper_api(str(big_audio), api_key="gsk_fake_key", model="whisper-large-v3", language="vi")
    assert res["duration"] == 10.0
    assert captured["is_stream"] is True, "Payload upload Groq phải là stream file-like (có .read())"
    assert captured["is_bytes"] is False, "Không được nhân đôi thành bytes/bytearray toàn file trên RAM"
    assert int(captured["content_length"]) == len(captured["raw_body"])
    assert audio_payload in captured["raw_body"]
    assert b'name="model"\r\n\r\nwhisper-large-v3' in captured["raw_body"]


def test_segment_and_refine_prompts_keep_100_percent_sentences_without_redundant_padding():
    """Đảm bảo giữ 100% lời thoại & mã câu khi gửi Gemini nhưng loại bỏ timestamp/indent thừa."""
    import json
    from backend.ai.models import Sentence, TranscriptOutput
    from backend.ai.transcript_refiner import TranscriptRefiner

    sentences = [
        Sentence(id="S0001", start=0.0, end=12.5, text="Giới thiệu kiến trúc hệ thống."),
        Sentence(id="S0002", start=12.5, end=27.3, text="Phân tích nguyên nhân tốn bộ nhớ."),
    ]
    transcript = TranscriptOutput(video="demo.mp4", duration=27.3, sentences=sentences)

    captured_prompts = []

    class FakeResp:
        def __init__(self, payload):
            self.text = json.dumps(payload)

    refiner = object.__new__(TranscriptRefiner)
    refiner.models_to_try = ["gemini-3.5-flash-lite"]
    refiner.model_name = "gemini-3.5-flash-lite"

    def fake_gen(prompt):
        captured_prompts.append(prompt)
        if "Semantic Video Segmentation" in prompt:
            return FakeResp({
                "sections": [{
                    "label": "Giới thiệu",
                    "topics": [{"title": "Tổng quan", "slug": "tong-quan", "start_id": "S0001", "end_id": "S0002"}]
                }]
            })
        return FakeResp({
            "sentences": [
                {"start_id": "S0001", "end_id": "S0001", "text": "Giới thiệu kiến trúc hệ thống."},
                {"start_id": "S0002", "end_id": "S0002", "text": "Phân tích nguyên nhân tốn bộ nhớ."},
            ]
        })

    refiner._generate_with_fallback = fake_gen

    refined = TranscriptRefiner.refine_transcript(refiner, transcript)
    assert len(refined.sentences) == 2
    assert refined.sentences[0].text == "Giới thiệu kiến trúc hệ thống."
    assert refined.sentences[1].text == "Phân tích nguyên nhân tốn bộ nhớ."

    TranscriptRefiner.segment_transcript(refiner, refined, lesson_name="Demo", force_ai=True, max_retries=1)

    refine_prompt, segment_prompt = captured_prompts[0], captured_prompts[1]
    # Kiểm tra refine prompt dùng JSON compact (không indent=2 mỗi dòng id/text)
    assert '\n  {\n    "id": "S0001"' not in refine_prompt
    assert '{"id":"S0001","text":"Giới thiệu kiến trúc hệ thống."}' in refine_prompt

    # Kiểm tra segment prompt giữ nguyên 100% nội dung và ID câu, nhưng không kèm [0.0s-12.5s] thừa
    assert "S0001: Giới thiệu kiến trúc hệ thống." in segment_prompt
    assert "S0002: Phân tích nguyên nhân tốn bộ nhớ." in segment_prompt
    assert "[0.0s-12.5s]" not in segment_prompt
    assert "[12.5s-27.3s]" not in segment_prompt



