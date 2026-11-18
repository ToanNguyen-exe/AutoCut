# F21 — AI sinh tiêu đề, tóm tắt, từ khoá cho từng clip

| Mục | Giá trị |
|---|---|
| **Mã** | F21 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (prompt, Python) + SV3 (API, DB) + SV4 (UI) |
| **Phụ thuộc** | **F00** (analyze ghi topic vào DB, `topicId` ổn định, lưu bằng upsert), F07 (khoá AI phía máy chủ), F09 + F10 (job nền), F13, F15 (bảng `ai_usage`) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không (dùng `google-genai` đã có trong `requirements.txt`) |
| **Tham khảo** | YouTube Studio (gợi ý tiêu đề), Descript "Show notes", Opus Clip (tiêu đề + hashtag) |

> **Cập nhật 18/11/2026:** job chỉ chạy sau khi analyze đã ghi topic vào DB (F00 FR-4) và dùng `topicId` số; metadata nằm trên cột của `topics`, không mất khi Lưu (upsert, AD-6); sửa tiêu đề qua `PUT /segments` cũng khoá trường; ghi rõ `llm_max_retries` hiện chưa được code nào đọc; token lấy từ `response.usage_metadata` và ghi vào `ai_usage` (F15); sinh cho 1 topic cũng là job (AD-10); quyền theo AD-2.

## 1. Bối cảnh & vấn đề

- LLM phân đoạn ([transcript_refiner.py:337](../../../backend/ai/transcript_refiner.py)) chỉ trả `title` và `slug` cho mỗi topic ([models.py:41](../../../backend/ai/models.py) `Topic`). Không có mô tả, không có từ khoá.
- Tiêu đề được sinh **cùng lúc** với việc chia đoạn, trong một prompt rất dài chứa toàn bộ transcript. Vì vậy tiêu đề thường chung chung, và khi người dùng sửa biên đoạn thì tiêu đề không được cập nhật theo.
- Bảng `topics` ([schema.sql](../../../database/schema.sql), bảng 5) chỉ có `title`, `slug`. Khi xuất bản (F40–F42) không có mô tả để đăng YouTube hay LMS.
- `SegmentDetailModal.tsx` ([dòng 30](../../../frontend/src/components/SegmentDetailModal.tsx)) chỉ hiển thị transcript của đoạn, chưa có tóm tắt.
- Hiện endpoint analyze ([VideoController.java:713-868](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L713)) **không ghi DB**; topic chỉ được ghi khi gọi `/save`, và mỗi lần ghi lại xoá rồi tạo lại toàn bộ ([SegmentPersistenceService.java:87-92](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L87-L92)). Spec này vì vậy **bắt buộc** làm sau F00: F00 cho analyze ghi topic ngay và đổi việc lưu sang upsert, nên các cột metadata trên `topics` không bị xoá khi người dùng bấm Lưu.
- `config.yaml` có `segmentation.llm_max_retries` và `max_llm_chars` ([config.yaml:15-16](../../../config.yaml)) nhưng hiện **không có code nào đọc** hai khoá này (`config_loader.py` không ánh xạ chúng).

## 2. Mục tiêu

Với mỗi topic, sinh **sau** khi phân đoạn xong (hoặc khi người dùng yêu cầu):
- `title`: ≤ 70 ký tự, tiếng Việt có dấu, nêu rõ kiến thức chính.
- `summary`: 2–4 câu, ≤ 400 ký tự.
- `key_points`: 3–5 gạch đầu dòng.
- `keywords`: 3–8 từ khoá, thường viết thường, không có dấu `#`.

### Ngoài phạm vi

- Sinh câu hỏi trắc nghiệm (F29), ảnh bìa (F43), dịch (F24).

## 3. User stories

- Là giảng viên, tôi muốn mỗi clip có tiêu đề và mô tả sẵn để đăng lên YouTube hoặc LMS mà không phải viết tay 20 lần.
- Là biên tập viên, sau khi kéo biên một đoạn, tôi muốn bấm "Viết lại" để tiêu đề khớp với nội dung mới.
- Là giảng viên, tôi không muốn AI ghi đè tiêu đề tôi đã tự sửa.

## 4. Yêu cầu chức năng

