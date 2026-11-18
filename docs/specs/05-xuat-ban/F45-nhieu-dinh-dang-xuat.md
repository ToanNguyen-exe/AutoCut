# F45 — Nhiều định dạng xuất (1080p/720p, khung dọc 9:16, MP3)

| Mục | Giá trị |
|---|---|
| **Mã** | F45 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV1 (lệnh FFmpeg cho từng profile) · SV3 (mở rộng job cắt, DB) · SV4 (chọn định dạng khi xuất) |
| **Phụ thuộc** | F00 (`video_parts` do job ghi), F09 (job nền), F13, F35 (`render_kind`), F39 (`presignGet`). Liên quan F25/F32 (filter cắt khoảng của AD-13), F44 (bố cục logo theo khung), F12 (ZIP streaming khi có nhiều định dạng) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không (FFmpeg có sẵn `libmp3lame` trong bản build chuẩn; kiểm tra lúc khởi động) |
| **Tham khảo** | Opus Clip (9:16 + chữ phụ đề), Descript export presets, Riverside "Magic Clips", Kapwing resize |

> **Cập nhật 18/11/2026:** Theo review:
> - Test so sánh với `VideoCutter.buildCommand` (tên đúng, [VideoCutter.java:339](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L339)).
> - Rendition dùng chung vòng đời với `video_parts` (có `STALE`, `r2_key` nullable) và kế thừa `render_kind` của F35.
> - Lệnh nhiều đầu ra nối sau filter cắt khoảng của AD-13.
> - URL tải là presigned (AD-3); lỗi quyền theo AD-2; mã lỗi đầu vào là 422; migration đặt tên theo dấu thời gian.

## 1. Bối cảnh & vấn đề

- `VideoCutter` hiện chỉ xuất **một định dạng cố định**: giữ độ phân giải gốc, `libx264 -preset fast -crf 22`, AAC, MP4 (hàm `buildCommand`, [VideoCutter.java:339-353](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L339-L353)). Không có tuỳ chọn hạ độ phân giải hay đổi tỉ lệ khung.
- Tên tệp đầu ra được tạo cứng dạng `%02d_%s.mp4` ([BatchVideoCutService.java:197](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L197)) trong thư mục `output/users/{user}/{lesson}/cuts` ([BatchVideoCutService.java:175](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L175)), nên không chứa được nhiều biến thể của cùng một clip.
- `video_parts` ([schema.sql](../../../database/schema.sql)) chỉ có một `r2_key` cho mỗi clip.
- Nhu cầu thực tế:
  - Gửi qua Zalo bị giới hạn dung lượng tệp, nên cần 720p nhẹ.
  - Quảng bá khoá học trên TikTok, Reels, Shorts cần khung dọc 9:16.
  - Học viên muốn nghe lại như podcast, chỉ cần âm thanh MP3.

## 2. Mục tiêu

- Cho chọn một hoặc nhiều **profile xuất** khi cắt: `SOURCE` (như hiện tại), `MP4_1080`, `MP4_720`, `VERTICAL_9_16`, `AUDIO_MP3`.
- Mỗi clip lưu nhiều **biến thể (rendition)**, tải riêng được và có trong ZIP.
- Khung dọc có 2 kiểu bố cục: **cắt giữa** (crop) và **nền mờ** (blur pad).

### Ngoài phạm vi
- Tự bám theo khuôn mặt hoặc con trỏ chuột khi cắt dọc (smart reframe). Ghi lại để làm sau, có thể dùng dữ liệu F26.
- Phụ đề kiểu TikTok chữ to hiện từng từ. F23 lo phần ghi cứng phụ đề; spec này chỉ để chỗ móc nối.
- Định dạng WebM/AV1, GIF.

## 3. User stories

- Là **giảng viên**, tôi muốn xuất thêm bản 720p để gửi qua Zalo (tệp nhỏ hơn khoảng 60%).
- Là **người làm truyền thông của khoa**, tôi muốn xuất clip "Mẹo debug Java" dạng 9:16 để đăng TikTok.
- Là **học viên**, tôi muốn tải bản MP3 để nghe lại trên xe buýt.

## 4. Yêu cầu chức năng

