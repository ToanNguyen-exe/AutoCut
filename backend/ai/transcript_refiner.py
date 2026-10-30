"""Module hiệu đính và tách câu văn bản bóc băng bằng Google Gemini LLM.

Nhiệm vụ trong Pipeline:
1. Tiếp nhận kết quả bóc băng từ Faster-Whisper (có mốc thời gian start, end).
2. Dùng Gemini để đọc hiểu ngữ cảnh, sửa lỗi chính tả tiếng Việt và chuẩn hóa thuật ngữ chuyên ngành (JavaScript, C++, for, while, Object, Primitive, DOM, Asynchronous...).
3. Tự động TÁCH các đoạn văn bản dài/nhiều ý của Whisper thành từng câu đơn độc lập, rõ ràng.
4. Tự động chuyển đổi dự phòng (fallback) giữa các model Gemini nếu gặp giới hạn 429/503 Free Tier.
5. Nội suy mốc thời gian (start, end) chính xác theo tỷ lệ độ dài từng câu và đánh lại mã số câu tuần tự S0001, S0002...
"""

import json
import logging
import time
from typing import Optional, List, Dict

from google import genai
from google.genai import types

from .models import Sentence, TranscriptOutput
from .prompt_builder import extract_terms_from_outline
from .config_loader import default_ai_config
from .post_processor import (
    split_segment_into_timed_sentences,
    ensure_sentence_casing_and_punctuation,
)

logger = logging.getLogger("AutoCut.AI.Refiner")

FALLBACK_MODELS = [
    "gemini-3.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-3.5-flash-lite",
]


class TranscriptRefiner:
    """Bộ hiệu đính chính tả, chuẩn hóa thuật ngữ và tách câu đơn bằng Gemini LLM."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None
    ):
        self.api_key = api_key or default_ai_config.gemini_api_key
        if not self.api_key:
            raise ValueError("Không tìm thấy GEMINI_API_KEY trong .env hoặc cấu hình!")
        self.model_name = model_name or getattr(default_ai_config, "gemini_model", "gemini-3.5-flash")
        self.client = genai.Client(
            api_key=self.api_key,
            http_options={"timeout": 180000.0}  # 180s timeout cho mỗi lượt gọi
        )

    def _get_candidate_models(self) -> List[str]:
        models = [self.model_name]
        for m in FALLBACK_MODELS:
            if m not in models:
                models.append(m)
        return models

    def _build_batches(
        self,
        sentences: List[Sentence],
        max_items: int = 25,
        max_chars: int = 6000
    ) -> List[List[Sentence]]:
        """Chia danh sách câu thành các batch hợp lý dựa theo số câu và tổng số ký tự."""
        batches: List[List[Sentence]] = []
        current_batch: List[Sentence] = []
        current_chars = 0

        for s in sentences:
            s_len = len(s.text)
            if current_batch and (len(current_batch) >= max_items or current_chars + s_len > max_chars):
                batches.append(current_batch)
                current_batch = [s]
                current_chars = s_len
            else:
                current_batch.append(s)
                current_chars += s_len

        if current_batch:
            batches.append(current_batch)

        return batches

    def refine_transcript(
        self,
        transcript: TranscriptOutput,
        outline_text: Optional[str] = None,
        max_batch_items: int = 25,
        max_batch_chars: int = 6000,
        start_from_id: Optional[str] = None
    ) -> TranscriptOutput:
        """Hiệu đính chính tả và tách các đoạn văn dài thành các câu đơn được đánh mã số S0001, S0002..."""
        if not transcript.sentences:
            return transcript

        terms = extract_terms_from_outline(outline_text) if outline_text else []
        terms_hint = f"Thuật ngữ bài giảng cần đối chiếu: {', '.join(terms)}" if terms else ""

        sentences_to_refine: List[Sentence] = []
        for s in transcript.sentences:
            if start_from_id and s.id < start_from_id:
                continue
            sentences_to_refine.append(s)

        batches = self._build_batches(
            sentences_to_refine,
            max_items=max_batch_items,
            max_chars=max_batch_chars
        )

        logger.info(
            f"[REFINER] Bắt đầu dùng Gemini hiệu đính & tách câu cho "
            f"{len(sentences_to_refine)} phân đoạn ({len(batches)} batches)..."
        )

        refined_sentences_map: Dict[str, List[str]] = {}
        candidate_models = self._get_candidate_models()
        active_model_idx = 0

        for b_idx, batch in enumerate(batches, start=1):
            batch_data = [{"id": s.id, "text": s.text} for s in batch]
            logger.info(
                f"[REFINER] Batch {b_idx}/{len(batches)}: Đang xử lý {batch[0].id} -> {batch[-1].id} "
                f"({len(batch)} mục)..."
            )

            prompt = f"""Bạn là chuyên gia biên tập ngữ liệu bài giảng lập trình tiếng Việt.
Dưới đây là các phân đoạn văn bản được bóc băng từ giọng nói (Speech-to-Text). Do giảng viên phát âm thuật ngữ tiếng Anh xen lẫn tiếng Việt và nói liền mạch, văn bản thô bị sai chính tả, sai tên thuật ngữ và nhiều câu bị dính liền thành một đoạn dài không có dấu chấm câu.

