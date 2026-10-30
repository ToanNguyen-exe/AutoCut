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
from typing import Optional, List, Dict, Any

from google import genai
from google.genai import types

from .models import Sentence, TranscriptOutput
from .prompt_builder import extract_terms_from_outline
from .config_loader import default_ai_config
from .post_processor import (
    ensure_sentence_casing_and_punctuation,
    split_segment_into_timed_sentences,
)
from .whisper_service import format_duration, build_progress_bar

logger = logging.getLogger("AutoCut.AI.Refiner")

FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash-lite",
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
    """Bộ hiệu đính, tách câu đơn và phân đoạn chủ đề bằng Gemini LLM."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None
    ):
        self.api_key = api_key or default_ai_config.gemini_api_key
        if not self.api_key:
            raise ValueError("Không tìm thấy GEMINI_API_KEY trong .env hoặc cấu hình!")
        primary = model_name or getattr(default_ai_config, "gemini_model", "gemini-2.5-flash")
        self.models_to_try = [primary] + [m for m in FALLBACK_MODELS if m != primary]
        self.model_name = self.models_to_try[0]
        self.client = genai.Client(
            api_key=self.api_key,
            http_options={"timeout": 90000.0}
        )

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
    def _build_char_batches(sentences: List[Sentence], max_chars: int = 6000, max_items: int = 25) -> List[List[Sentence]]:
        """Gom các câu thành từng lô dựa theo tổng số ký tự để tối ưu số lượt gọi API Gemini."""
        batches: List[List[Sentence]] = []
        current_batch: List[Sentence] = []
        current_chars = 0

        for s in sentences:
            s_len = len(s.text)
            if current_batch and (current_chars + s_len > max_chars or len(current_batch) >= max_items):
                batches.append(current_batch)
                current_batch = [s]
                current_chars = s_len
            else:
                current_batch.append(s)
                current_chars += s_len

        if current_batch:
            batches.append(current_batch)
        return batches

    @staticmethod
    def _interpolate_sentences(start: float, end: float, sentence_texts: List[str]) -> List[dict]:
        """Phân bổ mốc thời gian [start, end] cho danh sách các câu đã tách theo tỷ lệ độ dài ký tự."""
        clean_list = [
            ensure_sentence_casing_and_punctuation(t)
            for t in sentence_texts
            if t and t.strip()
        ]
        if not clean_list:
            return []

        if len(clean_list) == 1:
            return [{
                "start": round(float(start), 2),
                "end": round(float(end), 2),
                "text": clean_list[0]
            }]

        total_dur = max(0.01, float(end) - float(start))
        lengths = [max(1, len(s)) for s in clean_list]
        total_len = sum(lengths)

        timed_items: List[dict] = []
        curr_start = float(start)
        for idx, (s_text, c_len) in enumerate(zip(clean_list, lengths)):
            if idx == len(clean_list) - 1:
                curr_end = round(float(end), 2)
            else:
                curr_end = round(curr_start + total_dur * (c_len / total_len), 2)
                if curr_end <= curr_start:
                    curr_end = round(curr_start + 0.05, 2)

            timed_items.append({
                "start": round(curr_start, 2),
                "end": curr_end,
                "text": s_text
            })
            curr_start = curr_end

        return timed_items

    def refine_transcript(
        self,
        transcript: TranscriptOutput,
        outline_text: Optional[str] = None,
        start_from_id: Optional[str] = None
    ) -> TranscriptOutput:
        """Hiệu đính chính tả và tách từng câu đơn trên toàn bộ transcript, sau đó đánh lại mã S0001, S0002..."""
        if not transcript.sentences:
            return transcript

        terms = extract_terms_from_outline(outline_text) if outline_text else []
        terms_hint = f"Thuật ngữ bài giảng cần đối chiếu: {', '.join(terms)}" if terms else ""

        prefix_items: List[dict] = []
        target_sentences: List[Sentence] = []
        resuming = bool(start_from_id)

        for s in transcript.sentences:
            if resuming and s.id != start_from_id:
                prefix_items.extend(split_segment_into_timed_sentences(s.start, s.end, s.text))
            else:
                resuming = False
                target_sentences.append(s)

        batches = self._build_char_batches(target_sentences, max_chars=6000, max_items=25)
        total_batches = len(batches)
        refined_items: List[dict] = list(prefix_items)
        refine_start_wall = time.perf_counter()

        for b_idx, batch in enumerate(batches, start=1):
            batch_data = [{"id": s.id, "text": s.text} for s in batch]

            elapsed_ref = time.perf_counter() - refine_start_wall
            completed_batches = b_idx - 1
            percent_ref = (completed_batches / total_batches) * 100.0 if total_batches > 0 else 100.0
            if completed_batches > 0:
                avg_per_batch = elapsed_ref / completed_batches
                eta_ref = avg_per_batch * (total_batches - completed_batches)
                eta_str = f"~{format_duration(eta_ref)}"
            else:
                eta_str = "đang tính..."

            bar = build_progress_bar(percent_ref)
            sys.stdout.write(
                f"\r[Gemini Refiner] [{bar}] {percent_ref:5.1f}% | "
                f"Lô {b_idx}/{total_batches} ({batch[0].id}->{batch[-1].id}) | "
                f"Đã chạy: {format_duration(elapsed_ref)} | Còn lại (ETA): {eta_str}   "
            )
            sys.stdout.flush()

            prompt = f"""