- **FR-1** Bảng profile cố định trong code (không cho người dùng tự chế tham số FFmpeg):

  | Profile | Container | Video | Audio | Ghi chú |
  |---|---|---|---|---|
  | `SOURCE` | mp4 | giữ nguyên độ phân giải, `libx264 crf 22 preset fast` | aac 128k | hành vi hiện tại, mặc định |
  | `MP4_1080` | mp4 | cao 1080, `crf 23`, `-maxrate 6M -bufsize 12M` | aac 128k | không upscale |
  | `MP4_720` | mp4 | cao 720, `crf 24`, `-maxrate 3M -bufsize 6M` | aac 96k | không upscale |
  | `VERTICAL_9_16` | mp4 | 1080×1920, `crf 23`, 30 fps | aac 128k | bố cục `CROP` hoặc `BLUR_PAD` |
  | `AUDIO_MP3` | mp3 | — | `libmp3lame -q:a 4` (~165 kbps VBR), mono nếu nguồn mono | có thẻ ID3 tiêu đề/album |

- **FR-2** Khi gửi job cắt, thêm `profiles: ["SOURCE","MP4_720","AUDIO_MP3"]`. Mặc định là `["SOURCE"]`, nên client cũ không bị ảnh hưởng.
- **FR-3** Mỗi profile được tạo **từ video nguồn**, áp cùng khoảng cắt và cùng padding ([AudioPadding.java:42](../../../backend/src/main/java/com/autocut/video/AudioPadding.java#L42)), không phải mã hoá lại từ bản đã cắt (tránh giảm chất lượng hai lần). Để giảm số lần giải mã, các profile video dùng **một lệnh FFmpeg nhiều đầu ra** (`split`). Nếu topic có khoảng bị cắt (AD-13), `split` lấy đầu vào từ nhãn `[vcat]`/`[acat]` của filter `KeepRanges` thay cho `[0:v]`/`0:a`. Nhờ vậy mọi profile đều đã bỏ cùng các khoảng đó.
- **FR-4** Bố cục 9:16:
  - `CROP`: cắt vùng 9:16 ở giữa khung theo chiều ngang, vị trí lệch được qua `crop_x_ratio` (0–1, mặc định 0,5).
  - `BLUR_PAD`: video gốc thu vừa chiều ngang 1080 đặt ở giữa; nền là chính video đó phóng to + làm mờ. Phù hợp quay màn hình code, vì cắt giữa sẽ mất chữ.
  - Mặc định là `BLUR_PAD`.
- **FR-5** Tên tệp: `{NN}_{slug}{suffix}.{ext}`, với suffix là `""` (SOURCE), `_1080p`, `_720p`, `_doc`, `_audio`. Thư mục giữ nguyên.
- **FR-6** Mỗi biến thể lưu một dòng trong bảng `video_part_renditions` và upload lên R2 theo cùng quy ước khoá hiện tại ([BatchVideoCutService.java:213](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L213)). Rendition dùng chung trạng thái với part (F00): job ghi `RENDERING → COMPLETED/FAILED` cho từng rendition. Khi part chuyển `STALE`, mọi rendition của nó cũng chuyển `STALE`.
- **FR-10** Người xem qua link chia sẻ (F40), khoá học (F41) hoặc đẩy lên YouTube/Drive (F42) chỉ thấy rendition của part có `render_kind='RELEASE'` (F35) và `status='COMPLETED'`.
- **FR-7** Một profile lỗi (ví dụ thiếu `libmp3lame`) không làm hỏng các profile khác. `report.json` liệt kê lỗi theo profile.
- **FR-8** Tiến độ job tính theo `số clip × số profile`. Thông báo hiện dạng "Đang xuất 3/10 – Cú pháp for (bản 720p)".
- **FR-9** ZIP (F12) cho lọc theo profile: `?profiles=MP4_720,AUDIO_MP3`.

## 5. Yêu cầu phi chức năng

- Xuất 3 profile video bằng một lệnh nhiều đầu ra phải nhanh hơn chạy 3 lệnh riêng ít nhất 30% (đo và ghi vào PR).
- Bản 720p của clip quay màn hình 1080p 5 phút nhỏ hơn bản `SOURCE` ít nhất 40%.
- MP3 có thẻ ID3: `title` = tiêu đề clip, `album` = tên bài học, `track` = số thứ tự.
- Kiểm tra `ffmpeg -encoders | grep libmp3lame` khi khởi động. Nếu thiếu thì ẩn profile `AUDIO_MP3` khỏi `GET /api/v1/export-profiles`.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_part_renditions.sql`:

```sql
CREATE TABLE IF NOT EXISTS video_part_renditions (
    id BIGSERIAL PRIMARY KEY,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    profile VARCHAR(20) NOT NULL,           -- SOURCE | MP4_1080 | MP4_720 | VERTICAL_9_16 | AUDIO_MP3
    layout VARCHAR(10),                     -- CROP | BLUR_PAD (chỉ với VERTICAL_9_16)
    r2_key VARCHAR(500),                    -- NULL khi chưa đẩy R2 (giống video_parts sau F00)
    file_size BIGINT,
    width INTEGER,
    height INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','RENDERING','COMPLETED','FAILED','STALE')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_part_profile UNIQUE (video_part_id, profile)
);

-- Dữ liệu cũ: mỗi video_parts hiện có tương ứng một rendition SOURCE
INSERT INTO video_part_renditions (video_part_id, profile, r2_key, file_size, status)
SELECT id, 'SOURCE', r2_key, file_size, status FROM video_parts
WHERE status IN ('COMPLETED','STALE','FAILED')   -- sau migration F00, các dòng giả đã thành STALE
ON CONFLICT (video_part_id, profile) DO NOTHING;
```

`video_parts.r2_key` được giữ lại để tương thích ngược và luôn trùng với rendition `SOURCE`.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/export-profiles` | Đã đăng nhập | Danh sách profile khả dụng + mô tả tiếng Việt |
| POST | `/api/video/cut` (sau F09 là `/api/v1/cut-jobs`) | Quyền `EDIT` trên video | Thêm trường `profiles` và `vertical_layout` |
| GET | `/api/v1/parts/{partId}/renditions` | Quyền xem video chứa part | Danh sách biến thể + URL tải (presigned 15 phút, AD-3) |

Người xem qua link F40 lấy rendition qua `/api/v1/share/{token}/download/{partId}?profile=MP4_720` (F40 FR-9). Endpoint này chỉ trả rendition của part `RELEASE`.

Request mở rộng:

```json
{
  "user": "u01",
  "lesson": "Bai05_VongLap",
  "video_name": "bai05.mp4",
  "segments": [ { "id": "T01", "topic": "Giới thiệu vòng lặp", "start": 12.0, "end": 108.4 } ],
  "profiles": ["SOURCE", "MP4_720", "VERTICAL_9_16", "AUDIO_MP3"],
  "vertical_layout": "BLUR_PAD"
}
```

`CutClipInfo` ([Models.java:101](../../../backend/src/main/java/com/autocut/dto/Models.java#L101)) thêm trường `renditions`:

```json
{
  "index": 1, "name": "01_gioi-thieu-vong-lap.mp4", "topic": "Giới thiệu vòng lặp",
  "renditions": [
    { "profile": "SOURCE", "file": "01_gioi-thieu-vong-lap.mp4", "sizeBytes": 48211022 },
    { "profile": "MP4_720", "file": "01_gioi-thieu-vong-lap_720p.mp4", "sizeBytes": 17320011 },
    { "profile": "VERTICAL_9_16", "file": "01_gioi-thieu-vong-lap_doc.mp4", "sizeBytes": 30100223 },
    { "profile": "AUDIO_MP3", "file": "01_gioi-thieu-vong-lap_audio.mp3", "sizeBytes": 2011330 }
  ]
}
```

Lỗi:
- `422 UNKNOWN_PROFILE`.
- `422 PROFILE_UNAVAILABLE` (ví dụ thiếu `libmp3lame`).
- `404 PART_NOT_FOUND`: part không tồn tại, hoặc người gọi không có quyền xem (AD-2).
- `403 FORBIDDEN_ACTION`: xem được nhưng không có quyền sửa.

### 6.3 Backend (Spring Boot)

- **Tạo** `video/ExportProfile` (enum gồm `suffix`, `extension`, `maxHeight`) và `video/ExportCommandBuilder` (SV1). Đây là hàm thuần:
  `List<String> build(Path in, double ss, double to, List<ExportProfile> profiles, VerticalLayout layout, Map<ExportProfile, Path> outputs, BrandingSpec brandingOrNull)`.
  - Tham số `brandingOrNull` để nối với F44: logo được vẽ **sau** bước scale/crop của từng nhánh, nên luôn nằm đúng góc của khung đích.
  - Tham số đầu vào cho biết nhãn video/audio nguồn (`[0:v]`/`0:a`, hoặc `[vcat]`/`[acat]` của AD-13), để ghép được với filter cắt khoảng.
- **Sửa** `VideoCutter`: thêm `CutResult cutMulti(File in, double start, double end, double total, List<ExportProfile>, VerticalLayout, Map<ExportProfile, File>)`. Vẫn dùng `calculatePaddedRange` ([VideoCutter.java:198](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L198)) để áp padding. Hàm `cut(...)` cũ giữ nguyên và tương đương `cutMulti` với `[SOURCE]`.
- **Sửa** `BatchVideoCutService.executeJob` ([BatchVideoCutService.java:186-232](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L186-L232)): lặp theo clip, gọi `cutMulti`, upload từng tệp, ghi `video_part_renditions`. Tách `AUDIO_MP3` thành lệnh riêng (không có nhánh video), để lỗi encoder MP3 không làm hỏng các nhánh video.

Lệnh FFmpeg mẫu: 1 lần giải mã cho 3 đầu ra video.

```bash
ffmpeg -y -ss 11.7 -to 108.9 -i source.mp4 -filter_complex "\
[0:v]split=3[vs][v7][vv];\
[v7]scale=-2:'min(720,ih)'[o720];\
[vv]split=2[bg0][fg0];\
[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];\
[fg0]scale=1080:-2[fg];\
[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30[overt]" \
  -map "[vs]"    -map 0:a? -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -movflags +faststart 01_x.mp4 \
  -map "[o720]"  -map 0:a? -c:v libx264 -preset fast -crf 24 -maxrate 3M -bufsize 6M -c:a aac -b:a 96k -movflags +faststart 01_x_720p.mp4 \
  -map "[overt]" -map 0:a? -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart 01_x_doc.mp4
```

Bố cục `CROP` (thay nhánh `vv`):

```bash
[vv]crop=w=ih*9/16:h=ih:x=(iw-ih*9/16)*0.5:y=0,scale=1080:1920,fps=30[overt]
```

Chỉ âm thanh:

```bash
ffmpeg -y -ss 11.7 -to 108.9 -i source.mp4 -vn -c:a libmp3lame -q:a 4 \
  -metadata title="Giới thiệu vòng lặp" -metadata album="Bài 05 – Vòng lặp" -metadata track=1 \
  -id3v2_version 3 01_x_audio.mp3
```

### 6.5 Frontend (Next.js)

- Trong hộp thoại trước khi xuất (nơi gọi `startBatchCut`), thêm nhóm checkbox "Định dạng xuất":
  - ☑ Bản gốc (chất lượng cao nhất)
  - ☐ MP4 720p (nhẹ, gửi Zalo)
  - ☐ Video dọc 9:16 (TikTok/Reels/Shorts), có radio "Nền mờ (khuyên dùng cho quay màn hình) / Cắt giữa"
  - ☐ Chỉ âm thanh MP3

  Lấy danh sách từ `GET /api/v1/export-profiles`.
- [ExportProgressModal.tsx:302-330](../../../frontend/src/components/ExportProgressModal.tsx#L302-L330): mỗi clip hiện các nút tải nhỏ theo biến thể ("Gốc · 720p · Dọc · MP3") kèm dung lượng.
- Hiện ước lượng: "Dự kiến tạo 40 tệp, khoảng 1,2 GB". Ước lượng dựa trên bitrate profile × thời lượng.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* job không gửi `profiles`, *When* cắt, *Then* kết quả giống hệt hiện tại: một tệp `.mp4` mỗi clip, cùng tên, và các test cũ của `BatchVideoCutServiceTest` vẫn pass.
- **AC-2** — *Given* nguồn 1080p, profile `MP4_720`, *Then* `ffprobe` cho `height = 720`, và dung lượng ≤ 60% bản `SOURCE`.
- **AC-3** — *Given* nguồn 720p, profile `MP4_1080`, *Then* tệp đầu ra cao 720 (không upscale).
- **AC-4** — *Given* `VERTICAL_9_16` + `BLUR_PAD`, *Then* `ffprobe` cho 1080×1920, 30 fps; toàn bộ chiều ngang khung gốc nằm trong khung (kiểm tra tay bằng clip quay màn hình có chữ ở 2 mép).
- **AC-5** — *Given* `AUDIO_MP3`, *Then* tệp `.mp3` có thời lượng bằng bản `SOURCE` (±0,1 giây) và thẻ ID3 `title` đúng tiếng Việt có dấu.
- **AC-6** — *Given* FFmpeg không có `libmp3lame`, *When* yêu cầu `["SOURCE","AUDIO_MP3"]`, *Then* job vẫn `COMPLETED`, bản SOURCE có đủ, và `report.json` ghi lỗi của `AUDIO_MP3`.
- **AC-7** — *Given* 3 profile video, *Then* chỉ có **một** tiến trình FFmpeg cho phần video của mỗi clip (kiểm tra qua log lệnh).
- **AC-8** — Bảng `video_part_renditions` có đúng `số clip × số profile` dòng `COMPLETED`.
- **AC-9** — *Given* part có rendition `COMPLETED`, *When* sửa khoảng thời gian của topic rồi lưu (F00), *Then* mọi rendition của part chuyển `STALE`.
- **AC-10** — *Given* part có `render_kind='DRAFT'`, *When* tải qua link chia sẻ F40, *Then* nhận `404 PART_NOT_FOUND`.
- **AC-11** — *Given* người dùng không có quyền xem video, *When* gọi `GET /renditions`, *Then* nhận `404`. Mọi `url` trả về cho người có quyền đều có `X-Amz-Signature`.

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `ExportCommandBuilderTest.sourceOnly_equalsLegacyCommand` | unit: so với kết quả `VideoCutter.buildCommand` hiện có |
| `ExportCommandBuilderTest.withKeepRanges_splitsFromVcatLabel` | unit (AD-13) |
| `ExportCommandBuilderTest.threeVideoProfiles_singleSplit3` | unit |
| `ExportCommandBuilderTest.mp4_720_noUpscaleExpression` | unit: chứa `min(720,ih)` |
| `ExportCommandBuilderTest.vertical_blurPad_filterChain` / `vertical_crop_respectsXRatio` | unit |
| `ExportCommandBuilderTest.audioMp3_hasNoVideoMap_andId3Metadata` | unit |
| `ExportProfileTest.fileName_suffixes` | unit |
| `VideoCutterMultiTest.cutMulti_testsrc_producesExpectedDimensions` | integration `@Tag("ffmpeg")` dùng `testsrc=size=1920x1080:duration=8` + `sine` |
| `BatchVideoCutServiceTest.noProfiles_defaultsToSource` | unit (bảo vệ hành vi cũ) |
| `BatchVideoCutServiceTest.mp3Failure_doesNotFailJob` | unit (mock VideoCutter trả lỗi cho profile MP3) |
| `RenditionStaleTest.partStale_marksAllRenditionsStale` | integration Postgres (AC-9) |
| `RenditionControllerTest.noAccess_404_presignedUrls` | MockMvc (AC-11) |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Nhiều profile làm thời gian xuất tăng gấp 2–3 lần | Người dùng chờ lâu | Mặc định chỉ `SOURCE`; hiện ước lượng thời gian trước khi xuất; một lệnh nhiều đầu ra |
| Dung lượng R2 tăng | Vượt trần 8 GB ([CloudflareR2Service.java:25](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L25)) | Kiểm tra hạn mức (F16) trước khi chạy job dựa trên ước lượng; hiện ước lượng dung lượng trong UI |
| Khung dọc `CROP` làm mất chữ ở mép trái/phải khi quay màn hình | Clip vô dụng | Mặc định `BLUR_PAD`; UI ghi rõ khuyến nghị |
| Tiêu đề có ký tự đặc biệt trong `-metadata` | Lệnh lỗi | Truyền từng phần tử qua `ProcessBuilder` dạng `List<String>` (không qua shell), nên không cần escape. Có test với tiêu đề chứa `"` và `'` |
| Video nguồn VFR khiến khung dọc bị giật | Chất lượng kém | Cố định `fps=30` trong nhánh dọc |

## 10. Câu hỏi mở

- [ ] Có cần profile **`MP4_480`** cho học viên vùng mạng yếu không? Nếu đã có HLS (F39) thì có lẽ không cần.
- [ ] Khung dọc có cần **ghi cứng phụ đề** mặc định không? (TikTok xem không tiếng chiếm đa số.) Nếu có thì chờ F23.
- [ ] Bản MP3 có cần **gộp cả bài học thành 1 tệp** (podcast dài) ngoài tệp từng clip không?
- [ ] Profile mặc định nên là chỉ `SOURCE` hay `SOURCE + MP4_720`?