NHIỆM VỤ CỦA BẠN:
1. Sửa toàn bộ lỗi chính tả tiếng Việt và chuẩn hóa các thuật ngữ lập trình / CNTT về đúng dạng chuẩn (ví dụ: JavaScript, Object, Primitive, Non-primitive, function, parameter, argument, return, undefined, Arrow Function, Array, index, length, a.push, a.pop, CRUD, Create, Read, Update, Delete, String, Type Coercion, DOM, Document Object Model, HTML, element, event, event handler, attribute, onclick, document.write, document.getElementById, innerHTML, window.prompt, parseInt, console.log, Asynchronous, Multi-thread, C++, setTimeout, V8 Engine, Callback, Promise, Async/Await, Data Storage, Cookie, Web Storage, IndexedDB, HTML5, NoSQL Database, localStorage, Live Server, port 5500, 127.0.0.1:5500, Ctrl + S, Eimi Fukada, Yua Mikami, www.vungecoder.com...).
2. {terms_hint}
3. TÁCH CÂU RÕ RÀNG:
   - Nếu một mục ('id') chứa nhiều câu hoặc nhiều ý nối tiếp nhau, hãy TÁCH nó thành danh sách các câu đơn độc lập trong mảng "sentences".
   - Mỗi phần tử trong "sentences" chỉ là 1 câu hoàn chỉnh (viết hoa chữ cái đầu, kết thúc bằng dấu chấm '.', dấu hỏi '?' hoặc dấu cảm thán '!').
   - Không gộp các từ cảm thán ngắn (như 'OK!', 'Đó,', 'Rồi,') thành một câu riêng lẻ chỉ có 1-3 chữ mà hãy ghép tự nhiên vào đầu câu liền sau.
   - Giữ nguyên đầy đủ 100% ý nghĩa lời giảng của giảng viên, KHÔNG tóm tắt, KHÔNG lược bỏ ý.

DANH SÁCH PHÂN ĐOẠN ĐẦU VÀO:
{json.dumps(batch_data, ensure_ascii=False, indent=2)}

ĐỊNH DẠNG JSON ĐẦU RA BẮT BUỘC (chỉ trả về JSON thuần túy):
{{
  "items": [
    {{
      "id": "S0001",
      "sentences": [
        "Câu đơn hoàn chỉnh thứ nhất đã sửa chính tả và thuật ngữ.",
        "Câu đơn hoàn chỉnh thứ hai được tách ra từ đoạn gốc."
      ]
    }}
  ]
}}
"""

            try:
                response = None
                last_err = None
                for m_offset in range(len(candidate_models)):
                    m_idx = (active_model_idx + m_offset) % len(candidate_models)
                    chosen_model = candidate_models[m_idx]
                    try:
                        response = self.client.models.generate_content(
                            model=chosen_model,
                            contents=prompt,
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                temperature=0.1
                            )
                        )
                        active_model_idx = m_idx
                        break
                    except Exception as gen_err:
                        last_err = gen_err
                        err_str = str(gen_err)
                        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "503" in err_str or "UNAVAILABLE" in err_str or "404" in err_str:
                            logger.warning(f"[REFINER] Model {chosen_model} bận hoặc hết hạn mức ({err_str[:80]}...), chuyển sang model dự phòng...")
                            time.sleep(1.5)
                            continue
                        raise gen_err

                if response is None and last_err is not None:
                    raise last_err

                raw_text = response.text.strip()
                if raw_text.startswith("```json"):
                    raw_text = raw_text[7:]
                if raw_text.startswith("```"):
                    raw_text = raw_text[3:]
                if raw_text.endswith("```"):
                    raw_text = raw_text[:-3]
                raw_text = raw_text.strip()

                parsed = json.loads(raw_text)
                items = parsed.get("items") or parsed.get("corrections") or []

                for item in items:
                    c_id = item.get("id")
                    c_sents = item.get("sentences")
                    if isinstance(c_sents, list) and c_sents:
                        cleaned_list = [str(x).strip() for x in c_sents if str(x).strip()]
                        if c_id and cleaned_list:
                            refined_sentences_map[c_id] = cleaned_list
                    else:
                        c_text = str(item.get("text", "")).strip()
                        if c_id and c_text:
                            refined_sentences_map[c_id] = [c_text]

            except Exception as e:
                logger.warning(
                    f"[REFINER] Lỗi khi xử lý batch {b_idx} ({batch[0].id} -> {batch[-1].id}): {e}. "
                    f"Sử dụng bộ tách câu cục bộ cho nhóm này."
                )

        # Bước cuối: Tách từng phân đoạn thành các câu độc lập kèm nội suy thời gian [start, end]
        # và đánh lại mã định danh câu S0001, S0002... trên toàn bộ transcript.
        expanded_timed_items: List[dict] = []
        for s in transcript.sentences:
            source_text_or_list = refined_sentences_map.get(s.id, s.text)
            timed_chunks = split_segment_into_timed_sentences(
                start=s.start,
                end=s.end,
                text_or_sentences=source_text_or_list
            )
            expanded_timed_items.extend(timed_chunks)

        digit_count = 5 if len(expanded_timed_items) > 9999 else 4
        final_sentences: List[Sentence] = []
        for idx, item in enumerate(expanded_timed_items, start=1):
            final_sentences.append(
                Sentence(
                    id=f"S{idx:0{digit_count}d}",
                    start=item["start"],
                    end=item["end"],
                    text=ensure_sentence_casing_and_punctuation(item["text"])
                )
            )

        logger.info(
            f"[REFINER HOÀN TẤT] Đã chuẩn hóa và tách từ {len(transcript.sentences)} phân đoạn "
            f"thành {len(final_sentences)} câu đơn hoàn chỉnh (S0001 -> S{len(final_sentences):0{digit_count}d})."
        )
        transcript.sentences = final_sentences
        return transcript