Bạn là chuyên gia biên tập ngữ liệu bài giảng lập trình tiếng Việt.
Dưới đây là các đoạn văn bản được bóc băng từ giọng nói (Speech-to-Text).

NHIỆM VỤ:
1. Sửa lỗi chính tả tiếng Việt và chuẩn hóa các thuật ngữ lập trình/công nghệ thông tin (ví dụ: JavaScript, Node.js, HTML, CSS, VS Code, document.write, console.log, String, Number, Boolean, Object, Array, Function, DOM, Literal, Primitive...).
2. {terms_hint}
3. TÁCH CÂU ĐƠN RÕ RÀNG: Nếu một mục đầu vào chứa nhiều câu ghép lại thành đoạn dài, hãy tách chúng thành danh sách các câu đơn độc lập trong mảng "sentences". Mỗi phần tử trong "sentences" chỉ là 1 câu hoàn chỉnh (bắt đầu bằng chữ hoa, kết thúc bằng dấu chấm '.', dấu hỏi '?' hoặc dấu chấm than '!').

QUY TẮC BẮT BUỘC:
- GIỮ NGUYÊN mã 'id' của từng mục đầu vào để đối chiếu.
- KHÔNG tóm tắt, KHÔNG lược bỏ bất kỳ nội dung nào của người nói.
- Chỉ trả về JSON thuần túy theo đúng định dạng bên dưới.

DANH SÁCH ĐẦU VÀO:
{json.dumps(batch_data, ensure_ascii=False, indent=2)}

