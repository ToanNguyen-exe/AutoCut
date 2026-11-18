# F16 — Hạn mức dung lượng

| Mục | Giá trị |
|---|---|
| **Mã** | F16 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (backend), SV4 (giao diện thanh dung lượng) |
| **Phụ thuộc** | F01/F02 (biết ai là chủ), F13 (migration). Liên quan nhưng **không phụ thuộc vòng**: F11 và F09 chỉ gọi các hàm hook của `QuotaService` (là no-op khi F16 chưa merge, xem 6.3); F17 quyết định khi nào object bị xoá hẳn; F49 đổi hạn mức sang theo tổ chức. |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Google Drive (thanh "Đã dùng 12 GB / 15 GB"), Dropbox, Vimeo (hạn mức theo gói), Loom (giới hạn số video gói Free) |

> **Cập nhật 18/11/2026:** Thống nhất với F17 và AD-9: xoá video là chuyển vào thùng rác, vẫn tính dung lượng cho tới khi xoá hẳn; định nghĩa lớp `QuotaService` dùng chung (F09 và F11 gọi hook, không còn phụ thuộc vòng); sau F49 hạn mức tính theo tổ chức; tên migration theo quy ước dấu thời gian.

## 1. Bối cảnh & vấn đề

- Bảng `users` đã có `storage_used_bytes` và `storage_limit_bytes` (mặc định 2 GB) ([schema.sql](../../../database/schema.sql)), nhưng **không có dòng code nào đọc hay ghi hai cột này**.
- Hạn mức hiện chỉ có **một trần chung cho cả hệ thống** là 8 GB: `MAX_STORAGE_LIMIT_BYTES = 8L * 1024 * 1024 * 1024` ([CloudflareR2Service.java:25](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L25)). Một người upload 8 GB là cả hệ thống không ai upload được nữa.
- Cách kiểm tra trần chung gọi `getCurrentUsageBytes()` ([CloudflareR2Service.java:67-89](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L67)): **liệt kê toàn bộ object** trong bucket mỗi lần upload ([:109](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L109)). Số object càng nhiều thì càng chậm và tốn request Class A của R2.
- Lỗi vượt trần được ném dạng `IllegalStateException` và controller trả 413 ([VideoController.java:311-313](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L311)), nhưng việc kiểm tra xảy ra **sau khi** người dùng đã upload xong cả tệp lên server.
- Dung lượng thực tế mỗi video gồm: tệp gốc + các clip đã cắt + bản HLS (F39) + ảnh bìa, phụ đề, report. Hiện không ai tính phần này.

## 2. Mục tiêu

- Hạn mức theo **từng người dùng** (sau F49 là theo từng tổ chức, AD-9), kiểm tra **trước** khi upload hoặc render.
- Dung lượng đã dùng được tính dồn (cộng khi thêm, trừ khi xoá) trong DB, không phải liệt kê R2.
- Người dùng luôn thấy mình đã dùng bao nhiêu và còn bao nhiêu.
- Vẫn giữ trần an toàn toàn hệ thống (bảo vệ hoá đơn R2), nhưng đọc từ DB.

### Ngoài phạm vi

- Thu tiền khi mua thêm dung lượng (F49).
- Hạn mức số phút xử lý AI (F49; chi phí AI thuộc F15).

## 3. User stories

- Là giảng viên, tôi muốn thấy "Đã dùng 1,4 GB / 2 GB" để biết khi nào cần dọn bớt.
- Là giảng viên, tôi muốn biết ngay khi chọn tệp rằng tệp quá lớn so với dung lượng còn lại, thay vì upload 20 phút rồi mới bị từ chối.
- Là quản trị viên, tôi muốn nâng hạn mức cho một giảng viên cụ thể.
- Là quản trị viên, tôi muốn xem ai đang dùng nhiều dung lượng nhất.

## 4. Yêu cầu chức năng

