"""Module hiệu đính, tách câu đơn & phân đoạn ngữ nghĩa bài giảng bằng LLM (Groq Cloud 2 model chính, Google Gemini dự phòng).

Nhiệm vụ trong Pipeline:
1. Tiếp nhận kết quả bóc băng từ Whisper (đã có mốc thời gian start, end).
2. Dùng Groq LLM (mặc định `openai/gpt-oss-20b` chau chuốt câu từ, dự phòng `openai/gpt-oss-120b` & Google Gemini) sửa lỗi chính tả tiếng Việt, chuẩn hóa thuật ngữ chuyên ngành và tách các đoạn dài thành từng câu đơn.
3. Nội suy mốc thời gian [start, end] tương ứng cho từng câu đơn và đánh lại mã định danh tuần tự S0001, S0002...
4. Dùng Groq LLM (mặc định `openai/gpt-oss-120b` phân đoạn, dự phòng `openai/gpt-oss-20b` & Google Gemini) chia bài giảng thành các chương/chủ đề (SegmentsDTO) phục vụ Backend Spring Boot & Frontend Studio.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
import gc
import json
import logging
from pathlib import Path
import re
import sys
import threading
import time
from types import SimpleNamespace
import unicodedata
from typing import Optional, List, Dict, Any, Set
import urllib.error
import urllib.request

from google import genai
from google.genai import types

from .models import Sentence, TranscriptOutput
from .prompt_builder import extract_terms_from_outline
from .config_loader import (
    classify_ai_api_error,
    default_ai_config,
    log_ai_api_error,
    summarize_error,
)
from .post_processor import (
    ensure_sentence_casing_and_punctuation,
    split_segment_into_timed_sentences,
)
from .whisper_service import format_duration, build_progress_bar

logger = logging.getLogger("AutoCut.AI.Refiner")
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

DEFAULT_GROQ_REFINE_MODEL = "openai/gpt-oss-20b"
DEFAULT_GROQ_SEGMENT_MODEL = "openai/gpt-oss-120b"
DEFAULT_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

GROQ_FALLBACK_MODELS = [
    DEFAULT_GROQ_REFINE_MODEL,
    DEFAULT_GROQ_SEGMENT_MODEL,
]

GEMINI_FALLBACK_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash-lite",
    "gemini-pro-latest",
]

FALLBACK_MODELS = [
    *GROQ_FALLBACK_MODELS,
    *GEMINI_FALLBACK_MODELS,
]

# Timeout 60.000 ms (60 giây) tránh lỗi 504 DEADLINE_EXCEEDED trên các lô lớn / bước segment
REFINER_HTTP_TIMEOUT_MS = 60000.0
DEFAULT_REFINE_MAX_WORKERS = 2
EXHAUSTED_MODEL_COOLDOWN_SEC = 60.0


def _is_groq_model(model_name: str) -> bool:
    """Nhận diện model chạy qua Groq Cloud (không phải họ Google Gemini)."""
    return bool(model_name) and not model_name.strip().lower().startswith("gemini")


def _provider_label(model_name: str) -> str:
    return "GROQ" if _is_groq_model(model_name) else "GEMINI"


def slugify_vi(text: str) -> str:
    """Chuyển chuỗi tiếng Việt sang slug ASCII chuẩn (ví dụ: 'Kiểu dữ liệu & Biến' -> 'kieu-du-lieu-bien')."""
    if not text:
        return "chu-de"
    s = text.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:48].strip("-") or "chu-de"


def _strip_reasoning_and_fences(raw_text: str) -> str:
    """Loại bỏ khối suy luận <think>...</think> và markdown fence quanh JSON."""
    cleaned = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.IGNORECASE | re.DOTALL).strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.IGNORECASE | re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1).strip()
    return cleaned


def _parse_json_response(
    response: Any,
    model_name: str,
    warn_on_truncation: bool = True,
) -> Dict[str, Any]:
    """Kiểm tra giới hạn token đầu ra, bóc khối reasoning/markdown và parse JSON từ phản hồi LLM."""
    provider = _provider_label(model_name)
    candidates = getattr(response, "candidates", None)
    if warn_on_truncation and candidates:
        finish_reason = str(getattr(candidates[0], "finish_reason", "") or "").upper()
        if "MAX_TOKENS" in finish_reason or finish_reason == "LENGTH":
            logger.warning(f"[{provider}-TOKEN_OR_QUOTA_EXHAUSTED] {model_name}: cham MAX_TOKENS, JSON co the bi cat")
    raw_text = str(getattr(response, "text", "") or "").strip()
    cleaned = _strip_reasoning_and_fences(raw_text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx == -1 or end_idx <= start_idx:
            raise
        parsed = json.loads(cleaned[start_idx : end_idx + 1])
    if not isinstance(parsed, dict):
        raise ValueError(f"LLM {model_name} khong tra ve JSON object")
    return parsed


def _is_model_not_found_error(err: Exception) -> bool:
    """Nhận diện lỗi 404 NOT_FOUND (model không tồn tại trên endpoint/API key hiện tại)."""
    return bool(re.search(r"(?<![\w.])404(?![\w.])|not_found|not found", str(err).lower()))


class TranscriptRefiner:
    """Bộ hiệu đính, tách câu đơn và phân đoạn chủ đề (Groq 2 model chính: 20B chau chuốt / 120B phân đoạn, Gemini dự phòng)."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        exhausted_models: Optional[Set[str]] = None,
        unavailable_models: Optional[Set[str]] = None,
        groq_api_key: Optional[str] = None,
        groq_api_url: Optional[str] = None,
        refine_model: Optional[str] = None,
        segment_model: Optional[str] = None,
    ):
        self.groq_api_key = (
            groq_api_key
            if groq_api_key is not None
            else getattr(default_ai_config, "groq_api_key", "")
        )
        self.groq_api_url = (
            groq_api_url
            or getattr(default_ai_config, "groq_api_url", DEFAULT_GROQ_API_URL)
        )
        self.api_key = api_key if api_key is not None else default_ai_config.gemini_api_key

        if not self.groq_api_key and not self.api_key:
            logger.error("[GEMINI-API_KEY_ERROR] Thieu GROQ_API_KEY va GEMINI_API_KEY trong .env")
            raise ValueError("Không tìm thấy GROQ_API_KEY hoặc GEMINI_API_KEY trong .env hoặc cấu hình!")

        groq_refine = refine_model or getattr(default_ai_config, "groq_refine_model", DEFAULT_GROQ_REFINE_MODEL)
        groq_segment = segment_model or getattr(default_ai_config, "groq_segment_model", DEFAULT_GROQ_SEGMENT_MODEL)
        gemini_primary = getattr(default_ai_config, "gemini_model", "gemini-3.8-flash")

        gemini_models: List[str] = []
        if self.api_key:
            gemini_models = list(dict.fromkeys([gemini_primary, *GEMINI_FALLBACK_MODELS]))

        refine_order: List[str] = []
        segment_order: List[str] = []
        if model_name:
            refine_order.append(model_name)
            segment_order.append(model_name)
        if self.groq_api_key:
            refine_order.extend([m for m in (groq_refine, groq_segment) if m])
            segment_order.extend([m for m in (groq_segment, groq_refine) if m])
        refine_order.extend(gemini_models)
        segment_order.extend(gemini_models)

        self.refine_models_to_try = list(dict.fromkeys(refine_order))
        self.segment_models_to_try = list(dict.fromkeys(segment_order))
        self.models_to_try = list(self.refine_models_to_try)
        self._default_models_to_try = tuple(self.models_to_try)
        self.model_name = self.models_to_try[0]
        self.exhausted_models: Set[str] = exhausted_models if exhausted_models is not None else set()
        self._unavailable_models: Set[str] = unavailable_models if unavailable_models is not None else set()
        self._exhausted_at: Dict[str, float] = {}
        self._lock = threading.Lock()
        self.client = (
            genai.Client(
                api_key=self.api_key,
                http_options={"timeout": REFINER_HTTP_TIMEOUT_MS},
            )
            if self.api_key
            else None
        )

    def _call_groq(self, model_candidate: str, prompt: str):
        """Gọi Groq Cloud Chat Completions bằng stdlib urllib (không cần thêm thư viện ngoài)."""
        api_key = getattr(self, "groq_api_key", "")
        if not api_key:
            raise RuntimeError("401 Unauthorized: missing GROQ_API_KEY")

        api_url = getattr(self, "groq_api_url", DEFAULT_GROQ_API_URL)
        timeout_sec = REFINER_HTTP_TIMEOUT_MS / 1000.0
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        }

        def send_request(include_response_format: bool) -> Dict[str, Any]:
            payload: Dict[str, Any] = {
                "model": model_candidate,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            }
            if "gpt-oss" in model_candidate.lower():
                payload["reasoning_effort"] = "low"
            if include_response_format:
                payload["response_format"] = {"type": "json_object"}
            req = urllib.request.Request(
                api_url,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                return json.loads(resp.read().decode("utf-8"))

        def read_err_body(http_err: urllib.error.HTTPError) -> str:
            try:
                return http_err.read().decode("utf-8", errors="ignore")
            except Exception:
                return ""

        try:
            data = send_request(include_response_format=True)
        except urllib.error.HTTPError as err:
            body = read_err_body(err)
            body_lower = body.lower()
            retry_without_rf = err.code == 400 and (
                "response_format" in body_lower
                or "json_object" in body_lower
                or "json_validate_failed" in body_lower
                or "failed to validate json" in body_lower
            )
            if retry_without_rf:
                try:
                    data = send_request(include_response_format=False)
                except urllib.error.HTTPError as retry_err:
                    retry_body = read_err_body(retry_err)
                    raise RuntimeError(
                        f"HTTP {retry_err.code} {retry_err.reason}: {retry_body[:500]}"
                    ) from retry_err
            else:
                raise RuntimeError(f"HTTP {err.code} {err.reason}: {body[:500]}") from err

        choices = data.get("choices") or []
        if not choices:
            raise ValueError("Groq khong tra ve choices hop le")
        choice0 = choices[0]
        message = choice0.get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", "")) if isinstance(part, dict) else str(part)
                for part in content
            )
        content_str = str(content or "").strip()
        if not content_str:
            raise ValueError("Groq tra ve noi dung rong")

        finish_reason = str(choice0.get("finish_reason") or "").lower()
        mapped_reason = "MAX_TOKENS" if finish_reason == "length" else finish_reason.upper()
        return SimpleNamespace(
            text=content_str,
            candidates=[SimpleNamespace(finish_reason=mapped_reason)],
        )

    def _call_model(self, model_candidate: str, prompt: str):
        """Điều phối gọi Groq Cloud (2 model chính) hoặc Gemini SDK (model dự phòng)."""
        if _is_groq_model(model_candidate):
            return self._call_groq(model_candidate, prompt)
        client = getattr(self, "client", None)
        if client is None:
            raise RuntimeError("401 Unauthorized: missing GEMINI_API_KEY")
        return client.models.generate_content(
            model=model_candidate,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )

    def _evict_cooled_down_models_locked(self, exhausted: Set[str], exhausted_at: Dict[str, float]) -> None:
        """Gỡ các model từng báo 429 nếu đã qua cửa sổ hồi quota (60s)."""
        now = time.monotonic()
        expired = [
            m for m, marked_at in list(exhausted_at.items())
            if (now - marked_at) >= EXHAUSTED_MODEL_COOLDOWN_SEC
        ]
        for m in expired:
            exhausted.discard(m)
            exhausted_at.pop(m, None)

    def _try_candidate_models(
        self,
        candidates: List[str],
        prompt: str,
        lock: Any,
        exhausted: Set[str],
        exhausted_at: Dict[str, float],
        unavailable: Set[str],
    ):
        """Thử lần lượt danh sách model ứng viên (Groq chính -> Gemini dự phòng)."""
        last_err = None
        had_non_quota_err = False
        for idx, model_candidate in enumerate(candidates):
            with lock:
                if model_candidate in unavailable:
                    continue
            provider = _provider_label(model_candidate)
            for attempt in range(1, 3):
                try:
                    response = self._call_model(model_candidate, prompt)
                    # Xác thực phản hồi parse được JSON trước khi chấp nhận (không in lặp cảnh báo MAX_TOKENS)
                    _parse_json_response(response, model_candidate, warn_on_truncation=False)
                    with lock:
                        self.model_name = model_candidate
                        exhausted.discard(model_candidate)
                        exhausted_at.pop(model_candidate, None)
                    logger.info(f"[{provider}] Model: {model_candidate}")
                    return response, None, had_non_quota_err
                except Exception as err:
                    last_err = err
                    err_str = str(err)
                    code, _ = classify_ai_api_error(err)
                    is_key_err = code == "API_KEY_ERROR"
                    has_other_provider = any(
                        _provider_label(other) != provider for other in candidates[idx + 1 :]
                    )
                    log_ai_api_error(
                        logger,
                        provider,
                        model_candidate,
                        err,
                        is_fatal=is_key_err and not has_other_provider,
                    )
                    if is_key_err:
                        if has_other_provider:
                            with lock:
                                for other in candidates:
                                    if _provider_label(other) == provider:
                                        unavailable.add(other)
                            break
                        raise err
                    if _is_model_not_found_error(err):
                        with lock:
                            unavailable.add(model_candidate)
                        break
                    if code == "TOKEN_OR_QUOTA_EXHAUSTED":
                        with lock:
                            exhausted.add(model_candidate)
                            exhausted_at[model_candidate] = time.monotonic()
                        break
                    had_non_quota_err = True
                    if ("503" in err_str or "UNAVAILABLE" in err_str) and attempt < 2:
                        time.sleep(2)
                        continue
                    break
        return None, last_err, had_non_quota_err

    def _generate_with_fallback(self, prompt: str, models_override: Optional[List[str]] = None):
        """Gọi LLM API (Groq chính, Gemini dự phòng): bỏ qua 404 suốt phiên, tạm bỏ qua 429/413 trong 60s hoặc khi còn model khác."""
        lock = getattr(self, "_lock", None) or nullcontext()
        with lock:
            exhausted = getattr(self, "exhausted_models", None)
            if exhausted is None:
                exhausted = set()
                self.exhausted_models = exhausted
            unavailable = getattr(self, "_unavailable_models", None)
            if unavailable is None:
                unavailable = set()
                self._unavailable_models = unavailable
            exhausted_at = getattr(self, "_exhausted_at", None)
            if exhausted_at is None:
                exhausted_at = {}
                self._exhausted_at = exhausted_at

            self._evict_cooled_down_models_locked(exhausted, exhausted_at)

            model_list = models_override if models_override is not None else self.models_to_try
            available_models = [m for m in model_list if m not in unavailable]
            candidates = [m for m in available_models if m not in exhausted]
            skipped_exhausted = [m for m in available_models if m in exhausted]
            if not candidates and available_models:
                exhausted.clear()
                exhausted_at.clear()
                candidates = list(available_models)
                skipped_exhausted = []

        if not candidates:
            raise RuntimeError("Không có model LLM khả dụng trong danh sách fallback.")

        response, last_err, had_non_quota_err = self._try_candidate_models(
            candidates, prompt, lock, exhausted, exhausted_at, unavailable
        )
        if response is not None:
            return response

        # Nếu các model chưa hết quota đều chết vì 503/504 (không phải 429/404),
        # thử cứu vớt bằng các model từng 429 trước đó thay vì kẹt chết ở 1 model 503.
        tried_models = list(candidates)
        if had_non_quota_err and skipped_exhausted:
            recovery_resp, recovery_err, _ = self._try_candidate_models(
                skipped_exhausted, prompt, lock, exhausted, exhausted_at, unavailable
            )
            if recovery_resp is not None:
                return recovery_resp
            tried_models.extend(skipped_exhausted)
            if recovery_err is not None:
                last_err = recovery_err

        if last_err is not None:
            target_label = tried_models[0] if len(tried_models) == 1 else ",".join(tried_models)
            provider_label = _provider_label(tried_models[-1]) if tried_models else "GEMINI"
            log_ai_api_error(logger, provider_label, target_label, last_err, is_fatal=True)
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

    @staticmethod
    def _fallback_batch_items(batch: List[Sentence]) -> List[dict]:
        items: List[dict] = []
        for orig_s in batch:
            items.extend(split_segment_into_timed_sentences(orig_s.start, orig_s.end, orig_s.text))
        return items

    def _generate_for_task(self, prompt: str, task: str):
        """Gọi LLM theo danh sách ưu tiên riêng cho từng phần việc ('refine' hoặc 'segment')."""
        current_models = getattr(self, "models_to_try", None)
        default_models = getattr(self, "_default_models_to_try", None)
        if default_models is not None and current_models is not None and tuple(current_models) == default_models:
            task_models = getattr(self, f"{task}_models_to_try", None)
            if task_models and task_models != current_models:
                return self._generate_with_fallback(prompt, models_override=task_models)
        return self._generate_with_fallback(prompt)

    def _all_models_exhausted(self, model_list: Optional[List[str]] = None) -> bool:
        lock = getattr(self, "_lock", None) or nullcontext()
        with lock:
            try_models = model_list if model_list is not None else (getattr(self, "models_to_try", None) or [])
            ex_models = getattr(self, "exhausted_models", None) or set()
            unavail_models = getattr(self, "_unavailable_models", None) or set()
            unique_models = set(try_models)
            return bool(unique_models) and len(unique_models & (ex_models | unavail_models)) >= len(unique_models)

    def _refine_single_batch(
        self,
        b_idx: int,
        batch: List[Sentence],
        terms_hint: str,
        abort_event: threading.Event,
    ) -> List[dict]:
        """Hiệu đính 1 lô câu bằng LLM; fallback cục bộ chỉ cho lô lỗi nếu gặp lỗi tạm thời."""
        refine_models = getattr(self, "refine_models_to_try", None)
        if abort_event.is_set() or self._all_models_exhausted(refine_models):
            return self._fallback_batch_items(batch)

        batch_data = [{"id": s.id, "text": s.text} for s in batch]
        terms_line = f"\n- {terms_hint}" if terms_hint else ""
        compact_input = json.dumps(batch_data, ensure_ascii=False, separators=(",", ":"))
        prompt = (
            "Biên tập bản bóc băng bài giảng tiếng Việt sau và trả về DUY NHẤT JSON:\n"
            f'{{"sentences":[{{"start_id":"{batch[0].id}","end_id":"{batch[0].id}","text":"..."}}]}}\n'
            "Quy tắc:\n"
            "- Giữ riêng từng câu đơn hoàn chỉnh (start_id=end_id); CHỈ gộp các mẩu bị vỡ câu lửng lơ do lấy hơi.\n"
            "- Giữ nguyên văn 100% từ ngữ, từ đệm, số liệu, thuật ngữ; KHÔNG tóm tắt hay viết lại văn phong.\n"
            "- Chỉ sửa lỗi chính tả nghe nhầm, chuẩn hóa viết hoa tên riêng/thuật ngữ và thêm dấu kết câu (. ? !)."
            f"{terms_line}\n"
            f"- Bao phủ liên tục mọi id từ {batch[0].id} đến {batch[-1].id}, không bỏ sót.\n"
            f"INPUT:{compact_input}"
        )
        try:
            response = self._generate_for_task(prompt, "refine")
            parsed = _parse_json_response(response, getattr(self, "model_name", "unknown"))
            response = None  # chuỗi JSON lớn, giải phóng ngay sau khi parse
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
                        split_items = split_segment_into_timed_sentences(s_start, s_end, txt)
                        if split_items:
                            extracted_batch_items.extend(split_items)
                        else:
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
                return extracted_batch_items
            return self._fallback_batch_items(batch)
        except Exception as e:
            code = log_ai_api_error(
                logger,
                f"REFINER lo {b_idx}",
                getattr(self, "model_name", "unknown"),
                e,
                is_fatal=False,
            )
            if code == "API_KEY_ERROR":
                abort_event.set()
            return self._fallback_batch_items(batch)

    def refine_transcript(
        self,
        transcript: TranscriptOutput,
        outline_text: Optional[str] = None,
        start_from_id: Optional[str] = None,
        max_workers: Optional[int] = None
    ) -> TranscriptOutput:
        """Hiệu đính chính tả và tách từng câu đơn trên toàn bộ transcript, sau đó đánh lại mã S0001, S0002..."""
        if not transcript.sentences:
            return transcript

        if getattr(self, "_lock", None) is None:
            self._lock = threading.Lock()

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

        active_models = getattr(self, "refine_models_to_try", None) or getattr(self, "models_to_try", None) or []
        using_groq = bool(active_models) and _is_groq_model(active_models[0])
        if using_groq:
            # Groq Free giới hạn ~8.000 TPM/model -> chia lô gọn & chạy tuần tự để tránh 429/413
            batch_max_items = 20
            batch_max_chars = 4000
            effective_workers = max_workers if max_workers is not None else 1
        else:
            batch_max_items = 60 if len(target_sentences) > 200 else 25
            batch_max_chars = 12000 if len(target_sentences) > 200 else 6000
            effective_workers = max_workers if max_workers is not None else DEFAULT_REFINE_MAX_WORKERS

        batches = self._build_char_batches(target_sentences, max_chars=batch_max_chars, max_items=batch_max_items)
        total_batches = len(batches)
        refine_start_wall = time.perf_counter()
        abort_event = threading.Event()
        batch_results: List[Optional[List[dict]]] = [None] * total_batches

        def write_progress(completed: int, label_batch: List[Sentence], b_num: int):
            elapsed_ref = time.perf_counter() - refine_start_wall
            percent_ref = (completed / total_batches) * 100.0 if total_batches > 0 else 100.0
            if completed > 0:
                avg_per_batch = elapsed_ref / completed
                eta_ref = avg_per_batch * (total_batches - completed)
                eta_str = f"~{format_duration(eta_ref)}"
            else:
                eta_str = "đang tính..."
            bar = build_progress_bar(percent_ref)
            sys.stdout.write(
                f"\r[AI Refiner] [{bar}] {percent_ref:5.1f}% | "
                f"Lô {b_num}/{total_batches} ({label_batch[0].id}->{label_batch[-1].id}) | "
                f"Đã chạy: {format_duration(elapsed_ref)} | Còn lại (ETA): {eta_str}   "
            )
            sys.stdout.flush()

        workers = max(1, min(int(effective_workers or 1), total_batches)) if total_batches > 0 else 1
        if workers <= 1:
            for idx, batch in enumerate(batches):
                write_progress(idx, batch, idx + 1)
                batch_results[idx] = self._refine_single_batch(idx + 1, batch, terms_hint, abort_event)
        else:
            completed_count = 0
            with ThreadPoolExecutor(max_workers=workers) as executor:
                future_to_idx = {
                    executor.submit(self._refine_single_batch, idx + 1, batch, terms_hint, abort_event): idx
                    for idx, batch in enumerate(batches)
                }
                for future in as_completed(future_to_idx):
                    idx = future_to_idx[future]
                    batch_results[idx] = future.result()
                    completed_count += 1
                    write_progress(completed_count, batches[idx], idx + 1)

        refined_items: List[dict] = list(prefix_items)
        for items in batch_results:
            if items:
                refined_items.extend(items)

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
        # Giải phóng danh sách câu tạm khi transcript lớn (mỗi câu là object Pydantic)
        if len(new_sentences) > 200:
            gc.collect()
        return transcript

    def segment_transcript(
        self,
        transcript: TranscriptOutput,
        lesson_name: str,
        max_part_duration: float = 420.0,
        force_ai: bool = True,
        max_retries: Optional[int] = 2
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

        # Đọc toàn bộ câu transcript, tự động nén gọn nếu vượt max_llm_chars trong config.yaml (mặc định 60.000 ký tự)
        raw_cfg = getattr(default_ai_config, "raw_config", None) or {}
        max_llm_chars = int(raw_cfg.get("segmentation", {}).get("max_llm_chars", 60000) or 60000)
        target_transcript_chars = max(8000, max_llm_chars - 3000)

        # Bỏ timestamp khỏi prompt: bước phân đoạn chỉ cần mã câu + lời thoại,
        # mốc thời gian lấy lại từ Sentence.start/end nên không mất thông tin,
        # còn prompt ngắn hơn ~25% (ít token, ít RAM chuỗi).
        formatted_sentences = [
            f"{s.id}: {s.text}"
            for s in sentences
        ]
        if sum(len(line) + 1 for line in formatted_sentences) > target_transcript_chars:
            # Bước 1: Rút gọn timestamp mỗi dòng, ưu tiên giữ đủ 100% mã câu S0001..Sxxxx
            fits_budget = False
            for char_cap in (140, 100, 75, 55):
                compact_lines = []
                for s in sentences:
                    t = s.text.strip()
                    if len(t) > char_cap:
                        t = t[: char_cap - 1].rstrip() + "…"
                    compact_lines.append(f"{s.id}: {t}")
                formatted_sentences = compact_lines
                if sum(len(line) + 1 for line in formatted_sentences) <= target_transcript_chars:
                    fits_budget = True
                    break

            # Bước 2 (video rất dài > 1.000 câu): chỉ gắn mốc giây mỗi 5 câu để nhường ngân sách cho nội dung lời thoại
            if not fits_budget:
                last_idx = len(sentences) - 1
                prefixes = [
                    f"{s.id} [{int(round(s.start))}s]: " if (i % 5 == 0 or i == last_idx) else f"{s.id}: "
                    for i, s in enumerate(sentences)
                ]
                prefix_total = sum(len(p) + 1 for p in prefixes)
                dynamic_floor = max(12, (target_transcript_chars - prefix_total) // max(1, len(sentences)))
                for char_cap in (100, 75, 55, 45, 38, 32, 26, 20, dynamic_floor):
                    sparse_lines = []
                    for pfx, s in zip(prefixes, sentences):
                        t = s.text.strip()
                        if len(t) > char_cap:
                            t = t[: max(1, char_cap - 1)].rstrip() + "…"
                        sparse_lines.append(f"{pfx}{t}")
                    formatted_sentences = sparse_lines
                    if sum(len(line) + 1 for line in formatted_sentences) <= target_transcript_chars:
                        break

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
                logger.info(f"[SEGMENTER] Goi AI lan #{attempt}")
                response = self._generate_for_task(prompt, "segment")
                parsed = _parse_json_response(response, getattr(self, "model_name", "unknown"))
                response = None  # chuỗi JSON lớn, giải phóng ngay sau khi parse

                # Hỗ trợ cấu trúc sections -> topics (Đặc tả B4 llm_raw.json)
                used_model = getattr(self, "model_name", None) or (
                    self.models_to_try[0] if getattr(self, "models_to_try", None) else "unknown"
                )
                if isinstance(parsed, dict) and "sections" in parsed and isinstance(parsed["sections"], list):
                    try:
                        llm_raw_path = PROJECT_ROOT / "cache" / "llm_raw.json"
                        llm_raw_path.parent.mkdir(parents=True, exist_ok=True)
                        llm_raw_payload = {"model": used_model, **parsed}
                        with open(llm_raw_path, "w", encoding="utf-8") as f_raw:
                            json.dump(llm_raw_payload, f_raw, ensure_ascii=False, indent=2)
                    except Exception as raw_err:
                        logger.warning(f"[SEGMENTER] Loi ghi llm_raw.json: {summarize_error(raw_err)}")

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
                        logger.info(f"[SEGMENTER] {used_model}: {len(parsed['sections'])} phan, {len(raw_topics)} muc (lan #{attempt})")
                        break
                    else:
                        raise ValueError("AI trả về danh sách sections/topics rỗng.")
                else:
                    candidate_segs = parsed.get("segments", [])
                    if isinstance(candidate_segs, list) and len(candidate_segs) >= 2:
                        raw_topics = candidate_segs
                        logger.info(f"[SEGMENTER] {used_model}: {len(raw_topics)} phan doan (lan #{attempt})")
                        break
                    else:
                        raise ValueError("AI không trả về cấu trúc sections hoặc segments hợp lệ.")

            except Exception as e:
                log_ai_api_error(logger, f"SEGMENTER #{attempt}", getattr(self, "model_name", "unknown"), e, is_fatal=False)
                if not force_ai:
                    logger.warning("[SEGMENTER] Fallback cuc bo (force_ai=False)")
                    break
                if max_retries is not None and attempt >= max_retries:
                    logger.error(f"[SEGMENTER] That bai sau {attempt} lan: {summarize_error(e)}")
                    raise RuntimeError(f"Bắt buộc phân đoạn bằng AI nhưng AI gặp lỗi sau {attempt} lần thử: {e}")

                wait_sec = 0.05 if "pytest" in sys.modules else min(30, 2 + attempt * 2)
                err_str = str(e)
                if ("429" in err_str or "RESOURCE_EXHAUSTED" in err_str) and "pytest" not in sys.modules:
                    wait_sec = min(60, max(5, 5 * attempt))

                print(f"\n[AI Segmenter] Loi ({summarize_error(e)}). Doi {wait_sec}s thu lai lan {attempt + 1}...")
                time.sleep(wait_sec)

        # 2. Nếu force_ai=False và Gemini không khả dụng: mới dùng fallback chia đều từ câu thật
        # Đã gọi AI xong: nhả chuỗi prompt lớn và danh sách dòng đã format
        if len(sentences) > 200:
            del prompt, formatted_sentences
            gc.collect()

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
                min_step = 5.0 if total_duration > 30.0 else 1.0
                seg_end = round(max(seg_start + min_step, min(max_allowed, raw_end)), 2)

            if seg_end > total_duration:
                seg_end = total_duration
            if seg_end <= seg_start:
                min_step = 5.0 if total_duration > 30.0 else 1.0
                seg_end = round(min(total_duration, seg_start + min_step), 2)
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

        # Loại bỏ triệt để các phân đoạn ngắn vô nghĩa (< 5s hoặc 1s gây chật chỗ trên timeline)
        clean_segments: List[Dict[str, Any]] = []
        for s in segments_out:
            dur = s["end"] - s["start"]
            if dur < 5.0 and clean_segments and total_duration > 15.0:
                prev = clean_segments[-1]
                prev["end"] = s["end"]
                prev["end_id"] = s["end_id"]
                if prev.get("parts"):
                    prev["parts"][-1]["end"] = s["end"]
            else:
                clean_segments.append(s)

        if len(clean_segments) > 1 and (clean_segments[0]["end"] - clean_segments[0]["start"]) < 5.0 and total_duration > 15.0:
            first = clean_segments.pop(0)
            clean_segments[0]["start"] = first["start"]
            clean_segments[0]["start_id"] = first["start_id"]
            if clean_segments[0].get("parts"):
                clean_segments[0]["parts"][0]["start"] = first["start"]

        for idx, seg in enumerate(clean_segments, start=1):
            seg["id"] = f"seg_ai_{idx:02d}"
            seg["topic_no"] = idx
            if seg.get("parts") and len(seg["parts"]) == 1:
                seg["parts"][0]["start"] = seg["start"]
                seg["parts"][0]["end"] = seg["end"]

        return {
            "video": transcript.video,
            "lesson": lesson_name,
            "mode": "analyzed",
            "reviewed": False,
            "segments": clean_segments
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
