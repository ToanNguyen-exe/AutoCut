# F00 — Định danh ổn định & lưu dự án bằng upsert

| Mục | Giá trị |
|---|---|
| **Mã** | F00 |
| **Nhóm** | Tiền đề (làm trước mọi spec có đụng tới topic/clip) |
| **Ưu tiên** | **P0** |
| **Người phụ trách gợi ý** | SV3 (backend, DB) + SV4 (frontend) |
| **Phụ thuộc** | F13 (Flyway). Không bắt buộc F01/F02: ownership kiểm sau khi F02 xong |
| **Bị phụ thuộc bởi** | F12, F18, F21, F24, F27, F29, F32, F33, F34, F37, F39, F41, F45 |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Mô hình "client-generated ID + upsert" của Linear, Figma |

> **Tạo mới 18/11/2026:** gom phần upsert từ F33 và bổ sung định danh video cho frontend, ghi `video_parts` thật, theo [REVIEW-HIEN-TRANG.md](../REVIEW-HIEN-TRANG.md) §3.2 (vấn đề gốc 1, 2, 7).

## 1. Bối cảnh & vấn đề

Ba lỗi gốc trong code hiện tại làm hỏng nhiều spec khác:

1. **Lưu là xoá sạch rồi ghi lại.** `saveSegmentsToDatabase` xoá hết `sections` của video ([SegmentPersistenceService.java:87-92](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L87-L92)), kéo theo `topics` và `video_parts` bị xoá dây chuyền (cascade), rồi mới tạo lại. Hệ quả:
   - `topics.id` đổi sau mỗi lần lưu.
   - Mọi bảng con gắn vào topic sẽ mất sạch khi người dùng bấm Lưu: câu hỏi trắc nghiệm (F29), bản dịch (F24), metadata AI (F21), lịch sử chỉnh sửa (F27), tiến độ xem (F41).
2. **`video_parts` bị ghi giả.** Khi lưu, backend tạo lại `video_parts` từ dữ liệu frontend gửi lên, với `r2_key` lấy từ `part.file()` hoặc chuỗi `"cuts/part_N.mp4"`, `file_size=0` và `status='COMPLETED'` cứng ([SegmentPersistenceService.java:128-141](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L128-L141)). Job cắt thật (`BatchVideoCutService`) lại **không ghi** bảng này. Kết quả là bảng `video_parts` không phản ánh clip nào thật sự tồn tại.
3. **Frontend không biết id số của video.** Frontend nhận diện video bằng tên tệp hoặc hash. `/save` tìm video theo tên ([VideoController.java:1203](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1203)). Id của segment do frontend tự đặt (`seg_01`, `seg_ai_xx`…) và không gắn với id trong DB. Các API dạng `/api/v1/videos/{videoId}/...` của các spec khác vì thế không gọi được.

## 2. Mục tiêu
- `videos.id` được trả về cho frontend ở mọi luồng (upload, analyze, load) và frontend dùng nó làm khoá chính.
- Mỗi topic có **`client_id` ổn định** (UUID) suốt vòng đời. `topics.id` trong DB **không bao giờ đổi** sau khi đã tạo.
- Lưu dự án = **upsert**: cập nhật cái đã có, thêm cái mới, **xoá mềm** (`DISCARDED`) cái bị bỏ. Không bao giờ xoá cứng topic khi lưu.
- `video_parts` **chỉ do job cắt ghi** và phản ánh đúng tệp thật trên R2.

### Ngoài phạm vi
- Lịch sử phiên bản và chống ghi đè đồng thời (`baseVersion`, trả 409): thuộc F33. F00 chỉ chuẩn bị cột `topics.version`.
- Kiểm tra quyền sở hữu: thuộc F02. F00 để sẵn chỗ gọi `accessService.require(...)`.

## 3. User stories
- Là giảng viên, tôi bấm Lưu nhiều lần mà câu hỏi trắc nghiệm, tóm tắt và bản dịch đã duyệt vẫn còn nguyên.
- Là giảng viên, tôi bỏ một đoạn rồi đổi ý thì khôi phục lại được, kèm cả clip đã render trước đó.
- Là lập trình viên, tôi gọi `/api/v1/videos/{id}/...` bằng id lấy từ state của frontend, không phải đi tra theo tên tệp.

## 4. Yêu cầu chức năng
- **FR-1 — videoId cho frontend.** Các response sau phải có trường `videoId` (số):
  - Upload ([VideoController.java:166](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L166)).
  - Analyze ([:715](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L715)).
  - Load project (`/project`, `/load`).
  - List (`/list`).

  Frontend lưu giá trị này trong state của dự án và trong `localStorage` (cùng chỗ đang lưu phiên ở `page.tsx`).