- **FR-1** Mọi tệp hệ thống lưu trên R2 đều có một dòng trong bảng `stored_objects` (`owner_id`, `video_id`, `kind`, `r2_key`, `size_bytes`). Đây là nguồn sự thật để tính dung lượng.
- **FR-2** `users.storage_used_bytes` = tổng `size_bytes` của các object chưa bị xoá của người đó. Cập nhật **trong cùng transaction** với lúc thêm hoặc xoá `stored_objects`, dùng `UPDATE users SET storage_used_bytes = storage_used_bytes + :delta`.
- **FR-3** Kiểm tra khi khởi tạo upload (F11): `used + reserved + fileSize > limit` thì trả 402 `QUOTA_EXCEEDED`.
- **FR-4** **Giữ chỗ (reservation)**: khi khởi tạo upload, cộng `file_size` vào `storage_reserved_bytes`. Khi hoàn tất hoặc huỷ thì trả lại. Cách này chặn được việc mở 5 upload song song để lách hạn mức.
- **FR-5** Kiểm tra trước khi render hoặc cắt (job CUT): ước lượng dung lượng clip ≈ `tổng thời lượng clip / thời lượng gốc × kích thước gốc × 1,1`. Vượt hạn mức thì từ chối với thông báo rõ ràng.
- **FR-6** Xoá video gồm hai bước, theo F17 và AD-9:
  1. **Chuyển vào thùng rác** (`videos.deleted_at`, F17): **không** xoá object R2, **không** trừ dung lượng. Video trong thùng rác vẫn tính vào hạn mức; giao diện ghi "Thùng rác đang chiếm 1,2 GB" để người dùng biết nên dọn.
  2. **Xoá hẳn** (người dùng bấm "Xoá vĩnh viễn", hoặc job dọn thùng rác của F17 sau 30 ngày): gọi `QuotaService.removeStorage(videoId)`. Hàm này đánh dấu `stored_objects.deleted_at`, trừ dung lượng **trong cùng transaction**, rồi xoá object trên R2. Xoá R2 lỗi thì vẫn trừ dung lượng cho người dùng, còn object đưa vào hàng đợi dọn lại (F17).
- **FR-7** Trần toàn hệ thống `autocut.storage.global-limit-bytes` (mặc định 8 GB, giữ đúng giá trị hiện tại). Kiểm bằng `SUM(storage_used_bytes + storage_reserved_bytes)` từ DB. Bỏ việc gọi `getCurrentUsageBytes()` trong `uploadFile`.
- **FR-8** Job đối soát hằng đêm (`StorageReconcileJob`, 02:00): liệt kê R2 theo prefix `autocut/users/{id}/`, so với `stored_objects`, ghi log chênh lệch. Lệch > 1% thì cảnh báo (F15) và tự sửa `storage_used_bytes` theo `stored_objects`.
- **FR-9** Ngưỡng cảnh báo: dùng ≥ 80% thì hiện banner vàng; ≥ 95% thì banner đỏ và gửi thông báo (F48) tối đa 1 lần mỗi ngày.
- **FR-10** Admin đổi được `storage_limit_bytes` của từng người dùng. Thay đổi được ghi audit log (F08).
- **FR-11 (sau F49, AD-9)** Khi F49 merge, `QuotaService` lấy hạn mức **theo tổ chức**: giới hạn là `plans.storage_bytes` của gói mà tổ chức đang dùng, dung lượng đã dùng cộng theo `videos.org_id`. Mỗi user tự có một **tổ chức cá nhân**, tạo khi đăng ký, nên mọi user đều có `org_id` và chữ ký các hàm của `QuotaService` không đổi (vẫn nhận `ownerId`, tự tra `org_id`). Bộ đếm `used/reserved` chuyển từ `users` sang `organizations` bằng migration của F49; F49 mô tả chi tiết.

## 5. Yêu cầu phi chức năng

- Kiểm tra hạn mức ≤ 20 ms (chỉ đọc 1 dòng `users`).
- Không có điều kiện tranh chấp (race condition): 2 upload đồng thời không được cùng lọt qua khi tổng của chúng vượt hạn mức. Dùng `UPDATE ... SET storage_reserved_bytes = storage_reserved_bytes + :size WHERE id=:id AND storage_used_bytes + storage_reserved_bytes + :size <= storage_limit_bytes` rồi kiểm số dòng bị ảnh hưởng.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__storage_quota.sql`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_reserved_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT chk_storage_nonneg
  CHECK (storage_used_bytes >= 0 AND storage_reserved_bytes >= 0);

CREATE TABLE stored_objects (
    id          BIGSERIAL PRIMARY KEY,
    owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id    BIGINT REFERENCES videos(id) ON DELETE SET NULL,
    kind        VARCHAR(20) NOT NULL,  -- ORIGINAL | CLIP | HLS | THUMBNAIL | SUBTITLE | REPORT | ZIP
    r2_key      VARCHAR(500) NOT NULL UNIQUE,
    size_bytes  BIGINT NOT NULL CHECK (size_bytes >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_stored_owner_live ON stored_objects(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_stored_video ON stored_objects(video_id);

-- Backfill: đưa các object đang có của video vào stored_objects
INSERT INTO stored_objects(owner_id, video_id, kind, r2_key, size_bytes)
SELECT owner_id, id, 'ORIGINAL', r2_key, file_size FROM videos
WHERE owner_id IS NOT NULL AND r2_key IS NOT NULL
ON CONFLICT (r2_key) DO NOTHING;

UPDATE users u SET storage_used_bytes = COALESCE(
  (SELECT SUM(size_bytes) FROM stored_objects s WHERE s.owner_id = u.id AND s.deleted_at IS NULL), 0);
```

