"""Module hậu xử lý và làm sạch Transcript (Làm sạch ảo giác, chuẩn hóa thuật ngữ & tách câu chuẩn xác).

Giải quyết triệt để các lỗi thường gặp của Whisper & chuẩn hóa đầu ra:
1. Lặp từ vô tận (Repetition Loop / Hallucination): 'kênh kênh kênh...' -> 'kênh'
2. Ký tự ngoại ngữ rác (Korean/Chinese/Japanese tokens do ảo giác âm lượng nhỏ: 습니다, 로...)
3. Chuẩn hóa các thuật ngữ CNTT / Web3 / JavaScript / Lập trình bị nhận dạng sai âm tiếng Việt.
4. Gộp có kiểm soát các mảnh câu quá ngắn và TÁCH các đoạn văn dài thành từng câu độc lập có đánh mã số S0001, S0002... kèm nội suy mốc thời gian (start, end) chính xác.
5. Luôn viết hoa chữ cái đầu câu và kết thúc câu bằng đúng 1 dấu chấm câu.
"""

import re
from typing import List, Optional
from .models import Sentence, TranscriptOutput


# Từ điển ánh xạ các thuật ngữ bị Whisper nhận dạng sai âm trong bài giảng CNTT / Lập trình / Web3
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

    # JavaScript & Lập trình Web
    (r"\b(?:ZivaStream|Zavascript|Java\s+Script|server\s+script)\b", "JavaScript"),
    (r"\b(?:phimuyên\s+thuỷ|phimuyên\s+thủy|phi\s+nguyên\s+thuỷ)\b", "phi nguyên thủy"),
    (r"\b(?:nguyên\s+thuỷ)\b", "nguyên thủy"),
    (r"\b(?:stringuyên\s+thủy|stringuyên\s+thuỷ)\b", "string nguyên thủy"),
    (r"\b(?:stringobject)\b", "string object"),
    (r"\b(?:phang\s+sần|phang\s+sinh|fang\s+sơn|phang\s+sân|phang\s+son|phang\s+sừng|phăng\s+sừng|funcion|fang\s+sinh)\b", "function"),
    (r"\b(?:Kohl\s+Function)\b", "Call Function"),
    (r"\b(?:KuFap\s+Arrow\s+Function)\b", "cú pháp Arrow Function"),
    (r"\b(?:document\s+drive)\b", "document.write"),
    (r"\b(?:window\.prom|window\.pro|windowprome|Window\s+Prom)\b", "window.prompt"),
    (r"\b(?:Pass\s+in\s+the\s+T)\b", "parseInt"),
    (r"\b(?:documentGetElement\s*ByID|document\.getElementByID|document\s+Get\s+element\s+By\s+ID)\b", "document.getElementById"),
    (r"\b(?:inner\s+HTML|Inner\s+HTML)\b", "innerHTML"),
    (r"\b(?:Set\s+Tamal|set\s+thammao|set\s+tham\s+ao|Setamao|Setamaon|xét\s+thammao)\b", "setTimeout"),
    (r"\b(?:Time\s+Coercent)\b", "Type Coercion"),
    (r"\b(?:Da\s+Luong\s+Mantit\s+Thread)\b", "đa luồng (Multi-thread)"),
    (r"\b(?:si\s+cộng\s+cộn|Si\s+cộp\s+cộc|Xi\s+ổng\s+vọng|xi\s+cộng\s+cộng)\b", "C++"),
    (r"\b(?:VH\s+Engine|V8Engine|NGV8|Engine\s+V8)\b", "V8 Engine"),
    (r"\b(?:Truyền\s+Convac)\b", "truyền Callback"),
    (r"\b(?:ProMix)\b", "Promise"),
    (r"\b(?:Asin\s+Await)\b", "Async/Await"),
    (r"\b(?:West\s+storage)\b", "Web Storage"),
    (r"\b(?:Index\s+DB)\b", "IndexedDB"),
    (r"\b(?:HTM\s+L5)\b", "HTML5"),
    (r"\b(?:NoSQL\s+Databay)\b", "NoSQL Database"),
    (r"\b(?:LocalStory|LogoStory|Logo\s+Story|local\s+storage)\b", "localStorage"),
    (r"\b(?:clip\s+server)\b", "Live Server"),
    (r"\b(?:127\.0\.1\s+5500)\b", "127.0.0.1:5500"),
    (r"\b(?:C\s+R\s+U\s+D\s+Ví\s+tắt\s+của\s+Korea,\s+read\s+update\s+và\s+delete)\b", "CRUD, viết tắt của Create, Read, Update và Delete"),
    (r"\b(?:căn\s+trồn\s+em|canchon\s+S|Căn\s+chuẩn\s+s|Căn\s+chuẩn\s+S|canh\s+chuẩn\s+En|canh\s+Chuẩn\s+en|canh\s+cho\s+nét)\b", "Ctrl + S"),
    (r"\b(?:Amy\s+Fukada|Amy\s+Fukadda|Fucada|Fukadah|Fuka\s+Da|a\s+Bifurcada)\b", "Eimi Fukada"),
    (r"\b(?:UAMI-KAMI|Ua\s+Mikami)\b", "Yua Mikami"),

    # Lỗi phát âm & chính tả tiếng Việt phổ biến khi Whisper nghe bài giảng
    (r"\b(?:duyên\s+liệu|dư\s+liệu|dữ\s+lượu|dữ\s+líộn|dữ\s+lịu|dư\s+liều|duy\s+liệu|di\s+liệu|dý\s+liệu|dý\s+lợi|dưới\s+liệu|dự\s+liệu|dữ\s+di\s+liệu|giới\s+liệu)\b", "dữ liệu"),
    (r"\b(?:hệ\s+sinh\s+tái)\b", "hệ sinh thái"),
    (r"\b(?:hôn\s+ngữ|muôn\s+ngữ|ngôn\s+mữ|nguôn\s+ngữ|ngồn\s+ngữ|nguồn\s+ngữ|quân\s+gương|ngôn\s+gương)\b", "ngôn ngữ"),
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
PUNCTUATION_ENDINGS = ('.', '?', '!', ';', ':', '…', '...')

