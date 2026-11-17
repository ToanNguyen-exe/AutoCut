# F11 — Upload chia khúc, tiếp tục được, đi thẳng lên R2

| Mục | Giá trị |
|---|---|
| **Mã** | F11 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend, R2), SV4 (frontend) |
| **Phụ thuộc** | F01/F02 (biết ai upload), F10 (sau khi upload xong thì tạo job TRANSCRIBE), F16 (kiểm tra hạn mức) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. `S3Presigner` nằm sẵn trong `software.amazon.awssdk:s3` (đã có trong `pom.xml`). Frontend tự viết bằng `fetch`/`XMLHttpRequest`, không thêm Uppy hay tus-js. |
| **Tham khảo** | YouTube resumable upload, Mux Direct Upload, AWS S3 Multipart Upload, Cloudflare R2 multipart |

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
- **FR-2** Client tính SHA-256 **của 64 MB đầu + kích thước tệp** (gọi là "fingerprint nhanh", tính bằng `crypto.subtle.digest`) để tra trùng và làm khoá tiếp tục. SHA-256 đầy đủ do server tính sau (job `TRANSCRIBE` của F10 tính khi tải về).
- **FR-3** `POST /api/v1/uploads` khởi tạo: server kiểm tra hạn mức (F16), tạo bản ghi `uploads`, gọi `CreateMultipartUpload` lên R2, trả `uploadId`, `partSize`, `totalParts`.
- **FR-4** `POST /api/v1/uploads/{id}/parts` với `{ "partNumbers": [1,2,3,4] }` trả presigned URL `PUT` cho từng khúc (hết hạn sau 1 giờ). Mỗi lần xin tối đa 20 URL.
- **FR-5** Client `PUT` từng khúc lên R2, đọc header `ETag` trả về và báo lại server qua `PATCH /api/v1/uploads/{id}/parts/{n}` với `{ "etag": "..." }`. Server lưu vào `upload_parts`.
- **FR-6** Tiếp tục: client lưu `{fingerprint → uploadId}` vào `localStorage`. Khi người dùng chọn lại cùng tệp, gọi `GET /api/v1/uploads/{id}` để lấy danh sách khúc đã xong và chỉ gửi các khúc còn thiếu.
- **FR-7** Mỗi khúc lỗi được thử lại tối đa 5 lần với backoff 1s, 2s, 4s, 8s, 16s. Khi `navigator.onLine=false` thì tạm dừng, có mạng lại thì tự chạy tiếp.
- **FR-8** `POST /api/v1/uploads/{id}/complete`: server gọi `CompleteMultipartUpload` với danh sách ETag, rồi `HeadObject` để xác nhận kích thước. Sau đó tạo bản ghi `videos` (`status=UPLOADED`) và gửi job `TRANSCRIBE` (F10).
- **FR-9** `DELETE /api/v1/uploads/{id}`: huỷ upload, gọi `AbortMultipartUpload`.
- **FR-10** Upload bỏ dở quá 24 giờ thì bị tự huỷ (thuộc F17) và R2 cũng được cấu hình lifecycle `AbortIncompleteMultipartUpload` sau 1 ngày.
- **FR-11** Bỏ hẳn fallback `localhost:8080/api/video/stream`. Nếu R2 chưa được cấu hình thì `POST /uploads` trả 503 `STORAGE_NOT_CONFIGURED`. Chế độ dev cục bộ dùng MinIO trong Docker Compose (F14).

## 5. Yêu cầu phi chức năng

- Dung lượng đĩa backend tăng 0 byte khi người dùng upload.
- Tệp 3 GB trên mạng 50 Mbps upload xong trong ≤ 10 phút.
- Presigned URL chỉ cho phép `PUT` đúng `key` và đúng `partNumber`, không cho `GET` hay `DELETE`.
- Bucket R2 cần CORS cho phép `PUT` từ tên miền frontend và cho phép đọc header `ETag` (`ExposeHeaders: ["ETag"]`).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V4__uploads.sql`:

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
    status          VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS|COMPLETED|ABORTED
    video_id        BIGINT REFERENCES videos(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_uploads_owner_fp ON uploads(owner_id, fingerprint) WHERE status = 'IN_PROGRESS';

CREATE TABLE upload_parts (
    upload_id   UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    part_number INTEGER NOT NULL,
    etag        VARCHAR(100) NOT NULL,
    size        BIGINT,
    PRIMARY KEY (upload_id, part_number)
);
```