- **FR-2 — client_id cho topic.** Mỗi segment có `id` là UUID v4:
  - Python analyze sinh UUID ngay khi tạo segment.
  - Frontend sinh UUID khi người dùng tách hoặc thêm đoạn (`crypto.randomUUID()`).
  - Gộp hai đoạn thì đoạn bên trái **giữ** id của nó, đoạn bên phải bị bỏ (DISCARDED).
  - Tách một đoạn thì nửa đầu **giữ** id cũ, nửa sau nhận id mới.
- **FR-3 — id cũ.** Topic đã có trong DB trước migration được gán `client_id = 'legacy_' || id`. Payload gửi lên có id không phải UUID (`seg_01`…) vẫn được chấp nhận như một `client_id` bình thường.
- **FR-4 — Analyze ghi DB ngay.** Kết quả analyze được upsert vào DB ngay sau khi Python trả về, với `topics.origin='AI'`. Có vậy thì F18, F21, F27 mới có topic thật để làm việc. Response analyze trả kèm `topicId` (id số) cho từng segment.
- **FR-5 — Upsert khi lưu.** `PUT /api/v1/videos/{videoId}/segments` nhận toàn bộ danh sách segment. Trong **một transaction**:
  1. Upsert section theo `(video_id, label)`. Section không còn topic nào đang dùng thì giữ lại, không xoá.
  2. Upsert topic theo `(video_id, client_id)`: cập nhật `title`, `slug`, `start/end`, `start_id/end_id`, `position`, `section_id`; tăng `topics.version` nếu có trường nào đổi.
  3. Topic có trong DB mà không có trong payload thì đặt `status='DISCARDED'`, không xoá.
  4. Topic đang `DISCARDED` xuất hiện lại trong payload thì đặt về `ACTIVE`, giữ nguyên `id` và các bảng con.
  5. **Không** ghi `video_parts`. Nếu `start/end` của topic đổi so với clip đã render, đánh dấu các `video_parts` của topic đó `status='STALE'`.
  6. **Không** đặt `videos.reviewed=true`. Việc duyệt thuộc F35.
  7. **Không** ghi đè các cột do spec khác sở hữu trên `topics`: metadata AI của F21 (`summary`, `keywords`, `key_points`, `locked_fields`, `metadata_status`…) và điểm tin cậy của F18. Upsert chỉ cập nhật các cột liệt kê ở bước 2. Khi người dùng đổi `title` (payload khác giá trị trong DB và lần lưu không phải `origin=AI`), thêm `title` vào `locked_fields` để F21 không sinh đè (chỉ áp dụng khi F21 đã merge).
- **FR-6 — Đọc.** `GET /api/v1/videos/{videoId}/segments`:
  - Mặc định chỉ trả topic `ACTIVE`.
  - `?includeDiscarded=true` thì trả cả topic đã bỏ (để F37 khôi phục và F33 so sánh).
  - Mỗi segment trả kèm `topicId`, `clientId`, `status`, `version`, `parts[]` (lấy từ `video_parts` thật).
