"""Module hiệu đính, tách câu đơn & phân đoạn ngữ nghĩa bài giảng bằng Google Gemini LLM.

Nhiệm vụ trong Pipeline:
1. Tiếp nhận kết quả bóc băng từ Faster-Whisper (đã có mốc thời gian start, end).
2. Dùng Gemini để đọc hiểu văn bản, sửa lỗi chính tả tiếng Việt, chuẩn hóa thuật ngữ chuyên ngành và tách các đoạn dài thành từng câu đơn.
3. Nội suy mốc thời gian [start, end] tương ứng cho từng câu đơn và đánh lại mã định danh tuần tự S0001, S0002...
4. Phân tích ngữ nghĩa toàn bộ các câu S0001..Sxxxx để chia bài giảng thành các chương/chủ đề (SegmentsDTO) phục vụ Backend Spring Boot & Frontend Studio.
"""

import json
import logging
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Optional, List, Dict, Any, Callable

from google import genai
from google.genai import types

from .models import Sentence, TranscriptOutput
from .prompt_builder import extract_terms_from_outline
from .config_loader import default_ai_config
from .whisper_service import format_duration, build_progress_bar
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


def slugify_vi(text: str) -> str:
    """Chuyển chuỗi tiếng Việt sang slug ASCII chuẩn (ví dụ: 'Kiểu dữ liệu & Biến' -> 'kieu-du-lieu-bien')."""
    if not text:
        return "chu-de"
    s = text.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:48].strip("-") or "chu-de"


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

        primary = model_name or getattr(default_ai_config, "gemini_model", "gemini-3.5-flash")
        self.models_to_try = [primary] + [m for m in FALLBACK_MODELS if m != primary]
        self.model_name = self.models_to_try[0]
        self.client = genai.Client(
            api_key=self.api_key,
            http_options={"timeout": 90000.0}
        )

    def _get_candidate_models(self) -> List[str]:
        return self.models_to_try

    def _generate_with_fallback(self, prompt: str):
        """Gọi Gemini API với cơ chế tự động chuyển sang model dự phòng nếu gặp lỗi 429 Quota hoặc 503."""
        last_err = None
        for model_candidate in self.models_to_try:
            for attempt in range(1, 3):
                try:
                    response = self.client.models.generate_content(
                        model=model_candidate,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    self.model_name = model_candidate
                    return response
                except Exception as err:
                    last_err = err
                    err_str = str(err)
                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                        break
                    if ("503" in err_str or "UNAVAILABLE" in err_str) and attempt < 2:
                        time.sleep(2)
                        continue
                    break
        raise last_err

    @staticmethod
    def _build_char_batches(
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
        start_from_id: Optional[str] = None,
        progress_callback: Optional[Callable[[dict], None]] = None
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

        batches = self._build_char_batches(
            sentences_to_refine,
            max_items=max_batch_items,
            max_chars=max_batch_chars
        )
        total_batches = len(batches)
        logger.info(f"Bắt đầu hiệu đính {len(sentences_to_refine)} phân đoạn (chia thành {total_batches} lô)...")

        refined_sentences_map: Dict[str, List[str]] = {}
        candidate_models = self._get_candidate_models()
        active_model_idx = 0
        refine_start_wall = time.perf_counter()

        for b_idx, batch in enumerate(batches, start=1):
            batch_data = [{"id": s.id, "text": s.text} for s in batch]
            elapsed_before = time.perf_counter() - refine_start_wall
            done_batches = b_idx - 1
            pct_before = (done_batches / total_batches) * 100.0 if total_batches else 0.0

            if done_batches > 0:
                avg_time_per_batch = elapsed_before / done_batches
                eta_sec = avg_time_per_batch * (total_batches - done_batches)
                eta_str = f"~{format_duration(eta_sec)}"
            else:
                eta_str = "đang tính..."

            bar_str = build_progress_bar(pct_before)
            sys.stdout.write(
                f"\r[Gemini Refiner] [{bar_str}] {pct_before:5.1f}% | "
                f"Lô {b_idx}/{total_batches} ({batch[0].id} ➔ {batch[-1].id}) | "
                f"Đã chạy: {format_duration(elapsed_before)} | "
                f"Còn lại (ETA): {eta_str}   "
            )
            sys.stdout.flush()

            prompt = f"""
Bạn là chuyên gia hiệu đính văn bản tiếng Việt cho bài giảng trực tuyến.
Nhiệm vụ: Sửa lỗi chính tả, chuẩn hóa các thuật ngữ chuyên ngành (đặc biệt trong IT/Blockchain/Lập trình),
và QUAN TRỌNG NHẤT: Nếu một phân đoạn đầu vào chứa nhiều câu hoặc nhiều ý dài ghép lại, BẮT BUỘC TÁCH thành
các câu đơn độc lập trong mảng 'sentences' tương ứng.
{terms_hint}

QUY TẮC BẮT BUỘC:
1. KHÔNG được thay đổi hoặc tóm tắt ý nghĩa của người nói.
2. Viết hoa chữ cái đầu câu, kết thúc câu bằng dấu chấm '.', dấu hỏi '?' hoặc cảm thán '!'.
3. Mọi câu trong mảng 'sentences' phải là một câu đơn hoàn chỉnh.
4. Trả về đúng định dạng JSON có khóa 'items', giữ nguyên mã 'id' để đối chiếu.

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
                start_model_idx = active_model_idx
                for offset in range(len(candidate_models)):
                    curr_idx = (start_model_idx + offset) % len(candidate_models)
                    current_model = candidate_models[curr_idx]
                    try:
                        response = self.client.models.generate_content(
                            model=current_model,
                            contents=prompt,
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                temperature=0.1
                            )
                        )
                        if active_model_idx != curr_idx:
                            logger.info(f"Đã chuyển sang model Gemini: {current_model}")
                            active_model_idx = curr_idx
                        break
                    except Exception as gen_err:
                        last_err = gen_err
                        err_msg = str(gen_err).lower()
                        if "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg or "503" in err_msg:
                            logger.warning(f"Model {current_model} bị giới hạn/quá tải, chuyển sang model tiếp theo...")
                            time.sleep(1.0)
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
                    item_id = item.get("id")
                    item_sents = item.get("sentences")
                    if not item_id:
                        continue
                    if isinstance(item_sents, list) and item_sents:
                        refined_sentences_map[item_id] = [str(s).strip() for s in item_sents if str(s).strip()]
                    elif isinstance(item.get("text"), str) and item.get("text").strip():
                        refined_sentences_map[item_id] = [item["text"].strip()]

            except Exception as e:
                logger.warning(f"Lỗi khi gọi Gemini ở lô {b_idx} ({e}). Sử dụng bộ tách câu cục bộ cho lô này.")
                for s in batch:
                    refined_sentences_map[s.id] = [s.text]

            time.sleep(0.5)

        total_refine_elapsed = time.perf_counter() - refine_start_wall
        bar_complete = build_progress_bar(100.0)
        sys.stdout.write(
            f"\r[Gemini Refiner] [{bar_complete}] 100.0% | "
            f"Đã xử lý {total_batches}/{total_batches} lô | "
            f"Hoàn thành trong: {format_duration(total_refine_elapsed)} ({total_refine_elapsed:.2f}s)      \n"
        )
        sys.stdout.flush()

        expanded_timed_items: List[dict] = []
        for s in transcript.sentences:
            if s.id in refined_sentences_map:
                sentences_text_list = refined_sentences_map[s.id]
                timed_chunks = split_segment_into_timed_sentences(
                    start=s.start,
                    end=s.end,
                    text=" ".join(sentences_text_list)
                )
                expanded_timed_items.extend(timed_chunks)
            else:
                timed_chunks = split_segment_into_timed_sentences(
                    start=s.start,
                    end=s.end,
                    text=s.text
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
            f"thành {len(final_sentences)} câu đơn hoàn chỉnh (S0001 -> S{len(final_sentences):0{digit_count}d}) "
            f"trong {format_duration(total_refine_elapsed)} ({total_refine_elapsed:.2f}s)."
        )
        transcript.sentences = final_sentences
        return transcript

    def segment_transcript(
        self,
        transcript: TranscriptOutput,
        lesson_name: str,
        max_part_duration: float = 720.0
    ) -> Dict[str, Any]:
        """Phân tích ngữ nghĩa danh sách câu S0001..Sxxxx và chia thành các phân đoạn chủ đề (SegmentsDTO)."""
        sentences = transcript.sentences
        total_duration = round(float(transcript.duration or (sentences[-1].end if sentences else 180.0)), 2)

        if not sentences:
            return {
                "video": transcript.video,
                "lesson": lesson_name,
                "mode": "analyzed",
                "reviewed": False,
                "segments": []
            }

        sentence_map = {s.id: s for s in sentences}
        raw_topics: List[Dict[str, Any]] = []

        # 1. Thử phân đoạn ngữ nghĩa bằng Gemini LLM
        try:
            formatted_sentences = [
                f"{s.id} [{s.start:.1f}s-{s.end:.1f}s]: {s.text}"
                for s in sentences
            ]
            first_id = sentences[0].id
            last_id = sentences[-1].id

            prompt = f"""
Bạn là chuyên gia phân tích cấu trúc bài giảng video tự động (Semantic Video Segmentation).
Dưới đây là bản bóc băng (transcript) của video "{transcript.video}" (Chủ đề: "{lesson_name}", thời lượng: {total_duration}s), gồm các câu từ {first_id} đến {last_id}.

NHIỆM VỤ:
1. Tự động nhận diện chủ đề và thể loại nội dung video (ví dụ: bài giảng lập trình, khóa học kiến thức, thuyết trình chuyên đề...).
2. Phân tích cấu trúc video thành các phần lớn (sections) có ý nghĩa như: "Giới thiệu", "Lý thuyết", "Thực hành ví dụ", "Tổng kết"...
3. Trong mỗi phần lớn (section), BẮT BUỘC phân chia chi tiết thành các bài học / chủ đề cụ thể (topics) theo từng đơn vị kiến thức mà người nói giảng dạy (ví dụ đối với lập trình: thiết lập môi trường & lệnh đầu tiên, biến & kiểu dữ liệu, toán tử, rẽ nhánh if-else, vòng lặp for, object, function, array, string, DOM, bất đồng bộ, lưu trữ dữ liệu...). Tuyệt đối không được gộp bài giảng dài thành 1-2 đoạn chung chung.

QUY TẮC BẮT BUỘC:
1. Chủ đề (topic) đầu tiên của section đầu tiên PHẢI có "start_id": "{first_id}".
2. Chủ đề (topic) cuối cùng của section cuối cùng PHẢI có "end_id": "{last_id}".
3. Các topics phải nối tiếp nhau liên tục theo thứ tự thời gian tăng dần (end_id của topic trước liền kề với start_id của topic sau).
4. CẢNH BÁO QUAN TRỌNG VỀ MÃ CÂU: "start_id" và "end_id" BẮT BUỘC phải là mã câu ID thực tế có trong danh sách bên dưới (chỉ từ {first_id} đến {last_id}). TUYỆT ĐỐI KHÔNG lấy số giây thời gian (như 828s hay 1330s) để ghép thành mã câu giả (như S0828 hay S1330)!
5. "slug" phải là chuỗi không dấu, cách nhau bằng dấu gạch ngang (ví dụ: "bien-va-khoi-tao", "cau-truc-if-else").
6. Chỉ trả về JSON thuần túy theo đúng cấu trúc sections và topics sau:

{{
  "sections": [
    {{
      "label": "Giới thiệu",
      "topics": [
        {{
          "title": "Tổng quan và mục lục bài giảng",
          "slug": "tong-quan-va-muc-luc",
          "start_id": "{first_id}",
          "end_id": "S0017"
        }}
      ]
    }},
    {{
      "label": "Lý thuyết",
      "topics": [
        {{
          "title": "Thiết lập môi trường & Lệnh đầu tiên",
          "slug": "moi-truong-va-lenh-dau-tien",
          "start_id": "S0018",
          "end_id": "S0046"
        }},
        {{
          "title": "Khai báo và khởi tạo biến",
          "slug": "bien-va-khoi-tao",
          "start_id": "S0047",
          "end_id": "S0059"
        }}
      ]
    }},
    {{
      "label": "Tổng kết",
      "topics": [
        {{
          "title": "Tổng kết và định hướng học tập",
          "slug": "tong-ket-bai-giang",
          "start_id": "S0680",
          "end_id": "{last_id}"
        }}
      ]
    }}
  ]
}}

DANH SÁCH CÂU TRANSCRIPT:
{chr(10).join(formatted_sentences)}
"""
            response = self._generate_with_fallback(prompt)
            raw_text = response.text.strip()
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            parsed = json.loads(raw_text.strip())

            # Hỗ trợ cấu trúc sections -> topics (Đặc tả B4 llm_raw.json)
            if isinstance(parsed, dict) and "sections" in parsed and isinstance(parsed["sections"], list):
                try:
                    llm_raw_path = Path("cache") / "llm_raw.json"
                    llm_raw_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(llm_raw_path, "w", encoding="utf-8") as f_raw:
                        json.dump(parsed, f_raw, ensure_ascii=False, indent=2)
                except Exception:
                    pass

                raw_topics = []
                for sec_idx, sec in enumerate(parsed["sections"], start=1):
                    sec_label = str(sec.get("label", f"Phần {sec_idx}")).strip()
                    sec_slug = slugify_vi(sec_label)
                    for top_idx, top in enumerate(sec.get("topics", []), start=1):
                        raw_topics.append({
                            "section_no": sec_idx,
                            "section": f"{sec_idx:02d}_{sec_slug}",
                            "topic_no": top_idx,
                            "topic": str(top.get("title", f"Chủ đề {top_idx}")).strip(),
                            "slug": str(top.get("slug") or slugify_vi(top.get("title", ""))).strip(),
                            "start_id": str(top.get("start_id", "")),
                            "end_id": str(top.get("end_id", ""))
                        })
                logger.info(f"[SEGMENTER] Gemini đã chia thành công {len(parsed['sections'])} phần lớn với {len(raw_topics)} bài học cụ thể.")
            else:
                candidate_segs = parsed.get("segments", [])
                if isinstance(candidate_segs, list) and len(candidate_segs) >= 2:
                    raw_topics = candidate_segs
                    logger.info(f"[SEGMENTER] Gemini đã chia thành công {len(raw_topics)} phân đoạn ngữ nghĩa.")
        except Exception as e:
            logger.warning(f"[SEGMENTER] Không thể gọi Gemini để chia đoạn ({e}). Chuyển sang chia đoạn thông minh từ câu transcript.")

        # 2. Nếu Gemini không khả dụng hoặc hết hạn mức: Chia đoạn thông minh trực tiếp từ danh sách câu thật S0001..Sxxxx
        if not raw_topics:
            raw_topics = self._fallback_segment_from_sentences(sentences, lesson_name)

        # 3. Chuẩn hóa danh sách segments theo đúng hợp đồng dữ liệu SegmentsDTO
        segments_out: List[Dict[str, Any]] = []
        running_start = 0.0

        def resolve_sentence(candidate_id: Any, default_sent: Sentence) -> Sentence:
            if not candidate_id:
                return default_sent
            cid = str(candidate_id).strip()
            if cid in sentence_map:
                return sentence_map[cid]
            norm_cid = cid.upper()
            if norm_cid in sentence_map:
                return sentence_map[norm_cid]
            num_match = re.search(r"\d+", norm_cid)
            if num_match:
                val = int(num_match.group(0))
                padded = f"S{val:04d}"
                if padded in sentence_map:
                    return sentence_map[padded]
                padded5 = f"S{val:05d}"
                if padded5 in sentence_map:
                    return sentence_map[padded5]
                # Nếu LLM nhầm số giây thời gian thành mã câu (ví dụ S0828 -> time ~828s)
                if 0 <= val <= total_duration and sentences:
                    return min(sentences, key=lambda s: abs(s.start - val))
            return default_sent

        for idx, item in enumerate(raw_topics, start=1):
            start_id = str(item.get("start_id", sentences[0].id))
            end_id = str(item.get("end_id", sentences[-1].id))

            s_obj = resolve_sentence(start_id, sentences[min(idx - 1, len(sentences) - 1)])
            e_obj = resolve_sentence(end_id, sentences[-1])

            seg_start = 0.0 if idx == 1 else round(max(running_start, float(s_obj.start)), 2)
            if idx == len(raw_topics):
                seg_end = total_duration
            else:
                raw_end = float(e_obj.end)
                if raw_end >= total_duration or raw_end <= seg_start:
                    remaining_count = max(1, len(raw_topics) - idx + 1)
                    raw_end = seg_start + (total_duration - seg_start) / remaining_count
                max_allowed = total_duration - (len(raw_topics) - idx)
                seg_end = round(max(seg_start + 1.0, min(max_allowed, raw_end)), 2)

            if seg_end > total_duration:
                seg_end = total_duration
            if seg_end <= seg_start:
                seg_end = round(seg_start + 1.0, 2)
            running_start = seg_end

            section_no = int(item.get("section_no") or idx)
            section_name = str(item.get("section") or f"{section_no:02d}_Phan{section_no}").strip()
            topic_no = int(item.get("topic_no") or idx)
            topic_title = str(item.get("topic") or f"Phần {idx}: {lesson_name}").strip()
            slug = slugify_vi(str(item.get("slug") or topic_title))

            # Chia parts nếu đoạn dài hơn max_part_duration
            parts: List[Dict[str, Any]] = []
            seg_dur = seg_end - seg_start
            if seg_dur <= max_part_duration or max_part_duration <= 0:
                parts.append({
                    "part": 1,
                    "start": seg_start,
                    "end": seg_end,
                    "file": f"{section_name}/{topic_no:02d}_{slug}.mp4"
                })
            else:
                num_parts = int((seg_dur + max_part_duration - 0.01) // max_part_duration)
                part_len = seg_dur / num_parts
                p_start = seg_start
                for p_idx in range(1, num_parts + 1):
                    p_end = seg_end if p_idx == num_parts else round(p_start + part_len, 2)
                    parts.append({
                        "part": p_idx,
                        "start": round(p_start, 2),
                        "end": p_end,
                        "file": f"{section_name}/{topic_no:02d}_{slug}_Phan{p_idx}.mp4"
                    })
                    p_start = p_end

            segments_out.append({
                "id": f"seg_ai_{idx:02d}",
                "section_no": section_no,
                "section": section_name,
                "topic_no": topic_no,
                "topic": topic_title,
                "slug": slug,
                "start_id": s_obj.id,
                "end_id": e_obj.id,
                "start": seg_start,
                "end": seg_end,
                "parts": parts
            })

        return {
            "video": transcript.video,
            "lesson": lesson_name,
            "mode": "analyzed",
            "reviewed": False,
            "segments": segments_out
        }

    @staticmethod
    def _fallback_segment_from_sentences(sentences: List[Sentence], lesson_name: str) -> List[Dict[str, Any]]:
        """Chia đoạn dựa trên nội dung câu thực tế khi không gọi được Gemini API."""
        n = len(sentences)
        if n <= 4:
            return [{
                "section_no": 1,
                "section": "01_NoiDungChinh",
                "topic_no": 1,
                "topic": sentences[0].text[:70].rstrip(".") if sentences else lesson_name,
                "start_id": sentences[0].id,
                "end_id": sentences[-1].id
            }]

        num_segs = min(6, max(4, n // 80 + 4))
        chunk_size = max(1, n // num_segs)
        section_labels = [
            "01_GioiThieu",
            "02_KhaiNiemCoBan",
            "03_NoiDungTrongTam",
            "04_PhanTichChiTiet",
            "05_ThucHanhUngDung",
            "06_TongKetBaiGiang",
        ]

        topics: List[Dict[str, Any]] = []
        start_idx = 0
        for i in range(num_segs):
            end_idx = (n - 1) if i == num_segs - 1 else min(n - 1, (i + 1) * chunk_size - 1)
            if start_idx >= n:
                break

            first_sent_text = sentences[start_idx].text.strip().rstrip(".?!")
            if len(first_sent_text) > 68:
                first_sent_text = first_sent_text[:65].rsplit(" ", 1)[0] + "..."

            sec_label = section_labels[min(i, len(section_labels) - 1)]
            topics.append({
                "section_no": i + 1,
                "section": sec_label,
                "topic_no": i + 1,
                "topic": first_sent_text or f"Phần {i + 1}: {lesson_name}",
                "start_id": sentences[start_idx].id,
                "end_id": sentences[end_idx].id
            })
            start_idx = end_idx + 1

        return topics
