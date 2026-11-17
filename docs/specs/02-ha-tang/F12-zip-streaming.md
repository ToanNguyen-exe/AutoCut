# F12 — Xuất ZIP dạng luồng

| Mục | Giá trị |
|---|---|
| **Mã** | F12 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 |
| **Phụ thuộc** | F04 (vá lỗi lộ tệp: tham số `lesson` hiện nhận được `../`). F02 (kiểm quyền sở hữu). |
| **Ước lượng** | S (≤ 2 ngày) cho phương án A; M cho phương án B |
| **Thư viện mới cần duyệt** | Không. Dùng `java.util.zip.ZipOutputStream` và `StreamingResponseBody` có sẵn trong Spring MVC. |
| **Tham khảo** | Google Drive ("Đang chuẩn bị tệp nén…"), Dropbox, Frame.io (tải nhiều tệp) |

## 1. Bối cảnh & vấn đề

- `GET /api/video/download-zip` ([VideoController.java:1600-1653](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1600)) gom **toàn bộ** tệp ZIP vào RAM: `ByteArrayOutputStream baos = new ByteArrayOutputStream();` rồi trả `ResponseEntity<byte[]>`. Tổng các clip của bài giảng 2 giờ khoảng 1–3 GB, sẽ gây `OutOfMemoryError` làm sập backend và kéo theo mọi người dùng khác.
- Trình duyệt chỉ nhận được byte đầu tiên sau khi server nén xong toàn bộ. Với tệp lớn, proxy thường cắt kết nối trước đó (timeout).
- Video H.264 hầu như không nén thêm được nữa, nhưng code vẫn dùng mức nén mặc định (DEFLATE), tốn CPU mà gần như không giảm dung lượng.
- `lesson` được đưa thẳng vào `Paths.get("output", lesson)` mà không chuẩn hoá. Lỗi lộ tệp này do F04 xử lý; F12 phải làm sau hoặc làm cùng F04.
- Lỗi khi thêm một tệp chỉ được `log.warn` rồi bỏ qua ([:1631-1633](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1631)), nên người dùng nhận ZIP thiếu tệp mà không biết.
- Clip đã có trên R2 (do `BatchVideoCutService` upload, [BatchVideoCutService.java:214](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L214)) nhưng ZIP chỉ đọc thư mục `output/` cục bộ. Nếu máy chủ đã dọn đĩa (F17) thì ZIP rỗng.

## 2. Mục tiêu

- Bộ nhớ heap dùng cho việc xuất ZIP không phụ thuộc kích thước ZIP (≤ 16 MB mỗi request).
- Byte đầu tiên tới trình duyệt trong ≤ 2 giây.
- Tải theo `videoId`, có kiểm tra quyền, không dùng đường dẫn thô.
- Đọc clip từ R2 nếu tệp cục bộ không còn.

### Ngoài phạm vi

- Chọn từng clip để nén (F37 thao tác hàng loạt có thể dùng lại API này với tham số `partIds`).
- Đặt mật khẩu cho tệp ZIP.

## 3. User stories

- Là giảng viên, tôi muốn tải tất cả clip của bài giảng thành một tệp ZIP, bấm là bắt đầu tải ngay và thấy dung lượng tăng dần.
- Là quản trị viên, tôi không muốn một lần tải ZIP làm sập server của mọi người.

## 4. Yêu cầu chức năng

