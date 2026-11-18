# F04 — Vá lỗi lộ tệp khi tải clip/ZIP (Path Traversal)

| Mục | Giá trị |
|---|---|
| **Mã** | F04 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0, **làm đầu tiên**: không phụ thuộc gì và rủi ro cao nhất |
| **Người phụ trách gợi ý** | SV3 (chính) · SV1 (`/concat`) · SV4 (sửa link tải ở frontend) |
| **Phụ thuộc** | Bước 1: **không phụ thuộc**, làm được ngay. Bước 2 (tải theo `clipId`): cần F00 (`video_parts` là tệp thật), F01 (vé `DOWNLOAD`), F02 (quyền) |
| **Ước lượng** | S (≤ 2 ngày) cho bước 1 · M cho bước 2 |
| **Thư viện mới cần duyệt** | Không (`java.nio.file`, AWS SDK S3 Presigner đã có trong `software.amazon.awssdk:s3`) |
| **Tham khảo** | OWASP "Path Traversal" (A01:2021 Broken Access Control) |

> **Cập nhật 18/11/2026:** Thống nhất cách xử lý đường dẫn tuyệt đối giữa FR-1 và §9; tách rõ phần nào của `/concat` làm được ngay và phần nào cần F01/F02; bước 2 dùng `clipId = video_parts.id` theo F00, presigned URL 15 phút theo AD-3, vé `DOWNLOAD` theo AD-4 và mã lỗi 404 theo AD-2.

## 1. Bối cảnh & vấn đề
*Path traversal* là lỗi khi người dùng truyền một đường dẫn như `../../.env` và máy chủ đọc hoặc ghi ra ngoài thư mục cho phép. AutoCut đang có 4 chỗ dính lỗi này:

1. **`GET /api/video/download-clip?path=`** ([VideoController.java:1557-1581](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1557-L1581)): `Paths.get(filePath)` được dùng **trước tiên**. Vì vậy `?path=/etc/passwd` hay `?path=../.env` trả về nguyên nội dung tệp. Đây là lỗi **đọc tệp tuỳ ý**, lộ được `R2_ACCESS_KEY_ID`, `DATABASE_URL` và `LLM_API_KEY`.
2. **`GET /api/video/download-zip?lesson=`** ([VideoController.java:1600-1650](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1600-L1650)): `user` có lọc ký tự, nhưng `lesson` thì **không**. `?lesson=../..` sẽ nén **toàn bộ thư mục dự án** (kể cả `.env`) vào ZIP và trả về.
3. **`POST /api/video/concat`** ([VideoController.java:1725-1750](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1725-L1750)): `output` do client gửi lên được ghi bằng `Paths.get(rawOutput)`. Đây là lỗi **ghi tệp tuỳ ý**, có thể ghi đè tệp hệ thống bằng kết quả ffmpeg. Danh sách `clips` cũng đọc theo đường dẫn tuỳ ý qua `findFilePath`.
4. **`GET /api/video/stream/{hash}`** ([VideoController.java:531-560](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L531-L560)): khớp theo `startsWith(hash)`. Gửi `hash` rỗng hoặc 1 ký tự sẽ trả về tệp đầu tiên tìm thấy (lộ video của người khác).

