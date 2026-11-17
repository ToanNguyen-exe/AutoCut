# F43 — Tự tạo ảnh bìa (thumbnail)

| Mục | Giá trị |
|---|---|
| **Mã** | F43 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV1 (FFmpeg trích khung, vẽ chữ) · SV3 (API, lưu R2) · SV4 (chọn và đổi ảnh bìa) |
| **Phụ thuộc** | F09 (job nền), F13. Không bắt buộc: F21 (tiêu đề AI), F44 (logo thương hiệu) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không có thư viện code mới. Cần duyệt **một tệp font**: `Be Vietnam Pro Bold` (SIL Open Font License 1.1, Google Fonts), có đủ dấu tiếng Việt. Đặt ở `backend/src/main/resources/fonts/` và ghi nguồn + giấy phép vào README. |
| **Tham khảo** | YouTube (3 ảnh gợi ý tự động), Vimeo thumbnail picker, Opus Clip, Panopto |

## 1. Bối cảnh & vấn đề

- Clip sinh ra trong `BatchVideoCutService.executeJob` ([BatchVideoCutService.java:186-232](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L186-L232)) chỉ có MP4 + `CutClipInfo`, **không có ảnh đại diện**. Thư viện video và danh sách clip ([ExportProgressModal.tsx:302-330](../../../frontend/src/components/ExportProgressModal.tsx#L302-L330)) chỉ hiện tên tệp, nhìn rất khó phân biệt.
- Các tính năng phía sau đều cần ảnh: F40 (thẻ `og:image` khi dán link vào Zalo/Facebook), F41 (ảnh bìa khoá học và bài học), F42 (`thumbnails.set` cho YouTube).
- Khung hình đầu của clip thường là màn hình đen, hoặc slide chuyển dở do `padding_start` ([VideoProps.java:22](../../../backend/src/main/java/com/autocut/video/VideoProps.java#L22)) lùi 0,3 giây. Lấy khung ở giây 0 thường cho ảnh xấu.

## 2. Mục tiêu

- Mỗi clip tự có **3 ảnh gợi ý** (khung hình đẹp) và **1 ảnh bìa có chữ** (khung hình + tiêu đề + nhãn section).
- Giảng viên chọn ảnh khác hoặc tự upload ảnh riêng.
- Ảnh đạt chuẩn YouTube: 1280×720, JPEG, < 2 MB.

### Ngoài phạm vi
- AI sinh ảnh (diffusion).
- Nhận diện khuôn mặt để chọn khung có mặt giảng viên. Có thể làm sau bằng heuristic của F26.
- Ảnh động GIF hoặc preview khi rê chuột (làm ở F38).

## 3. User stories

- Là **giảng viên**, tôi muốn mỗi clip có sẵn ảnh bìa ghi "03 · Cú pháp vòng lặp for" để học viên nhìn là biết nội dung.
- Là **giảng viên**, tôi muốn bấm vào 1 trong 3 ảnh gợi ý để đổi ảnh bìa.
- Là **giảng viên**, tôi muốn kéo tới đúng giây có slide đẹp trên trình phát rồi bấm "Lấy khung hình này làm ảnh bìa".

## 4. Yêu cầu chức năng

- **FR-1** Khi một clip chuyển sang `COMPLETED`, tạo job `THUMBNAIL` cho clip đó.
- **FR-2** Chọn 3 khung gợi ý:
  1. Chia clip thành 3 đoạn bằng nhau.
  2. Trong mỗi đoạn, dùng filter `thumbnail` của FFmpeg (chọn khung tiêu biểu nhất trong mỗi nhóm N khung) và bỏ qua 1 giây đầu.
  3. Loại khung quá tối (độ sáng trung bình `YAVG < 20` theo `signalstats`) và thử khung kế tiếp.
- **FR-3** Ảnh bìa có chữ (template mặc định):
  - Nền là khung gợi ý số 1, thu về 1280×720 (giữ tỉ lệ, viền đen nếu cần), phủ dải gradient đen 60% ở 1/3 dưới.
  - Dòng 1: nhãn section + số thứ tự (`LÝ THUYẾT · 03`), cỡ 36px, màu trắng 80%.
  - Dòng 2: tiêu đề clip, cỡ 64px đậm, màu trắng, tối đa 2 dòng, cắt bằng `…`.
  - Góc phải trên: logo (nếu đã cấu hình ở F44).
- **FR-4** Người dùng có thể:
  - (a) chọn 1 trong 3 khung gợi ý hoặc ảnh có chữ;
  - (b) lấy khung tại giây `t` bất kỳ;
  - (c) upload ảnh JPEG/PNG ≤ 5 MB; server tự thu về 1280×720 và nén JPEG chất lượng 85.
- **FR-5** Đổi tiêu đề clip (F21 hoặc sửa tay) thì sinh lại ảnh có chữ, **trừ khi** người dùng đã chọn ảnh tự upload.
- **FR-6** Mỗi ảnh có thêm bản nhỏ 320×180 dùng cho danh sách.

## 5. Yêu cầu phi chức năng

- Sinh xong 4 ảnh của một clip 5 phút trong ≤ 5 giây (FFmpeg dùng `-ss` trước `-i` để tua nhanh).
- Ảnh trên R2 đặt `Cache-Control: public, max-age=31536000, immutable`. Tên tệp chứa hash nội dung, nên đổi ảnh là đổi URL và không cần xoá cache.
- Chữ tiếng Việt hiển thị đúng dấu. Kiểm tra bằng ảnh mẫu chứa "Ứng dụng đệ quy – Tổng kết".

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__add_thumbnails.sql`:

```sql
CREATE TABLE IF NOT EXISTS thumbnails (
    id BIGSERIAL PRIMARY KEY,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,           -- CANDIDATE | TITLED | FRAME | UPLOAD
    at_sec DOUBLE PRECISION,             -- vị trí khung (null với UPLOAD)
    r2_key VARCHAR(500) NOT NULL,
    r2_key_small VARCHAR(500) NOT NULL,
    width INTEGER NOT NULL DEFAULT 1280,
    height INTEGER NOT NULL DEFAULT 720,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_thumbs_part ON thumbnails(video_part_id);

ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS cover_thumbnail_id BIGINT REFERENCES thumbnails(id) ON DELETE SET NULL;
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/parts/{partId}/thumbnails` | Chủ clip | Danh sách ảnh + ảnh bìa đang chọn |
| PUT | `/api/v1/parts/{partId}/cover` | Chủ clip | `{ "thumbnailId": 81 }` |
| POST | `/api/v1/parts/{partId}/thumbnails/frame` | Chủ clip | `{ "atSec": 47.2 }` → tạo ảnh `FRAME` và chọn luôn |
| POST | `/api/v1/parts/{partId}/thumbnails/upload` | Chủ clip | `multipart/form-data`, trường `file` |
| POST | `/api/v1/parts/{partId}/thumbnails:regenerate` | Chủ clip | Sinh lại ảnh gợi ý và ảnh có chữ |

Response `GET`:

```json
{
  "coverId": 84,
  "items": [
    { "id": 81, "kind": "CANDIDATE", "atSec": 12.0, "url": "https://cdn/.../c1_9f3a.jpg", "smallUrl": "https://cdn/.../c1_9f3a_s.jpg" },
    { "id": 82, "kind": "CANDIDATE", "atSec": 55.5, "url": "..." },
    { "id": 83, "kind": "CANDIDATE", "atSec": 98.1, "url": "..." },
    { "id": 84, "kind": "TITLED", "atSec": 12.0, "url": "..." }
  ]
}
```

Lỗi: `400 INVALID_IMAGE` (sai định dạng hoặc > 5 MB), `400 AT_SEC_OUT_OF_RANGE`.

### 6.3 Backend (Spring Boot)

- **Tạo** `video/ThumbnailExtractor` (SV1):
  - `File extractAt(File clip, double atSec, Path out)`
  - `List<Double> pickCandidates(File clip, double durationSec)`
  - `File renderTitled(File frame, String kicker, String title, Path logoOrNull, Path out)`
  - Chạy lệnh bằng `ProcessBuilder` + `StreamUtil`, timeout theo `VideoProps.cutTimeoutSeconds`.
- **Tạo** `service/ThumbnailService` (SV3): điều phối job, upload R2 qua `CloudflareR2Service.uploadFile` ([CloudflareR2Service.java:98](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L98)), ghi bảng `thumbnails`.
- Khi `kind = UPLOAD`: dùng FFmpeg để kiểm tra và thu nhỏ ảnh. Không tin phần mở rộng tệp; kiểm tra magic bytes `FFD8FF` (JPEG) và `89504E47` (PNG).
- Tiêu đề đưa vào `drawtext` **phải ghi ra tệp tạm và dùng `textfile=`**, không nhúng thẳng vào chuỗi filter, để tránh lỗi escape với `:` `'` `%` `\` (đây cũng là lỗ hổng injection vào filtergraph).

Lệnh FFmpeg mẫu:

```bash
# 1) Khung tiêu biểu trong đoạn [t0, t0+d] (bỏ 1s đầu)
ffmpeg -y -ss 1.0 -t 60 -i clip.mp4 -vf "thumbnail=150,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" -frames:v 1 -q:v 3 c1.jpg

# 2) Đo độ sáng để loại khung tối
ffmpeg -i c1.jpg -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 | grep YAVG

# 3) Khung tại giây bất kỳ (tua nhanh nhờ -ss trước -i)
ffmpeg -y -ss 47.2 -i clip.mp4 -frames:v 1 -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" -q:v 3 frame.jpg

# 4) Ảnh bìa có chữ
ffmpeg -y -i c1.jpg -i logo.png -filter_complex "\
[0:v]drawbox=x=0:y=ih*2/3:w=iw:h=ih/3:color=black@0.6:t=fill,\
drawtext=fontfile=BeVietnamPro-Bold.ttf:textfile=kicker.txt:fontsize=36:fontcolor=white@0.8:x=64:y=h-230,\
drawtext=fontfile=BeVietnamPro-Bold.ttf:textfile=title.txt:fontsize=64:fontcolor=white:x=64:y=h-170:line_spacing=12[bg];\
[1:v]scale=-1:72[lg];[bg][lg]overlay=W-w-48:48" -frames:v 1 -q:v 3 titled.jpg

# 5) Bản nhỏ
ffmpeg -y -i titled.jpg -vf scale=320:180 -q:v 5 titled_s.jpg
```

- Ngắt dòng tiêu đề: `drawtext` không tự xuống dòng. `TitleWrapper.wrap(title, maxCharsPerLine=32, maxLines=2)` chia theo từ, thêm `…` khi dài quá, rồi ghi vào `title.txt` (UTF-8, ngắt dòng bằng `\n`).

### 6.5 Frontend (Next.js)

- **Tạo** `components/ThumbnailPicker.tsx`: lưới 4 ô; ô đang chọn có viền `ring`; nút "Lấy khung hình hiện tại" (lấy `currentTime` của trình phát) và nút "Tải ảnh lên".
- Mở từ `SegmentDetailModal.tsx` (tab mới "Ảnh bìa") và từ danh sách clip trong `ExportProgressModal.tsx`.
- Hiện ảnh nhỏ 320×180 ở danh sách clip và thư viện (`VideoLibraryColumn.tsx`). Thẻ `<img>` có `loading="lazy"` và `alt` = tiêu đề clip.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* clip 3 phút vừa cắt xong, *When* job THUMBNAIL hoàn tất, *Then* có 3 ảnh `CANDIDATE` + 1 ảnh `TITLED` (1280×720, mỗi ảnh < 2 MB), và `cover_thumbnail_id` trỏ tới ảnh `TITLED`.
- **AC-2** — *Given* clip có 2 giây đầu đen, *Then* không có ảnh gợi ý nào có `YAVG < 20`.
- **AC-3** — *Given* tiêu đề "Ứng dụng đệ quy: tính n! – ví dụ 'giai thừa' 100%", *When* sinh ảnh có chữ, *Then* ảnh hiển thị đúng toàn bộ ký tự và dấu, FFmpeg không báo lỗi.
- **AC-4** — *Given* tiêu đề dài 120 ký tự, *Then* ảnh chỉ có 2 dòng tiêu đề và dòng thứ 2 kết thúc bằng `…`.
- **AC-5** — *Given* upload tệp `.jpg` nhưng thực chất là PDF, *Then* nhận `400 INVALID_IMAGE`.
- **AC-6** — *Given* người dùng đã upload ảnh riêng, *When* đổi tiêu đề clip, *Then* ảnh bìa không đổi.
- **AC-7** — *Given* `atSec = 47.2`, *When* gọi `/thumbnails/frame`, *Then* ảnh trả về đúng khung tại giây đó (so với ảnh chụp tay từ trình phát, lệch ≤ 1 khung).

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `TitleWrapperTest.wrap_twoLines_ellipsis` / `wrap_keepsVietnameseDiacritics` / `wrap_singleLongWord_hardBreak` | unit |
| `ThumbnailExtractorTest.buildTitledCommand_usesTextfileNotInlineText` | unit (khẳng định lệnh không chứa nguyên văn tiêu đề) |
| `ThumbnailExtractorTest.pickCandidates_splitsInto3Windows_skipsFirstSecond` | unit |
| `ThumbnailExtractorTest.extract_onTestsrc_produces1280x720` | integration `@Tag("ffmpeg")`, nguồn `ffmpeg -f lavfi -i testsrc=duration=10` |
| `ThumbnailExtractorTest.darkFrame_rejected` | integration, nguồn `color=black:d=3` nối với `testsrc` |
| `ImageMagicBytesTest.pdfRenamedJpg_rejected` | unit |
| `ThumbnailControllerTest.atSecOutOfRange_400` / `notOwner_403` | MockMvc |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Máy chủ hoặc container thiếu font, hoặc FFmpeg build không có `--enable-libfreetype` | `drawtext` lỗi, không sinh được ảnh có chữ | Font nằm trong resources và được giải nén ra thư mục tạm khi khởi động. Kiểm tra `ffmpeg -filters | grep drawtext` lúc khởi động; nếu thiếu thì log cảnh báo và chỉ sinh ảnh không chữ (vẫn có log, không nuốt lỗi). Dockerfile ở F14 cần cài FFmpeg bản đầy đủ |
| Tiêu đề chứa ký tự đặc biệt phá filtergraph | Lỗi lệnh hoặc injection | Bắt buộc dùng `textfile=` (xem 6.3) |
| Quay màn hình code có nền tối | Lọc `YAVG < 20` loại mất khung hợp lệ | Ngưỡng cấu hình được trong `config.yaml` (`output.thumbnail_min_luma`); nếu cả 3 khung đều tối thì vẫn lấy khung tốt nhất |
| Bùng số ảnh trên R2 | Tốn dung lượng | Mỗi ảnh khoảng 150 KB; khi người dùng chọn lại thì job dọn (F17) xoá ảnh `FRAME` cũ không dùng |

## 10. Câu hỏi mở

- [ ] Duyệt font **Be Vietnam Pro** (OFL), hay trường có font thương hiệu riêng?
- [ ] Ảnh bìa mặc định nên là ảnh **có chữ** hay **khung gợi ý không chữ**? YouTube thường dùng ảnh có chữ, còn trang khoá học (F41) có thể đẹp hơn khi không chữ.
- [ ] Màu dải gradient và vị trí chữ có cần chỉnh theo tổ chức không? Nếu có thì đưa vào cấu hình thương hiệu của F44.
