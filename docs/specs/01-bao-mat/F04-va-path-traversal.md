# F04 — Vá lỗi lộ tệp khi tải clip/ZIP (Path Traversal)

| Mục | Giá trị |
|---|---|
| **Mã** | F04 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0, **làm đầu tiên**: không phụ thuộc gì và rủi ro cao nhất |
| **Người phụ trách gợi ý** | SV3 (chính) · SV1 (`/concat`) · SV4 (sửa link tải ở frontend) |
| **Phụ thuộc** | Không. Bước 1 làm được ngay; bước 2 (tải theo `clipId`) cần F02 |
| **Ước lượng** | S (≤ 2 ngày) cho bước 1 · M cho bước 2 |
| **Thư viện mới cần duyệt** | Không (`java.nio.file`, AWS SDK S3 Presigner đã có trong `software.amazon.awssdk:s3`) |
| **Tham khảo** | OWASP "Path Traversal" (A01:2021 Broken Access Control) |

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
  - Từ chối `null`, chuỗi rỗng, ký tự `\0`, và đường dẫn tuyệt đối (`/…`, `C:\…`, `\\server\…`).
  - Tính `root.resolve(input).normalize().toAbsolutePath()`, sau đó gọi `toRealPath()` nếu tệp tồn tại để xử lý cả symlink.
  - Kết quả không `startsWith(root.toRealPath())` thì ném `PathOutsideRootException`.
- **FR-2** `download-clip` chỉ nhận đường dẫn **tương đối** so với `output/`. Bỏ hẳn nhánh `Paths.get(filePath)` dùng trực tiếp. Chỉ cho đuôi `.mp4`, `.txt`, `.vtt`, `.srt`, `.json`.
- **FR-3** `download-zip`: `lesson` phải khớp regex `^[a-zA-Z0-9_.-]{1,100}$` và không được là `.` hoặc `..`. Thư mục sau khi resolve phải nằm trong `output/`.
- **FR-4** `/concat`: bỏ tham số `output`, máy chủ tự sinh `output/users/{ownerId}/combined_{uuid}.mp4`. Mỗi phần tử của `clips` đi qua `SafePaths.resolveWithin(outputRoot, …)`.
- **FR-5** `/stream/{hash}`: `hash` phải khớp `^[0-9a-f]{64}$` (SHA-256), nếu không thì trả 400.
- **FR-6** Mọi lần bị từ chối: log mức WARN gồm IP, userId, endpoint và input đã cắt còn 200 ký tự. Trả 400 `INVALID_PATH`, không tiết lộ đường dẫn thật trên máy chủ.
- **FR-7** (Bước 2) `GET /api/v1/clips/{clipId}/download` → 302 tới presigned URL R2, hoặc stream từ ổ đĩa nếu chưa có R2. Response JSON của job cắt (`CutJobResponse`) trả thêm `clipId` cho mỗi clip.
- **FR-8** (Bước 2) Endpoint `download-clip?path=` cũ trả header `Deprecation: true` và bị xoá sau khi frontend chuyển xong.

