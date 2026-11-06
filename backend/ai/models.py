"""Data models for AutoCut AI according to Project Specification Section 5.
"""

from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class Word(BaseModel):
    """Mốc thời gian chi tiết của từng từ."""
    word: str
    start: float
    end: float


class Sentence(BaseModel):
    """Một câu phát biểu (segment từ Whisper) kèm mã câu định danh chuẩn S0001."""
    id: str = Field(..., description="Mã câu định danh: S + 4 chữ số (hoặc 5 chữ số nếu > 9999 câu)")
    start: float = Field(..., description="Thời điểm bắt đầu câu (giây)")
    end: float = Field(..., description="Thời điểm kết thúc câu (giây)")
    text: str = Field(..., description="Nội dung văn bản của câu")
    # Loại bỏ hoàn toàn trường words khi xuất JSON (exclude=True) để chỉ phân tích theo câu
    words: Optional[List[Word]] = Field(default=None, exclude=True, description="Mốc thời gian từng từ (không xuất ra JSON)")

    @field_validator("id")
    @classmethod
    def validate_sentence_id(cls, v: str) -> str:
        if not v.startswith("S") or not v[1:].isdigit():
            raise ValueError(f"Sentence ID phải có định dạng 'S' theo sau là các chữ số (ví dụ S0001), nhận được: {v}")
        return v


class TranscriptOutput(BaseModel):
    """Cấu trúc tệp transcript.json (Mục 5.1)."""
    video: str = Field(..., description="Tên tệp video gốc (ví dụ: Bai05_VongLap.mp4)")
    duration: float = Field(..., description="Tổng thời lượng video (giây)")
    sentences: List[Sentence] = Field(default_factory=list, description="Danh sách các câu đã được đánh số tăng dần")


# --- Models cho đầu ra của LLM (Mục 5.3) và thẩm định kết quả (Mục B5) ---

class Topic(BaseModel):
    """Chủ đề con bên trong một Phần lớn."""
    title: str = Field(..., description="Tên chủ đề hiển thị (ví dụ: Vòng lặp for)")
    slug: str = Field(..., description="Tên rút gọn không dấu dùng để đặt tên file (ví dụ: for)")
    start_id: str = Field(..., description="Mã câu bắt đầu (ví dụ: S0012)")
    end_id: str = Field(..., description="Mã câu kết thúc (ví dụ: S0142)")


class Section(BaseModel):
    """Phần lớn trong bài giảng (ví dụ: Lý thuyết, Thực hành ví dụ, Bài tập)."""
    label: str = Field(..., description="Tên nhãn phần lớn")
    topics: List[Topic] = Field(default_factory=list, description="Danh sách các chủ đề thuộc phần này")


class LLMOutput(BaseModel):
    """Cấu trúc JSON đầu ra của LLM phân đoạn 2 cấp (Mục 5.3)."""
    sections: List[Section] = Field(default_factory=list, description="Danh sách các phần lớn")
