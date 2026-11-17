# F17 — Dọn tệp tạm & vòng đời lưu trữ

| Mục | Giá trị |
|---|---|
| **Mã** | F17 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (chính), SV1 (thư mục làm việc của ffmpeg) |
| **Phụ thuộc** | F09 (bảng `jobs`), F11 (bảng `uploads`), F16 (`stored_objects` và trừ dung lượng), F13 |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Dùng `@Scheduled` của Spring và API lifecycle của R2 (S3 SDK có sẵn). |
| **Tham khảo** | S3/R2 Lifecycle Rules, Google Drive Trash (giữ 30 ngày), Vimeo (lưu trữ dài hạn) |

## 1. Bối cảnh & vấn đề

Backend đang ghi tệp vào nhiều thư mục **trong cây mã nguồn** và gần như không bao giờ dọn:

| Thư mục / tệp | Ai ghi | Có dọn không |
|---|---|---|
| `temp/` | Upload ([VideoController.java:182-197](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L182)) | Có `deleteIfExists` trong `finally` ([:323-327](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L323)); nhưng nếu JVM chết giữa chừng thì tệp ở lại mãi |
| `uploads/{hash}_{tên}` | Upload ([:214-220](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L214)) | **Không bao giờ dọn**, kể cả khi đã có bản trên R2 |
| `cache/ai_analyze_*.json` | Analyze ([:771](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L771)) | Chỉ xoá ở nhánh thành công ([:889](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L889)) |
| `cache/{hash}_transcript.json` | `CacheService` | Không dọn (đây là cache có chủ đích, nhưng không giới hạn dung lượng) |
| `output/users/{user}/{lesson}/cuts/*.mp4` | Cắt video ([BatchVideoCutService.java:175](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L175)) | Không dọn, kể cả khi đã upload lên R2 ([:214](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L214)) |
| `transcripts/*.json`, `transcript.json` và `cut_points.json` ở gốc repo | [:456](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L456), [:839](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L839), [:847](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L847) | Bị **ghi đè** bởi video xử lý sau cùng. Hai người dùng chạy cùng lúc sẽ đè dữ liệu của nhau |

Hậu quả: đĩa máy chủ đầy dần (mỗi bài giảng 1–3 GB), làm sập toàn bộ hệ thống mà không có cảnh báo. Trên R2: không có lifecycle rule, các upload multipart bỏ dở (F11) và video người dùng đã xoá vẫn bị tính tiền.

## 2. Mục tiêu

- Mỗi job làm việc trong một **thư mục riêng** `${AUTOCUT_WORK_DIR}/jobs/{jobId}/` (nằm ngoài cây mã nguồn), và thư mục này bị xoá khi job kết thúc.
- R2 là nơi lưu trữ lâu dài; đĩa cục bộ chỉ là bộ đệm có giới hạn dung lượng.
- Các job dọn dẹp định kỳ: tệp tạm mồ côi, upload bỏ dở, job cũ, thùng rác.
- Video bị xoá đi vào **thùng rác 30 ngày** rồi mới xoá hẳn (cứu được khi xoá nhầm).
- Cảnh báo khi đĩa sắp đầy.

### Ngoài phạm vi

- Chuyển video cũ sang lớp lưu trữ rẻ hơn (R2 Infrequent Access): ghi lại ở mục 10, quyết định sau.
- Sao lưu (backup) database: Neon tự lo phần này.

## 3. User stories

- Là người vận hành, tôi không muốn máy chủ sập vì đầy ổ cứng.
- Là giảng viên, khi lỡ tay xoá một bài giảng, tôi muốn khôi phục được trong vòng 30 ngày.
- Là trưởng nhóm, tôi muốn hoá đơn R2 không tính tiền cho dữ liệu rác.

## 4. Yêu cầu chức năng