- **FR-1** Endpoint mới `GET /api/v1/videos/{id}/export.zip`. Tham số tuỳ chọn `include=clips,chapters,report,subtitles` (mặc định `clips,chapters,report`).
- **FR-2** Tìm danh sách tệp từ **DB** (`video_parts` với `status=COMPLETED` của video đó) thay vì quét thư mục. Thứ tự trong ZIP theo `section_no`, `topic_no`, `part_no`.
- **FR-3** Đường dẫn trong ZIP theo `config.yaml` → `output.section_folder_template` và `naming_template`, ví dụ `01_ly-thuyet/03_vong-lap-for_Phan1.mp4`. Tên tệp được làm sạch bằng `PathSlugifier` sẵn có.
- **FR-4** Ghi thẳng ra `response.getOutputStream()` qua `StreamingResponseBody`. Dùng `setLevel(Deflater.NO_COMPRESSION)` cho `.mp4` (lý do ở 6.3) và mức nén mặc định cho `.txt` và `.json`.
- **FR-5** Nguồn tệp: nếu `video_parts.file_path` cục bộ còn tồn tại thì đọc cục bộ, nếu không thì `GetObject` từ R2 theo `r2_key` và copy luồng vào ZIP với buffer 64 KB.
- **FR-6** Một tệp lỗi giữa chừng không làm hỏng cả ZIP: bỏ qua tệp đó và ghi thêm `_LOI_TAI_TEP.txt` ở cuối ZIP liệt kê các tệp lỗi kèm lý do.
- **FR-7** Header: `Content-Disposition: attachment; filename*=UTF-8''<ten-bai-giang>.zip` (hỗ trợ tên tiếng Việt), `Content-Type: application/zip`. Không gửi `Content-Length` vì không biết trước.
- **FR-8** Mỗi người dùng chỉ chạy tối đa 2 lần tải ZIP đồng thời; vượt quá thì trả 429 (dùng chung cơ chế với F06).
- **FR-9** Endpoint cũ `/api/video/download-zip` chuyển sang dùng chung `ZipExportService` (chỉ khi tìm được `videoId` theo `lesson`), có log cảnh báo deprecated và bị xoá sau 1 sprint.

### Phương án B (ghi lại, chưa làm)

Video có tổng dung lượng > 5 GB thì tạo job `EXPORT` (F09) để nén lên R2 rồi gửi link ký sẵn qua thông báo (F48). Chỉ làm khi phương án A không đủ.

## 5. Yêu cầu phi chức năng

- Heap tăng ≤ 16 MB cho mỗi request ZIP bất kể kích thước tệp.
- Thông lượng ≥ 50 MB/s khi đọc từ đĩa cục bộ.
- Người dùng huỷ tải giữa chừng thì server dừng đọc ngay (bắt `ClientAbortException` / `IOException: Broken pipe`, log ở mức DEBUG, không phải ERROR).
- `spring.mvc.async.request-timeout` đặt `-1` (không giới hạn) riêng cho request này, hoặc ≥ 60 phút.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

Không thêm bảng. Cần `video_parts.file_path VARCHAR(500)` nếu chưa có (`V6__video_parts_local_path.sql`):

```sql
ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/export.zip?include=clips,chapters,report` | Chủ video, Admin, hoặc người được chia sẻ (F40) | Tải ZIP dạng luồng |

Lỗi (trả trước khi bắt đầu ghi luồng): `VIDEO_NOT_FOUND` (404), `FORBIDDEN` (403), `NO_CLIPS_TO_EXPORT` (409, video chưa cắt clip nào), `TOO_MANY_DOWNLOADS` (429).

### 6.3 Backend

- Tạo `com.autocut.export.ZipExportService`:
  ```java
  public record ZipItem(String entryName, Supplier<InputStream> source, boolean compress) {}
  public List<ZipItem> planItems(long videoId, Set<String> include);   // thuần logic, dễ test
  public void writeZip(List<ZipItem> items, OutputStream out) throws IOException;
  ```
  Trong `writeZip`: với tệp không nén (`compress=false`) dùng `zos.setLevel(Deflater.NO_COMPRESSION)` trước `putNextEntry`, sau đó copy bằng `InputStream.transferTo` với buffer 64 KB. (`ZipEntry.STORED` đòi biết trước CRC và kích thước, nên không dùng.)
- Tạo `com.autocut.export.ExportController`, trả `ResponseEntity<StreamingResponseBody>`.
- `CloudflareR2Service`: thêm `InputStream openObject(String key)` (gọi `s3Client.getObject(...)` trả `ResponseInputStream`).
- Đánh dấu `VideoController.downloadZip` là `@Deprecated` và cho nó gọi qua `ZipExportService`.

### 6.5 Frontend