ĐỊNH DẠNG JSON ĐẦU RA BẮT BUỘC:
{{
  "items": [
    {{
      "id": "S0001",
      "sentences": [
        "Câu đơn thứ nhất đã sửa chính tả.",
        "Câu đơn thứ hai được tách ra từ đoạn gốc."
      ]
    }}
  ]
}}
"""
            try:
                response = self._generate_with_fallback(prompt)
                raw_text = response.text.strip()
                if raw_text.startswith("```json"):
                    raw_text = raw_text[7:]
                if raw_text.startswith("```"):
                    raw_text = raw_text[3:]
                if raw_text.endswith("```"):
                    raw_text = raw_text[:-3]
                raw_text = raw_text.strip()

                parsed = json.loads(raw_text)
                items_list = parsed.get("items", [])
                by_id: Dict[str, List[str]] = {}
                for it in items_list:
                    it_id = it.get("id")
                    sents = it.get("sentences")
                    if it_id and isinstance(sents, list) and sents:
                        by_id[it_id] = [str(x).strip() for x in sents if str(x).strip()]

                for orig_s in batch:
                    if orig_s.id in by_id:
                        refined_items.extend(
                            self._interpolate_sentences(orig_s.start, orig_s.end, by_id[orig_s.id])
                        )
                    else:
                        refined_items.extend(
                            split_segment_into_timed_sentences(orig_s.start, orig_s.end, orig_s.text)
                        )

            except Exception as e:
                logger.warning(
                    f"[REFINER] Lỗi khi gọi Gemini ở lô {b_idx} ({e}). "
                    f"Sử dụng bộ tách câu cục bộ cho lô này."
                )
                for orig_s in batch:
                    refined_items.extend(
                        split_segment_into_timed_sentences(orig_s.start, orig_s.end, orig_s.text)
                    )

        if total_batches > 0:
            total_ref_elapsed = time.perf_counter() - refine_start_wall
            bar = build_progress_bar(100.0)
            sys.stdout.write(
                f"\r[Gemini Refiner] [{bar}] 100.0% | "
                f"Đã xử lý {total_batches}/{total_batches} lô | "
                f"Hoàn tất trong: {format_duration(total_ref_elapsed)}                        \n"
            )
            sys.stdout.flush()

        digit_count = 5 if len(refined_items) > 9999 else 4
        new_sentences: List[Sentence] = []
        for idx, item in enumerate(refined_items, start=1):
            new_sentences.append(
                Sentence(
                    id=f"S{idx:0{digit_count}d}",
                    start=item["start"],
                    end=item["end"],
                    text=item["text"]
                )
            )

        transcript.sentences = new_sentences
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
            # Lấy mẫu tối đa ~120 câu đại diện trải đều hoặc toàn bộ nếu <= 120 câu để prompt gọn nhẹ & nhanh
            step = max(1, len(sentences) // 120)
            sampled = [
                f"{s.id} [{s.start:.1f}s-{s.end:.1f}s]: {s.text}"
                for idx, s in enumerate(sentences)
                if idx % step == 0 or idx == len(sentences) - 1
            ]
            first_id = sentences[0].id
            last_id = sentences[-1].id

            prompt = f"""
Bạn là chuyên gia phân tích cấu trúc bài giảng video tự động (Semantic Video Segmentation).
Dưới đây là bản bóc băng (transcript) của video "{transcript.video}" (Chủ đề: "{lesson_name}", thời lượng: {total_duration}s), gồm các câu từ {first_id} đến {last_id}.

NHIỆM VỤ:
Hãy chia toàn bộ nội dung từ câu đầu tiên ({first_id}) đến câu cuối cùng ({last_id}) thành từ 4 đến 8 phân đoạn (topics) liên tiếp nhau theo mạch kiến thức thực tế trong lời giảng.

QUY TẮC BẮT BUỘC:
1. Phân đoạn đầu tiên PHẢI có "start_id": "{first_id}".
2. Phân đoạn cuối cùng PHẢI có "end_id": "{last_id}".
3. Các phân đoạn phải nối tiếp nhau liên tục (end_id của đoạn trước liền kề với start_id của đoạn sau).
4. Đặt tên "section" (nhãn phần lớn, ví dụ: "01_GioiThieu", "02_LyThuyetCoBan", "03_ThucHanh", "04_TongKet") và "topic" (tiêu đề cụ thể, sát với nội dung câu nói thực tế).
5. Chỉ trả về JSON thuần túy theo đúng định dạng sau:

{{
  "segments": [
    {{
      "section_no": 1,
      "section": "01_GioiThieu",
      "topic_no": 1,
      "topic": "Tên chủ đề cụ thể của đoạn 1",
      "start_id": "{first_id}",
      "end_id": "S0020"
    }}
  ]
}}

DANH SÁCH CÂU TRANSCRIPT:
{chr(10).join(sampled)}
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

        for idx, item in enumerate(raw_topics, start=1):
            start_id = str(item.get("start_id", sentences[0].id))
            end_id = str(item.get("end_id", sentences[-1].id))

            s_obj = sentence_map.get(start_id) or sentences[min(idx - 1, len(sentences) - 1)]
            e_obj = sentence_map.get(end_id) or sentences[-1]

            seg_start = 0.0 if idx == 1 else round(max(running_start, float(s_obj.start)), 2)
            seg_end = total_duration if idx == len(raw_topics) else round(max(seg_start + 1.0, float(e_obj.end)), 2)
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

        # Chia thành 5 phân đoạn cân đối theo số câu và ranh giới tự nhiên
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

            # Trích tiêu đề ngắn gọn từ câu đầu tiên của phân đoạn
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
