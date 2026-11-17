# F27 — AI học từ chỉnh sửa của người dùng

| Mục | Giá trị |
|---|---|
| **Mã** | F27 |
| **Nhóm** | AI |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (ghi nhận chỉnh sửa, thống kê) + SV2 (dùng lại trong prompt, gợi ý từ điển) |
| **Phụ thuộc** | F13, F18 (confidence), F19 (từ điển), F33 (lịch sử phiên bản), F32 (sửa transcript) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Descript (gợi ý sửa chính tả từ lịch sử), Otter.ai (học từ vựng), Grammarly "personal dictionary" |

## 1. Bối cảnh & vấn đề

- Khi người dùng lưu, `SegmentPersistenceService.saveSegmentsToDatabase` **xoá toàn bộ section cũ** rồi ghi mới ([SegmentPersistenceService.java:87-92](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L87)). Vì vậy hệ thống không còn biết **AI đề xuất gì** và **người dùng đã sửa gì**, nên mọi tín hiệu học bị mất.
- Bản LLM thô chỉ được ghi đè vào một tệp duy nhất `cache/llm_raw.json` ([transcript_refiner.py:414](../../../backend/ai/transcript_refiner.py)), dùng chung cho mọi video, và lỗi bị nuốt bằng `except Exception: pass` (dòng 418). Cách làm này vi phạm CONSTRAINTS §2.
- Các tham số `pause_threshold`, `cue_phrases` ([config.yaml:31-40](../../../config.yaml)) dùng chung cho tất cả giảng viên, trong khi mỗi người có thói quen nói khác nhau ("ok giờ mình qua…", "rồi, bây giờ…").

## 2. Mục tiêu

1. **Ghi nhận:** lưu bản AI đề xuất lần đầu (snapshot) và bản người dùng chốt; tính chênh lệch (diff) cho từng biên và tiêu đề.
2. **Đo:** chỉ số "tỉ lệ biên phải sửa" theo video, theo người dùng, theo phiên bản prompt. Đây là thước đo chính cho mọi thay đổi AI.
3. **Học, mức 1 (không cần huấn luyện):**
   - Tự đề xuất **cue phrase cá nhân**: cụm từ mở đầu những câu mà người dùng hay kéo biên tới.
   - Tự đề xuất **mục từ điển** (F19) từ các lần sửa transcript lặp lại (F32).
   - Đưa **ví dụ mẫu** (few-shot) từ 2–3 lần sửa gần nhất của chính người dùng vào prompt phân đoạn.
   - Tinh chỉnh `pause_threshold` cá nhân theo phân phối khoảng lặng tại các biên đã chốt.

### Ngoài phạm vi

- Fine-tune LLM hay Whisper.
- Học chéo giữa các người dùng hay tổ chức (vấn đề quyền riêng tư). Chỉ học trong phạm vi một người dùng.

## 3. User stories

- Là giảng viên, sau 5 video tôi muốn AI cắt đúng thói quen "Ok, giờ mình qua phần…" của tôi mà không phải cấu hình gì.
- Là trưởng nhóm, tôi muốn thấy prompt phiên bản mới có thật sự giảm số lần phải sửa hay không.

## 4. Yêu cầu chức năng

- **FR-1** Sau analyze, lưu `ai_suggestions` (JSON segments đầy đủ + `prompt_version` + `model`) cho video. Mỗi lần analyze lại tạo một bản ghi mới.
- **FR-2** Khi video chuyển sang trạng thái "Đã duyệt" (F35), hoặc khi người dùng bấm Lưu mà chưa có F35, tính `edit_events`:
  - `BOUNDARY_MOVED`: so khớp topic AI ↔ topic chốt bằng **độ chồng lấp thời gian lớn nhất**. Ghi `delta_seconds` cho biên đầu và cuối.
  - `TOPIC_SPLIT`, `TOPIC_MERGED`, `TOPIC_DELETED`, `TOPIC_ADDED`.
  - `TITLE_EDITED` (lưu cả tiêu đề cũ và mới).
  - `TRANSCRIPT_EDITED` (từ F32: câu cũ và câu mới).