### Thư mục làm việc
- **FR-1** Cấu hình `autocut.work-dir=${AUTOCUT_WORK_DIR:/app/work}` (dev: `./work`, thêm vào `.gitignore`). Gồm các thư mục con: `jobs/`, `cache/transcripts/`, `cache/sources/`.
- **FR-2** `JobWorker` (F09) tạo `jobs/{jobId}/` trước khi chạy handler, truyền qua `JobContext.workDir()`, và **luôn** xoá thư mục này trong `finally` khi job kết thúc (dù thành công, lỗi hay bị huỷ). Nếu cấu hình `autocut.cleanup.keep-failed-job-dir=true` (chỉ dùng ở dev) thì giữ lại thư mục của job lỗi để debug.
- **FR-3** Bỏ việc ghi `transcript.json` và `cut_points.json` ở gốc repo. Kết quả đi vào DB (`transcripts`, `topics`) và thư mục job. Các test và tệp mẫu đang dùng hai tệp gốc này chuyển sang `mock-data/`.
- **FR-4** `cache/sources/`: bản sao cục bộ của video gốc để cắt nhanh, tối đa `autocut.cache.sources-max-bytes` (mặc định 20 GB). Vượt mức thì xoá theo LRU (tệp lâu nhất chưa dùng bị xoá trước, dựa trên thời gian truy cập lưu trong bảng hoặc `lastModified`). Không có trong cache thì tải từ R2.
- **FR-5** `cache/transcripts/`: giữ theo `sha256`, tối đa 500 MB, xoá theo LRU. Nguồn sự thật là bảng `transcripts` trong DB.

### Job dọn dẹp (`CleanupScheduler`)
| # | Tác vụ | Lịch | Quy tắc |
|---|---|---|---|
| **FR-6** | Thư mục job mồ côi | Mỗi giờ | Xoá `jobs/{id}/` nếu job không còn `RUNNING` hoặc thư mục có `lastModified` > 24 giờ |
| **FR-7** | Upload bỏ dở | Mỗi giờ | `uploads.status=IN_PROGRESS` và `updated_at` > 24 giờ thì gọi `AbortMultipartUpload`, đặt `ABORTED`, trả phần giữ chỗ dung lượng (F16) |
| **FR-8** | Job cũ | 03:00 hằng ngày | Xoá `jobs` đã kết thúc > 30 ngày (giữ lại `ai_usage` vì FK là `SET NULL`) |
| **FR-9** | Thùng rác | 03:30 hằng ngày | Video `deleted_at` > 30 ngày thì xoá hẳn: xoá object R2 (theo `stored_objects`), xoá dòng DB (cascade), trừ dung lượng (F16) |
| **FR-10** | Object R2 không có chủ | Chủ nhật 04:00 | Liệt kê R2 theo prefix `autocut/`; object không có trong `stored_objects` và cũ hơn 7 ngày thì **chỉ báo cáo** (không tự xoá) ở bản đầu |
| **FR-11** | Đĩa sắp đầy | Mỗi 5 phút | `FileStore.getUsableSpace()` của `work-dir` < 15% thì xoá `cache/sources` xuống 50% hạn mức và cảnh báo (F15); < 5% thì `JobWorker` ngừng nhận job mới cho tới khi đĩa đủ chỗ |

- **FR-12** Mỗi tác vụ dọn dẹp ghi log tổng kết dạng `{task, scanned, deleted, freedBytes, errors, durationMs}` và chạy nhờ cơ chế khoá đơn giản (một dòng trong bảng `scheduler_locks`) để không chạy trùng khi có nhiều instance.
- **FR-13** Cờ `autocut.cleanup.dry-run=true` chỉ log những gì **sẽ** xoá; mặc định bật ở lần deploy đầu tiên.

### Thùng rác
- **FR-14** `DELETE /api/v1/videos/{id}` chỉ đặt `videos.deleted_at = now()` (xoá mềm). Video biến mất khỏi thư viện, link chia sẻ (F40) ngừng hoạt động; dung lượng **vẫn được tính** cho tới khi xoá hẳn.
- **FR-15** `GET /api/v1/videos/trash` liệt kê video trong thùng rác kèm "Tự xoá sau N ngày". `POST /api/v1/videos/{id}/restore` khôi phục. `DELETE /api/v1/videos/{id}?permanent=true` xoá hẳn ngay (hỏi xác nhận trên giao diện).

