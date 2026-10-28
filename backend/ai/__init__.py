"""AutoCut AI - Module AI (SV2)
Chịu trách nhiệm:
- Nhận dạng giọng nói (Gemini API / Whisper STT) & đánh số câu chuẩn format S0001 (P02)
- Mồi từ khóa thuật ngữ (initial_prompt) từ đề cương (P03)
- Cache transcript theo mã băm SHA-256 (P04)
- Phân đoạn chủ đề bằng LLM / Gemini (P06, P07, P08)
- Thẩm định kết quả LLM & Tự sửa lỗi (P09)
"""

from .models import Word, Sentence, TranscriptOutput, Topic, Section, LLMOutput
from .prompt_builder import build_initial_prompt, extract_terms_from_outline
from .gemini_transcriber import GeminiTranscriber
from .whisper_service import WhisperTranscriber
from .transcript_refiner import TranscriptRefiner

__all__ = [
    "Word",
    "Sentence",
    "TranscriptOutput",
    "Topic",
    "Section",
    "LLMOutput",
    "build_initial_prompt",
    "extract_terms_from_outline",
    "GeminiTranscriber",
    "WhisperTranscriber",
    "TranscriptRefiner"
]
