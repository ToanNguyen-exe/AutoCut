"""Module hậu xử lý và làm sạch Transcript (Làm sạch ảo giác, tách câu đơn & chuẩn hóa thuật ngữ chuyên ngành).

Giải quyết triệt để các lỗi thường gặp của Whisper:
1. Lặp từ vô tận (Repetition Loop / Hallucination): 'kênh kênh kênh...' -> 'kênh'
2. Ký tự ngoại ngữ rác (Korean/Chinese/Japanese tokens do ảo giác âm lượng nhỏ: 습니다, 로...)
3. Chuẩn hóa các thuật ngữ CNTT / Web3 / Lập trình bị nhận dạng sai âm tiếng Việt.
4. Gộp các segment quá ngắn bị ngắt giữa chừng và tách các đoạn văn dài thành từng câu đơn độc lập kèm nội suy thời gian.
5. Luôn viết hoa chữ cái đầu câu và kết thúc câu bằng đúng 1 dấu chấm câu.
"""

import re
from typing import List
from .models import Sentence, TranscriptOutput


# Từ điển ánh xạ các thuật ngữ bị Whisper nhận dạng sai âm trong bài giảng CNTT/Web3/JavaScript
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

    # JavaScript / Web Development
    (r"\b(?:gia\s+va\s+sờ\s+cờ\s+ríp|gia\s+va\s+sờ\s+cờ\s+rít|javascript)\b", "JavaScript"),
    (r"\b(?:nốt\s+js|nốt\s+giây\s+ét|nodejs)\b", "Node.js"),
    (r"\b(?:hát\s+tê\s+mờ\s+lờ|html)\b", "HTML"),
    (r"\b(?:vê\s+ét\s+cốt|vs\s+cốt|vscode)\b", "VS Code"),
    (r"\b(?:đốc\s+cơ\s+mừn\s+chấm\s+rai|document\s+chấm\s+write)\b", "document.write"),
    (r"\b(?:con\s+sôn\s+chấm\s+lốc|console\s+chấm\s+log)\b", "console.log"),

    # Lỗi phát âm & chính tả tiếng Việt phổ biến khi Whisper nghe bài giảng
    (r"\b(?:hệ\s+sinh\s+tái)\b", "hệ sinh thái"),
    (r"\b(?:hôn\s+ngữ|muôn\s+ngữ)\b", "ngôn ngữ"),
    (r"\b(?:hội\s+chữ|hổng\s+hộ)\b", "hỗ trợ"),
    (r"\b(?:thị\s+trùm)\b", "thị trường"),
    (r"\b(?:sứng\s+đáng)\b", "xứng đáng"),
    (r"\b(?:Phương\s+nhận\s+nhất)\b", "Quan trọng nhất"),
    (r"\b(?:rất\s+tự\s+sự\s+của\s+hợp)\b", "rất thực sự phù hợp"),
    (r"\b(?:chiến\s+nó\s+thành)\b", "chia nó thành"),
    (r"\b(?:Ở\s+Lê\s+Lan)\b", "ở level"),
    (r"\b(?:thể\s+ấn\s+trên\s+hộ)\b", "thể lên trên fanpage"),
]

# Chỉ coi dấu kết thúc câu thực sự (., ?, !, …) là ranh giới đóng câu
SENTENCE_END_PUNCTUATION = ('.', '?', '!', '…', '...')

# Biểu thức chính quy tách câu tại dấu ., ?, !, … nhưng KHÔNG tách bên trong tên kỹ thuật như Node.js, document.write, console.log, v.v.
SENTENCE_BOUNDARY_RE = re.compile(r'(?<=[.?!…])\s+(?=[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ"\'“‘(\[])')