### R2 lifecycle (cấu hình một lần, lưu thành mã)
- **FR-16** Lúc khởi động, `R2LifecycleConfigurer` đảm bảo bucket có rule:
  - `AbortIncompleteMultipartUpload` sau 1 ngày (prefix `autocut/`).
  - Hết hạn sau 7 ngày với prefix `autocut/tmp/` (dùng cho ZIP phương án B của F12 và các tệp xuất tạm).

## 5. Yêu cầu phi chức năng

- Một lần dọn dẹp không được chặn job đang chạy: chạy trên luồng của `@Scheduled`, xoá theo lô 500 dòng.
- Không bao giờ xoá tệp nằm ngoài `work-dir` (kiểm bằng `path.normalize().startsWith(workDir)` trước mỗi lệnh xoá).
- Mọi lần xoá hẳn đều có log INFO kèm `videoId` và `ownerId` (phục vụ audit, F08).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V9__retention.sql`:

```sql
ALTER TABLE videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_videos_deleted ON videos(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE scheduler_locks (
    name        VARCHAR(64) PRIMARY KEY,
    locked_until TIMESTAMPTZ NOT NULL,
    locked_by   VARCHAR(100) NOT NULL
);
```

Mọi truy vấn danh sách video phải thêm điều kiện `deleted_at IS NULL`. Dùng `@SQLRestriction("deleted_at IS NULL")` của Hibernate trên `VideoEntity` cho truy vấn mặc định, và một repository riêng cho thùng rác.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| DELETE | `/api/v1/videos/{id}` | Chủ video | Chuyển vào thùng rác |
| DELETE | `/api/v1/videos/{id}?permanent=true` | Chủ video | Xoá hẳn |
| GET | `/api/v1/videos/trash` | Đã đăng nhập | Danh sách thùng rác |
| POST | `/api/v1/videos/{id}/restore` | Chủ video | Khôi phục |
| GET | `/api/v1/admin/cleanup/report` | Admin | Kết quả 10 lần dọn gần nhất của mỗi tác vụ |
| POST | `/api/v1/admin/cleanup/{task}/run?dryRun=true` | Admin | Chạy tay một tác vụ |

```json
// GET /api/v1/videos/trash
[ { "id": 42, "fileName": "Bai05_VongLap.mp4", "deletedAt": "2026-11-10T08:00:00Z",
    "purgeAt": "2026-12-10T08:00:00Z", "daysLeft": 23, "sizeBytes": 1503238553 } ]
```

### 6.3 Backend

- Tạo `com.autocut.storage.WorkDirService`: `jobDir(jobId)`, `sourceCache()`, `safeDelete(Path)` (kiểm path nằm trong `work-dir`), `evictLru(Path dir, long maxBytes)`.
- Tạo `com.autocut.cleanup.CleanupScheduler` (mỗi tác vụ ở mục 4 là một hàm), `SchedulerLock`, `R2LifecycleConfigurer`, `CleanupAdminController`.
- `CloudflareR2Service`: thêm `deleteObjects(List<String> keys)` (tối đa 1.000 key mỗi lần gọi), `listKeys(prefix)` (dạng iterator), `putLifecycle(...)`.
- Sửa `VideoController` và `BatchVideoCutService`: thay `Paths.get("temp")`, `projectRoot.resolve("uploads")`, `Paths.get("output", ...)`, `projectRoot.resolve("cache")` bằng `WorkDirService`. Nếu F09/F10 đã chuyển logic sang handler thì sửa trong handler.
- `CacheService`: đổi `CACHE_DIR = Paths.get("cache")` ([CacheService.java:22](../../../backend/src/main/java/com/autocut/service/CacheService.java#L22)) thành `workDir/cache/transcripts` và thêm LRU.
- `.gitignore`: thêm `work/`.

### 6.5 Frontend

- Trang hoặc tab **"Thùng rác"** trong `VideoLibraryDrawer.tsx`: danh sách, số ngày còn lại, các nút "Khôi phục" và "Xoá vĩnh viễn" (hộp thoại xác nhận phải gõ lại tên video).
- Nút xoá video hiện thông báo "Đã chuyển vào thùng rác" kèm nút "Hoàn tác" trong 10 giây.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* chạy 10 job cắt liên tiếp, *When* tất cả kết thúc, *Then* `work/jobs/` rỗng.
- **AC-2** — *Given* `kill -9` backend khi job đang chạy, *When* khởi động lại và chờ ≥ 1 lần dọn theo giờ (hoặc chạy tay), *Then* thư mục của job đó bị xoá sau khi job kết thúc lại (F09) hoặc sau 24 giờ.
- **AC-3** — *Given* 2 người dùng analyze cùng lúc, *Then* không có tệp nào ở gốc repo bị ghi đè (`transcript.json` và `cut_points.json` ở gốc không bị ghi nữa).
- **AC-4** — *Given* `cache/sources` có hạn mức 1 GB và 3 video 500 MB, *When* video thứ 3 được tải về, *Then* video ít dùng nhất bị xoá và tổng ≤ 1 GB.
- **AC-5** — *Given* xoá một video, *Then* video biến mất khỏi thư viện, xuất hiện trong thùng rác với `daysLeft=30`; khôi phục thì video trở lại đầy đủ segment.
- **AC-6** — *Given* video trong thùng rác có `deleted_at` lùi về 31 ngày trước, *When* chạy tác vụ thùng rác, *Then* object R2 bị xoá, dòng DB bị xoá, `storage_used_bytes` giảm tương ứng.
- **AC-7** — *Given* `dry-run=true`, *When* chạy mọi tác vụ, *Then* không có tệp hay object nào bị xoá, và log liệt kê đúng những gì sẽ bị xoá.
- **AC-8** — *Given* truyền tới `safeDelete` một đường dẫn `work/../backend`, *Then* hàm ném lỗi và không xoá gì.
- **AC-9** — *Given* đĩa còn < 5% (giả lập bằng cấu hình ngưỡng), *Then* job mới ở trạng thái `QUEUED` không được lấy ra chạy, và có cảnh báo.

## 8. Kế hoạch kiểm thử (TDD)

- `WorkDirServiceTest.safeDelete_outsideWorkDir_throws`
- `WorkDirServiceTest.evictLru_deletesOldestUntilUnderLimit`
- `JobWorkerTest.jobDir_isDeleted_afterSuccessFailureAndCancel`
- `CleanupSchedulerTest.abandonedUploads_areAborted_andReservationReleased`
- `CleanupSchedulerTest.oldJobs_deleted_aiUsageKept`
- `CleanupSchedulerTest.trashOlderThan30Days_purgesR2AndDb`
- `CleanupSchedulerTest.dryRun_deletesNothing`
- `CleanupSchedulerTest.orphanR2Objects_reportedNotDeleted`
- `SchedulerLockTest.secondInstance_skipsWhileLocked`
- `VideoTrashControllerTest.delete_thenRestore_roundTrip`
- `VideoRepositoryTest.defaultQueries_excludeDeleted`
- Sửa `CacheServiceTest` cho đúng thư mục mới (không xoá test).

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Xoá nhầm dữ liệu thật | Mất bài giảng | Bật `dry-run` ở lần deploy đầu; có thùng rác 30 ngày; `safeDelete` chặn path ngoài `work-dir`; FR-10 chỉ báo cáo |
| Quên thêm `deleted_at IS NULL` ở truy vấn mới | Video đã xoá vẫn hiện ra | `@SQLRestriction` mặc định; có test riêng |
| Dọn cache trong lúc job đang đọc tệp | Job lỗi | LRU bỏ qua tệp đang được job `RUNNING` sử dụng (kiểm theo `video_id` của job) |
| Chi phí liệt kê R2 hằng tuần | Tốn request Class A | Chỉ chạy mỗi tuần một lần; mỗi trang 1.000 key |

## 10. Câu hỏi mở

- [ ] Thời gian giữ trong thùng rác: 30 ngày có hợp lý không?
- [ ] Có giữ video gốc trên R2 vĩnh viễn không, hay chỉ giữ clip sau N tháng?
- [ ] Hạn mức cache `sources` 20 GB: ổ cứng máy chủ bao nhiêu?
- [ ] Ai được bật tắt `dry-run` ở production?