- **FR-3** Chỉ số: `boundary_edit_rate = số biên |delta| > 3s / tổng biên nội bộ`. Tính theo video, rồi gộp theo người dùng và theo `prompt_version`.
- **FR-4 Cue phrase cá nhân:** với các biên đã chốt mà người dùng phải dời (`|delta| > 3s`), lấy 1–4 từ đầu của câu bắt đầu tại biên mới. Đếm tần suất; cụm nào xuất hiện ≥ 3 lần trên ≥ 2 video thì **đề xuất** (không tự thêm) vào `user_cue_phrases`.
- **FR-5 Từ điển:** cặp (từ sai → từ đúng) xuất hiện ≥ 3 lần trong `TRANSCRIPT_EDITED` thì đề xuất thêm quy tắc sửa vào F19.
- **FR-6 Few-shot:** prompt phân đoạn có thêm khối "VÍ DỤ CÁCH NGƯỜI DÙNG NÀY CHIA ĐOẠN" lấy từ 2 video đã duyệt gần nhất. Mỗi ví dụ ≤ 1.500 ký tự (danh sách tiêu đề + câu mở đầu của mỗi topic). Bật/tắt bằng `ai_learning.few_shot`.
- **FR-7 Pause threshold cá nhân:** trung vị của khoảng lặng tại các biên đã chốt, kẹp trong `[0.8, 3.0]`. Chỉ áp dụng khi có ≥ 30 biên.
- **FR-8** Người dùng xem và quản lý "Những gì AI đã học": danh sách cue phrase và quy tắc, bấm Chấp nhận / Bỏ qua; có nút "Xoá dữ liệu học".
- **FR-9** Sửa lỗi ghi `llm_raw.json`: ghi theo đường dẫn `cache/<hash>/llm_raw.json`, lỗi thì `logger.warning`, không `pass`.

## 5. Yêu cầu phi chức năng

