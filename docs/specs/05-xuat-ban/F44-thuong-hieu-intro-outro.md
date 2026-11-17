# F44 — Logo, watermark, intro/outro (bộ nhận diện thương hiệu)

| Mục | Giá trị |
|---|---|
| **Mã** | F44 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV1 (filter FFmpeg, ghép intro/outro) · SV3 (lưu cấu hình, tài nguyên) · SV4 (trang cài đặt thương hiệu, xem trước) |
| **Phụ thuộc** | F02, F09, F13. Liên quan F43 (logo trên ảnh bìa), F45 (bố cục logo cho khung dọc), F49 (thương hiệu theo tổ chức) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không (dùng FFmpeg sẵn có). Font cho watermark chữ dùng chung tệp với F43. |
| **Tham khảo** | Descript Brand Studio, Riverside Brand Kit, Kaltura Player branding, Vimeo "Custom logo" |

## 1. Bối cảnh & vấn đề

- `VideoCutter` đã **mã hoá lại** (re-encode) mọi clip bằng `libx264 -preset fast -crf 22` ([VideoCutter.java:212](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L212), [VideoCutter.java:346-351](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L346-L351)). Vì video đã được giải mã và mã hoá lại trong bước này, thêm filter `overlay` vào cùng lệnh gần như **không tốn thêm thời gian**, không cần một lượt encode thứ hai.
- `config.yaml` có `output.cut_mode: accurate | fast`. Chế độ `fast` (stream copy, không mã hoá lại) **không thể** chèn logo. Spec cần quy định rõ hành vi trong trường hợp này.
- `VideoConcat` đã có 2 cách ghép: demuxer `-c copy` ([VideoConcat.java:292-301](../../../backend/src/main/java/com/autocut/video/VideoConcat.java#L292-L301)) và `concatWithFilter` dự phòng khi các tệp khác thông số ([VideoConcat.java:165](../../../backend/src/main/java/com/autocut/video/VideoConcat.java#L165), [VideoConcat.java:249](../../../backend/src/main/java/com/autocut/video/VideoConcat.java#L249)). Có thể dùng lại để ghép intro + clip + outro.
- Hiện chưa có chỗ nào lưu logo, màu hay intro của trường hoặc giảng viên. Clip xuất ra trông "thô" và dễ bị lấy lại đăng lên kênh khác mà không có dấu nguồn.

## 2. Mục tiêu

- Mỗi người dùng (sau F49 là mỗi tổ chức) có **một hoặc nhiều Brand Kit** gồm: logo PNG, vị trí, độ mờ, kích thước; watermark chữ (ví dụ "© Khoa CNTT – ĐH X"); video intro và outro; màu chủ đạo.
- Khi cắt hoặc xuất clip, chọn Brand Kit để áp dụng. Logo và watermark được ghép trong **cùng lượt encode** với bước cắt.
- Có ảnh xem trước để giảng viên kiểm tra trước khi chạy cả loạt.

### Ngoài phạm vi
- Watermark động theo từng người xem (ví dụ in email học viên để chống quay lén). Việc này cần phát lại theo từng người và nên thuộc spec DRM riêng.
- Lower-third động (chạy tên giảng viên), hiệu ứng chuyển cảnh.
- Nhạc nền. Nếu làm sau thì phải dùng nhạc có giấy phép rõ ràng.

## 3. User stories

- Là **giảng viên**, tôi muốn mọi clip có logo trường ở góc phải trên, mờ 70%, để video được nhận diện khi chia sẻ.
- Là **giảng viên**, tôi muốn mỗi clip mở đầu bằng intro 3 giây có logo khoa và kết thúc bằng outro "Đăng ký kênh".
- Là **giảng viên**, tôi muốn xem trước một khung hình có logo trước khi xuất 20 clip.
- Là **giảng viên**, tôi muốn tắt intro/outro cho clip ngắn dưới 60 giây.

## 4. Yêu cầu chức năng

- **FR-1** Brand Kit gồm:
  - `logo`: PNG có kênh alpha, ≤ 2 MB, cạnh dài ≤ 2000px.
  - `logo_position`: `TOP_LEFT | TOP_RIGHT | BOTTOM_LEFT | BOTTOM_RIGHT`.
  - `logo_scale`: tỉ lệ chiều cao logo so với chiều cao video, 0,05–0,25, mặc định 0,10.
  - `logo_opacity`: 0,2–1,0, mặc định 0,8.
  - `logo_margin`: tỉ lệ so với chiều cao video, mặc định 0,03.
  - `text_watermark`: ≤ 80 ký tự, không bắt buộc. Cỡ chữ 2,5% chiều cao, góc đối diện logo, mờ 60%.
  - `intro_video`, `outro_video`: MP4 ≤ 15 giây, ≤ 100 MB.
  - `skip_intro_outro_under_sec`: mặc định 60.
  - `primary_color`: mã hex, dùng cho F43 và trang F41.
- **FR-2** Có một Brand Kit mặc định. Khi gửi job cắt (`CutRequestDTO`), thêm trường `brandKitId` (giá trị `null` = dùng mặc định, `0` = không áp dụng thương hiệu).
- **FR-3** Logo và watermark được áp **trong lượt encode của `VideoCutter`**: mở rộng tham số `-vf` / `-filter_complex` của lệnh cắt hiện tại.
- **FR-4** Nếu `cut_mode = fast` mà Brand Kit có logo hoặc watermark thì **tự chuyển sang `accurate`** cho job đó và ghi vào `report.json`: `"brandingForcedReencode": true`.
- **FR-5** Intro/outro:
  - Khi upload, chuẩn hoá ngay một lần về thông số chuẩn của hệ thống: 1920×1080 (hoặc theo F45), 30 fps, `yuv420p`, AAC 48 kHz stereo. Lưu bản đã chuẩn hoá.
  - Khi xuất: nếu clip có cùng thông số thì dùng concat demuxer `-c copy` (nhanh). Nếu khác (clip 720p, 25 fps) thì dùng `concatWithFilter`.
- **FR-6** Clip ngắn hơn `skip_intro_outro_under_sec` thì không chèn intro/outro, nhưng vẫn có logo.
- **FR-7** Chèn intro sẽ làm lệch thời gian. Chapters (F22), phụ đề (F23) và tiến độ xem (F41) của clip có intro phải **cộng thêm `introDurationSec`**. Mỗi clip lưu `intro_offset_sec`.
- **FR-8** API xem trước: trả 1 ảnh JPEG khung hình tại giây `t` của clip với Brand Kit đang chỉnh (chưa lưu). Thời gian phản hồi ≤ 2 giây.

## 5. Yêu cầu phi chức năng

- Thời gian cắt clip khi có logo tăng không quá 10% so với khi không có logo (đo trên cùng một clip 5 phút, ghi kết quả vào PR).
- Logo được đặt theo **tỉ lệ** chiều cao video, nên trông giống nhau ở 360p, 720p và 1080p, và ở khung dọc (F45).
- Kiểm tra tệp upload bằng magic bytes (PNG `89504E47`, MP4 `ftyp` ở byte 4–7) và `VideoValidator` ([VideoValidator.java:62](../../../backend/src/main/java/com/autocut/video/VideoValidator.java#L62)).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_brand_kits.sql`:

```sql
CREATE TABLE IF NOT EXISTS brand_kits (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    logo_r2_key VARCHAR(500),
    logo_position VARCHAR(20) NOT NULL DEFAULT 'TOP_RIGHT',
    logo_scale NUMERIC(4,3) NOT NULL DEFAULT 0.100 CHECK (logo_scale BETWEEN 0.05 AND 0.25),
    logo_opacity NUMERIC(3,2) NOT NULL DEFAULT 0.80 CHECK (logo_opacity BETWEEN 0.2 AND 1.0),
    logo_margin NUMERIC(4,3) NOT NULL DEFAULT 0.030,
    text_watermark VARCHAR(80),
    intro_r2_key VARCHAR(500),
    intro_duration_sec DOUBLE PRECISION,
    outro_r2_key VARCHAR(500),
    outro_duration_sec DOUBLE PRECISION,
    skip_intro_outro_under_sec INTEGER NOT NULL DEFAULT 60,
    primary_color VARCHAR(7) DEFAULT '#1E3A8A',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_default ON brand_kits(owner_id) WHERE is_default;

ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS brand_kit_id BIGINT REFERENCES brand_kits(id) ON DELETE SET NULL;
ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS intro_offset_sec DOUBLE PRECISION NOT NULL DEFAULT 0;
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET/POST | `/api/v1/brand-kits` | Giảng viên | Liệt kê / tạo |
| PATCH/DELETE | `/api/v1/brand-kits/{id}` | Chủ kit | Sửa / xoá |
| POST | `/api/v1/brand-kits/{id}/assets/{logo\|intro\|outro}` | Chủ kit | Upload `multipart` |
| POST | `/api/v1/brand-kits/preview` | Giảng viên | Body: cấu hình tạm + `partId` + `atSec` → `image/jpeg` |

Mở rộng `POST /api/video/cut` (`CutRequestDTO`, [Models.java:130](../../../backend/src/main/java/com/autocut/dto/Models.java#L130)): thêm trường `"brand_kit_id": 3` (có alias `brandKitId`). Khi F09 xong và endpoint chuyển sang `/api/v1/cut-jobs` thì giữ nguyên trường này.

### 6.3 Backend (Spring Boot)

- **Tạo** `video/BrandingFilterBuilder` (SV1), hàm thuần không có I/O để dễ test:

  ```java
  record BrandingSpec(Path logo, Corner corner, double scale, double opacity, double margin, Path watermarkTextFile, Path fontFile) {}
  /** Trả filter_complex hoặc null nếu không có gì để vẽ. Đầu vào [0:v], logo là input [1:v], đầu ra [vout]. */
  String build(BrandingSpec spec);
  ```

- **Sửa** `VideoCutter.buildCutCommand(...)` ([VideoCutter.java:337-360](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L337-L360)): thêm tham số `BrandingSpec branding` có thể `null`. Khi khác `null`:
  - thêm `-i logo.png`;
  - thay phần video bằng `-filter_complex <...> -map [vout] -map 0:a?`;
  - giữ nguyên `-c:v libx264 -preset fast -crf 22 -c:a aac -movflags +faststart`.
  - Giữ nguyên các overload cũ để test hiện có không phải sửa.
- **Sửa** `BatchVideoCutService.executeJob` ([BatchVideoCutService.java:199-205](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L199-L205)): tải tài nguyên Brand Kit từ R2 về thư mục tạm **một lần cho cả job**, truyền `BrandingSpec` vào mỗi lần cắt. Sau khi cắt, nếu cần intro/outro thì gọi `VideoConcat.concat(List.of(intro, clip, outro), out)` và ghi `intro_offset_sec`.
- **Tạo** `service/BrandKitService`: CRUD, chuẩn hoá intro/outro khi upload (job nền), dựng ảnh xem trước.

Lệnh FFmpeg mẫu: cắt + logo góc phải trên + watermark chữ góc trái dưới, trong một lượt:

```bash
ffmpeg -y -ss 120.3 -to 245.5 -i source.mp4 -i logo.png -filter_complex "\
[1:v]format=rgba,colorchannelmixer=aa=0.8[lg0];\
[lg0][0:v]scale2ref=w=oh*mdar:h=ih*0.10[lg][base];\
[base][lg]overlay=x=W-w-H*0.03:y=H*0.03[v1];\
[v1]drawtext=fontfile=BeVietnamPro-Bold.ttf:textfile=wm.txt:fontsize=h*0.025:fontcolor=white@0.6:x=h*0.03:y=h-th-h*0.03[vout]" \
-map "[vout]" -map 0:a? -c:v libx264 -preset fast -crf 22 -c:a aac \
-avoid_negative_ts make_zero -movflags +faststart out.mp4
```

Chuẩn hoá intro khi upload:

```bash
ffmpeg -y -i intro_raw.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 -c:a aac -ar 48000 -ac 2 -movflags +faststart intro_norm.mp4
# Nếu intro không có tiếng: thêm -f lavfi -i anullsrc=r=48000:cl=stereo -shortest để concat demuxer không lỗi thiếu luồng audio
```

### 6.5 Frontend (Next.js)

- `app/settings/brand/page.tsx`: danh sách Brand Kit, form chỉnh sửa, upload logo/intro/outro.
- `components/BrandPreview.tsx`: hiện ảnh xem trước từ API, gọi lại 500 ms sau lần chỉnh cuối (debounce). Có thanh trượt cho scale và opacity, lưới 4 góc để chọn vị trí.
- `ExportProgressModal.tsx` / nơi bấm "Xuất clip": thêm dropdown "Thương hiệu: [Mặc định ▾] / Không dùng".

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* Brand Kit logo `TOP_RIGHT`, scale 0,10, *When* xuất clip 1080p, *Then* logo cao 108px (±2px), cách mép trên và mép phải 32px (±2px). Kiểm tra bằng ảnh chụp khung hình.
- **AC-2** — Cùng Brand Kit, xuất clip 720p thì logo cao 72px (±2px).
- **AC-3** — *Given* `cut_mode = fast` và có logo, *When* cắt, *Then* clip vẫn có logo và `report.json` có `"brandingForcedReencode": true`.
- **AC-4** — *Given* intro 3 giây, clip 120 giây, *When* xuất, *Then* thời lượng clip ≈ 123 giây (±0,1), `intro_offset_sec = 3`, và chapter đầu tiên trong `chapters.txt` của clip bắt đầu `00:03`.
- **AC-5** — *Given* clip 45 giây, `skip_intro_outro_under_sec = 60`, *Then* clip không có intro/outro nhưng vẫn có logo.
- **AC-6** — *Given* intro không có âm thanh, *When* ghép với clip có âm thanh, *Then* ghép thành công, và âm thanh của clip không bị lệch so với hình (kiểm tra tay tại 3 điểm).
- **AC-7** — Thời gian cắt clip 5 phút có logo ≤ 110% thời gian cắt khi không có logo, đo 3 lần lấy trung bình.
- **AC-8** — *Given* `brandKitId = 0`, *Then* lệnh FFmpeg không có `overlay` và không có `-i logo.png`.

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `BrandingFilterBuilderTest.topRight_overlayExpression` / `bottomLeft_overlayExpression` | unit |
| `BrandingFilterBuilderTest.noLogoNoText_returnsNull` | unit |
| `BrandingFilterBuilderTest.textOnly_usesTextfile_notInline` | unit |
| `VideoCutterTest.buildCutCommand_withBranding_addsLogoInputAndMaps` | unit (bổ sung vào `VideoCutterTest` sẵn có) |
| `VideoCutterTest.buildCutCommand_nullBranding_unchanged` | unit (bảo vệ hành vi cũ) |
| `BatchVideoCutServiceTest.fastModeWithBranding_forcesAccurate_andReports` | unit (mock VideoCutter) |
| `IntroOffsetTest.chaptersShiftedByIntroDuration` | unit |
| `BrandingIntegrationTest.logoHeightMatchesScale_1080_and_720` | integration `@Tag("ffmpeg")`: logo màu đỏ đặc, đo vùng pixel đỏ trên khung trích ra |
| `BrandKitServiceTest.uploadNonPng_rejected` | unit |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Ghép intro bằng `concatWithFilter` buộc mã hoá lại toàn bộ clip | Thời gian xuất tăng gấp đôi | Chuẩn hoá intro/outro trước theo đúng thông số clip đầu ra (cùng độ phân giải, fps, sample rate) để dùng được demuxer `-c copy` |
| Lệch tiếng và hình sau khi ghép | Trải nghiệm tệ | Chuẩn hoá audio 48 kHz stereo; intro không tiếng thì thêm `anullsrc`; test AC-6 |
| Logo che chữ trên slide (góc phải trên hay có số trang) | Học viên không đọc được | Có ảnh xem trước; cho chọn 4 góc; opacity mặc định 0,8 |
| Thay đổi thời gian do intro làm lệch phụ đề và chapters | Sai mốc | `intro_offset_sec` là nguồn duy nhất để dịch mốc; F22/F23/F41 phải đọc giá trị này |
| `scale2ref` bị đánh dấu deprecated trong FFmpeg mới | Lệnh lỗi khi nâng cấp FFmpeg | Ghi chú phiên bản FFmpeg tối thiểu trong Dockerfile (F14). Phương án thay thế: tính kích thước logo ở Java từ `ffprobe` rồi dùng `scale=-1:<px>` |

## 10. Câu hỏi mở

- [ ] Brand Kit thuộc **người dùng** hay **tổ chức**? Spec hiện gắn với `owner_id`; khi có F49 sẽ chuyển sang `org_id`.
- [ ] Có cho áp thương hiệu **lên video đã xuất trước đó** không? Việc này phải cắt lại toàn bộ.
- [ ] Độ phân giải chuẩn của intro là 1080p hay theo độ phân giải video gốc? (Liên quan F45.)
- [ ] Có cần mặc định ẩn logo trong khoảng 3 giây đầu và cuối khi đã có intro/outro (vì intro đã có logo) không?
