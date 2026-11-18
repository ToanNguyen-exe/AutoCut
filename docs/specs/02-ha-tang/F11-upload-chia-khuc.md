# F11 — Upload chia khúc, tiếp tục được, đi thẳng lên R2

| Mục | Giá trị |
|---|---|
| **Mã** | F11 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend, R2), SV4 (frontend) |
| **Phụ thuộc** | F01/F02 (biết ai upload, quyền), F00 (trả `videoId` theo F00 FR-1), F10 (sau khi upload xong thì tạo job TRANSCRIBE). **Không** phụ thuộc cứng F16: F11 chỉ gọi `QuotaService.reserveStorage(...)`, và hàm này là no-op khi F16 chưa có (xem FR-3). |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. `S3Presigner` nằm sẵn trong `software.amazon.awssdk:s3` (đã có trong `pom.xml`). Frontend tự viết bằng `fetch`/`XMLHttpRequest`, không thêm Uppy hay tus-js. Test frontend cần **Vitest** (cần duyệt, AD-11). |
| **Tham khảo** | YouTube resumable upload, Mux Direct Upload, AWS S3 Multipart Upload, Cloudflare R2 multipart |

> **Cập nhật 18/11/2026:** Bỏ bảng `upload_parts`, lấy danh sách khúc bằng `ListParts` của R2 (YAGNI); `complete` có thể gọi lại nhiều lần an toàn (idempotent); thống nhất công thức fingerprint; phá phụ thuộc vòng với F16; bucket private theo AD-3; không có quyền thì trả 404 theo AD-2; ràng buộc `UNIQUE(owner_id, sha256_hash)` đồng bộ với F02.

## 1. Bối cảnh & vấn đề

