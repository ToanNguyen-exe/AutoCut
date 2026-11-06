"""Module tạo initial_prompt cho Whisper từ đề cương và từ điển công nghệ (Tính năng P03).

Mục tiêu: Đưa thuật ngữ chuyên ngành vào initial_prompt của Whisper để giảm thiểu tối đa lỗi
nhận dạng sai âm thanh tiếng Việt trong bài giảng CNTT/Web3 (ví dụ: nghe 'bởi lúc trên' thay vì 'blockchain',
'lớp 3' thay vì 'Web3', 'test stack' thay vì 'tech stack', 'e-roll' thay vì 'airdrop').
"""

import re
from typing import List, Optional


# Kho từ điển thuật ngữ CNTT / Lập trình / Web3 thông dụng trong các bài giảng
DEFAULT_TECH_VOCABULARY = [
    "blockchain", "Web3", "tech stack", "roadmap", "Ethereum", "Solana",
    "Polkadot", "Sui", "Ton", "Solidity", "DefiLlama", "Total Value Locked", "TVL",
    "on-chain", "smart contract", "DApp", "hacker house", "hackathon", "airdrop",
    "developer", "Superteam", "OpenGov", "VBI Academy", "hệ sinh thái", "ngôn ngữ lập trình",
    "thị trường", "biến", "hàm", "vòng lặp for", "while", "do while", "thuật toán"
]


def extract_terms_from_outline(outline_text: str) -> List[str]:
    """Trích xuất danh sách thuật ngữ từ văn bản đề cương."""
    if not outline_text or not outline_text.strip():
        return []

    terms: List[str] = []
    lines = outline_text.strip().splitlines()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        cleaned_line = re.sub(r"^[\d\.\-\*\+\s]+", "", line)
        if ":" in cleaned_line:
            parts = cleaned_line.split(":", 1)
            prefix_title = parts[0].strip()
            if prefix_title and len(prefix_title) < 40:
                terms.append(prefix_title)
            sub_items = re.split(r"[,;]+", parts[1])
            for item in sub_items:
                item_clean = item.strip()
                if item_clean:
                    terms.append(item_clean)
        else:
            sub_items = re.split(r"[,;]+", cleaned_line)
            for item in sub_items:
                item_clean = item.strip()
                if item_clean:
                    terms.append(item_clean)

    unique_terms: List[str] = []
    seen = set()
    for term in terms:
        term_norm = term.lower().strip()
        if term_norm and term_norm not in seen and len(term) <= 60:
            seen.add(term_norm)
            unique_terms.append(term.strip())

    return unique_terms


def build_initial_prompt(
    outline_text: Optional[str] = None,
    prefix: str = "Bài giảng lập trình:"
) -> str:
    """Tạo chuỗi initial_prompt hoàn chỉnh đưa vào Whisper transcribe.

    Tự động kết hợp thuật ngữ đề cương với kho thuật ngữ CNTT / Web3 phổ biến.
    """
    user_terms = extract_terms_from_outline(outline_text) if outline_text else []

    # Kết hợp từ khóa người dùng cung cấp và từ điển chuẩn
    combined_terms: List[str] = []
    seen = set()

    for t in user_terms + DEFAULT_TECH_VOCABULARY:
        t_clean = t.strip()
        t_norm = t_clean.lower()
        if t_norm and t_norm not in seen:
            seen.add(t_norm)
            combined_terms.append(t_clean)

    joined_terms = ", ".join(combined_terms)
    # Whisper initial_prompt tối đa khoảng ~224 tokens (tương đương 400-500 ký tự)
    if len(joined_terms) > 420:
        joined_terms = joined_terms[:420].rsplit(",", 1)[0]

    return f"{prefix} {joined_terms}."