Frontend tạo link tải tại [api.ts:228-229](../../../frontend/src/lib/api.ts#L228-L229) bằng cách truyền nguyên đường dẫn local, `Models.java` có trường `local_path` ([Models.java:112](../../../backend/src/main/java/com/autocut/dto/Models.java#L112)).

## 2. Mục tiêu
- **Bước 1 (vá khẩn):** mọi đường dẫn từ client phải được chuẩn hoá và **nằm trong** thư mục gốc cho phép (`output/`, `uploads/`). Kiểm tra `hash` đúng định dạng.
- **Bước 2 (sửa tận gốc):** client không gửi đường dẫn nữa mà gửi `clipId` hoặc `videoId`. Máy chủ tra DB, kiểm tra quyền (F02) rồi trả **link R2 ký sẵn** có hạn 10 phút.
- `/concat` không nhận `output` từ client nữa; máy chủ tự sinh tên tệp.

### Ngoài phạm vi
- ZIP dạng luồng (xem F12).
- Phát HLS (xem F39).

## 3. User stories
- Là người vận hành, tôi cần chắc chắn không ai đọc được `.env` hay tệp hệ thống qua API.
- Là người dùng, tôi vẫn bấm "Tải clip" và "Tải ZIP" như cũ, không bị ảnh hưởng.

## 4. Yêu cầu chức năng
- **FR-1** Tạo tiện ích `SafePaths.resolveWithin(Path root, String userInput)`:
  - Từ chối `null`, chuỗi rỗng, ký tự `\0`, và đường dẫn mạng UNC (`\\server\…`).
  - Đường dẫn **tương đối**: tính `root.resolve(input)`. Đường dẫn **tuyệt đối** (`/…`, `C:\…`): giữ nguyên để so ở bước sau. Lý do: frontend hiện truyền nguyên `local_path` tuyệt đối mà job cắt trả về, nên phải chấp nhận để không làm hỏng nút "Tải clip" của job cũ.
  - Chuẩn hoá bằng `normalize().toAbsolutePath()`, sau đó gọi `toRealPath()` nếu tệp tồn tại để xử lý cả symlink.
  - Kết quả không `startsWith(root.toRealPath())` thì ném `PathOutsideRootException`. Vì vậy `/etc/passwd` bị từ chối, còn `/srv/autocut/output/users/3/a.mp4` (nằm trong root) thì được chấp nhận.
- **FR-2** `download-clip` chỉ nhận đường dẫn **tương đối** so với `output/`. Bỏ hẳn nhánh `Paths.get(filePath)` dùng trực tiếp. Chỉ cho đuôi `.mp4`, `.txt`, `.vtt`, `.srt`, `.json`.
- **FR-3** `download-zip`: `lesson` phải khớp regex `^[a-zA-Z0-9_.-]{1,100}$` và không được là `.` hoặc `..`. Thư mục sau khi resolve phải nằm trong `output/`.
- **FR-4** `/concat`: bỏ tham số `output` ([VideoController.java:1735-1749](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1735-L1749) đang dùng `Paths.get(rawOutput)`), máy chủ tự sinh tên tệp. Mỗi phần tử của `clips` đi qua `SafePaths.resolveWithin(outputRoot, …)`.
  - Bước 1 (chưa có F01/F02): ghi vào `output/combined/combined_{uuid}.mp4`.
  - Sau F02: ghi vào `output/users/{ownerId}/combined_{uuid}.mp4`, với `ownerId` lấy từ JWT.
- **FR-5** `/stream/{hash}`: `hash` phải khớp `^[0-9a-f]{64}$` (SHA-256), nếu không thì trả 400. So khớp **bằng** (`equals`) tên tệp `{hash}.{ext}` hoặc `{hash}_…`, không dùng `startsWith` với chuỗi tuỳ ý. Sau F02, tra video theo `(owner_id, sha256_hash)` trong số video người gọi xem được; không có quyền thì trả 404 (AD-2).
- **FR-6** Mọi lần bị từ chối: log mức WARN gồm IP, userId, endpoint và input đã cắt còn 200 ký tự. Trả 400 `INVALID_PATH`, không tiết lộ đường dẫn thật trên máy chủ.
- **FR-7** (Bước 2) `GET /api/v1/clips/{clipId}/download`, với `clipId` = `video_parts.id` (F00):
  - Kiểm tra quyền `DOWNLOAD` trên video chứa clip (F02). Không có quyền xem thì trả 404 `CLIP_NOT_FOUND` (AD-2).
  - Clip phải ở trạng thái `COMPLETED`; `STALE`/`FAILED`/`RENDERING` thì trả 409 `CLIP_NOT_READY`.
  - Có `r2_key` thì trả **302** tới presigned URL R2 hạn **15 phút** (AD-3), kèm `response-content-disposition=attachment; filename="<tên clip>.mp4"`.
  - Chưa đẩy R2 (chỉ có `file_path` cục bộ) thì stream từ ổ đĩa sau khi đi qua `SafePaths.resolveWithin(outputRoot, file_path)`.
  - Link dùng trong thẻ `<a>` nên xác thực bằng vé `DOWNLOAD` (`?ticket=`, F01 FR-10) thay cho header JWT.
  - Response của job cắt (`CutJobResponse`) trả thêm `clipId` cho mỗi clip.
- **FR-8** (Bước 2) Endpoint `download-clip?path=` cũ trả header `Deprecation: true` và bị xoá sau khi frontend chuyển xong.

## 5. Yêu cầu phi chức năng
- Thời gian kiểm tra đường dẫn không đáng kể (< 1 ms).
- Hành vi giống nhau trên Windows (team đang chạy `mvnw.cmd`) và Linux.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không đổi ở bước 1. Bước 2 dùng bảng `video_parts` sau khi F00 sửa xong (`id` = `clipId`; `r2_key`, `file_path`, `status` do job cắt ghi thật). Trước F00, `video_parts` chứa `r2_key` giả nên **không được** dùng cho bước 2.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/video/download-clip?path=<trong output root>` | `DOWNLOAD` (sau F02) | Bước 1, đã vá |
| GET | `/api/video/download-zip?lesson=<slug>` | `DOWNLOAD` (sau F02) | Bước 1, đã vá (bỏ `user` sau F02) |
| POST | `/api/video/concat` | `EDIT` (sau F02) | Bỏ trường `output` |
| GET | `/api/v1/clips/{clipId}/download?ticket=` | `DOWNLOAD` | Bước 2 |

Lỗi mẫu:
```json
{ "error": { "code": "INVALID_PATH", "message": "Đường dẫn tệp không hợp lệ" } }
```

### 6.3 Backend
- Tạo `com.autocut.video.SafePaths` (lớp final, hàm static): `resolveWithin`, `isSafeSlug`, `isSha256`.
- Tạo `PathOutsideRootException extends RuntimeException` và map sang 400 trong `GlobalExceptionHandler`.
- Sửa `VideoController`: `downloadClip`, `downloadZip`, `concatVideos`, `streamVideo` và hàm private `findFilePath`.
- Gom các vị trí gốc (`Paths.get("output")` hay `resolveProjectRoot().resolve("output")`) về **một** cấu hình `autocut.storage.output-dir` (đọc `STORAGE_OUTPUT_DIR` trong `.env.example`). Không dò nhiều chỗ nữa.
- Bước 2: tạo `ClipDownloadController`, thêm `CloudflareR2Service.presignGet(String key, Duration ttl, String downloadFileName)` dùng `S3Presigner`. Hàm này dùng chung cho F12, F39, F40 (AD-3).

### 6.5 Frontend
- [api.ts:228](../../../frontend/src/lib/api.ts#L228) `getDownloadClipUrl`: bước 1 giữ nguyên (backend đã chấp nhận đường dẫn nằm trong output root). Bước 2 đổi thành `getDownloadClipUrl(clipId)`: gọi `getTicket("DOWNLOAD", clipId)` (F01) rồi trả `/api/v1/clips/{clipId}/download?ticket=…`.
- [ExportProgressModal.tsx](../../../frontend/src/components/ExportProgressModal.tsx): dùng `clipId` từ kết quả job.

## 7. Tiêu chí chấp nhận
- **AC-1** — *When* `GET /download-clip?path=/etc/passwd` *Then* nhận 400 `INVALID_PATH`.
- **AC-2** — *When* `GET /download-clip?path=../.env` hoặc `..%2F.env` hoặc `....//.env` *Then* nhận 400.
- **AC-3** — *When* `GET /download-zip?lesson=..` hoặc `lesson=../..` *Then* nhận 400.
- **AC-4** — *When* `POST /concat` gửi `"output":"/tmp/x.mp4"` *Then* trường này bị bỏ qua; tệp kết quả nằm trong `output/users/{id}/`.
- **AC-5** — *When* `POST /concat` gửi `"clips":["../../.env"]` *Then* nhận 400.
- **AC-6** — *When* `GET /stream/a` *Then* nhận 400; *When* gửi hash 64 ký tự hex hợp lệ của tệp có thật *Then* nhận 200.
- **AC-7** — *Given* symlink `output/link → /etc` *When* `download-clip?path=link/passwd` *Then* nhận 400.
- **AC-8** — Luồng cũ vẫn chạy: sau khi cắt xong, bấm "Tải clip" và "Tải ZIP" trong Studio đều tải được, kể cả khi frontend gửi `local_path` tuyệt đối nằm trong output root.
- **AC-9** — (Bước 2) *Given* clip 55 `COMPLETED` có `r2_key` *When* chủ video gọi `/api/v1/clips/55/download?ticket=…` *Then* nhận 302 tới URL R2 có `X-Amz-Expires=900`. *Given* user không có quyền xem *Then* nhận 404. *Given* clip `STALE` *Then* nhận 409 `CLIP_NOT_READY`.

## 8. Kế hoạch kiểm thử (TDD)
- `SafePathsTest` (tham số hoá bằng `@ParameterizedTest`), mỗi input phải bị từ chối: `"../x"`, `"a/../../x"`, `"/etc/passwd"`, `"C:\\Windows\\win.ini"`, `"\\\\srv\\share"`, `"a\u0000b"`, `""`, symlink ra ngoài. Các input hợp lệ: `"lesson1/01_intro.mp4"`, `"a/./b.mp4"`.
- `SafePathsTest.isSha256_rejectsShortAndNonHex`.
- `SafePathsTest.absoluteInsideRoot_accepted`, `absoluteOutsideRoot_rejected`.
- `VideoControllerSecurityIT`: AC 1–8 qua MockMvc, dùng `@TempDir` làm thư mục output.
- `ClipDownloadControllerIT` (bước 2): AC-9, mock `S3Presigner`.
- Giữ nguyên và chạy lại `VideoControllerTest` hiện có.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Frontend đang truyền đường dẫn tuyệt đối từ job cũ | Không tải được clip cũ | FR-1 chấp nhận đường dẫn tuyệt đối **chỉ khi** nó nằm trong output root sau khi chuẩn hoá |
| Windows không phân biệt hoa/thường (`C:\Out` và `c:\out`) | So `startsWith` sai | So sau khi gọi `toRealPath()` |
| Có nơi khác ngoài 4 endpoint trên cũng nhận đường dẫn | Còn sót lỗ hổng | `grep -n "Paths.get(" VideoController.java` và rà từng chỗ nhận input từ client; ghi danh sách vào PR |

## 10. Câu hỏi mở
- [ ] Có đổi **ngay** các khoá R2, Neon, LLM đang dùng không, phòng trường hợp đã bị lộ qua lỗi này? Đề xuất: **có**, vì backend từng được chạy với CORS mở.
- [x] TTL của presigned URL: đã chốt 15 phút theo AD-3. Presigned URL chỉ cần còn hạn **lúc bắt đầu** tải, nên video dài tải chậm vẫn tải xong.