- Frontend gửi **cả tệp** trong một request `multipart/form-data` duy nhất ([api.ts:314-324](../../../frontend/src/lib/api.ts#L314)). Mạng chập chờn ở phút thứ 9 của tệp 3 GB là phải upload lại từ đầu, và người dùng không thấy phần trăm đã gửi.
- Backend cho phép request tới 5 GB (`spring.servlet.multipart.max-file-size=5000MB` ở [application.properties:5-6](../../../backend/src/main/resources/application.properties#L5)). Tệp đi qua Spring, được ghi **3 lần** lên đĩa (Tomcat tạm → `temp/` ở [VideoController.java:192-197](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L192) → `uploads/` ở [:219-220](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L219)), rồi mới đẩy lên R2 bằng `putObject` một phát ([CloudflareR2Service.java:133](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L133)). `putObject` của S3/R2 giới hạn 5 GB mỗi request.
- Khi R2 lỗi, code lặng lẽ dùng link `http://localhost:8080/api/video/stream/...` ([VideoController.java:229-232](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L229)). Link này hỏng ngay khi deploy lên máy chủ thật.
- Không kiểm tra định dạng tệp trước khi nhận; `VideoValidator` có sẵn nhưng chỉ chạy sau khi đã upload xong.

## 2. Mục tiêu

- Trình duyệt upload **thẳng lên R2** bằng S3 Multipart Upload qua URL ký sẵn (presigned URL). Backend chỉ điều phối, không nhận byte video.
- Chia khúc 16 MB, chạy song song 4 khúc, tự thử lại từng khúc. Mất mạng hoặc tải lại trang vẫn tiếp tục từ khúc đang dở.
- Hiện phần trăm, tốc độ và thời gian còn lại.
- Phát hiện trùng lặp trước khi upload (cùng SHA-256 thì không cần upload lại).

### Ngoài phạm vi

- Upload từ link YouTube hoặc Google Drive (để sau).
- Ghi hình trực tiếp trên trình duyệt.

## 3. User stories

- Là giảng viên ở mạng trường yếu, tôi muốn upload bài giảng 2 GB mà rớt mạng giữa chừng vẫn tiếp tục được.
- Là giảng viên, tôi muốn thấy "Đã tải 1,2/3,4 GB · 8 MB/s · còn khoảng 4 phút".
- Là giảng viên, tôi muốn được báo ngay nếu chọn nhầm tệp không phải video, thay vì chờ upload xong mới báo lỗi.

## 4. Yêu cầu chức năng

- **FR-1** Kiểm tra phía client trước khi upload: đuôi tệp thuộc `.mp4 .mov .mkv .webm .m4v`, kích thước ≤ `autocut.upload.max-bytes` (mặc định 10 GB), MIME bắt đầu bằng `video/`.
- **FR-2** Client tính **fingerprint nhanh** (bằng `crypto.subtle.digest`) để tra trùng và làm khoá tiếp tục:
  `fingerprint = hex(SHA-256( hex(SHA-256(64 MB đầu)) + ":" + fileSize + ":" + fileName ))`.
  §9 dùng đúng công thức này. SHA-256 đầy đủ của tệp do server tính sau (job `TRANSCRIBE` của F10 tính khi tải về).
- **FR-3** `POST /api/v1/uploads` khởi tạo: server gọi `QuotaService.reserveStorage(ownerId, fileSize)` (F16, AD-9; là no-op khi F16 chưa merge), tạo bản ghi `uploads`, gọi `CreateMultipartUpload` lên R2, trả `uploadId`, `partSize`, `totalParts`. Upload bị huỷ hoặc hết hạn thì `releaseStorage(...)`.
- **FR-4** `POST /api/v1/uploads/{id}/parts` với `{ "partNumbers": [1,2,3,4] }` trả presigned URL `PUT` cho từng khúc (hết hạn sau 1 giờ). Mỗi lần xin tối đa 20 URL. Endpoint này được gọi nhiều lần trong một lần upload. Theo F06, nhóm rate limit `upload` **chỉ tính request khởi tạo** (`POST /api/v1/uploads`); các request xin URL, xem trạng thái và hoàn tất tính vào nhóm `default`.
- **FR-5** Client `PUT` từng khúc lên R2. Server **không** lưu ETag. Danh sách khúc đã xong luôn lấy từ R2 bằng `ListParts(key, uploadId)` (có phân trang, tối đa 1.000 khúc mỗi trang). Bỏ bảng `upload_parts` và endpoint `PATCH …/parts/{n}` (YAGNI: R2 đã giữ thông tin này).
- **FR-6** Tiếp tục: client lưu `{fingerprint → uploadId}` vào `localStorage`. Khi người dùng chọn lại cùng tệp, gọi `GET /api/v1/uploads/{id}`. Server gọi `ListParts` và trả danh sách khúc đã xong; client chỉ gửi các khúc còn thiếu.
- **FR-7** Mỗi khúc lỗi được thử lại tối đa 5 lần với backoff 1s, 2s, 4s, 8s, 16s. Khi `navigator.onLine=false` thì tạm dừng, có mạng lại thì tự chạy tiếp.
- **FR-8** `POST /api/v1/uploads/{id}/complete`:
  1. Chuyển trạng thái có điều kiện: `UPDATE uploads SET status='COMPLETING' WHERE id=:id AND status='IN_PROGRESS'`.
     - Cập nhật được 1 dòng: tiếp bước 2.
     - Cập nhật 0 dòng và upload đang `COMPLETED`: trả **lại đúng response cũ** (`videoId`, `jobId` lưu trong bảng `uploads`) với mã 200. Đây là phần idempotent.
     - Cập nhật 0 dòng và upload đang `COMPLETING`: trả 409 `UPLOAD_COMPLETING`.
  2. Gọi `ListParts` để kiểm tra đủ `1..totalParts`. Thiếu khúc thì đưa `status` về `IN_PROGRESS` và trả 409 `UPLOAD_PARTS_MISSING`.
  3. Gọi `CompleteMultipartUpload` với danh sách ETag lấy từ `ListParts`, rồi `HeadObject` để xác nhận kích thước.
  4. Trong một transaction: tạo bản ghi `videos` (`status=UPLOADED`, `r2_key`), ghi `uploads.video_id`, `status='COMPLETED'`, rồi gọi **điểm hook hậu xử lý** `PostUploadHooks.onUploadCompleted(video)`. Hook này tạo các job chạy sau upload qua `JobService.enqueue`: `TRANSCRIBE` (F10) và `MEDIA_PREVIEW` (F38: sóng âm và ảnh xem trước; chỉ khi F38 đã merge). Id của job `TRANSCRIBE` được lưu vào `uploads.job_id`.
  `UploadService.complete(uploadId)` là **điểm hook duy nhất** sau upload; spec nào cần chạy việc gì sau upload thì đăng ký vào `PostUploadHooks`, không sửa luồng `complete`.

  Nếu bước 3 hoặc 4 lỗi thì đưa `status` về `IN_PROGRESS` để client gọi lại được.
- **FR-9** `DELETE /api/v1/uploads/{id}`: huỷ upload, gọi `AbortMultipartUpload`.
- **FR-10** Upload bỏ dở quá 24 giờ thì bị tự huỷ (thuộc F17) và R2 cũng được cấu hình lifecycle `AbortIncompleteMultipartUpload` sau 1 ngày. F17 gộp rule này vào cấu hình lifecycle đang có, không ghi đè.
- **FR-11** Bỏ hẳn fallback `localhost:8080/api/video/stream`. Nếu R2 chưa được cấu hình thì `POST /uploads` trả 503 `STORAGE_NOT_CONFIGURED`. Chế độ dev cục bộ dùng MinIO trong Docker Compose (F14).
- **FR-12** Theo AD-3, bucket R2 là private. `videos` chỉ lưu `r2_key`; `cloud_url` không còn bắt buộc. Muốn phát hoặc tải video thì sinh presigned URL khi cần.

## 5. Yêu cầu phi chức năng

- Dung lượng đĩa backend tăng 0 byte khi người dùng upload.
- Tệp 3 GB trên mạng 50 Mbps upload xong trong ≤ 10 phút.
- Presigned URL chỉ cho phép `PUT` đúng `key` và đúng `partNumber`, không cho `GET` hay `DELETE`.
- Bucket R2 **phải** được cấu hình CORS (6.6): `AllowedOrigins` là tên miền frontend (cùng danh sách với F05), `AllowedMethods` gồm `PUT`, `GET`, `HEAD`, và `ExposeHeaders: ["ETag"]`. Server lấy danh sách khúc bằng `ListParts` (FR-5), nên ETag ở client chỉ dùng để gỡ lỗi, nhưng vẫn khai báo đủ để thống nhất với cấu hình chuẩn của dự án.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__uploads.sql`:

```sql
CREATE TABLE uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    file_size       BIGINT NOT NULL,
    content_type    VARCHAR(100) NOT NULL,
    fingerprint     VARCHAR(64) NOT NULL,
    r2_key          VARCHAR(500) NOT NULL,
    r2_upload_id    VARCHAR(255) NOT NULL,
    part_size       INTEGER NOT NULL,
    total_parts     INTEGER NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS|COMPLETING|COMPLETED|ABORTED
    video_id        BIGINT REFERENCES videos(id) ON DELETE SET NULL,
    job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,  -- để trả lại response khi complete được gọi lại
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_upload_status CHECK (status IN ('IN_PROGRESS','COMPLETING','COMPLETED','ABORTED'))
);
-- Mỗi user chỉ có tối đa 1 upload dở cho cùng một fingerprint
CREATE UNIQUE INDEX uq_uploads_owner_fp_active ON uploads(owner_id, fingerprint) WHERE status IN ('IN_PROGRESS','COMPLETING');

-- Bucket private (AD-3): videos chỉ cần r2_key
ALTER TABLE videos ALTER COLUMN cloud_url DROP NOT NULL;
```

> Không có bảng `upload_parts`; xem FR-5.
>
> Hai request khởi tạo cùng lúc cho cùng fingerprint: dùng `INSERT … ON CONFLICT DO NOTHING RETURNING id` (AD-8). Nếu không có dòng trả về thì đọc lại upload đang dở và trả `resumed: true`.

Khoá R2: `autocut/users/{ownerId}/originals/{uuid}{ext}`. Không đưa tên tệp gốc vào khoá, để tránh lỗi ký tự lạ và lộ thông tin.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/uploads` | Đã đăng nhập, role khác `VIEWER` | Khởi tạo upload |
| GET | `/api/v1/uploads/{id}` | Chủ upload | Trạng thái và danh sách khúc đã xong (lấy bằng `ListParts`) |
| POST | `/api/v1/uploads/{id}/parts` | Chủ upload | Xin presigned URL |
| POST | `/api/v1/uploads/{id}/complete` | Chủ upload | Hoàn tất, tạo video và job (idempotent) |
| DELETE | `/api/v1/uploads/{id}` | Chủ upload | Huỷ |

Theo AD-2: người không phải chủ upload (và không phải Admin) nhận **404** `UPLOAD_NOT_FOUND` ở mọi endpoint có `{id}`.

Khởi tạo:

```json
// POST /api/v1/uploads
{ "fileName": "Bai05_VongLap.mp4", "fileSize": 3221225472, "contentType": "video/mp4", "fingerprint": "9b1c..." }
// 201
{ "uploadId": "d2a1...", "partSize": 16777216, "totalParts": 192, "completedParts": [], "resumed": false }
```

Nếu đã có upload `IN_PROGRESS` cùng `owner_id + fingerprint` thì trả 200 với `resumed: true` và `completedParts: [1,2,...]`.

Xin URL:

```json
// POST /api/v1/uploads/d2a1.../parts
{ "partNumbers": [5, 6, 7, 8] }
// 200
{ "urls": [ { "partNumber": 5, "url": "https://<account>.r2.cloudflarestorage.com/autocut/...?partNumber=5&uploadId=...&X-Amz-Signature=...", "expiresAt": "2026-11-17T09:00:00Z" } ] }
```

Hoàn tất:

```json
// 200
{ "videoId": 42, "jobId": "3f0c...", "status": "UPLOADED", "eventsUrl": "/api/v1/videos/42/events" }
```

Mã lỗi: `FILE_TYPE_NOT_ALLOWED` (415), `FILE_TOO_LARGE` (413), `QUOTA_EXCEEDED` (402, F16), `UPLOAD_NOT_FOUND` (404), `UPLOAD_PARTS_MISSING` (409, kèm `details.missing: [12, 40]`), `UPLOAD_COMPLETING` (409), `STORAGE_NOT_CONFIGURED` (503).

### 6.3 Backend

- `CloudflareR2Service`: thêm `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNo, Duration)`, `listParts(key, uploadId)` (tự đi hết các trang), `completeMultipartUpload(key, uploadId, List<CompletedPart>)`, `abortMultipartUpload(key, uploadId)`, `headObject(key)`. Tạo `S3Presigner` cạnh `S3Client` sẵn có ([CloudflareR2Service.java:51](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L51)).
- Tạo `com.autocut.upload.UploadEntity`, `UploadRepository`, `UploadService`, `UploadController`.
- `TranscribeJobHandler` (F10): tải tệp gốc từ R2 về thư mục làm việc tạm của job, tính SHA-256 đầy đủ, ghi `videos.sha256_hash`. Nếu trùng với video khác của cùng chủ thì chỉ trỏ tới transcript cũ.
- Cột `videos.sha256_hash` hiện là `UNIQUE NOT NULL` ([schema.sql:30](../../../database/schema.sql)). Phải đổi thành `UNIQUE(owner_id, sha256_hash)` và cho phép NULL khi chưa tính xong, để hai giảng viên upload cùng một tệp không đụng nhau. **Migration này thuộc F02** (`video_hash_per_owner`), vì F02 merge trước. Nếu F11 merge trước F02 thì F11 tạo migration này, viết bằng `DROP CONSTRAINT IF EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` để spec merge sau không làm lại.
  ```sql
  ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_sha256_hash_key;
  ALTER TABLE videos ALTER COLUMN sha256_hash DROP NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_videos_owner_sha ON videos(owner_id, sha256_hash) WHERE sha256_hash IS NOT NULL;
  ```

### 6.5 Frontend

- Tạo `frontend/src/lib/chunkedUpload.ts` gồm lớp `ChunkedUploader`, có `start()`, `pause()`, `resume()`, `cancel()` và các sự kiện `onProgress({loaded,total,speedBps,etaSec})`, `onError`, `onComplete({videoId,jobId})`. Dùng `XMLHttpRequest` cho từng khúc để có `upload.onprogress`, chạy song song 4 khúc.
- `AddVideoModal.tsx`: thay `uploadVideoFile` bằng `ChunkedUploader`; hiện thanh tiến độ, tốc độ, thời gian còn lại, các nút Tạm dừng/Tiếp tục/Huỷ. Khi chọn tệp đã có upload dở thì hiện "Tiếp tục tải lên từ 42%".
- Chặn đóng tab khi đang upload bằng `beforeunload`.
- Giữ `uploadVideoFile` cũ trong 1 sprint, đánh dấu `@deprecated`.

### 6.6 Cấu hình R2 (làm một lần, ghi vào README triển khai)

```json
[{ "AllowedOrigins": ["https://studio.autocut.vn","http://localhost:3000"],
   "AllowedMethods": ["PUT","GET","HEAD"], "AllowedHeaders": ["*"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```
`AllowedOrigins` lấy từ cùng danh sách origin với F05; không dùng `*`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* tệp 2 GB, *When* upload, *Then* thư mục `uploads/`, `temp/` và thư mục tạm của Tomcat trên backend không tăng dung lượng; trong tab Network chỉ thấy request `PUT` tới tên miền R2.
- **AC-2** — *Given* đang upload ở 40%, *When* tắt Wi-Fi 30 giây rồi bật lại, *Then* upload tự chạy tiếp và hoàn tất; không có khúc nào bị gửi lại quá 1 lần ngoài khúc đang dở.
- **AC-3** — *Given* đang upload ở 40%, *When* tải lại trang (F5) và chọn lại cùng tệp, *Then* thanh tiến độ bắt đầu từ khoảng 40%.
- **AC-4** — *Given* tệp `baigiang.pdf`, *When* chọn tệp, *Then* thấy lỗi "Tệp không phải video" ngay, không có request nào được gửi.
- **AC-5** — *Given* tệp 6 GB (vượt giới hạn cũ của `putObject`), *When* upload, *Then* thành công và `HeadObject` trả đúng kích thước.
- **AC-6** — *Given* client gọi `complete` khi còn thiếu khúc 12, *Then* nhận 409 `UPLOAD_PARTS_MISSING` với `missing=[12]`.
- **AC-7** — *Given* user B, *When* gọi `POST /uploads/{id}/parts` cho upload của user A, *Then* nhận 404 `UPLOAD_NOT_FOUND` (AD-2).
- **AC-8** — *Given* R2 chưa được cấu hình, *When* khởi tạo upload, *Then* nhận 503 `STORAGE_NOT_CONFIGURED`; không còn chuỗi `localhost:8080` trong `VideoController`.
- **AC-9** — *Given* `complete` đã thành công (trả `videoId=42`), *When* client gọi `complete` lần nữa (ví dụ do mạng chập lúc nhận response), *Then* nhận 200 với đúng `videoId=42` và `jobId` cũ; DB chỉ có 1 video và 1 job.
- **AC-10** — *Given* hai giảng viên A, B cùng upload một tệp giống hệt, *When* cả hai hoàn tất, *Then* có 2 bản ghi `videos` với cùng `sha256_hash` và khác `owner_id`, không có lỗi trùng khoá.

## 8. Kế hoạch kiểm thử (TDD)

- `UploadServiceTest.init_createsMultipart_andComputesTotalParts`
- `UploadServiceTest.init_sameFingerprint_resumesExisting`
- `UploadServiceTest.init_quotaExceeded_throws` (mock `QuotaService`; khi F16 chưa có thì dùng bản no-op)
- `UploadServiceTest.init_disallowedExtension_throws415`
- `UploadServiceTest.complete_missingParts_throwsWithList_andRevertsToInProgress` (mock `listParts`)
- `UploadServiceTest.complete_success_createsVideo_andEnqueuesTranscribe`
- `UploadServiceTest.complete_success_invokesAllRegisteredPostUploadHooks` (ví dụ hook `MEDIA_PREVIEW` của F38)
- `UploadServiceTest.complete_calledTwice_returnsSameVideoAndJob` (AC-9)
- `UploadServiceTest.complete_whileCompleting_returns409`
- `CloudflareR2ServiceTest.presignUploadPart_containsPartNumberAndUploadId` (kiểm query string, không gọi mạng)
- `CloudflareR2ServiceTest.listParts_followsPagination`
- `UploadControllerTest.otherUser_gets404`
- `VideoHashMigrationTest.sameFileTwoOwners_allowed` (AC-10, Postgres theo AD-7)
- Frontend: `chunkedUpload.test.ts`: chia khúc đúng biên, thử lại khi PUT trả 500, bỏ qua khúc đã có. Cần duyệt Vitest vì frontend chưa có test runner; nếu không được duyệt thì SV4 kiểm thủ công theo AC-2, AC-3.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Thiếu CORS cho `PUT` từ tên miền frontend | Trình duyệt chặn upload khúc | Ghi rõ ở 6.6; health check (F15) kiểm cấu hình CORS của bucket |
| Presigned URL hết hạn khi mạng chậm | PUT trả 403 | Gặp 403 thì xin URL mới cho khúc đó và thử lại |
| Fingerprint 64 MB trùng giữa 2 tệp khác nhau | Tiếp tục nhầm upload | Fingerprint gồm cả `fileSize` và `fileName` (công thức ở FR-2); server xác minh SHA đầy đủ ở bước TRANSCRIBE |
| Client gọi `complete` hai lần do mạng chập | Tạo 2 video | Chuyển trạng thái có điều kiện + trả lại response cũ (FR-8) |
| Upload dở tích tụ trên R2 | Tốn tiền lưu trữ | Lifecycle rule của R2 + job dọn của F17 |
| Trình duyệt cũ không có `crypto.subtle` (HTTP thường) | Không tính được fingerprint | Bắt buộc HTTPS ở môi trường thật; nếu không có thì dùng fingerprint `name+size+lastModified` |

## 10. Câu hỏi mở

- [ ] Giới hạn kích thước tối đa mỗi tệp: 10 GB có ổn không?
- [x] Môi trường dev dùng MinIO thay R2: **Đã chốt**, nằm trong Docker Compose của F14.
- [ ] Có cần hỗ trợ upload nhiều tệp cùng lúc (hàng đợi upload) ngay ở bản này không?
- [ ] Tên miền frontend chính thức là gì (để cấu hình CORS của R2 và F05)?