- **FR-1** Sau khi job analyze ghi topic vào DB thành công (F00 FR-4), tự xếp một job `GENERATE_METADATA` (F09) cho video, với `payload = { "videoId": 42, "topicIds": [1187, 1188, …] }`. Job chạy theo lô 5 topic mỗi lần gọi LLM, và bỏ qua topic `DISCARDED`.
- **FR-2** Đầu vào cho mỗi topic: tiêu đề bài học (lesson), label section, transcript của topic (tối đa 12.000 ký tự; nếu dài hơn thì lấy 6.000 ký tự đầu và 6.000 ký tự cuối) và tiêu đề của topic liền trước, liền sau (để tránh trùng).
- **FR-3** Đầu ra là JSON **được kiểm tra bằng Pydantic**. Sai schema thì thử lại tối đa `segmentation.llm_max_retries` lần (khoá có trong [config.yaml:15](../../../config.yaml) nhưng chưa được đọc: spec này thêm việc đọc khoá vào `config_loader.py`, mặc định 2); vẫn lỗi thì giữ nguyên tiêu đề cũ và đặt `metadata_status = FAILED`.
- **FR-4** Mỗi trường nằm trong danh sách `locked_fields`. Người dùng sửa tay trường nào thì trường đó bị khoá, AI không ghi đè nữa. Sửa tay gồm cả `PATCH …/metadata` lẫn đổi `topic` (tiêu đề) trong `PUT /api/v1/videos/{videoId}/segments` của F00: khi upsert thấy tiêu đề khác giá trị trong DB và `origin=USER`, thêm `title` vào `locked_fields`.
- **FR-4b** Upsert của F00 **không** đụng tới các cột metadata (`summary`, `key_points`, `keywords`, `locked_fields`, `metadata_*`). Gộp hai topic thì topic giữ lại (bên trái) giữ metadata của nó và đặt `metadata_status = STALE`; tách topic thì nửa mới có `metadata_status = NONE`.
- **FR-5** Nút "Viết lại bằng AI" cho từng topic và cho cả video; có tuỳ chọn giọng văn: `trang_trong` (mặc định), `than_thien`, `ngan_gon`.
- **FR-6** `slug` được sinh lại từ `title` bằng `slugify_vi` ([transcript_refiner.py:40](../../../backend/ai/transcript_refiner.py)) chỉ khi `slug` chưa bị khoá và clip **chưa được render** (tên tệp đã xuất không được đổi).
- **FR-7** Ghi lại số token và model đã dùng cho mỗi lần gọi vào bảng `ai_usage` (F15). `_generate_with_fallback` ([transcript_refiner.py:70](../../../backend/ai/transcript_refiner.py)) đã trả về nguyên đối tượng response của Gemini, nên đọc `response.usage_metadata.prompt_token_count` và `candidates_token_count` cùng `self.model_name` (model thực sự đã dùng sau khi chuyển dự phòng). Python in dòng `@@USAGE {json}`; job runner (F10) ghi vào `ai_usage`.

## 5. Yêu cầu phi chức năng

- Video 20 topic sinh xong ≤ 60s (4 lô chạy song song tối đa 2).
- Prompt phải yêu cầu "chỉ dựa vào transcript, không bịa thông tin". Chỉ báo chất lượng ở AC-5.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__add_topic_metadata.sql`:
```sql
ALTER TABLE topics ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS key_points JSONB;     -- ["...","..."]
ALTER TABLE topics ADD COLUMN IF NOT EXISTS keywords TEXT[];
ALTER TABLE topics ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}';  -- {'title','summary'}
ALTER TABLE topics ADD COLUMN IF NOT EXISTS metadata_status VARCHAR(20) NOT NULL DEFAULT 'NONE'
  CHECK (metadata_status IN ('NONE','PENDING','DONE','FAILED','STALE'));
