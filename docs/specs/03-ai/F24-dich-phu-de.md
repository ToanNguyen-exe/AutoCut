# F24 — Dịch phụ đề và metadata sang ngôn ngữ khác

| Mục | Giá trị |
|---|---|
| **Mã** | F24 |
| **Nhóm** | AI |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV2 (prompt dịch) + SV3 (API, DB) + SV4 (UI chọn ngôn ngữ) |
| **Phụ thuộc** | F00 (`topicId` ổn định), F23 (cue phụ đề), F21 (tiêu đề, tóm tắt; đọc `llm_max_retries`), F09 (job nền), F15 (`ai_usage`), F19 (từ điển, để giữ nguyên thuật ngữ) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không (dùng Gemini qua `google-genai` có sẵn) |
| **Tham khảo** | YouTube auto-translate, Coursera (phụ đề đa ngôn ngữ), Rask.ai |

> **Cập nhật 18/11/2026:** bổ sung schema để đạt AC: cột `status` cho từng cue, `sentence_ids` liên kết cue với câu nguồn, `warnings` cho track; cue nguồn được chụp lại (snapshot) khi dịch vì F23 không lưu cue; quy trình "dịch lại phần đã đổi" thay cả nhóm cue liền nhau; quyền theo AD-2, chống trùng job theo AD-8.

## 1. Bối cảnh & vấn đề

- Hiện chỉ có một ngôn ngữ: `transcript.language: vi` ([config.yaml:5](../../../config.yaml)).
- Bài giảng CNTT có nhiều thuật ngữ tiếng Anh nằm lẫn trong câu tiếng Việt ("khai báo biến bằng `let`"). Dịch máy thông thường hay dịch nhầm cả thuật ngữ và tên hàm, ví dụ `for` thành "cho".
- Nhiều trường muốn mở khoá học cho sinh viên quốc tế (tiếng Anh), hoặc làm nội dung nội bộ cho đối tác Nhật/Hàn.
- Cue phụ đề của F23 **không được lưu**: mỗi lần gọi API, cue được sinh lại từ transcript. Sau khi transcript được sửa (F32), số lượng và vị trí cue có thể thay đổi. Vì vậy bản dịch không thể chỉ dựa vào `cue_index` của F23, mà phải tự lưu bản chụp cue nguồn kèm danh sách câu (`sentence_id`) mà mỗi cue phủ.

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
- **FR-0 — Chụp cue nguồn.** Khi bắt đầu dịch một ngôn ngữ, gọi `SubtitleService` (F23) sinh cue tiếng Việt cho cả video, rồi lưu vào `subtitle_cues` của track đích: mốc thời gian, `source_text`, và `sentence_ids` (các `sentence_id` mà cue phủ). Từ đây, track dịch chỉ làm việc trên bản chụp này.
- **FR-3** Đầu vào là JSON `[{ "i": 12, "text": "..." }]`, đầu ra là JSON có cùng tập `i`. Thiếu hoặc thừa `i` thì thử lại; sau `segmentation.llm_max_retries` lần (F21 thêm việc đọc khoá này) vẫn sai thì đặt `status='FAILED'` cho cue đó, `text = source_text`, và thêm cảnh báo vào `subtitle_tracks.warnings`.
- **FR-4** Danh sách "giữ nguyên" = thuật ngữ trong từ điển F19 (loại `TERM`) + chuỗi trong backtick + từ dạng `camelCase`/`snake_case`/có dấu chấm (`console.log`).
- **FR-5** Dòng dịch có thể dài hơn tiếng Việt. Sau khi dịch, chạy lại bước chia 2 dòng của F23 (giữ nguyên thời gian). Nếu tốc độ đọc > 20 ký tự/giây thì gắn cảnh báo `READING_SPEED_HIGH`.
- **FR-6** Sửa tay một cue → `edited=true`. Khi dịch lại cả video, cue `edited` không bị ghi đè.
- **FR-7** Khi một câu transcript đổi chữ hoặc bị cắt (F32), mọi cue dịch có `sentence_ids` chứa câu đó được đặt `status='STALE'`. Giao diện hiện nút "Dịch lại phần đã đổi".
- **FR-8 — Dịch lại phần đã đổi.** Với mỗi nhóm cue `STALE` liền nhau: lấy tập câu mà nhóm phủ, sinh lại cue tiếng Việt cho đúng khoảng thời gian đó bằng F23, **xoá nhóm cue cũ và chèn nhóm cue mới**, đánh lại `cue_index` cho cả track trong cùng transaction, rồi dịch các cue mới. Cue `edited=true` nằm trong nhóm bị thay thì giữ lại bản sửa tay trong `warnings` để người dùng tự đối chiếu.