def clean_hallucination_and_artifacts(text: str) -> str:
    """Loại bỏ triệt để ảo giác lặp từ, ký tự ngoại ngữ rác (Hàn, Trung, Nhật)."""
    if not text:
        return ""

    cleaned = re.sub(r"[\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]+", "", text)
    cleaned = re.sub(r"(?:kênh|kên)(\s+(?:kênh|kên)){2,}", "kênh", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(\w+)(?:\s+\1){2,}\b", r"\1", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"xin lỗimillion", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"asingly number thôi", "", cleaned, flags=re.IGNORECASE)
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

    start_idx = 0
    while start_idx < len(text) and text[start_idx] in ('"', "'", '“', '‘', '(', '[', '{', ' '):
        start_idx += 1

    if start_idx < len(text) and text[start_idx].isalpha():
        text = text[:start_idx] + text[start_idx].upper() + text[start_idx + 1:]

    text = text.rstrip(" \t,;:-")

    if text.endswith("?"):
        text = text.rstrip("?").rstrip() + "?"
    elif text.endswith("!"):
        text = text.rstrip("!").rstrip() + "!"
    elif text.endswith("..."):
        text = text.rstrip(".").rstrip() + "."
    elif text.endswith("…"):
        text = text.rstrip("…").rstrip() + "."
    elif text.endswith("."):
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
    """Kiểm tra xem câu có kết thúc bằng dấu kết thúc câu (., ?, !, …) hay không."""
    t = text.strip().rstrip('"\'”)]{}')
    return bool(t) and t.endswith(SENTENCE_END_PUNCTUATION)


def split_text_into_sentences(text: str) -> List[str]:
    """Tách một đoạn văn bản dài chứa nhiều câu thành danh sách các câu đơn độc lập."""
    if not text or not text.strip():
        return []

    raw_parts = SENTENCE_BOUNDARY_RE.split(text.strip())
    sentences: List[str] = []

    for part in raw_parts:
        p = part.strip()
        if not p:
            continue
        word_count = len(p.split())
        # Nếu mảnh trước đó quá ngắn (<= 2 từ, ví dụ "OK!", "Nha!", "Rồi.") thì ghép vào câu kế tiếp
        if sentences and len(sentences[-1].split()) <= 2:
            sentences[-1] = f"{sentences[-1]} {p}"
        else:
            sentences.append(p)

    # Nếu mảnh cuối cùng quá ngắn (<= 2 từ) thì ghép vào câu liền trước
    if len(sentences) > 1 and len(sentences[-1].split()) <= 2:
        last_part = sentences.pop()
        sentences[-1] = f"{sentences[-1]} {last_part}"

    return [ensure_sentence_casing_and_punctuation(s) for s in sentences if s.strip()]


def split_segment_into_timed_sentences(start: float, end: float, text: str) -> List[dict]:
    """Tách một segment có thể chứa nhiều câu thành các câu đơn kèm nội suy mốc [start, end] theo tỷ lệ độ dài."""
    sentence_texts = split_text_into_sentences(text)
    if not sentence_texts:
        return []

    if len(sentence_texts) == 1:
        return [{
            "start": round(float(start), 2),
            "end": round(float(end), 2),
            "text": sentence_texts[0]
        }]

    total_duration = max(0.01, float(end) - float(start))
    char_lengths = [max(1, len(s)) for s in sentence_texts]
    total_chars = sum(char_lengths)

    result: List[dict] = []
    curr_start = float(start)
    for idx, (s_text, c_len) in enumerate(zip(sentence_texts, char_lengths)):
        if idx == len(sentence_texts) - 1:
            curr_end = round(float(end), 2)
        else:
            ratio = c_len / total_chars
            curr_end = round(curr_start + total_duration * ratio, 2)
            if curr_end <= curr_start:
                curr_end = round(curr_start + 0.05, 2)

        result.append({
            "start": round(curr_start, 2),
            "end": curr_end,
            "text": s_text
        })
        curr_start = curr_end

    return result


def merge_fragmented_segments(
    segments: list,
    max_merged_duration: float = 12.0,
    max_merged_words: int = 32
) -> list[dict]:
    """Hậu xử lý gộp các segment bị ngắt vụn quá ngắn và tự động tách các đoạn dài thành câu đơn độc lập."""
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
            combined_duration = float(s_end) - float(current["start"])
            combined_words = len(current["text"].split()) + len(cleaned_text.split())
            gap = float(s_start) - float(current["end"])

            should_merge = (
                not is_ending_with_punctuation(current["text"])
                and combined_duration <= max_merged_duration
                and combined_words <= max_merged_words
                and gap <= 1.5
            )

            if should_merge:
                current["text"] = f"{current['text']} {cleaned_text}"
                current["end"] = round(float(s_end), 2)
            else:
                merged.extend(
                    split_segment_into_timed_sentences(current["start"], current["end"], current["text"])
                )
                current = {
                    "start": round(float(s_start), 2),
                    "end": round(float(s_end), 2),
                    "text": cleaned_text
                }

    if current is not None:
        merged.extend(
            split_segment_into_timed_sentences(current["start"], current["end"], current["text"])
        )

    return merged


def post_process_transcript(transcript: TranscriptOutput) -> TranscriptOutput:
    """Lọc rác, tách các đoạn văn dài thành câu đơn và chuẩn hóa mã định danh câu Sxxxx."""
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