Khoá R2: `autocut/users/{ownerId}/originals/{uuid}{ext}`. Không đưa tên tệp gốc vào khoá, để tránh lỗi ký tự lạ và lộ thông tin.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/uploads` | Đã đăng nhập | Khởi tạo upload |
| GET | `/api/v1/uploads/{id}` | Chủ upload | Trạng thái và danh sách khúc đã xong |
| POST | `/api/v1/uploads/{id}/parts` | Chủ upload | Xin presigned URL |
| PATCH | `/api/v1/uploads/{id}/parts/{n}` | Chủ upload | Báo ETag của khúc đã xong |
| POST | `/api/v1/uploads/{id}/complete` | Chủ upload | Hoàn tất, tạo video và job |
| DELETE | `/api/v1/uploads/{id}` | Chủ upload | Huỷ |

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

Mã lỗi: `FILE_TYPE_NOT_ALLOWED` (415), `FILE_TOO_LARGE` (413), `QUOTA_EXCEEDED` (402, F16), `UPLOAD_PARTS_MISSING` (409, kèm `details.missing: [12, 40]`), `STORAGE_NOT_CONFIGURED` (503).

### 6.3 Backend

- `CloudflareR2Service`: thêm `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNo, Duration)`, `completeMultipartUpload(key, uploadId, List<CompletedPart>)`, `abortMultipartUpload(key, uploadId)`, `headObject(key)`. Tạo `S3Presigner` cạnh `S3Client` sẵn có ([CloudflareR2Service.java:51](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L51)).
- Tạo `com.autocut.upload.UploadEntity`, `UploadPartEntity`, các repository tương ứng, `UploadService`, `UploadController`.
- `TranscribeJobHandler` (F10): tải tệp gốc từ R2 về thư mục làm việc tạm của job, tính SHA-256 đầy đủ, ghi `videos.sha256_hash`. Nếu trùng với video khác của cùng chủ thì chỉ trỏ tới transcript cũ.
- Cột `videos.sha256_hash` hiện là `UNIQUE NOT NULL` ([schema.sql](../../../database/schema.sql)). Cần đổi thành `UNIQUE(owner_id, sha256_hash)` và cho phép NULL khi chưa tính xong (migration riêng `V5__video_hash_per_owner.sql`). Hai giảng viên upload cùng một tệp không được đụng nhau.

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

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* tệp 2 GB, *When* upload, *Then* thư mục `uploads/`, `temp/` và thư mục tạm của Tomcat trên backend không tăng dung lượng; trong tab Network chỉ thấy request `PUT` tới tên miền R2.
- **AC-2** — *Given* đang upload ở 40%, *When* tắt Wi-Fi 30 giây rồi bật lại, *Then* upload tự chạy tiếp và hoàn tất; không có khúc nào bị gửi lại quá 1 lần ngoài khúc đang dở.
- **AC-3** — *Given* đang upload ở 40%, *When* tải lại trang (F5) và chọn lại cùng tệp, *Then* thanh tiến độ bắt đầu từ khoảng 40%.
- **AC-4** — *Given* tệp `baigiang.pdf`, *When* chọn tệp, *Then* thấy lỗi "Tệp không phải video" ngay, không có request nào được gửi.
- **AC-5** — *Given* tệp 6 GB (vượt giới hạn cũ của `putObject`), *When* upload, *Then* thành công và `HeadObject` trả đúng kích thước.
- **AC-6** — *Given* client gọi `complete` khi còn thiếu khúc 12, *Then* nhận 409 `UPLOAD_PARTS_MISSING` với `missing=[12]`.
- **AC-7** — *Given* user B, *When* gọi `POST /uploads/{id}/parts` cho upload của user A, *Then* nhận 403.
- **AC-8** — *Given* R2 chưa được cấu hình, *When* khởi tạo upload, *Then* nhận 503 `STORAGE_NOT_CONFIGURED`; không còn chuỗi `localhost:8080` trong `VideoController`.

## 8. Kế hoạch kiểm thử (TDD)

- `UploadServiceTest.init_createsMultipart_andComputesTotalParts`
- `UploadServiceTest.init_sameFingerprint_resumesExisting`
- `UploadServiceTest.init_quotaExceeded_throws` (dùng mock F16)
- `UploadServiceTest.init_disallowedExtension_throws415`
- `UploadServiceTest.complete_missingParts_throwsWithList`
- `UploadServiceTest.complete_success_createsVideo_andEnqueuesTranscribe`
- `CloudflareR2ServiceTest.presignUploadPart_containsPartNumberAndUploadId` (kiểm query string, không gọi mạng)
- `UploadControllerTest.otherUser_gets403`
- Frontend: `chunkedUpload.test.ts`: chia khúc đúng biên, thử lại khi PUT trả 500, bỏ qua khúc đã có. Cần duyệt Vitest vì frontend chưa có test runner; nếu không được duyệt thì SV4 kiểm thủ công theo AC-2, AC-3.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Thiếu `ExposeHeaders: ETag` trong CORS của R2 | Client không đọc được ETag, không hoàn tất được | Ghi rõ ở 6.6; endpoint health kiểm cấu hình CORS |
| Presigned URL hết hạn khi mạng chậm | PUT trả 403 | Gặp 403 thì xin URL mới cho khúc đó và thử lại |
| Fingerprint 64 MB trùng giữa 2 tệp khác nhau | Tiếp tục nhầm upload | Fingerprint gồm cả `fileSize` và `fileName`; server xác minh SHA đầy đủ ở bước TRANSCRIBE |
| Upload dở tích tụ trên R2 | Tốn tiền lưu trữ | Lifecycle rule của R2 + job dọn của F17 |
| Trình duyệt cũ không có `crypto.subtle` (HTTP thường) | Không tính được fingerprint | Bắt buộc HTTPS ở môi trường thật; nếu không có thì dùng fingerprint `name+size+lastModified` |

## 10. Câu hỏi mở

- [ ] Giới hạn kích thước tối đa mỗi tệp: 10 GB có ổn không?
- [ ] Môi trường dev có dùng MinIO thay R2 không (cần thêm image Docker ở F14)?
- [ ] Có cần hỗ trợ upload nhiều tệp cùng lúc (hàng đợi upload) ngay ở bản này không?
- [ ] Tên miền frontend chính thức là gì (để cấu hình CORS của R2 và F05)?