## 5. Yêu cầu phi chức năng
- Thời gian kiểm tra đường dẫn không đáng kể (< 1 ms).
- Hành vi giống nhau trên Windows (team đang chạy `mvnw.cmd`) và Linux.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không đổi ở bước 1. Bước 2 dùng bảng `video_parts` sẵn có (`id` = `clipId`, `r2_key`).

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/video/download-clip?path=<tương đối>` | View (F02) | Bước 1, đã vá |
| GET | `/api/video/download-zip?lesson=<slug>` | View | Bước 1, đã vá (bỏ `user`) |
| POST | `/api/video/concat` | Edit | Bỏ trường `output` |
| GET | `/api/v1/clips/{clipId}/download` | View | Bước 2 |

Lỗi mẫu:
```json
{ "error": { "code": "INVALID_PATH", "message": "Đường dẫn tệp không hợp lệ" } }
```

### 6.3 Backend
- Tạo `com.autocut.video.SafePaths` (lớp final, hàm static): `resolveWithin`, `isSafeSlug`, `isSha256`.
- Tạo `PathOutsideRootException extends RuntimeException` và map sang 400 trong `GlobalExceptionHandler`.
- Sửa `VideoController`: `downloadClip`, `downloadZip`, `concatVideos`, `streamVideo` và hàm private `findFilePath`.
- Gom các vị trí gốc (`Paths.get("output")` hay `resolveProjectRoot().resolve("output")`) về **một** cấu hình `autocut.storage.output-dir` (đọc `STORAGE_OUTPUT_DIR` trong `.env.example`). Không dò nhiều chỗ nữa.
- Bước 2: tạo `ClipDownloadController`, thêm `CloudflareR2Service.presignGet(String key, Duration ttl)` dùng `S3Presigner`.

### 6.5 Frontend
- [api.ts:228](../../../frontend/src/lib/api.ts#L228) `getDownloadClipUrl`: truyền đường dẫn tương đối, tức là bỏ tiền tố `output/` hoặc đường dẫn tuyệt đối khi ghép URL. Bước 2 đổi thành `getDownloadClipUrl(clipId)`.
- [ExportProgressModal.tsx](../../../frontend/src/components/ExportProgressModal.tsx): dùng `clipId` từ kết quả job.

## 7. Tiêu chí chấp nhận
- **AC-1** — *When* `GET /download-clip?path=/etc/passwd` *Then* nhận 400 `INVALID_PATH`.
- **AC-2** — *When* `GET /download-clip?path=../.env` hoặc `..%2F.env` hoặc `....//.env` *Then* nhận 400.
- **AC-3** — *When* `GET /download-zip?lesson=..` hoặc `lesson=../..` *Then* nhận 400.
- **AC-4** — *When* `POST /concat` gửi `"output":"/tmp/x.mp4"` *Then* trường này bị bỏ qua; tệp kết quả nằm trong `output/users/{id}/`.
- **AC-5** — *When* `POST /concat` gửi `"clips":["../../.env"]` *Then* nhận 400.
- **AC-6** — *When* `GET /stream/a` *Then* nhận 400; *When* gửi hash 64 ký tự hex hợp lệ của tệp có thật *Then* nhận 200.
- **AC-7** — *Given* symlink `output/link → /etc` *When* `download-clip?path=link/passwd` *Then* nhận 400.
- **AC-8** — Luồng cũ vẫn chạy: sau khi cắt xong, bấm "Tải clip" và "Tải ZIP" trong Studio đều tải được.

## 8. Kế hoạch kiểm thử (TDD)
- `SafePathsTest` (tham số hoá bằng `@ParameterizedTest`), mỗi input phải bị từ chối: `"../x"`, `"a/../../x"`, `"/etc/passwd"`, `"C:\\Windows\\win.ini"`, `"\\\\srv\\share"`, `"a\u0000b"`, `""`, symlink ra ngoài. Các input hợp lệ: `"lesson1/01_intro.mp4"`, `"a/./b.mp4"`.
- `SafePathsTest.isSha256_rejectsShortAndNonHex`.
- `VideoControllerSecurityIT`: AC 1–7 qua MockMvc, dùng `@TempDir` làm thư mục output.
- Giữ nguyên và chạy lại `VideoControllerTest` hiện có.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Frontend đang truyền đường dẫn tuyệt đối từ job cũ | Không tải được clip cũ | Bước 1 chấp nhận đường dẫn tuyệt đối **nếu** nó nằm trong output root: chuẩn hoá xong mới so |
| Windows không phân biệt hoa/thường (`C:\Out` và `c:\out`) | So `startsWith` sai | So sau khi gọi `toRealPath()` |
| Có nơi khác ngoài 4 endpoint trên cũng nhận đường dẫn | Còn sót lỗ hổng | `grep -n "Paths.get(" VideoController.java` và rà từng chỗ nhận input từ client; ghi danh sách vào PR |

## 10. Câu hỏi mở
- [ ] Có đổi **ngay** các khoá R2, Neon, LLM đang dùng không, phòng trường hợp đã bị lộ qua lỗi này? Đề xuất: **có**, vì backend từng được chạy với CORS mở.
- [ ] TTL của presigned URL là 10 phút hay 1 giờ? Video dài tải chậm có thể cần lâu hơn.