# Biểu thức chính quy nhận diện ranh giới giữa các câu (dấu chấm, hỏi, chấm than, chấm phẩy)
# theo sau bởi khoảng trắng và chữ cái viết hoa (hoặc dấu mở ngoặc/nháy + chữ hoa).
# Không tách các lệnh có dấu chấm liền như document.write, console.log, window.prompt, 127.0.0.1
SENTENCE_BOUNDARY_RE = re.compile(
    r'([.?!;…]+\s*["”\'’)\]]*)\s+(?=["“\'‘(\[]*[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ])'
)


def clean_hallucination_and_artifacts(text: str) -> str:
    """Loại bỏ triệt để ảo giác lặp từ, ký tự ngoại ngữ rác (Hàn, Trung, Nhật)."""
    if not text:
        return ""

    # 1. Bỏ ký tự tiếng Hàn, Trung, Nhật, Nga rác do Whisper ảo giác ở đoạn âm thanh nhỏ/nhiễu
    cleaned = re.sub(r"[\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff\ufffd]+", "", text)

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

    # Check if ends with closing quote after punctuation, e.g. "Quất luôn!"
    if len(text) >= 2 and text[-1] in ('"', "'", '”', '’', ')') and text[-2] in ('.', '?', '!'):
        return text

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
    """Kiểm tra xem câu có kết thúc bằng dấu kết câu (. ? ! ; :) hay không."""
    t = text.strip().rstrip('"\'”)]{}')
    return bool(t) and t.endswith(PUNCTUATION_ENDINGS)


def split_text_into_sentences(text: str, min_words: int = 5) -> list[str]:
    """Tách một đoạn văn bản gồm nhiều câu thành danh sách các câu đơn độc lập.

    - Bảo toàn các biểu thức code có dấu chấm như document.write, console.log, window.prompt, Node.js, 127.0.0.1.
    - Tự động ghép các từ cảm thán/câu đệm quá ngắn (< min_words từ, ví dụ: 'Nha!', 'OK!', 'Đó.')
      vào câu liền kề để không tạo ra các câu rác chỉ có 1-3 chữ.
    """
    cleaned = clean_hallucination_and_artifacts(text)
    cleaned = correct_domain_terminology(cleaned).strip()
    if not cleaned:
        return []

    # Đánh dấu vị trí tách câu bằng ký tự xuống dòng tạm thời
    marked = SENTENCE_BOUNDARY_RE.sub(r"\1\n", cleaned)
    raw_parts = [p.strip() for p in marked.split("\n") if p.strip()]

    if len(raw_parts) <= 1:
        return [ensure_sentence_casing_and_punctuation(cleaned)]

    # Bước 1: Ghép các câu đệm/thán từ quá ngắn ở phía trước vào câu kế tiếp (ví dụ: 'Nha!', 'OK!', 'Xít quên!')
    forward_merged: list[str] = []
    buffer = ""
    for part in raw_parts:
        combined = f"{buffer} {part}".strip() if buffer else part
        word_count = len(combined.split())
        if word_count < min_words:
            buffer = combined
        else:
            forward_merged.append(combined)
            buffer = ""

    if buffer:
        if forward_merged:
            forward_merged[-1] = f"{forward_merged[-1]} {buffer}".strip()
        else:
            forward_merged.append(buffer)

    return [ensure_sentence_casing_and_punctuation(s) for s in forward_merged if s.strip()]