- `frontend/src/lib/api.ts`: thay hàm dựng URL `download-zip?lesson=` ([api.ts:237](../../../frontend/src/lib/api.ts#L237)) bằng `getExportZipUrl(videoId, include)`.
- Nút "Tải ZIP" trong `ExportProgressModal.tsx` dùng thẻ `<a href download>` (để trình duyệt tự quản lý tiến độ tải) thay vì `fetch` + `blob()`, vì `blob()` cũng nạp toàn bộ tệp vào RAM của trình duyệt.
- Sau F01, JWT phải đi được theo link tải: dùng cookie HttpOnly, hoặc vé tải ngắn hạn `?ticket=` như F10.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* backend chạy với `-Xmx512m` và video có 3 GB clip, *When* tải ZIP, *Then* tải thành công, không có `OutOfMemoryError`, heap đỉnh (xem qua Actuator/VisualVM) tăng ≤ 16 MB.
- **AC-2** — *Given* bấm "Tải ZIP", *When* đo thời gian, *Then* trình duyệt bắt đầu nhận byte trong ≤ 2 giây.
- **AC-3** — *Given* ZIP tải về, *When* giải nén, *Then* cấu trúc thư mục khớp `section_folder_template` và mọi clip phát được.
- **AC-4** — *Given* đã xoá tệp cục bộ của 2 clip, *When* tải ZIP, *Then* 2 clip đó được lấy từ R2 và ZIP vẫn đủ tệp.
- **AC-5** — *Given* 1 clip không còn ở cả cục bộ lẫn R2, *When* tải ZIP, *Then* ZIP có các clip còn lại cùng `_LOI_TAI_TEP.txt` ghi tên clip lỗi.
- **AC-6** — *Given* user B, *When* tải ZIP của video thuộc user A, *Then* nhận 403 trước khi có byte nào được gửi.
- **AC-7** — *Given* đang tải được 30%, *When* huỷ trên trình duyệt, *Then* server dừng đọc trong ≤ 2 giây và log không có ERROR.
- **AC-8** — Tên tệp ZIP có dấu tiếng Việt hiển thị đúng trên Chrome, Safari và Edge.

## 8. Kế hoạch kiểm thử (TDD)

- `ZipExportServiceTest.planItems_ordersBySectionTopicPart`
- `ZipExportServiceTest.planItems_usesNamingTemplateFromConfig`
- `ZipExportServiceTest.planItems_fallsBackToR2_whenLocalMissing`
- `ZipExportServiceTest.writeZip_mp4EntriesAreNotCompressed` (kiểm `compressedSize ≈ size`)
- `ZipExportServiceTest.writeZip_failingSource_isSkipped_andListedInErrorFile`
- `ZipExportServiceTest.writeZip_largeInput_usesBoundedMemory` (luồng giả 500 MB sinh byte ngẫu nhiên, so sánh `Runtime.totalMemory()` trước và sau)
- `ExportControllerTest.otherUser_returns403`
- `ExportControllerTest.noCompletedParts_returns409`
- `ExportControllerTest.contentDisposition_isRfc5987Encoded`
- Sửa test cũ trong `VideoControllerTest` liên quan `download-zip` cho chạy qua với cách làm mới (không xoá).

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Lỗi giữa luồng sau khi đã gửi header 200 | Không đổi được mã lỗi HTTP, ZIP bị cụt | Lỗi theo từng tệp thì ghi vào `_LOI_TAI_TEP.txt`; lỗi nghiêm trọng thì đóng kết nối, trình duyệt báo "Tải không thành công" |
| ZIP > 4 GB hoặc > 65.535 tệp | Cần định dạng ZIP64 | `ZipOutputStream` của Java tự dùng ZIP64 khi cần; thêm test với tệp giả > 4 GB (đánh dấu là test chậm, chạy trong CI ban đêm) |
| Đọc từ R2 chậm | Tải lâu | Chấp nhận; có thể dùng phương án B về sau |
| Request giữ thread Tomcat lâu | Hết thread | `StreamingResponseBody` chạy trên async executor riêng (cấu hình `spring.mvc.async` với pool 8 luồng) |

## 10. Câu hỏi mở

- [ ] Có đưa video gốc vào ZIP không? Mặc định là không.
- [ ] Ngưỡng nào thì chuyển sang phương án B (nén nền, gửi link)?
- [ ] Người được chia sẻ link (F40) có được tải ZIP không?
