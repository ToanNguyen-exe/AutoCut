"""Module hậu xử lý và làm sạch Transcript (Làm sạch ảo giác & chuẩn hóa thuật ngữ chuyên ngành).

Giải quyết triệt để các lỗi thường gặp của Whisper:
1. Lặp từ vô tận (Repetition Loop / Hallucination): 'kênh kênh kênh...' -> 'kênh'
2. Ký tự ngoại ngữ rác (Korean/Chinese/Japanese tokens do ảo giác âm lượng nhỏ: 습니다, 로...)
3. Chuẩn hóa các thuật ngữ CNTT / Web3 / Lập trình bị nhận dạng sai âm tiếng Việt.
4. Gộp các segment bị tách vụn do ngừng nghỉ ngắn không có dấu chấm câu.
5. Luôn viết hoa chữ cái đầu câu và kết thúc câu bằng đúng 1 dấu chấm câu.
"""

import re
from typing import List, Optional
from .models import Sentence, TranscriptOutput


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

# Các ký tự kết thúc câu hoặc mệnh đề hoàn chỉnh
PUNCTUATION_ENDINGS = ('.', ',', '?', '!', ';', ':', '…', '...')


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


def ensure_sentence_casing_and_punctuation(text: str) -> str:
    """Đảm bảo trong 1 câu thì chữ ở đầu câu luôn viết hoa, và cuối câu luôn có đúng 1 dấu chấm (hoặc dấu hỏi/than)."""
    if not text:
        return ""

    text = text.strip()
    if not text:
        return ""

    # 1. Chữ ở đầu câu luôn viết hoa (bỏ qua dấu mở ngoặc/trích dẫn nếu có)
    start_idx = 0
    while start_idx < len(text) and text[start_idx] in ('"', "'", '“', '‘', '(', '[', '{', ' '):
        start_idx += 1

    if start_idx < len(text) and text[start_idx].isalpha():
        text = text[:start_idx] + text[start_idx].upper() + text[start_idx + 1:]

    # 2. Xóa các dấu câu lửng lơ ở cuối như phẩy, hai chấm, chấm phẩy, gạch ngang
    text = text.rstrip(" \t,;:-")

    # 3. Cuối câu luôn có đúng 1 dấu chấm (hoặc giữ dấu hỏi/cảm thán nếu có sẵn)
    if text.endswith("?"):
        text = text.rstrip("?").rstrip() + "?"
    elif text.endswith("!"):
        text = text.rstrip("!").rstrip() + "!"
    elif text.endswith("..."):
        text = text.rstrip(".").rstrip() + "."
    elif text.endswith("…"):
        text = text.rstrip("…").rstrip() + "."
    elif text.endswith("."):
        # Đảm bảo chỉ có đúng 1 dấu chấm duy nhất (tránh ".." hay "...")
        text = text.rstrip(".").rstrip() + "."
    else:
        text = text + "."

    return text


def post_process_sentence(text: str) -> str:
    """Xử lý toàn diện một câu văn bản: dọn rác ảo giác + sửa từ chuyên ngành + viết hoa đầu câu & chấm cuối câu."""
    cleaned = clean_hallucination_and_artifacts(text)
    corrected = correct_domain_terminology(cleaned)
    formatted = ensure_sentence_casing_and_punctuation(corrected)
    return formatted


def is_ending_with_punctuation(text: str) -> bool:
    """Kiểm tra xem câu có kết thúc bằng dấu chấm câu (chấm, phẩy, hỏi chấm, than...) hay không."""
    t = text.strip().rstrip('"\'”)]{}')
    return bool(t) and t.endswith(PUNCTUATION_ENDINGS)


def merge_fragmented_segments(segments: list) -> list[dict]:
    """Hậu xử lý gộp các segment bị tách vụn không có dấu chấm câu vào segment liền kề.

    Quy tắc (Chuẩn Python 3.12):
    - Nếu segment không kết thúc bằng dấu chấm câu (chấm, phẩy, hỏi chấm, than...),
      hãy gộp text và mốc end của nó vào segment liền kề phía sau, đồng thời giữ nguyên
      mốc start ban đầu.
    - Mỗi câu sau khi hoàn tất luôn có chữ đầu câu viết hoa và cuối câu có đúng 1 dấu chấm.
    """
    merged: list[dict] = []
    current: dict | None = None

    for seg in segments:
        raw_text = getattr(seg, "text", "") if hasattr(seg, "text") else seg.get("text", "")
        s_start = getattr(seg, "start", 0.0) if hasattr(seg, "start") else seg.get("start", 0.0)
        s_end = getattr(seg, "end", 0.0) if hasattr(seg, "end") else seg.get("end", 0.0)

        cleaned_text = clean_hallucination_and_artifacts(raw_text)
        cleaned_text = correct_domain_terminology(cleaned_text).strip()
        if not cleaned_text:
            continue

        if current is None:
            current = {
                "start": round(float(s_start), 2),
                "end": round(float(s_end), 2),
                "text": cleaned_text
            }
        else:
            # Nếu segment trước đó không kết thúc bằng dấu chấm câu -> Gộp vào segment này
            if not is_ending_with_punctuation(current["text"]):
                current["text"] = f"{current['text']} {cleaned_text}"
                current["end"] = round(float(s_end), 2)
                # Mốc start được giữ nguyên từ segment ban đầu
            else:
                # Segment trước đã hoàn tất -> Chuẩn hóa viết hoa đầu câu & 1 dấu chấm cuối câu
                current["text"] = ensure_sentence_casing_and_punctuation(current["text"])
                merged.append(current)
                current = {
                    "start": round(float(s_start), 2),
                    "end": round(float(s_end), 2),
                    "text": cleaned_text
                }

    if current is not None:
        current["text"] = ensure_sentence_casing_and_punctuation(current["text"])
        merged.append(current)

    return merged


def post_process_transcript(transcript: TranscriptOutput) -> TranscriptOutput:
    """Lọc rác, gộp các đoạn bị tách vụn và chuẩn hóa mã định danh câu Sxxxx."""
    merged_items = merge_fragmented_segments(transcript.sentences)
    digit_count = 5 if len(merged_items) > 9999 else 4

    new_sentences: list[Sentence] = []
    for idx, item in enumerate(merged_items, start=1):
        formatted_text = ensure_sentence_casing_and_punctuation(item["text"])
        new_sentences.append(
            Sentence(
                id=f"S{idx:0{digit_count}d}",
                start=item["start"],
                end=item["end"],
                text=formatted_text
            )
        )

    transcript.sentences = new_sentences
    return transcript