def split_segment_into_timed_sentences(
    start: float,
    end: float,
    text_or_sentences: str | list[str],
    min_words: int = 5
) -> list[dict]:
    """Tách một segment có mốc [start, end] thành các câu độc lập và nội suy thời gian theo tỷ lệ độ dài."""
    sentences: list[str] = []
    if isinstance(text_or_sentences, str):
        sentences = split_text_into_sentences(text_or_sentences, min_words=min_words)
    else:
        for item in text_or_sentences:
            sentences.extend(split_text_into_sentences(item, min_words=min_words))

    if not sentences:
        return []

    start_f = round(float(start), 2)
    end_f = round(float(end), 2)
    if len(sentences) == 1 or end_f <= start_f:
        return [{
            "start": start_f,
            "end": max(start_f, end_f),
            "text": ensure_sentence_casing_and_punctuation(sentences[0])
        }]

    total_duration = end_f - start_f
    weights = [max(len(s), 1) for s in sentences]
    total_weight = sum(weights)

    timed_items: list[dict] = []
    cum_weight = 0
    for idx, (s_text, w) in enumerate(zip(sentences, weights)):
        s_start = start_f if idx == 0 else round(start_f + total_duration * (cum_weight / total_weight), 2)
        cum_weight += w
        s_end = end_f if idx == len(sentences) - 1 else round(start_f + total_duration * (cum_weight / total_weight), 2)
        if s_end < s_start:
            s_end = s_start
        timed_items.append({
            "start": s_start,
            "end": s_end,
            "text": ensure_sentence_casing_and_punctuation(s_text)
        })

    return timed_items


def merge_fragmented_segments(
    segments: list,
    max_merged_duration: float = 12.0,
    max_merged_words: int = 32,
    max_pause_gap: float = 0.6
) -> list[dict]:
    """Hậu xử lý gộp các mảnh quá ngắn và tách các đoạn nhiều câu thành từng câu đơn chuẩn xác.

    Quy tắc:
    1. Chỉ gộp 2 segment liền kề nếu segment trước chưa có dấu kết câu, khoảng nghỉ <= max_pause_gap,
       tổng thời lượng sau khi gộp <= max_merged_duration (12s) và tổng số từ <= max_merged_words (32 từ).
       (Tránh tuyệt đối hiện tượng gộp tràn lan thành đoạn văn dài hàng chục giây).
    2. Nếu một segment chứa nhiều câu (ngăn cách bởi dấu chấm, hỏi, cảm thán), tự động tách thành
       các câu riêng biệt với mốc thời gian start, end được nội suy chính xác.
    """
    coarsely_merged: list[dict] = []
    current: dict | None = None

    for seg in segments:
        raw_text = getattr(seg, "text", "") if hasattr(seg, "text") else seg.get("text", "")
        s_start = float(getattr(seg, "start", 0.0) if hasattr(seg, "start") else seg.get("start", 0.0))
        s_end = float(getattr(seg, "end", 0.0) if hasattr(seg, "end") else seg.get("end", 0.0))

        cleaned_text = clean_hallucination_and_artifacts(raw_text)
        cleaned_text = correct_domain_terminology(cleaned_text).strip()
        if not cleaned_text:
            continue

        if current is None:
            current = {
                "start": round(s_start, 2),
                "end": round(s_end, 2),
                "text": cleaned_text
            }
        else:
            pause_gap = s_start - current["end"]
            combined_duration = s_end - current["start"]
            combined_words = len(current["text"].split()) + len(cleaned_text.split())

            should_merge = (
                not is_ending_with_punctuation(current["text"])
                and pause_gap <= max_pause_gap
                and combined_duration <= max_merged_duration
                and combined_words <= max_merged_words
            )

            if should_merge:
                current["text"] = f"{current['text']} {cleaned_text}"
                current["end"] = round(s_end, 2)
            else:
                coarsely_merged.append(current)
                current = {
                    "start": round(s_start, 2),
                    "end": round(s_end, 2),
                    "text": cleaned_text
                }

    if current is not None:
        coarsely_merged.append(current)

    # Bước 2: Tách mọi đoạn văn chứa nhiều câu thành các câu đơn độc lập kèm nội suy [start, end]
    final_items: list[dict] = []
    for item in coarsely_merged:
        split_items = split_segment_into_timed_sentences(item["start"], item["end"], item["text"])
        final_items.extend(split_items)

    return final_items


def post_process_transcript(transcript: TranscriptOutput) -> TranscriptOutput:
    """Lọc rác, tách các đoạn văn dài thành câu đơn và chuẩn hóa mã định danh câu Sxxxx."""
    processed_items = merge_fragmented_segments(transcript.sentences)
    digit_count = 5 if len(processed_items) > 9999 else 4

    new_sentences: list[Sentence] = []
    for idx, item in enumerate(processed_items, start=1):
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
