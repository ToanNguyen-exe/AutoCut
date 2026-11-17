# F24 — Dịch phụ đề và metadata sang ngôn ngữ khác

| Mục | Giá trị |
|---|---|
| **Mã** | F24 |
| **Nhóm** | AI |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV2 (prompt dịch) + SV3 (API, DB) + SV4 (UI chọn ngôn ngữ) |
| **Phụ thuộc** | F23 (cue phụ đề), F21 (tiêu đề và tóm tắt), F09 (job nền), F19 (từ điển, để giữ nguyên thuật ngữ) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không (dùng Gemini qua `google-genai` có sẵn) |
| **Tham khảo** | YouTube auto-translate, Coursera (phụ đề đa ngôn ngữ), Rask.ai |

## 1. Bối cảnh & vấn đề

- Hiện chỉ có một ngôn ngữ: `transcript.language: vi` ([config.yaml:5](../../../config.yaml)).
- Bài giảng CNTT có nhiều thuật ngữ tiếng Anh nằm lẫn trong câu tiếng Việt ("khai báo biến bằng `let`"). Dịch máy thông thường hay dịch nhầm cả thuật ngữ và tên hàm, ví dụ `for` thành "cho".
- Nhiều trường muốn mở khoá học cho sinh viên quốc tế (tiếng Anh), hoặc làm nội dung nội bộ cho đối tác Nhật/Hàn.

## 2. Mục tiêu

- Dịch **cue phụ đề** (F23) và **metadata** (F21: title, summary, key_points) sang ngôn ngữ đích: ban đầu `en`, sau đó `ja`, `ko`, `zh`.
- Giữ nguyên **mốc thời gian** và **số lượng cue**: dịch 1–1, không gộp, không tách.
- Không dịch code, tên hàm, thuật ngữ trong từ điển (F19) được đánh dấu "giữ nguyên".
- Có thể sửa tay bản dịch.

### Ngoài phạm vi

- Lồng tiếng AI (dubbing).
- Dịch ngược từ ngôn ngữ khác sang tiếng Việt (nguồn vẫn là tiếng Việt).

## 3. User stories

- Là giảng viên, tôi muốn tải `en.srt` cho bài giảng để sinh viên trao đổi đọc được.
- Là biên tập viên, tôi muốn sửa một câu dịch sai mà không phải dịch lại cả video.

## 4. Yêu cầu chức năng

- **FR-1** Người dùng chọn 1..n ngôn ngữ đích. Mỗi ngôn ngữ chạy thành một job `TRANSLATE` riêng.
- **FR-2** Dịch theo lô 40 cue mỗi lần gọi LLM. Mỗi lô gửi kèm **5 cue trước và 5 cue sau làm ngữ cảnh** (đánh dấu "không dịch") để câu bị ngắt giữa hai cue vẫn dịch mạch lạc.
- **FR-3** Đầu vào là JSON `[{ "i": 12, "text": "..." }]`, đầu ra là JSON có cùng tập `i`. Thiếu hoặc thừa `i` thì thử lại; sau `llm_max_retries` lần vẫn sai thì đánh `FAILED` cho cue đó và giữ nguyên văn tiếng Việt.
- **FR-4** Danh sách "giữ nguyên" = thuật ngữ trong từ điển F19 (loại `TERM`) + chuỗi trong backtick + từ dạng `camelCase`/`snake_case`/có dấu chấm (`console.log`).
- **FR-5** Dòng dịch có thể dài hơn tiếng Việt. Sau khi dịch, chạy lại bước chia 2 dòng của F23 (giữ nguyên thời gian). Nếu tốc độ đọc > 20 ký tự/giây thì gắn cảnh báo `READING_SPEED_HIGH`.
- **FR-6** Sửa tay một cue → `edited=true`. Khi dịch lại cả video, cue `edited` không bị ghi đè.
- **FR-7** Khi transcript gốc đổi (F32), các cue dịch tương ứng được đánh dấu `stale=true` và UI hiện nút "Dịch lại phần đã đổi".

## 5. Yêu cầu phi chức năng

