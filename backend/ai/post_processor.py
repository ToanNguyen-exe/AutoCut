"""Module hậu xử lý và làm sạch Transcript (Làm sạch ảo giác & chuẩn hóa thuật ngữ chuyên ngành).

Giải quyết triệt để các lỗi thường gặp của Whisper:
1. Lặp từ vô tận (Repetition Loop / Hallucination): 'kênh kênh kênh...' -> 'kênh'
2. Ký tự ngoại ngữ rác (Korean/Chinese/Japanese tokens do ảo giác âm lượng nhỏ: 습니다, 로...)
3. Chuẩn hóa các thuật ngữ CNTT / Web3 / Lập trình bị nhận dạng sai âm tiếng Việt.
"""

import re
from typing import List
from .models import Sentence, TranscriptOutput, Word


# Từ điển ánh xạ các thuật ngữ bị Whisper nhận dạng sai âm trong bài giảng CNTT/Web3
DOMAIN_TERM_MAPPINGS = [
    # Blockchain & Web3
    (r"\b(?:bởi\s+lúc\s+trên|lúc\s+chain|lốc\s+chen|bởi\s+lúc\s+chen|lúc\s+chen)\b", "blockchain"),
    (r"\b(?:Blockchain\s+nào\s+đang\s+có\s+thể,\s+chúng\s+ta\s+có\s+thể\s+dễ\s+dàng\s+người\s+ta)\b", "Blockchain nào chúng ta có thể dễ dàng"),
    (r"\b(?:nào\s+lớp\s+3|lớp\s+3|lớp\s+ba)\b", "Web3"),
    (r"\b(?:test\s+stack|tét\s+tắc|test\s+tắc)\b", "tech stack"),
    (r"\b(?:e-roll|e\s+rôn|e\s+dốt|e\s+rốp)\b", "airdrop"),
    (r"\b(?:Solana\s+Superjip|Superjip)\b", "Solana Superteam"),
    (r"\b(?:OpenGuy)\b", "OpenGov"),
    (r"\b(?:suy\s+hấp)\b", "Sui Hub"),
    (r"\b(?:À\s+suy\s+luôn)\b", "À Sui luôn"),
    (r"\b(?:mà\s+suy\s+nữa)\b", "mạng Sui nữa"),
    (r"\b(?:giống\s+như\s+Sui)\b", "giống như Sui"),
    (r"\b(?:hacker\s+camp)\b", "hacker house"),
    (r"\b(?:nốt\s+developer|nút\s+developer)\b", "Web3 developer"),
    (r"\b(?:DefiLlama|đề\s+phi\s+la\s+ma)\b", "DefiLlama"),
    (r"\b(?:on-chain|on\s+chen)\b", "on-chain"),
    (r"\b(?:smart\s+contract|xì\s+mát\s+con\s+trắc)\b", "smart contract"),
    (r"\b(?:Solidity|xô\s+li\s+đi\s+ti)\b", "Solidity"),

    # Lỗi phát âm & chính tả tiếng Việt phổ biến khi Whisper nghe bài giảng
    (r"\b(?:hệ\s+sinh\s+tái)\b", "hệ sinh thái"),
    (r"\b(?:hôn\s+ngữ)\b", "ngôn ngữ"),
    (r"\b(?:muôn\s+ngữ)\b", "ngôn ngữ"),
    (r"\b(?:hội\s+chữ|hổng\s+hộ)\b", "hỗ trợ"),
    (r"\b(?:thị\s+trùm)\b", "thị trường"),
    (r"\b(?:sứng\s+đáng)\b", "xứng đáng"),
    (r"\b(?:Phương\s+nhận\s+nhất)\b", "Quan trọng nhất"),
    (r"\b(?:rất\s+tự\s+sự\s+của\s+hợp)\b", "rất thực sự phù hợp"),
    (r"\b(?:chiến\s+nó\s+thành)\b", "chia nó thành"),
    (r"\b(?:Ở\s+Lê\s+Lan)\b", "ở level"),
    (r"\b(?:thể\s+ấn\s+trên\s+hộ)\b", "thể lên trên fanpage"),
]


def clean_hallucination_and_artifacts(text: str) -> str:
    """Loại bỏ triệt để ảo giác lặp từ, ký tự ngoại ngữ rác (Hàn, Trung, Nhật)."""
    if not text:
        return ""

    # 1. Bỏ ký tự tiếng Hàn, Trung, Nhật rác do Whisper ảo giác ở đoạn âm thanh nhỏ/nhiễu
    cleaned = re.sub(r"[\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]+", "", text)

    # 2. Xóa các chuỗi lặp từ vô nghĩa (ví dụ: 'kênh kênh kênh kên kên...')
    cleaned = re.sub(r"(?:kênh|kên)(\s+(?:kênh|kên)){2,}", "kênh", cleaned, flags=re.IGNORECASE)
    # Lặp bất kỳ từ nào từ 3 lần trở lên liên tiếp
    cleaned = re.sub(r"\b(\w+)(?:\s+\1){2,}\b", r"\1", cleaned, flags=re.IGNORECASE)

    # 3. Dọn rác các đoạn vô nghĩa kiểu 'compatibility xin lỗimillion', 'asingly number thôi'
    cleaned = re.sub(r"xin lỗimillion", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"asingly number thôi", "", cleaned, flags=re.IGNORECASE)

    # 4. Chuẩn hóa khoảng trắng và dấu câu
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.\?!])", r"\1", cleaned)
    return cleaned.strip()


def correct_domain_terminology(text: str) -> str:
    """Chuẩn hóa các thuật ngữ chuyên ngành công nghệ / lập trình / Web3."""
    if not text:
        return ""

    result = text
    for pattern, replacement in DOMAIN_TERM_MAPPINGS:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result


def post_process_sentence(text: str) -> str:
    """Xử lý toàn diện một câu văn bản: dọn rác ảo giác + sửa từ chuyên ngành."""
    cleaned = clean_hallucination_and_artifacts(text)
    corrected = correct_domain_terminology(cleaned)
    return corrected.strip()


def post_process_transcript(transcript: TranscriptOutput) -> TranscriptOutput:
    """Lọc và chuẩn hóa toàn bộ file TranscriptOutput."""
    new_sentences: List[Sentence] = []
    for s in transcript.sentences:
        processed_text = post_process_sentence(s.text)
        # Bỏ qua các câu rỗng sau khi lọc rác
        if not processed_text:
            continue
        new_s = s.model_copy()
        new_s.text = processed_text
        new_sentences.append(new_s)

    # Đánh lại mã câu nếu có câu rỗng bị lọc bỏ
    digit_count = 5 if len(new_sentences) > 9999 else 4
    for idx, s in enumerate(new_sentences, start=1):
        s.id = f"S{idx:0{digit_count}d}"

    transcript.sentences = new_sentences
    return transcript