- Tính diff ≤ 200ms cho 50 topic.
- Dữ liệu học thuộc về người dùng. Khi xoá tài khoản thì xoá hết dữ liệu học.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_ai_learning.sql`:
```sql
CREATE TABLE ai_suggestions (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    prompt_version VARCHAR(20) NOT NULL,
    model VARCHAR(50),
    segments_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE edit_events (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    suggestion_id BIGINT REFERENCES ai_suggestions(id) ON DELETE SET NULL,
    event_type VARCHAR(30) NOT NULL,
    delta_seconds DOUBLE PRECISION,
    before_value TEXT,
    after_value TEXT,
    at_sentence_id VARCHAR(10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_edit_events_user ON edit_events(user_id, event_type);
CREATE TABLE user_ai_profile (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cue_phrases TEXT[] NOT NULL DEFAULT '{}',
    pause_threshold DOUBLE PRECISION,
    few_shot_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE ai_learning_suggestions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,      -- CUE_PHRASE|GLOSSARY
    payload JSONB NOT NULL,         -- {"phrase":"ok giờ mình qua"} | {"from":"giao va","to":"Java"}
    support_count INTEGER NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'PENDING' -- PENDING|ACCEPTED|DISMISSED
);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/me/ai-learning` | Đăng nhập | Profile + đề xuất đang chờ |
| POST | `/api/v1/me/ai-learning/suggestions/{id}:accept` | Đăng nhập | Chấp nhận (ghi vào profile hoặc F19) |
| POST | `/api/v1/me/ai-learning/suggestions/{id}:dismiss` | Đăng nhập | Bỏ qua |
| DELETE | `/api/v1/me/ai-learning` | Đăng nhập | Xoá toàn bộ dữ liệu học |
| GET | `/api/v1/admin/ai-quality?groupBy=prompt_version` | Admin | Thống kê `boundary_edit_rate` |

```json
// GET /api/v1/admin/ai-quality?groupBy=prompt_version
[ { "promptVersion": "seg-v3", "videos": 41, "boundaryEditRate": 0.27 },
  { "promptVersion": "seg-v4", "videos": 18, "boundaryEditRate": 0.19 } ]
```

### 6.3 Backend (Spring Boot)

- `service/EditDiffService.java` (hàm thuần): `List<EditEvent> diff(List<Segment> ai, List<Segment> fin)`.
- `service/LearningService.java`: tính FR-4, FR-5, FR-7 theo lịch (`@Scheduled` hằng đêm) hoặc ngay sau khi duyệt.
- Gắn vào luồng lưu: trước khi `saveSegmentsToDatabase` xoá dữ liệu cũ, gọi `EditDiffService` so với `ai_suggestions` mới nhất.
- Khi gọi Python analyze: truyền `--user-profile <json>` gồm cue phrases, pause threshold và few-shot examples. Java cũng dùng `pause_threshold` cá nhân trong `CutPointService` (ưu tiên hơn `ConfigService.getPauseThreshold()`).

### 6.4 AI pipeline (Python)

- `transcript_refiner.py`: thêm hằng `PROMPT_VERSION = "seg-v4"` và trả kèm trong `segments_data`. Mỗi lần sửa prompt **bắt buộc** tăng phiên bản.
- `segment_transcript(..., few_shot_examples: list[str] | None = None)`: chèn khối FR-6 trước "DANH SÁCH CÂU TRANSCRIPT" (dòng ~398).
- Sửa FR-9 tại dòng 412–419.

### 6.5 Frontend (Next.js)

- `AccountModal.tsx`: tab "AI của tôi" với danh sách đề xuất (Chấp nhận / Bỏ qua), các cue phrase đã học, công tắc few-shot, nút "Xoá dữ liệu học".
- Trang quản trị (khi có): bảng chất lượng theo `prompt_version`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* AI đề xuất biên ở 412s, người dùng chốt 405s. *When* duyệt. *Then* có `edit_events` loại `BOUNDARY_MOVED` với `delta_seconds = -7`.
- **AC-2** — *Given* 3 video, mỗi video có ≥ 1 lần người dùng dời biên tới câu bắt đầu bằng "ok giờ mình qua". *Then* có đề xuất `CUE_PHRASE` với `support_count ≥ 3`.
- **AC-3** — *Given* đề xuất được chấp nhận. *When* analyze video mới. *Then* `calculateCutPoints` cộng điểm cue cho cụm đó (kiểm qua `reasons`).
- **AC-4** — *Given* few-shot bật và có 2 video đã duyệt. *Then* prompt gửi đi chứa khối ví dụ ≤ 3.000 ký tự (kiểm qua log debug).
- **AC-5** — Thử nghiệm A/B trên ≥ 10 video của cùng 1 giảng viên: bật F27 làm `boundary_edit_rate` giảm ≥ 15% tương đối.
- **AC-6** — Gọi `DELETE /me/ai-learning` thì `edit_events` của người dùng, `user_ai_profile` và các đề xuất đều bị xoá; `ai_suggestions` (thuộc video) vẫn giữ.

## 8. Kế hoạch kiểm thử (TDD)

JUnit:
- `EditDiffServiceTest.diff_boundaryMoved_recordsDelta()`
- `EditDiffServiceTest.diff_splitTopic_detectsSplit()`
- `EditDiffServiceTest.diff_mergedTopics_detectsMerge()`
- `EditDiffServiceTest.diff_titleChanged_recordsBeforeAfter()`
- `LearningServiceTest.cuePhrase_requiresThreeSupportsAcrossTwoVideos()`
- `LearningServiceTest.pauseThreshold_clampedAndRequires30Boundaries()`
- `CutPointServiceTest.userCuePhrases_areScored()`

pytest:
- `test_segment_prompt_includes_few_shot_block_when_given()`
- `test_segment_output_contains_prompt_version()`
- `test_llm_raw_written_per_hash_and_logs_on_error()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Học từ lần sửa sai hoặc vội | AI tệ đi | Chỉ học khi video ở trạng thái "Đã duyệt"; mọi đề xuất phải được chấp nhận thủ công |
| Few-shot làm prompt quá dài | Tốn token, vượt `max_llm_chars` | Giới hạn 3.000 ký tự; tắt khi transcript > 80% giới hạn |
| So khớp topic AI ↔ chốt sai khi cấu trúc đổi nhiều | Thống kê nhiễu | Chỉ ghi `BOUNDARY_MOVED` khi độ chồng lấp ≥ 50% |

## 10. Câu hỏi mở

- [ ] Có cho học ở cấp tổ chức (khi đã có F49) không, và cần những đồng ý gì từ người dùng?
- [ ] Ai chịu trách nhiệm tăng `PROMPT_VERSION` (quy trình review prompt)?