- Video 60 phút (~900 cue) dịch xong ≤ 3 phút.
- Ghi lại token dùng cho mỗi ngôn ngữ (F15).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_translations.sql`:
```sql
CREATE TABLE subtitle_tracks (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    lang VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',   -- PENDING|RUNNING|DONE|FAILED
    source_hash VARCHAR(64) NOT NULL,                -- hash transcript nguồn lúc dịch
    model VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_track UNIQUE (video_id, lang)
);
CREATE TABLE subtitle_cues (
    id BIGSERIAL PRIMARY KEY,
    track_id BIGINT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
    cue_index INTEGER NOT NULL,
    start_time DOUBLE PRECISION NOT NULL,
    end_time DOUBLE PRECISION NOT NULL,
    source_text TEXT NOT NULL,
    text TEXT NOT NULL,
    edited BOOLEAN NOT NULL DEFAULT FALSE,
    stale BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_cue UNIQUE (track_id, cue_index)
);
CREATE TABLE topic_translations (
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    lang VARCHAR(10) NOT NULL,
    title VARCHAR(255), summary TEXT, key_points JSONB,
    PRIMARY KEY (topic_id, lang)
);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos/{id}/translations` | Chủ video | `{ "langs": ["en","ja"] }` → `202 { "jobIds": [...] }` |
| GET | `/api/v1/videos/{id}/translations` | Chủ video | Danh sách track + trạng thái |
| GET | `/api/v1/videos/{id}/subtitles?format=srt&lang=en` | Chủ video / chia sẻ | Mở rộng API F23 |
| PATCH | `/api/v1/subtitle-cues/{cueId}` | Chủ video | `{ "text": "..." }` |
| POST | `/api/v1/videos/{id}/translations/{lang}:refresh-stale` | Chủ video | Chỉ dịch lại cue `stale` |

### 6.3 Backend (Spring Boot)

- `service/TranslationService.java`: tạo track, chụp danh sách cue từ `SubtitleService` (F23), ghi tệp `cache/<hash>/translate_<lang>_in.json`, gọi `python -m backend.ai.cli --translate --lang en --input ... --output ...` trong job F09, rồi nạp kết quả vào DB.
- `controller/TranslationController.java`.
- `SubtitleService` (F23): nhận tham số `lang`. `vi` lấy từ transcript, ngôn ngữ khác lấy từ `subtitle_cues`.

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/translator.py`:
  ```python
  def translate_cues(cues: list[Cue], target_lang: str, keep_terms: list[str], batch_size: int = 40) -> list[TranslatedCue]: ...
  def protect_terms(text: str, keep_terms: list[str]) -> tuple[str, dict[str, str]]: ...  # thay bằng ⟦T1⟧
  def restore_terms(text: str, mapping: dict[str, str]) -> str: ...
  ```
  `protect_terms` thay thuật ngữ bằng token giữ chỗ trước khi gửi, `restore_terms` trả lại sau khi nhận. Cách này giữ thuật ngữ an toàn hơn so với chỉ dặn trong prompt.
- Khung prompt:
  ```
  Dịch các phụ đề bài giảng sau từ tiếng Việt sang {lang_name}. Giữ nguyên mọi token ⟦Tn⟧.
  Văn phong nói, ngắn gọn. Trả JSON {"items":[{"i":..,"text":..}]} với ĐÚNG các i được yêu cầu.
  NGỮ CẢNH (không dịch): ...
  CẦN DỊCH: ...
  ```
- Dùng `_generate_with_fallback` của `TranscriptRefiner` (dòng 70) và JSON mode.

### 6.5 Frontend (Next.js)

- Popup "Dịch phụ đề" trong menu Xuất: chọn ngôn ngữ, xem tiến độ từng track.
- `TranscriptScenesPanel.tsx`: thêm bộ chọn ngôn ngữ hiển thị; chế độ "song ngữ" hiện hai cột Việt / đích, sửa được cột đích.
- `VideoPlayerPreview.tsx`: menu CC liệt kê các ngôn ngữ.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* 900 cue tiếng Việt. *When* dịch sang `en`. *Then* track có đúng 900 cue với `start/end` trùng khớp bản gốc.
- **AC-2** — *Given* cue "Dùng console.log để in biến i". *Then* bản dịch chứa nguyên chuỗi `console.log`.
- **AC-3** — *Given* LLM trả thiếu `i=15` cả 3 lần. *Then* cue 15 giữ text tiếng Việt, status cue là `FAILED`, track vẫn `DONE` kèm cảnh báo.
- **AC-4** — *Given* cue 20 đã sửa tay. *When* dịch lại cả video. *Then* cue 20 giữ nguyên.
- **AC-5** — *Given* sửa câu S0100 ở transcript gốc. *Then* các cue dịch phủ S0100 có `stale=true`.
- **AC-6** — Chất lượng: người song ngữ chấm 50 cue ngẫu nhiên. ≥ 85% đạt "đúng nghĩa, tự nhiên"; 0 cue dịch sai thuật ngữ có trong từ điển.

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f24_translate.py`):
- `test_protect_and_restore_terms_roundtrip()`
- `test_protect_terms_detects_dotted_and_camelcase_identifiers()`
- `test_translate_cues_preserves_count_and_times()` (mock LLM)
- `test_translate_cues_missing_index_retries_then_marks_failed()`
- `test_context_cues_not_included_in_output()`

JUnit:
- `TranslationServiceTest.import_keepsEditedCues()`
- `TranslationServiceTest.sourceChange_marksOverlappingCuesStale()`
- `SubtitleServiceTest.toSrt_lang_en_readsFromCues()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| LLM gộp hai cue thành một | Lệch thời gian | Ép đúng tập `i`, nếu sai thì thử lại |
| Bản dịch quá dài so với thời lượng cue | Không kịp đọc | Cảnh báo `READING_SPEED_HIGH`; prompt yêu cầu "ngắn gọn" |
| Chi phí khi dịch nhiều ngôn ngữ | Tốn tiền | Giới hạn theo gói (F49); hiện ước tính token trước khi chạy |

## 10. Câu hỏi mở

- [ ] Danh sách ngôn ngữ cho bản đầu tiên: chỉ `en` hay thêm `ja`, `ko`?
- [ ] Có cần người duyệt bản dịch (F35) trước khi công khai không?