## 5. Yêu cầu phi chức năng

- Video 60 phút (~900 cue) dịch xong ≤ 3 phút.
- Ghi lại token dùng cho mỗi ngôn ngữ (F15).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_translations.sql`:
```sql
CREATE TABLE IF NOT EXISTS subtitle_tracks (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    lang VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
    source_hash VARCHAR(64) NOT NULL,                -- hash transcript nguồn lúc chụp cue
    model VARCHAR(50),
    warnings JSONB NOT NULL DEFAULT '[]',            -- [{"code":"CUE_FAILED","cueIndex":15,"message":"..."}]
    last_job_id BIGINT,                              -- job F09 gần nhất
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_track UNIQUE (video_id, lang)
);
CREATE TABLE IF NOT EXISTS subtitle_cues (
    id BIGSERIAL PRIMARY KEY,
    track_id BIGINT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
    cue_index INTEGER NOT NULL,
    start_time DOUBLE PRECISION NOT NULL,
    end_time DOUBLE PRECISION NOT NULL,
    sentence_ids TEXT[] NOT NULL,                   -- {'S0099','S0100'}: câu nguồn mà cue phủ
    source_text TEXT NOT NULL,
    text TEXT,                                       -- NULL khi chưa dịch
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','DONE','FAILED','STALE')),
    edited BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_cue UNIQUE (track_id, cue_index) DEFERRABLE INITIALLY DEFERRED  -- cho phép đánh lại số (FR-8)
);
CREATE INDEX IF NOT EXISTS idx_cues_sentence_ids ON subtitle_cues USING GIN (sentence_ids);
CREATE TABLE IF NOT EXISTS topic_translations (
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    lang VARCHAR(10) NOT NULL,
    title VARCHAR(255), summary TEXT, key_points JSONB,
    edited BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (topic_id, lang)
);
```
`topic_translations` dùng `ON DELETE CASCADE` an toàn vì topic không bị xoá cứng khi Lưu (F00, AD-6).

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos/{videoId}/translations` | Sửa video | `{ "langs": ["en","ja"] }` → `202 { "jobIds": [...] }` |
| GET | `/api/v1/videos/{videoId}/translations` | Xem video | Danh sách track + trạng thái + `warnings` + số cue theo từng `status` |
| GET | `/api/v1/videos/{videoId}/subtitles?format=srt&lang=en` | Xem video | Mở rộng API F23. Link chia sẻ dùng `/api/v1/share/{token}/subtitles?lang=en` (AD-5) |
| PATCH | `/api/v1/subtitle-cues/{cueId}` | Sửa video chứa cue | `{ "text": "..." }` → `edited=true`, `status='DONE'` |
| POST | `/api/v1/videos/{videoId}/translations/{lang}:refresh-stale` | Sửa video | FR-8 → `202 { "jobId": … }` |

Không có quyền xem thì trả 404, xem được nhưng không sửa được thì 403 `FORBIDDEN_ACTION` (AD-2). Đã có job `TRANSLATE` đang chạy cho cùng `(videoId, lang)` thì trả lại `jobId` đó, không tạo job thứ hai (chống trùng bằng `INSERT … ON CONFLICT` trên khoá `translate:{videoId}:{lang}` của F09, AD-8).

### 6.3 Backend (Spring Boot)

- `service/TranslationService.java`: là handler job `TRANSLATE` (F09). Tạo track, chụp cue theo FR-0, ghi tệp vào thư mục làm việc của job (F17) `translate_<lang>_in.json`, gọi `python -m backend.ai.cli --translate --lang en --input ... --output ...` qua job runner của F10, rồi nạp kết quả vào DB. Khi nạp, **không** ghi đè cue `edited=true`.
- `TranscriptEditService` (F32) sau khi lưu chỉnh sửa câu gọi `TranslationService.markStale(videoId, changedSentenceIds)`: `UPDATE subtitle_cues SET status='STALE' WHERE track_id IN (…) AND sentence_ids && :ids`.
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
- Dùng `_generate_with_fallback` của `TranscriptRefiner` (dòng 70), hàm này đã bật JSON mode. In `@@USAGE {json}` cho mỗi lần gọi để ghi `ai_usage` (F15).

