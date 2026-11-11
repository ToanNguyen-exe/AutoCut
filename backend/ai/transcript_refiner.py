"""Module hiệu đính, tách câu đơn & phân đoạn ngữ nghĩa bài giảng bằng Google Gemini LLM.

Nhiệm vụ trong Pipeline:
1. Tiếp nhận kết quả bóc băng từ Faster-Whisper (đã có mốc thời gian start, end).
2. Dùng Gemini để đọc hiểu văn bản, sửa lỗi chính tả tiếng Việt, chuẩn hóa thuật ngữ chuyên ngành và tách các đoạn dài thành từng câu đơn.
3. Nội suy mốc thời gian [start, end] tương ứng cho từng câu đơn và đánh lại mã định danh tuần tự S0001, S0002...
4. Phân tích ngữ nghĩa toàn bộ các câu S0001..Sxxxx để chia bài giảng thành các chương/chủ đề (SegmentsDTO) phục vụ Backend Spring Boot & Frontend Studio.
"""

import json
import logging
from pathlib import Path
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
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

FALLBACK_MODELS = [
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash-lite",
    "gemini-pro-latest",
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
        primary = model_name or getattr(default_ai_config, "gemini_model", "gemini-3.5-flash")
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
        # pyrefly: ignore[bad-raise]
        raise last_err

    @staticmethod
    def _build_char_batches(sentences: List[Sentence], max_chars: int = 4000, max_items: int = 15) -> List[List[Sentence]]:
        """Gom các câu thành từng lô dựa theo tổng số ký tự để tối ưu số lượt gọi API Gemini, giữ kích thước vừa phải để tinh chỉnh chi tiết từng câu."""
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
Bạn là chuyên gia biên tập ngữ liệu bóc băng giọng nói bài giảng video tiếng Việt chuyên nghiệp.
Dưới đây là danh sách các câu/mẩu câu bóc băng thô từ giọng nói của giảng viên trong video.

NGUYÊN TẮC CỐT LÕI (BẢO TOÀN NGUYÊN VĂN & TÁCH CÂU CHI TIẾT):
1. ƯU TIÊN TÁCH CÂU CỤ THỂ ĐỂ PHÂN ĐOẠN CHÍNH XÁC:
   - Hãy cố gắng giữ và tách riêng từng câu đơn cụ thể theo từng phát ngôn hoặc vế câu có nghĩa độc lập.
   - CÂU ĐƠN ĐỘC LẬP: Nếu một mẩu câu đã diễn đạt xong một ý hoặc đã có cấu trúc câu tương đối hoàn chỉnh (dù ngắn), BẮT BUỘC giữ nguyên là một câu độc lập riêng biệt (chỉ định "start_id" và "end_id" GIỐNG NHAU).
   - CHỈ GỘP KHI BỊ VỠ CÂU DO NGẮT NGHỈ LẤY HƠI: Chỉ gộp khi một câu thực sự bị đứt gãy lửng lơ giữa chừng (ví dụ: bị ngắt giữa cụm danh từ hoặc vị ngữ: 'Anh em có thể viết app từ desktop' và 'cho đến mobile.'). TUYỆT ĐỐI KHÔNG gộp 2 câu đơn độc lập hoàn chỉnh liên tiếp vào một khối lớn.
   - Việc tách câu chi tiết và cụ thể là tối quan trọng để hệ thống phân đoạn (video segmentation) xác định chính xác các điểm mốc thời gian bắt đầu và kết thúc của từng chủ đề bài giảng!

2. BẢO TOÀN TỐI ĐA CÂU TỪ (VERBATIM FIDELITY - TUYỆT ĐỐI KHÔNG GỌT TỪ):
   - Giữ nguyên vẹn 100% tất cả các từ ngữ mà người nói đã phát âm, bao gồm cả từ nối, từ đệm tự nhiên ('thế nhưng mà', 'nói gì đi nữa', 'tuy nhiên', 'cá nhân tôi', 'đấy nhé', 'ạ'...), số liệu, tên riêng, thuật ngữ.
   - TUYỆT ĐỐI KHÔNG TÓM TẮT, KHÔNG LƯỢC BỎ TỪ, KHÔNG TỰ Ý VIẾT LẠI VĂN PHONG (NO PARAPHRASING).
   - Chỉ sửa các lỗi chính tả hiển nhiên do nhận diện âm thanh nhầm, chuẩn hóa viết hoa danh từ riêng/thuật ngữ kỹ thuật, và đảm bảo câu có dấu kết thúc (. ? !).
3. {terms_hint}
4. BẢO TOÀN TOÀN BỘ MÃ ID:
   - Toàn bộ các mẩu id từ {batch[0].id} đến {batch[-1].id} phải được bao phủ liên tục theo thứ tự thời gian tăng dần, không được bỏ rơi bất kỳ mẩu id nào.

DANH SÁCH ĐẦU VÀO:
{json.dumps(batch_data, ensure_ascii=False, indent=2)}

ĐỊNH DẠNG JSON ĐẦU RA BẮT BUỘC:
{{
  "sentences": [
    {{
      "start_id": "{batch[0].id}",
      "end_id": "{batch[0].id}",
      "text": "Câu đơn thứ nhất giữ nguyên văn câu từ gốc."
    }},
    {{
      "start_id": "S0002",
      "end_id": "S0003",
      "text": "Câu sau khi ghép 2 mẩu bị vỡ câu lửng lơ do lấy hơi."
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
                batch_map = {s.id: s for s in batch}
                merged_sentences = parsed.get("sentences") or parsed.get("items") or []

                extracted_batch_items: List[dict] = []
                covered_ids = set()

                if isinstance(merged_sentences, list) and merged_sentences:
                    for it in merged_sentences:
                        if not isinstance(it, dict):
                            continue
                        start_id = it.get("start_id") or it.get("id")
                        end_id = it.get("end_id") or start_id
                        txt = str(it.get("text") or "").strip()

                        # Định dạng tương thích nếu Gemini trả về mảng con sentences
                        if not txt and "sentences" in it and isinstance(it["sentences"], list):
                            multi_sents = [str(x).strip() for x in it["sentences"] if str(x).strip()]
                            if start_id in batch_map:
                                orig_s = batch_map[start_id]
                                extracted_batch_items.extend(
                                    self._interpolate_sentences(orig_s.start, orig_s.end, multi_sents)
                                )
                                covered_ids.add(start_id)
                            continue

                        if not txt:
                            continue

                        s_obj = batch_map.get(start_id)
                        e_obj = batch_map.get(end_id)
                        if s_obj is not None and e_obj is not None:
                            s_start = s_obj.start
                            s_end = e_obj.end
                            if s_end <= s_start:
                                s_end = round(s_start + 1.0, 2)
                            extracted_batch_items.append({
                                "start": round(float(s_start), 2),
                                "end": round(float(s_end), 2),
                                "text": ensure_sentence_casing_and_punctuation(txt)
                            })
                            in_range = False
                            for s in batch:
                                if s.id == start_id:
                                    in_range = True
                                if in_range:
                                    covered_ids.add(s.id)
                                if s.id == end_id:
                                    break

                # Nếu Gemini xử lý tốt và bao phủ ít nhất 70% số mẩu trong batch
                if extracted_batch_items and len(covered_ids) >= max(1, int(len(batch) * 0.7)):
                    missing_batch = [s for s in batch if s.id not in covered_ids]
                    if missing_batch:
                        for ms in missing_batch:
                            extracted_batch_items.append({
                                "start": round(float(ms.start), 2),
                                "end": round(float(ms.end), 2),
                                "text": ensure_sentence_casing_and_punctuation(ms.text)
                            })
                        extracted_batch_items.sort(key=lambda x: x["start"])
                    refined_items.extend(extracted_batch_items)
                else:
                    for orig_s in batch:
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
        max_part_duration: float = 420.0,
        force_ai: bool = True,
        max_retries: Optional[int] = None
    ) -> Dict[str, Any]:
        """Phân tích ngữ nghĩa danh sách câu S0001..Sxxxx và chia thành các phân đoạn chủ đề (SegmentsDTO).
        Bắt buộc phân đoạn bằng AI: nếu gặp lỗi sẽ kiên trì thử lại (retry loop) cho đến khi AI thành công.
        """
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

        # Tự động chuyển force_ai = False nếu refiner là mock offline (không có models_to_try)
        if not getattr(self, "models_to_try", None):
            force_ai = False

        # Đọc toàn bộ 100% câu transcript chi tiết để Gemini phân đoạn chính xác nhất
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
6. QUY TẮC THỜI LƯỢNG (TỐI ĐA 7 PHÚT / 420 GIÂY MỖI ĐOẠN VIDEO):
   Mỗi bài học / chủ đề (topic) KHÔNG ĐƯỢC dài quá 7 phút (420 giây). Nếu một chủ đề kiến thức có nội dung dài hơn 7 phút, BẮT BUỘC phải chia chủ đề đó thành nhiều đoạn nhỏ nối tiếp nhau trong cùng section với tiêu đề kèm '(Phần 1)', '(Phần 2)' (ví dụ: 'Khai báo biến (Phần 1)', 'Khai báo biến (Phần 2)'), sao cho mỗi đoạn đều có thời lượng không vượt quá 7 phút (<= 420s).
7. Chỉ trả về JSON thuần túy theo đúng cấu trúc sections và topics sau:

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

        # Vòng lặp kiên trì gọi AI phân đoạn (Retry loop cho đến khi AI thành công)
        attempt = 0
        while True:
            attempt += 1
            try:
                logger.info(f"[SEGMENTER] Đang gửi yêu cầu phân đoạn tới AI (Lần thử #{attempt})...")
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
                        llm_raw_path = PROJECT_ROOT / "cache" / "llm_raw.json"
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
                    if raw_topics:
                        logger.info(f"[SEGMENTER] Gemini đã chia thành công {len(parsed['sections'])} phần lớn với {len(raw_topics)} bài học cụ thể (Lần thử #{attempt}).")
                        break
                    else:
                        raise ValueError("AI trả về danh sách sections/topics rỗng.")
                else:
                    candidate_segs = parsed.get("segments", [])
                    if isinstance(candidate_segs, list) and len(candidate_segs) >= 2:
                        raw_topics = candidate_segs
                        logger.info(f"[SEGMENTER] Gemini đã chia thành công {len(raw_topics)} phân đoạn ngữ nghĩa (Lần thử #{attempt}).")
                        break
                    else:
                        raise ValueError("AI không trả về cấu trúc sections hoặc segments hợp lệ.")

            except Exception as e:
                logger.warning(f"[SEGMENTER] AI phân đoạn gặp lỗi ở lần thử #{attempt}: {e}")
                if not force_ai:
                    logger.warning("[SEGMENTER] Chế độ force_ai=False, cho phép chuyển sang fallback.")
                    break
                if max_retries is not None and attempt >= max_retries:
                    logger.error(f"[SEGMENTER] Đã thử {attempt} lần nhưng AI không thể phân đoạn: {e}")
                    raise RuntimeError(f"Bắt buộc phân đoạn bằng AI nhưng AI gặp lỗi sau {attempt} lần thử: {e}")

                wait_sec = 0.05 if "pytest" in sys.modules else min(30, 2 + attempt * 2)
                err_str = str(e)
                if ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str) and "pytest" not in sys.modules:
                    wait_sec = min(60, max(5, 5 * attempt))

                print(f"\n[AI Segmenter] AI chưa phân đoạn thành công (Lỗi: {e}). Đang đợi {wait_sec}s để thử lại lần {attempt + 1}...")
                time.sleep(wait_sec)

        # 2. Nếu force_ai=False và Gemini không khả dụng: mới dùng fallback chia đều từ câu thật
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
                next_item = raw_topics[idx]
                next_s_obj = resolve_sentence(str(next_item.get("start_id", "")), e_obj)
                # Khoảng chết giữa 2 phân đoạn mặc định nối trọn vẹn vào cuối phân đoạn trước
                target_end = float(next_s_obj.start) if next_s_obj.start > e_obj.end else float(e_obj.end)
                raw_end = target_end
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

            # Chia nhỏ chủ đề nếu thời lượng dài hơn max_part_duration (tối đa 7 phút = 420 giây)
            seg_dur = seg_end - seg_start
            if seg_dur <= max_part_duration or max_part_duration <= 0:
                seg_idx = len(segments_out) + 1
                segments_out.append({
                    "id": f"seg_ai_{seg_idx:02d}",
                    "section_no": section_no,
                    "section": section_name,
                    "topic_no": topic_no,
                    "topic": topic_title,
                    "slug": slug,
                    "start_id": s_obj.id,
                    "end_id": e_obj.id,
                    "start": seg_start,
                    "end": seg_end,
                    "parts": [{
                        "part": 1,
                        "start": seg_start,
                        "end": seg_end,
                        "file": f"{topic_no:02d}_{slug}.mp4"
                    }]
                })
            else:
                p_start = seg_start
                p_idx = 1
                topic_folder = f"{topic_no:02d}_{slug}"

                # Danh sách câu trong phạm vi của topic này để map mốc câu chuẩn xác
                seg_sentences = [
                    s for s in sentences
                    if s.start >= seg_start - 0.5 and s.end <= seg_end + 0.5
                ]

                while p_start < seg_end - 0.05:
                    remaining_time = seg_end - p_start
                    if remaining_time <= max_part_duration:
                        p_end = seg_end
                        sub_e_obj = e_obj
                    else:
                        rem_parts = max(2, int((remaining_time + max_part_duration - 0.01) // max_part_duration))
                        target_len = remaining_time / rem_parts
                        target_end = p_start + target_len
                        max_allowed_rem = (rem_parts - 1) * max_part_duration

                        # Tìm câu kết thúc trong khoảng hợp lệ:
                        # vừa đảm bảo phần này <= max_part_duration,
                        # vừa đảm bảo thời gian còn lại không bắt các phần sau phải vượt quá max_part_duration
                        valid_candidates = [
                            s for s in seg_sentences
                            if (p_start + 1.0) <= s.end <= (p_start + max_part_duration)
                            and (seg_end - s.end) <= max_allowed_rem
                        ]
                        if valid_candidates:
                            best_sent = min(valid_candidates, key=lambda s: abs(s.end - target_end))
                            p_end = round(best_sent.end, 2)
                            sub_e_obj = best_sent
                        else:
                            p_end = round(min(seg_end, target_end), 2)
                            sub_e_obj = min(sentences, key=lambda s: abs(s.end - p_end))

                    # Đảm bảo p_end luôn tiến về phía trước và không vượt quá seg_end
                    if p_end <= p_start:
                        p_end = round(min(seg_end, p_start + max_part_duration), 2)
                    if p_end > seg_end:
                        p_end = seg_end

                    if p_idx == 1:
                        sub_s_obj = s_obj
                    else:
                        candidates_start = [s for s in seg_sentences if s.start >= p_start - 0.5]
                        sub_s_obj = candidates_start[0] if candidates_start else min(sentences, key=lambda s: abs(s.start - p_start))

                    sub_title = f"{topic_title} (Phần {p_idx})"
                    sub_slug = f"{slug}-phan-{p_idx}"
                    sub_file = f"{topic_folder}/{topic_no:02d}_{slug}_Phan{p_idx}.mp4"
                    seg_idx = len(segments_out) + 1

                    segments_out.append({
                        "id": f"seg_ai_{seg_idx:02d}",
                        "section_no": section_no,
                        "section": section_name,
                        "topic_no": topic_no,
                        "topic": sub_title,
                        "slug": sub_slug,
                        "start_id": sub_s_obj.id,
                        "end_id": sub_e_obj.id,
                        "start": round(p_start, 2),
                        "end": round(p_end, 2),
                        "parts": [{
                            "part": 1,
                            "start": round(p_start, 2),
                            "end": round(p_end, 2),
                            "file": sub_file
                        }]
                    })
                    p_start = p_end
                    p_idx += 1

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

        # Chia thành các phân đoạn cân đối theo thời lượng (mỗi đoạn không quá 7 phút = 420s) và ranh giới câu tự nhiên
        total_dur = sentences[-1].end - sentences[0].start if sentences else 0.0
        min_segs_by_dur = max(1, int((total_dur + 419.99) // 420.0))
        num_segs = max(min_segs_by_dur, min(24, max(4, n // 80 + 4)))
        chunk_size = max(1, n // num_segs)
        base_section_labels = [
            "GioiThieu",
            "KhaiNiemCoBan",
            "NoiDungTrongTam",
            "PhanTichChiTiet",
            "ThucHanhUngDung",
            "TongKetBaiGiang",
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

            base_label = base_section_labels[min(i, len(base_section_labels) - 1)]
            sec_label = f"{i + 1:02d}_{base_label}"
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
