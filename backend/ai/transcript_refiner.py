"""Module hiệu đính văn bản bóc băng bằng Google Gemini LLM (gemini-3.5-flash).

Nhiệm vụ trong Pipeline:
1. Tiếp nhận kết quả bóc băng từ Faster-Whisper (đã có mốc thời gian start, end, id chuẩn S0001).
2. Dùng Gemini để đọc hiểu văn bản, sửa lỗi chính tả tiếng Việt và chuẩn hóa thuật ngữ chuyên ngành (C++, for, while, pointer...).
3. Tuyệt đối giữ nguyên mốc thời gian (start, end) và định danh câu (id) do Whisper đo đạc.
"""

import json
import logging
import time
from typing import Optional, List, Dict, Any

from google import genai
from google.genai import types

from .models import Sentence, TranscriptOutput
from .prompt_builder import extract_terms_from_outline
from .config_loader import default_ai_config

logger = logging.getLogger("AutoCut.AI.Refiner")


class TranscriptRefiner:
    """Bộ hiệu đính và chuẩn hóa văn bản transcript bằng Gemini LLM."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "gemini-3.5-flash"
    ):
        self.api_key = api_key or default_ai_config.gemini_api_key
        if not self.api_key:
            raise ValueError("Không tìm thấy GEMINI_API_KEY trong .env hoặc cấu hình!")
        self.model_name = model_name
        self.client = genai.Client(
            api_key=self.api_key,
            http_options={"timeout": 60000.0}  # 60s timeout cho mỗi lượt text
        )

    def refine_transcript(
        self,
        transcript: TranscriptOutput,
        outline_text: Optional[str] = None,
        batch_size: int = 40
    ) -> TranscriptOutput:
        """Hiệu đính văn bản toàn bộ transcript theo từng nhóm câu (batching)."""
        if not transcript.sentences:
            return transcript

        terms = extract_terms_from_outline(outline_text) if outline_text else []
        terms_hint = f"Thuật ngữ bài giảng cần đối chiếu: {', '.join(terms)}" if terms else ""

        total_sentences = len(transcript.sentences)
        logger.info(f"[REFINER] Bắt đầu dùng Gemini ({self.model_name}) hiệu đính {total_sentences} câu từ Whisper...")

        # Tạo bản đồ id -> Sentence để cập nhật nhanh
        sentence_map: Dict[str, Sentence] = {s.id: s for s in transcript.sentences}
        updated_count = 0

        # Chia nhỏ thành các batch 40 câu để tránh tràn context và dễ quản lý
        for start_idx in range(0, total_sentences, batch_size):
            batch = transcript.sentences[start_idx : start_idx + batch_size]
            batch_data = [{"id": s.id, "text": s.text} for s in batch]

            logger.info(
                f"[REFINER] Đang hiệu đính nhóm câu {batch[0].id} -> {batch[-1].id} "
                f"({start_idx + len(batch)}/{total_sentences})..."
            )

            prompt = f"""
Bạn là chuyên gia biên tập ngữ liệu bài giảng lập trình tiếng Việt.
Dưới đây là các câu được bóc băng từ giọng nói (Speech-to-Text). Do người nói phát âm tiếng Anh trong câu tiếng Việt, một số từ ngữ lập trình hoặc chính tả có thể bị ghi nhận sai (ví dụ: 'pho' -> 'for', 'oai' -> 'while', 'xi cộng cộng' -> 'C++').

NHIỆM VỤ:
1. Đọc văn bản từng câu và sửa lỗi chính tả tiếng Việt chuẩn ngữ pháp.
2. Chuẩn hóa các thuật ngữ công nghệ thông tin/lập trình theo đúng dạng viết chuẩn.
3. {terms_hint}

QUY TẮC BẮT BUỘC:
- GIỮ NGUYÊN đúng số lượng câu và đúng mã 'id' tương ứng.
- KHÔNG tóm tắt, KHÔNG lược bỏ câu, KHÔNG gộp nhiều câu thành một.
- Chỉ trả về chuỗi JSON thuần túy, không có giải thích hay markdown.

DANH SÁCH CÂU ĐẦU VÀO:
{json.dumps(batch_data, ensure_ascii=False, indent=2)}

ĐỊNH DẠNG JSON ĐẦU RA BẮT BUỘC:
{{
  "corrections": [
    {{"id": "S0001", "text": "Câu sau khi đã sửa chính tả và chuẩn hóa thuật ngữ"}},
    {{"id": "S0002", "text": "Câu tiếp theo..."}}
  ]
}}
"""

            try:
                response = None
                for attempt in range(1, 4):
                    try:
                        response = self.client.models.generate_content(
                            model=self.model_name,
                            contents=prompt,
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                temperature=0.1
                            )
                        )
                        break
                    except Exception as gen_err:
                        if ("503" in str(gen_err) or "UNAVAILABLE" in str(gen_err)) and attempt < 3:
                            time.sleep(attempt * 2)
                            continue
                        raise gen_err

                raw_text = response.text.strip()
                if raw_text.startswith("```json"):
                    raw_text = raw_text[7:]
                if raw_text.startswith("```"):
                    raw_text = raw_text[3:]
                if raw_text.endswith("```"):
                    raw_text = raw_text[:-3]
                raw_text = raw_text.strip()

                parsed = json.loads(raw_text)
                corrections = parsed.get("corrections", [])

                for item in corrections:
                    c_id = item.get("id")
                    c_text = item.get("text", "").strip()
                    if c_id in sentence_map and c_text:
                        if sentence_map[c_id].text != c_text:
                            sentence_map[c_id].text = c_text
                            updated_count += 1

            except Exception as e:
                logger.warning(
                    f"[REFINER] Lỗi khi hiệu đính nhóm câu {batch[0].id} ({e}). "
                    f"Giữ nguyên văn bản gốc từ Whisper cho nhóm này."
                )

        logger.info(f"[REFINER HOÀN TẤT] Đã kiểm tra {total_sentences} câu, tinh chỉnh chuẩn hóa {updated_count} câu.")
        return transcript