> Video cũ có `owner_id` NULL (dữ liệu trước F02) không được tính cho ai; job đối soát FR-8 sẽ báo chúng ra.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/me/storage` | Đã đăng nhập | Dung lượng của tôi |
| GET | `/api/v1/admin/storage/users?sort=used_desc&page=` | Admin | Xếp hạng người dùng theo dung lượng |
| PATCH | `/api/v1/admin/users/{id}/storage-limit` | Admin | Đổi hạn mức |

```json
// GET /api/v1/me/storage
{ "usedBytes": 1503238553, "reservedBytes": 0, "limitBytes": 2147483648, "percent": 70,
  "breakdown": { "ORIGINAL": 1200000000, "CLIP": 290000000, "HLS": 0, "OTHER": 13238553 } }

// 402 khi vượt
{ "error": { "code": "QUOTA_EXCEEDED", "message": "Không đủ dung lượng: cần 3,0 GB, còn trống 0,6 GB.",
  "details": { "requiredBytes": 3221225472, "availableBytes": 644245094 } } }
```

### 6.3 Backend

- **Lớp dùng chung `com.autocut.quota.QuotaService`** (một lớp, không tạo interface, theo YAGNI). Spec nào trong F09, F11, F16 merge **đầu tiên** thì tạo lớp này với các hàm rỗng (no-op), để không spec nào phải chờ spec khác:
  | Hàm | Ai gọi | Ai cài đặt thật |
  |---|---|---|
  | `reserveStorage(ownerId, bytes)`, `releaseStorage(ownerId, bytes)` | F11 (khởi tạo hoặc huỷ upload), job CUT (FR-5) | **F16** |
  | `commitStorage(ownerId, videoId, kind, key, size)` | Mọi chỗ upload lên R2 (chuyển phần giữ chỗ thành dung lượng thật) | **F16** |
  | `removeStorage(videoId)` | F17 (xoá hẳn) | **F16** |
  | `getUsage(ownerId)` | `/me/storage` | **F16** |
  | `reserveForJob(ownerId, jobType, minutes)`, `commit(jobId)`, `release(jobId)` | F09, F10 (phút xử lý AI) | **F49** (đến lúc đó là no-op) |
- Tạo `com.autocut.storage.StoredObjectEntity`, `StoredObjectRepository`; `QuotaService` dùng hai lớp này cho phần dung lượng.
- Tạo `StorageController`, `StorageAdminController`, `StorageReconcileJob` (`@Scheduled(cron="0 0 2 * * *")`).
- `CloudflareR2Service.uploadFile`: **bỏ** đoạn kiểm trần bằng `getCurrentUsageBytes()` ([:108-119](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L108)). Việc kiểm tra chuyển lên tầng service; `getCurrentUsageBytes()` chỉ còn được job đối soát dùng.
- Mọi nơi upload lên R2 (`BatchVideoCutService` ở [:214](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L214), [:254](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L254), [:267](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L267) và `UploadService` của F11) phải gọi `QuotaService.commitStorage(...)`.
- `MAX_STORAGE_LIMIT_BYTES` chuyển thành cấu hình `autocut.storage.global-limit-bytes`.

### 6.5 Frontend

- Tạo component `StorageMeter.tsx` (thanh tiến độ + chữ "1,4 GB / 2 GB"), đặt trong `StudioSidebar.tsx` hoặc `AccountModal.tsx`. Màu theo ngưỡng 80% / 95%.
- `AddVideoModal.tsx`: trước khi upload, so `file.size` với `limit - used - reserved` lấy từ `/me/storage`. Không đủ thì hiện lỗi ngay, kèm gợi ý "Xoá bớt video cũ trong Thư viện".
- Trong thư viện video, hiện dung lượng mỗi video (lấy tổng từ `stored_objects`), cho phép sắp xếp theo dung lượng.
- Định dạng số theo kiểu Việt Nam: dấu phẩy thập phân (`1,4 GB`).

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* hạn mức 2 GB, đã dùng 1,8 GB, *When* chọn tệp 500 MB, *Then* thấy lỗi ngay trên giao diện; nếu gọi API trực tiếp thì nhận 402 `QUOTA_EXCEEDED`, không có object nào được tạo trên R2.
- **AC-2** — *Given* hạn mức 2 GB, đã dùng 0, *When* mở 2 upload 1,5 GB song song, *Then* đúng 1 upload được chấp nhận, upload còn lại nhận 402.
- **AC-3** — *Given* upload xong 1 video 300 MB và cắt ra 5 clip tổng 120 MB, *When* gọi `/me/storage`, *Then* `usedBytes` ≈ 420 MB (sai số ≤ 1%), `breakdown.CLIP` ≈ 120 MB.
- **AC-4** — *Given* video ở AC-3, *When* chuyển vào thùng rác, *Then* `usedBytes` **không đổi** và object trên R2 vẫn còn. *When* bấm "Xoá vĩnh viễn" (hoặc job F17 xoá hẳn sau 30 ngày), *Then* `usedBytes` giảm đúng 420 MB và các object trên R2 bị xoá.
- **AC-5** — *Given* một upload bị huỷ giữa chừng, *Then* `reservedBytes` về lại giá trị trước đó.
- **AC-6** — *Given* bucket có 10.000 object, *When* khởi tạo upload, *Then* bước kiểm hạn mức mất ≤ 20 ms và không có request `ListObjectsV2` nào tới R2.
- **AC-7** — *Given* sửa tay `storage_used_bytes` sai đi 10%, *When* job đối soát chạy, *Then* giá trị được sửa lại và có log WARN cùng cảnh báo.
- **AC-8** — *Given* Admin đổi hạn mức của user A lên 10 GB, *Then* user A thấy giới hạn mới ngay ở lần tải trang kế tiếp.

## 8. Kế hoạch kiểm thử (TDD)

- `QuotaServiceTest.reserveStorage_withinLimit_succeeds`
- `QuotaServiceTest.reserveStorage_overLimit_throwsQuotaExceeded_withAvailableBytes`
- `QuotaServiceTest.commitStorage_movesReservedToUsed`
- `QuotaServiceTest.releaseStorage_neverGoesNegative`
- `QuotaServiceTest.trashedVideo_stillCounted` (AC-4, bước 1)
- `QuotaServiceTest.removeStorage_decrementsUsed_andMarksDeleted` (AC-4, bước 2)
- `QuotaServiceTest.globalLimit_blocksEvenIfUserHasRoom`
- `QuotaServiceTest.jobMinuteMethods_areNoOpBeforeF49`
- `StorageQuotaConcurrencyTest.parallelReserve_onlyOneWins` (Postgres thật theo AD-7, 10 luồng)
- `StorageReconcileJobTest.drift_isCorrected_andAlerted`
- `CloudflareR2ServiceTest.uploadFile_noLongerListsBucket` (mock `S3Client` và kiểm `listObjectsV2` không được gọi). Sửa test cũ có kiểm trần 8 GB thay vì xoá.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Quên gọi `commit` ở một chỗ upload mới | Dung lượng tính thiếu | Job đối soát hằng đêm phát hiện; review checklist: "mọi `r2Service.uploadFile` phải đi kèm `commit`" |
| Giữ chỗ không được trả (server sập giữa upload) | Người dùng bị khoá dung lượng | F17 dọn upload bỏ dở quá 24 giờ và trả phần giữ chỗ |
| Dữ liệu cũ không có `owner_id` | Không tính được cho ai | Báo cáo danh sách; Admin gán chủ bằng tay |
| Ước lượng dung lượng clip sai (FR-5) | Từ chối nhầm hoặc vượt nhẹ | Hệ số 1,1; nếu vượt nhẹ sau khi render thì vẫn cho qua, chỉ cảnh báo |

## 10. Câu hỏi mở

- [x] Video trong thùng rác có tính dung lượng không? **Đã chốt theo AD-9:** có, cho tới khi xoá hẳn.
- [x] Hạn mức theo user hay theo tổ chức? **Đã chốt theo AD-9:** theo user trước F49, theo tổ chức sau F49.
- [ ] Hạn mức mặc định cho mỗi vai trò: Giảng viên 2 GB, Admin không giới hạn?
- [ ] Clip đã cắt có tính vào hạn mức không, hay chỉ tính video gốc?
- [ ] Khi vượt hạn mức do Admin hạ giới hạn xuống, có khoá upload ngay không hay cho một khoảng ân hạn?
