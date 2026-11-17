# F22 — Xuất chapters YouTube / WebVTT / JSON

| Mục | Giá trị |
|---|---|
| **Mã** | F22 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (service + API) + SV4 (nút tải, xem trước) |
| **Phụ thuộc** | F02 (quyền), F04 (tải tệp an toàn). F21 không bắt buộc nhưng giúp tiêu đề đẹp hơn |
| **Ước lượng** | S (≤ 2 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | YouTube Chapters, Vimeo Chapters, chuẩn WebVTT (`kind="chapters"`) |

## 1. Bối cảnh & vấn đề

- Đã có `BatchVideoCutService.generateChaptersContent` ([BatchVideoCutService.java:294](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L294)). Hàm này sinh `chapters.txt` với định dạng `mm:ss - Phần N: <topic>` nhưng **chỉ chạy sau khi cắt hàng loạt** (dòng 244–258). Người dùng không lấy được chapters nếu không cắt clip.
- Định dạng hiện tại chưa đạt yêu cầu của YouTube:
  - YouTube cần **ít nhất 3 chương**, chương đầu bắt đầu tại `00:00`, mỗi chương **≥ 10 giây**. Hiện không có bước kiểm tra nào.
  - Tiền tố "Phần N:" lặp lại làm tiêu đề dài và rối.
  - Các đoạn bị loại vì "ngoài lề" (`OFF_TOPIC_PATTERN`, [CutPointService.java:24](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L24)) gây khoảng trống: chương trước đó sẽ "kéo dài" phủ luôn đoạn bị loại.
- Không có định dạng WebVTT chapters cho trình phát HTML5 (F39, F41), cũng không có JSON cho Public API (F50).
- `config.yaml` có `output.export_chapters: true` nhưng Java không đọc khoá này.

## 2. Mục tiêu

- Xuất chapters **bất kỳ lúc nào** sau khi có segments (không cần cắt clip trước), với 3 định dạng: `youtube` (txt), `vtt`, `json`.
- Hỗ trợ 2 trục thời gian:
  - `source`: theo video gốc, dùng khi đăng nguyên video lên YouTube.
  - `concat`: theo video ghép từ các đoạn được giữ lại (`VideoConcat`), có tính lại mốc thời gian sau khi bỏ đoạn.
- Kiểm tra quy tắc YouTube và trả cảnh báo rõ ràng.

### Ngoài phạm vi

- Không tự đẩy chapters lên YouTube (thuộc F42).

## 3. User stories

- Là giảng viên, tôi muốn copy một khối text dán vào mô tả YouTube để video có mục lục chương.
- Là người phát triển trang khoá học (F41), tôi muốn tệp `.vtt` chapters để trình phát hiện danh sách chương.

## 4. Yêu cầu chức năng

- **FR-1** Lấy danh sách topic `ACTIVE` từ DB (sau F13) hoặc từ `SegmentsDTO` trong bộ nhớ, sắp theo `start`.
- **FR-2** Định dạng `youtube`: mỗi dòng `HH:MM:SS Tiêu đề` (bỏ giờ nếu video < 1 giờ: `MM:SS`). Không có tiền tố "Phần N". Tuỳ chọn `includeSection=true` thêm dòng tiêu đề section in hoa không có mốc thời gian **chỉ ở định dạng txt** (YouTube bỏ qua dòng không có mốc).
- **FR-3** Định dạng `vtt`:
  ```
  WEBVTT

  1
  00:00:00.000 --> 00:06:52.350
  Tổng quan và mục lục bài giảng
  ```
- **FR-4** Định dạng `json`: `[{ "index":1, "start":0.0, "end":412.35, "title":"...", "section":"Giới thiệu" }]`.
- **FR-5** Kiểm tra YouTube (chỉ áp cho `youtube`):
  - Chương đầu ≠ 0 → tự đặt về `00:00` và cảnh báo `FIRST_NOT_ZERO_FIXED`.
  - Chương < 10s → gộp vào chương liền trước, cảnh báo `SHORT_CHAPTER_MERGED`.
  - Ít hơn 3 chương → vẫn trả nội dung, kèm cảnh báo `TOO_FEW_CHAPTERS` ("YouTube sẽ không hiển thị chương").
- **FR-6** Trục `concat`: mốc của mỗi chương = tổng thời lượng các đoạn được giữ trước nó (có tính `padding_start/end` trong [config.yaml](../../../config.yaml) mục `output`).
- **FR-7** Tiêu đề được làm sạch: bỏ xuống dòng, cắt ≤ 100 ký tự, giữ dấu tiếng Việt.
- **FR-8** `generateChaptersContent` hiện có gọi sang service mới để chỉ còn một nguồn sinh duy nhất. `chapters.txt` trong job cắt dùng trục `concat`.

## 5. Yêu cầu phi chức năng

- Trả về ≤ 200ms cho 100 chương. Tệp UTF-8 không BOM.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

Không thay đổi.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/chapters?format=youtube\|vtt\|json&timeline=source\|concat&includeSection=false` | Chủ video / link chia sẻ (F40) | Trả nội dung |

- `format=youtube` → `text/plain; charset=utf-8`; `vtt` → `text/vtt`; `json` → `application/json`.
- Thêm `download=true` → header `Content-Disposition: attachment; filename="<slug>_chapters.<ext>"`.
- Cảnh báo trả qua header `X-Chapter-Warnings: SHORT_CHAPTER_MERGED,TOO_FEW_CHAPTERS`. Với `json`, cảnh báo nằm trong body:
```json
{ "chapters": [ ... ], "warnings": [ { "code": "SHORT_CHAPTER_MERGED", "message": "Chương 'Hỏi nhanh' dài 6s nên đã gộp vào chương trước" } ] }
```

### 6.3 Backend (Spring Boot)

- `service/ChapterService.java`:
  ```java
  public ChapterResult build(List<Segment> segments, Timeline timeline, double padStart, double padEnd);
  public String toYoutube(ChapterResult r, boolean includeSection);
  public String toVtt(ChapterResult r);
  ```
  Các hàm đều thuần (không đọc DB) để dễ test. Dùng lại `formatTimestamp` của `BatchVideoCutService` (dòng ~309) bằng cách chuyển nó thành tiện ích chung `video/TimeFormat.java`.
- `controller/ChapterController.java`.
- `BatchVideoCutService.generateChaptersContent` chuyển sang gọi `ChapterService` (FR-8). Sửa test cũ nếu định dạng đổi và ghi rõ lý do trong PR.

### 6.4 AI pipeline (Python)

Không thay đổi.

### 6.5 Frontend (Next.js)

- `StudioHeader.tsx`: menu "Xuất" thêm mục **"Chapters"**, mở popup gồm:
  - Chọn định dạng (YouTube / WebVTT / JSON) và trục thời gian.
  - Ô xem trước có nút **"Sao chép"**.
  - Danh sách cảnh báo màu vàng; dùng chữ `charcoal`, không dùng màu vàng làm màu chữ.
- `ExportProgressModal.tsx`: sau khi cắt xong, link `chapters.txt` dùng API mới.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* 4 topic bắt đầu ở 0, 412.35, 780.1, 1500. *When* `format=youtube`. *Then* nội dung là:
  ```
  00:00 Tổng quan
  06:52 Biến
  13:00 Vòng lặp for
  25:00 Tổng kết
  ```
- **AC-2** — *Given* topic thứ 2 dài 6s. *Then* nó được gộp vào topic 1 và có cảnh báo `SHORT_CHAPTER_MERGED`.
- **AC-3** — *Given* video 1 giờ 5 phút. *Then* mọi mốc có dạng `H:MM:SS` (ví dụ `1:02:10`).
- **AC-4** — *Given* topic 2 (60s) bị loại vì ngoài lề, trục `concat`. *Then* topic 3 bắt đầu sớm hơn 60s (± padding) so với trục `source`.
- **AC-5** — Tệp `.vtt` hợp lệ: chạy qua bộ kiểm tra WebVTT (dùng `<track kind="chapters">` trong Chrome không báo lỗi console).
- **AC-6** — Người không phải chủ video gọi API thì nhận `403`.

## 8. Kế hoạch kiểm thử (TDD)

JUnit (`ChapterServiceTest`):
- `toYoutube_underOneHour_usesMmSs()`
- `toYoutube_overOneHour_usesHMmSs()`
- `build_firstChapterNotZero_isFixedWithWarning()`
- `build_shortChapter_mergedIntoPrevious()`
- `build_lessThanThreeChapters_warns()`
- `build_concatTimeline_shiftsAfterDroppedSegment()`
- `toVtt_producesValidHeaderAndCueTimes()`
- `sanitizeTitle_stripsNewlinesKeepsVietnamese()`

`ChapterControllerTest`:
- `get_vtt_returnsTextVttContentType()`
- `get_download_setsContentDisposition()`

Hồi quy: `BatchVideoCutServiceTest` (đã có) vẫn chạy qua sau khi chuyển sang `ChapterService`.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Trục `concat` lệch so với video ghép thật do làm tròn khung hình hoặc re-encode | Chương lệch 0,1–0,5s | Lấy thời lượng thật của từng clip đã cắt (`CutResult`) khi có, chỉ tính lý thuyết khi chưa cắt |
| Đổi định dạng `chapters.txt` ảnh hưởng người đang dùng | Nhầm lẫn | Ghi chú trong changelog |

## 10. Câu hỏi mở

- [ ] Giữ tiền tố "Phần N" như tuỳ chọn hay bỏ hẳn?
- [ ] Khi dưới 3 chương, có tự tách chương dài cho đủ 3 không, hay chỉ cảnh báo?