ALTER TABLE topics ADD COLUMN IF NOT EXISTS metadata_model VARCHAR(50);
ALTER TABLE topics ADD COLUMN IF NOT EXISTS metadata_generated_at TIMESTAMPTZ;
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos/{videoId}/metadata:generate` | Sửa video | Sinh cho cả video → `202 { "jobId": 981 }` |
| POST | `/api/v1/topics/{topicId}/metadata:generate` | Sửa video chứa topic | Sinh cho 1 topic → `202 { "jobId": 982 }` (job ưu tiên cao, thường xong ≤ 15s; giao diện theo dõi qua SSE của F10) |
| GET | `/api/v1/topics/{topicId}/metadata` | Xem video chứa topic | Đọc metadata |
| PATCH | `/api/v1/topics/{topicId}/metadata` | Sửa video chứa topic | Sửa tay, tự khoá trường đã sửa |
| POST | `/api/v1/topics/{topicId}/metadata:unlock` | Sửa video chứa topic | `{ "fields": ["title"] }` |

`topicId` là id số do F00 trả về. Không có quyền xem video chứa topic thì 404, xem được nhưng không sửa được thì 403 `FORBIDDEN_ACTION` (AD-2). Topic `DISCARDED` thì 409 `TOPIC_DISCARDED`.

```json
// POST /api/v1/topics/1187/metadata:generate  body: { "tone": "than_thien" }  →  202 { "jobId": 982 }
// Khi job xong: GET /api/v1/topics/1187/metadata
{
  "title": "Vòng lặp for: cú pháp và ví dụ in bảng cửu chương",
  "summary": "Giảng viên giới thiệu cú pháp vòng lặp for trong JavaScript...",
  "keyPoints": ["Ba thành phần của for", "Biến đếm và điều kiện dừng", "Ví dụ bảng cửu chương"],
  "keywords": ["vòng lặp for", "javascript", "biến đếm"],
  "lockedFields": [],
  "metadataStatus": "DONE"
}
```

### 6.3 Backend (Spring Boot)

- `service/TopicMetadataService.java`: là handler của job `GENERATE_METADATA` (F09). Gọi Python `python -m backend.ai.cli --generate-metadata --input <topics.json> --output <out.json>` qua job runner chung của F10 (không tự dựng `ProcessBuilder` như [VideoController.java:805](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L805)). Ghi kết quả vào DB trong một transaction, tôn trọng `locked_fields`, bỏ qua topic đã `DISCARDED` trong lúc job chạy.
- `controller/TopicController.java` (tệp mới, **không** thêm vào `VideoController`).
- `TopicEntity`: thêm các trường mới; `locked_fields` ánh xạ `String[]` (Hibernate 6 hỗ trợ mảng).
- `Models.Segment`: thêm các trường nullable `summary`, `keyPoints`, `keywords`, `lockedFields`, `metadataStatus` để `GET /api/v1/videos/{videoId}/segments` (F00) trả đủ cho frontend. Các trường này **chỉ đọc** trong `PUT /segments`: upsert bỏ qua chúng (FR-4b).

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/metadata_generator.py`:
  ```python
  class TopicMetadata(BaseModel):
      topic_id: str
      title: str = Field(max_length=70)
      summary: str = Field(max_length=400)
      key_points: list[str] = Field(min_length=3, max_length=5)
      keywords: list[str] = Field(min_length=3, max_length=8)

  def generate_metadata(topics: list[TopicInput], lesson: str, tone: str = "trang_trong") -> list[TopicMetadata]: ...
  ```
