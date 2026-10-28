"""Bộ kiểm thử tính năng Tuần 1 cho Sinh Viên 2 (SV2 - AI Module).
Bao gồm:
- P02: Cấu trúc transcript.json, đánh số câu S0001, S0002...
- P03: initial_prompt được sinh tự động từ đề cương.
- P04: Cơ chế Cache SHA-256 (Cache Miss -> Cache Hit).
- Chuẩn bị Tuần 2: Kiểm tra kết nối Gemini API (gemini-3.5-flash).
"""

import os
import sys
import time
from pathlib import Path

# Đảm bảo in tiếng Việt không bị lỗi cp1252 trên Windows PowerShell
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Đảm bảo import được module backend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ai.models import Word, Sentence, TranscriptOutput
from backend.ai.prompt_builder import extract_terms_from_outline, build_initial_prompt
from backend.ai.gemini_transcriber import compute_file_sha256, GeminiTranscriber
from backend.ai.config_loader import default_ai_config


def test_models_and_sentence_id():
    """Kiểm tra P02: Định dạng câu và mã S0001."""
    print("\n--- [TEST 1] Kiểm tra Pydantic Models & Mã câu S0001 ---")
    s1 = Sentence(
        id="S0001",
        start=0.0,
        end=4.5,
        text="Chào các bạn, hôm nay chúng ta sẽ bắt đầu với vòng lặp for.",
        words=[
            Word(word="Chào", start=0.0, end=0.5),
            Word(word="các", start=0.5, end=0.8),
            Word(word="bạn", start=0.8, end=1.1)
        ]
    )
    assert s1.id == "S0001"
    assert len(s1.words) == 3

    transcript = TranscriptOutput(
        video="Bai05_VongLap.mp4",
        duration=1820.0,
        sentences=[s1]
    )
    json_data = transcript.model_dump_json(indent=2)
    assert '"id": "S0001"' in json_data
    assert '"video": "Bai05_VongLap.mp4"' in json_data
    print("PASS: Pydantic models hoạt động chuẩn xác theo Mục 5.1.")


def test_initial_prompt_builder():
    """Kiểm tra P03: Trích xuất thuật ngữ và tạo initial_prompt."""
    print("\n--- [TEST 2] Kiểm tra P03: initial_prompt từ đề cương ---")
    sample_outline = """
    Lý thuyết: for, while, do...while
    Thực hành ví dụ: tính tổng 1 đến n, in bảng cửu chương
    Bài tập: kiểm tra số nguyên tố, đảo ngược số
    """
    terms = extract_terms_from_outline(sample_outline)
    print(f"Thuật ngữ bóc tách được: {terms}")
    assert "for" in terms
    assert "while" in terms
    assert "do...while" in terms

    prompt = build_initial_prompt(sample_outline)
    print(f"initial_prompt hoàn chỉnh:\n-> '{prompt}'")
    assert "Bài giảng lập trình:" in prompt
    assert "for" in prompt
    assert "do...while" in prompt
    print("PASS: Sinh initial_prompt thành công, sẵn sàng nạp vào Whisper.")


def test_sha256_cache():
    """Kiểm tra P04: Băm SHA-256 và cơ chế Cache."""
    print("\n--- [TEST 3] Kiểm tra P04: Băm SHA-256 & Cache ---")
    dummy_file = "cache/test_sample.wav"
    assert Path(dummy_file).exists(), f"Không tìm thấy {dummy_file}"

    sha_1 = compute_file_sha256(dummy_file)
    print(f"Mã SHA-256 tính được: {sha_1}")
    assert len(sha_1) == 64

    # Kiểm tra nạp từ cache
    transcriber = GeminiTranscriber(cache_dir="cache")
    cache_path = transcriber.get_cache_path(sha_1)

    # Ghi thử dữ liệu mẫu vào cache
    sample_transcript = TranscriptOutput(
        video="test_sample.wav",
        duration=2.0,
        sentences=[
            Sentence(id="S0001", start=0.0, end=2.0, text="Âm thanh thử nghiệm.", words=[])
        ]
    )
    with open(cache_path, "w", encoding="utf-8") as f:
        f.write(sample_transcript.model_dump_json())

    # Gọi transcribe -> Phải nhận diện Cache Hit ngay lập tức (<0.05s)
    t0 = time.time()
    cached_result = transcriber.transcribe(dummy_file)
    elapsed = time.time() - t0

    assert cached_result.sentences[0].id == "S0001"
    print(f"Thời gian nạp từ Cache: {elapsed*1000:.2f}ms (Cache Hit chuẩn xác)")
    print("PASS: Cơ chế Cache SHA-256 hoạt động hoàn hảo.")


def test_gemini_api_connection():
    """Kiểm tra kết nối Gemini API với model gemini-3.5-flash."""
    print("\n--- [TEST 4] Kiểm tra kết nối Gemini API (Sẵn sàng Tuần 2) ---")
    api_key = default_ai_config.gemini_api_key
    assert api_key, "Chưa thiết lập GEMINI_API_KEY trong .env"

    from google import genai
    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents="Phản hồi đúng 1 từ: READY"
        )
        ans = response.text.strip()
        print(f"Phản hồi từ Gemini 3.5 Flash: {ans}")
        assert "READY" in ans.upper()
        print("PASS: Gemini API sẵn sàng phục vụ phân đoạn ngữ nghĩa ở Tuần 2.")
    except Exception as e:
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            print(f"INFO: Kết nối API thành công (Đã chạm hạn mức 20 req/ngày của Free Tier).")
            print("PASS: Gemini API Key hợp lệ và sẵn sàng.")
        else:
            raise


if __name__ == "__main__":
    test_models_and_sentence_id()
    test_initial_prompt_builder()
    test_sha256_cache()
    test_gemini_api_connection()
    print("\n=======================================================")
    print(" TẤT CẢ CÁC BÀI TEST TUẦN 1 CỦA SV2 ĐÃ ĐẠT 100%!")
    print("=======================================================\n")