- **FR-7 — Job cắt ghi `video_parts`.** Với mỗi clip, `BatchVideoCutService` upsert `video_parts` theo `(topic_id, part_no)`:
  - Bắt đầu cắt: `status='RENDERING'`.
  - Xong: `COMPLETED`, ghi `file_path` cục bộ, `r2_key` thật sau khi đẩy R2, `file_size` thật, `rendered_at`.
  - Lỗi: `FAILED` kèm `error_message`.

  Payload `/cut` phải có `videoId` và `topicId` cho từng segment, thêm trường vào `CutRequestDTO` ([Models.java:130](../../../backend/src/main/java/com/autocut/dto/Models.java#L130)). Trường `renderKind` (`DRAFT`/`RELEASE`) do F35 thêm sau.
  Tên tệp clip lấy theo `section_no`/`topic_no` **thật** qua `PathSlugifier.resolveOutputFile`, không theo vị trí trong request. Hiện code đánh số theo vị trí ở [BatchVideoCutService.java:199](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L199). Chi tiết ở F37.
- **FR-8 — Endpoint cũ.** `/save` và `POST /{id}/segments` chuyển sang gọi cùng hàm upsert, giữ hình dạng request cũ để frontend chuyển dần. Ghi log `WARN deprecated`.

## 5. Yêu cầu phi chức năng
- Upsert 200 topic phải xong dưới 500 ms trên Neon. Tải trước toàn bộ topic của video bằng **một** truy vấn rồi so trong bộ nhớ, không truy vấn từng dòng.
- Gọi lưu hai lần với cùng payload phải cho cùng một trạng thái DB (idempotent), và lần thứ hai không tăng `version`.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__stable_ids.sql`:
```sql
-- topics: thêm video_id (để ràng buộc duy nhất theo video), client_id, origin
ALTER TABLE topics ADD COLUMN IF NOT EXISTS video_id BIGINT;
UPDATE topics t SET video_id = s.video_id FROM sections s WHERE t.section_id = s.id AND t.video_id IS NULL;
ALTER TABLE topics ALTER COLUMN video_id SET NOT NULL;
ALTER TABLE topics ADD CONSTRAINT fk_topics_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE;

ALTER TABLE topics ADD COLUMN IF NOT EXISTS client_id VARCHAR(64);
UPDATE topics SET client_id = 'legacy_' || id WHERE client_id IS NULL;
ALTER TABLE topics ALTER COLUMN client_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_video_client ON topics(video_id, client_id);

ALTER TABLE topics ADD COLUMN IF NOT EXISTS origin VARCHAR(10) NOT NULL DEFAULT 'USER'; -- AI | USER

-- sections: upsert theo nhãn
CREATE UNIQUE INDEX IF NOT EXISTS uq_sections_video_label ON sections(video_id, label);

-- video_parts: trạng thái thật
ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE video_parts ALTER COLUMN r2_key DROP NOT NULL;     -- chưa đẩy R2 thì NULL
ALTER TABLE video_parts ALTER COLUMN cloud_url DROP NOT NULL;  -- bucket private (AD-3), cột này bỏ dần
ALTER TABLE video_parts DROP CONSTRAINT IF EXISTS chk_part_status;
ALTER TABLE video_parts ADD CONSTRAINT chk_part_status
  CHECK (status IN ('PENDING','RENDERING','COMPLETED','FAILED','STALE'));
-- dữ liệu cũ: các dòng 'COMPLETED' giả không có tệp thật
UPDATE video_parts SET status = 'STALE' WHERE file_size IS NULL OR file_size = 0;
```
> Trước khi chạy cần kiểm tra bảng `sections` không có hai dòng trùng `(video_id, label)`. Nếu có thì gộp lại trong cùng migration.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{videoId}/segments?includeDiscarded=` | Xem video | Đọc danh sách (FR-6) |
| PUT | `/api/v1/videos/{videoId}/segments` | Sửa video | Upsert toàn bộ (FR-5) |

```json
// PUT /api/v1/videos/42/segments
{ "segments": [
  { "id": "3f1c8a2e-6b1d-4c39-9f3e-0b7d2a1c5e90", "section": "Lý thuyết", "section_no": 2,
    "topic_no": 1, "topic": "Vòng lặp for", "slug": "vong-lap-for",
    "start_id": "S0012", "end_id": "S0040", "start": 151.3, "end": 402.8 } ] }
// 200
{ "videoId": 42, "saved": 1, "discarded": 2, "restored": 0, "staleParts": 1,
  "segments": [ { "id": "3f1c8a2e-…", "topicId": 1187, "status": "ACTIVE", "version": 4, "parts": [] } ] }
```
Lỗi theo định dạng chung trong README:
- `VIDEO_NOT_FOUND` (404).
- `SEGMENT_INVALID` (422): `end <= start`, `start < 0`, `end > duration + 1`, hoặc trùng `id` trong payload.

### 6.3 Backend
- **Sửa** `TopicEntity`: thêm `videoId`, `clientId`, `origin`, `status` (đã có trong schema), `version`.
- **Sửa** `SegmentPersistenceService`: thay `saveSegmentsToDatabase` bằng `upsertSegments(Long videoId, List<Segment> segs, Origin origin)`, trả về `UpsertResult(saved, discarded, restored, staleParts, List<TopicRef>)`. Logic là hàm thuần `SegmentDiff.compute(existing, incoming)`, test riêng không cần DB.
- **Sửa** `Models.Segment`: thêm `topicId` (Long, có thể null) và `status`. `CutRequestDTO` thêm `videoId` và `topicId` cho từng segment.
- **Mới** `controller/v1/SegmentController.java` cho hai endpoint ở 6.2. Không thêm vào `VideoController` (quy ước README).
- **Sửa** `BatchVideoCutService`: thêm `VideoPartRepository.upsert(topicId, partNo, …)` theo FR-7.
- **Sửa** luồng analyze: sau khi Python trả kết quả, gọi `upsertSegments(videoId, segs, AI)`, rồi gắn `topicId` vào response.

### 6.4 AI pipeline (Python)
- `cli.py --analyze-backend`: gán `id = str(uuid.uuid4())` cho mỗi segment khi tạo.

### 6.5 Frontend
- `types/index.ts`: `Segment` thêm `topicId?: number`, `status?: "ACTIVE" | "DISCARDED"`. State của dự án thêm `videoId: number`.
- `page.tsx`: các hàm tách, gộp, thêm đoạn dùng `crypto.randomUUID()` theo FR-2. Lưu thì gọi `PUT /api/v1/videos/{videoId}/segments`.
- `lib/api.ts`: thêm `getSegments(videoId)` và `saveSegments(videoId, segs)`.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* video có 5 topic đã lưu, *When* lưu lại đúng payload đó 3 lần, *Then* 5 `topics.id` không đổi, `version` không tăng, số dòng `topics` vẫn là 5.
- **AC-2** — *Given* topic T có 3 câu hỏi trắc nghiệm (hoặc bất kỳ bảng con nào), *When* đổi tiêu đề T rồi lưu, *Then* T giữ nguyên `id` và 3 bảng con vẫn còn.
- **AC-3** — *Given* bỏ T khỏi payload rồi lưu, *Then* T có `status='DISCARDED'` và `GET` mặc định không trả T. *When* gửi lại T với cùng `id`, *Then* T trở về `ACTIVE`, cùng `topicId`, bảng con vẫn còn.
- **AC-4** — *Given* T có clip `COMPLETED`, *When* đổi `end` của T rồi lưu, *Then* clip của T chuyển `STALE`. Response có `staleParts=1`.
- **AC-5** — *Given* chạy job cắt cho 3 topic, *When* job xong, *Then* có 3 dòng `video_parts` `COMPLETED` với `file_size > 0` và `r2_key` trỏ tới object có thật trên R2 (kiểm bằng `HeadObject`).
- **AC-6** — *Given* analyze xong video 42, *Then* DB có topic `origin='AI'`, và response có `videoId=42` cùng `topicId` cho từng segment.
- **AC-7** — *Given* payload có hai segment trùng `id`, *Then* nhận 422 `SEGMENT_INVALID` và DB không thay đổi.
- **AC-8** — *Given* DB có dữ liệu trước migration, *When* chạy migration, *Then* mọi topic có `client_id='legacy_<id>'`, không mất dòng nào, và các `video_parts` có `file_size=0` chuyển `STALE`.

## 8. Kế hoạch kiểm thử (TDD)
- `SegmentDiffTest` (unit, thuần): `unchanged_noVersionBump`, `titleChanged_bumpsVersion`, `missing_marksDiscarded`, `reappearing_restoresSameId`, `rangeChanged_marksPartsStale`, `duplicateIds_rejected`, `upsert_doesNotOverwriteMetadataColumns_andLocksEditedTitle`.
- `SegmentPersistenceServiceTest` (integration, Postgres theo AD-7): AC-1, AC-2, AC-3, AC-7.
- `BatchVideoCutServiceTest`: thêm `writesVideoPartsCompletedWithRealSize`, `marksFailedOnFfmpegError`.
- `StableIdsMigrationTest`: AC-8, chạy trên bản sao schema hiện tại.
- Frontend (sau khi Vitest được duyệt): `splitKeepsLeftId`, `mergeKeepsLeftIdDiscardsRight`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Hai section trùng nhãn trong dữ liệu cũ | Migration lỗi ở unique index | Gộp trước trong cùng migration (6.1) |
| Frontend cũ vẫn gửi `seg_01` cho nhiều video | Trùng `client_id` | Unique tính theo `(video_id, client_id)` nên không ảnh hưởng giữa các video |
| Frontend gửi thiếu segment do lỗi | Topic bị DISCARDED nhầm | Xoá mềm nên khôi phục được; response trả số `discarded` để giao diện cảnh báo khi > 50% |
| Job cắt chạy trong lúc người dùng sửa | Clip vừa xong đã STALE | Chấp nhận được; giao diện hiện badge "Cần render lại" |

## 10. Câu hỏi mở
- [ ] Section rỗng (không còn topic ACTIVE) có hiện trên giao diện không? Đề xuất: ẩn.
- [ ] Có cần job dọn topic DISCARDED quá 90 ngày không? Đề xuất: để F17 quyết định.