### 6.5 Frontend (Next.js)

- Popup "Dịch phụ đề" trong menu Xuất: chọn ngôn ngữ, xem tiến độ từng track.
- `TranscriptScenesPanel.tsx`: thêm bộ chọn ngôn ngữ hiển thị; chế độ "song ngữ" hiện hai cột Việt / đích, sửa được cột đích.
- `VideoPlayerPreview.tsx`: menu CC liệt kê các ngôn ngữ.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* 900 cue tiếng Việt. *When* dịch sang `en`. *Then* track có đúng 900 cue với `start/end` trùng khớp bản gốc.
- **AC-2** — *Given* cue "Dùng console.log để in biến i". *Then* bản dịch chứa nguyên chuỗi `console.log`.
- **AC-3** — *Given* LLM trả thiếu `i=15` cả 3 lần. *Then* cue 15 có `status='FAILED'`, `text = source_text`; track vẫn `DONE` và `warnings` chứa `{"code":"CUE_FAILED","cueIndex":15}`.
- **AC-4** — *Given* cue 20 đã sửa tay. *When* dịch lại cả video. *Then* cue 20 giữ nguyên.
- **AC-5** — *Given* sửa câu S0100 ở transcript gốc. *Then* đúng các cue dịch có `'S0100' = ANY(sentence_ids)` chuyển `status='STALE'`, các cue khác giữ nguyên.
- **AC-5b** — *Given* 3 cue liền nhau `STALE`. *When* chạy `refresh-stale`. *Then* 3 cue được thay bằng cue mới sinh từ transcript đã sửa (số lượng có thể khác 3), `cue_index` của cả track liên tục từ 1, và các cue ngoài nhóm giữ nguyên `text`.
- **AC-7** — Người không có quyền xem video gọi `GET …/translations` thì nhận 404.
- **AC-6** — Chất lượng: người song ngữ chấm 50 cue ngẫu nhiên. ≥ 85% đạt "đúng nghĩa, tự nhiên"; 0 cue dịch sai thuật ngữ có trong từ điển.

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f24_translate.py`):
- `test_protect_and_restore_terms_roundtrip()`
- `test_protect_terms_detects_dotted_and_camelcase_identifiers()`
- `test_translate_cues_preserves_count_and_times()` (mock LLM)
- `test_translate_cues_missing_index_retries_then_marks_failed()`
- `test_context_cues_not_included_in_output()`
- `test_usage_line_printed_per_call()`

JUnit:
- `TranslationServiceTest.import_keepsEditedCues()`
- `TranslationServiceTest.sourceChange_marksOverlappingCuesStale()` (AC-5)
- `TranslationServiceTest.snapshot_storesSentenceIdsPerCue()` (FR-0)
- `TranslationServiceTest.refreshStale_replacesRunAndRenumbers()` (AC-5b)
- `TranslationServiceTest.missingIndex_marksCueFailedAndAddsWarning()` (AC-3)
- `TranslationControllerTest.duplicateRequest_returnsExistingJob()` (AD-8)
- `SubtitleServiceTest.toSrt_lang_en_readsFromCues()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| LLM gộp hai cue thành một | Lệch thời gian | Ép đúng tập `i`, nếu sai thì thử lại |
| Sửa transcript nhiều lần làm cue tiếng Việt lệch so với bản chụp | Phụ đề dịch lệch thời gian | FR-7, FR-8: chỉ thay nhóm cue bị ảnh hưởng, theo `sentence_ids` |
| Bản dịch quá dài so với thời lượng cue | Không kịp đọc | Cảnh báo `READING_SPEED_HIGH`; prompt yêu cầu "ngắn gọn" |
| Chi phí khi dịch nhiều ngôn ngữ | Tốn tiền | Giới hạn theo gói (F49); hiện ước tính token trước khi chạy |

## 10. Câu hỏi mở

- [ ] Danh sách ngôn ngữ cho bản đầu tiên: chỉ `en` hay thêm `ja`, `ko`?
- [ ] Có cần người duyệt bản dịch (F35) trước khi công khai không?