- Dùng `TranscriptRefiner._generate_with_fallback` ([transcript_refiner.py:70](../../../backend/ai/transcript_refiner.py)) để có cơ chế đổi model dự phòng. Hàm này **đã** đặt sẵn `response_mime_type="application/json"` (dòng 78), không cần sửa. Lấy số token từ đối tượng response trả về (FR-7).
- `config_loader.py`: thêm ánh xạ `segmentation.llm_max_retries` (mặc định 2) để FR-3 dùng.
- Bỏ đoạn tự cắt ```` ```json ```` thủ công như ở dòng ~403; dùng JSON mode hoặc một hàm `parse_llm_json` dùng chung.
- Khung prompt:
  ```
  Bạn là biên tập viên khoá học. Với MỖI chủ đề dưới đây, viết tiêu đề (≤70 ký tự), tóm tắt 2–4 câu,
  3–5 ý chính, 3–8 từ khoá. CHỈ dùng thông tin có trong transcript. Giọng văn: {tone}.
  Không lặp tiêu đề của chủ đề liền trước/sau: {neighbors}.
  Trả về JSON: {"items":[{"topic_id":..., "title":..., ...}]}
  ```

### 6.5 Frontend (Next.js)

- `SegmentDetailModal.tsx`: thêm tab "Thông tin" gồm ô sửa tiêu đề, tóm tắt, ý chính, từ khoá. Trường bị khoá có biểu tượng `Lock`; có nút "Viết lại bằng AI" kèm menu chọn giọng văn.
- `TranscriptScenesPanel.tsx`: hiện tóm tắt một dòng dưới tiêu đề topic; có khung xám nhấp nháy (`animate-pulse`) khi `metadata_status = PENDING`; badge "Cần viết lại" khi `STALE`.
- Nút "Sinh thông tin cho toàn bộ" trên `StudioHeader.tsx`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* video đã phân đoạn 12 topic. *When* job metadata chạy xong. *Then* cả 12 topic có `metadata_status = DONE` và mọi trường thoả ràng buộc độ dài.
- **AC-2** — *Given* người dùng đã sửa `title` của topic 3. *When* sinh lại cho cả video. *Then* `title` topic 3 giữ nguyên, `summary` vẫn được cập nhật.
- **AC-3** — *Given* LLM trả JSON sai schema 3 lần liên tiếp. *Then* `metadata_status = FAILED`, tiêu đề cũ giữ nguyên, UI hiện "Không sinh được, thử lại".
- **AC-4** — *Given* clip đã render. *When* đổi `title`. *Then* `slug` và tên tệp không đổi.
- **AC-4b** — *Given* 12 topic đã có metadata `DONE`. *When* người dùng kéo biên 2 topic rồi bấm Lưu 3 lần. *Then* cả 12 topic vẫn giữ `summary`, `key_points`, `keywords` (F00 upsert không xoá).
- **AC-4c** — *Given* người dùng đổi tiêu đề topic 5 trên timeline rồi Lưu. *Then* `locked_fields` của topic 5 chứa `title`; sinh lại cho cả video không đổi tiêu đề này.
- **AC-5** — Đánh giá thủ công trên 30 topic từ 3 video: ≥ 90% tiêu đề được người duyệt chấm "dùng được không cần sửa / sửa nhẹ"; 0 tóm tắt chứa thông tin không có trong transcript.
- **AC-6** — Mỗi lần gọi LLM tạo một dòng `ai_usage` (F15) có `model` (model thực sự đã dùng), `input_tokens`, `output_tokens`, `job_id`.

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f21_metadata.py`):
- `test_topic_metadata_rejects_title_over_70_chars()`
- `test_generate_metadata_batches_of_five()` (mock LLM, đếm số lần gọi)
- `test_generate_metadata_retries_on_invalid_json()`
- `test_long_topic_transcript_is_truncated_head_tail()`
- `test_prompt_contains_neighbor_titles()`
- `test_usage_line_printed_from_response_usage_metadata()` (AC-6)
- `test_config_loader_reads_llm_max_retries()`

JUnit:
- `TopicMetadataServiceTest.apply_respectsLockedFields()`
- `TopicMetadataServiceTest.apply_doesNotChangeSlugWhenRendered()`
- `TopicControllerTest.patchMetadata_locksEditedFields()`
- `TopicControllerTest.generate_returns202WithJobId()` (cả cho video và cho 1 topic)
- `TopicControllerTest.generate_withoutAccess_returns404()` (AD-2)
- `SegmentPersistenceServiceTest.upsert_keepsMetadataColumns()` (AC-4b)
- `SegmentPersistenceServiceTest.upsert_titleChangedByUser_locksTitle()` (AC-4c)

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| LLM bịa nội dung | Mô tả sai trên kênh công khai | Prompt "chỉ dùng transcript"; bước duyệt F35 trước khi xuất bản |
| Chi phí khi sinh lại nhiều lần | Tốn tiền | Rate limit (F06); không tự sinh lại khi chỉ đổi biên < 5s |
| Đổi slug làm hỏng đường dẫn đã chia sẻ | Link chết | FR-6 |
| Job chạy trong lúc người dùng đang sửa | Ghi đè tiêu đề vừa sửa | Kiểm tra lại `locked_fields` ngay trong transaction ghi kết quả |

## 10. Câu hỏi mở

- [ ] Có sinh luôn mô tả cho **cả video** (dùng cho trang khoá học F41) không?
- [ ] Danh sách giọng văn đã đủ chưa? Có cần chọn ngôn ngữ đầu ra (đi cùng F24) không?
- [ ] Từ khoá có cần thêm dạng hashtag (`#vonglapfor`) cho mạng xã hội không?
