# F39 — Phát video HLS

| Mục | Giá trị |
|---|---|
| **Mã** | F39 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV1 (đóng gói HLS bằng FFmpeg) · SV3 (API, lưu R2, DB) · SV4 (trình phát) |
| **Phụ thuộc** | F09 (hàng đợi job bền vững), F13 (Flyway), F02 (kiểm tra quyền sở hữu), F04 (không nhận đường dẫn tệp từ client) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `hls.js` (frontend, ~1.5.x, giấy phép Apache-2.0). Lý do: Chrome, Firefox và Edge trên desktop không tự phát được `.m3u8`, chỉ Safari và iOS phát được sẵn. Backend không cần thư viện mới vì FFmpeg đã có sẵn. |
| **Tham khảo** | Mux Video, Vimeo, Cloudflare Stream, YouTube (ABR — tự đổi chất lượng theo tốc độ mạng) |

## 1. Bối cảnh & vấn đề

Hiện tại video chỉ phát được bằng cách tải nguyên tệp MP4:

- `GET /api/video/stream/{hash}` ([VideoController.java:531-573](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L531-L573)) duyệt thư mục `uploads/`, tìm tệp có tên bắt đầu bằng `hash`, rồi trả về `FileSystemResource`. Endpoint này:
  - đọc thẳng ổ đĩa cục bộ của máy chủ, nên không chạy được khi có nhiều instance hoặc khi tệp chỉ còn trên R2;
  - phải gọi `Files.list` mỗi lần có request;
  - chỉ có một chất lượng (tệp gốc, có thể vài GB). Sinh viên dùng 4G sẽ bị giật hoặc không tua được.
- Clip sau khi cắt được upload lên R2 dạng MP4 có `+faststart` ([VideoCutter.java:346-351](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L346-L351); [BatchVideoCutService.java:211-215](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L211-L215)). Như vậy là xem được, nhưng chưa tự đổi chất lượng theo mạng.
- Trình xem trước [VideoPlayerPreview.tsx:36-48](../../../frontend/src/components/VideoPlayerPreview.tsx#L36-L48) chỉ giả lập phát bằng `setInterval`. Trình phát thật nằm ở [VideoCanvasViewport.tsx:268-272](../../../frontend/src/components/VideoCanvasViewport.tsx#L268-L272) và dùng `<video src=...>` trỏ thẳng tới tệp MP4.
- `CloudflareR2Service.uploadFile` ([CloudflareR2Service.java:98-140](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L98-L140)) chỉ upload từng tệp một và kiểm tra trần 8 GB mỗi lần gọi. Một bản HLS có hàng trăm segment `.ts`/`.m4s`, nên gọi `getCurrentUsageBytes()` cho từng tệp sẽ rất chậm.

## 2. Mục tiêu

- Đóng gói video gốc và từng clip thành HLS nhiều mức chất lượng (360p, 720p, 1080p nếu nguồn đủ lớn).
- Trình phát trong Studio và trang học viên (F41) đổi chất lượng tự động; tua tới đâu phát được ngay tới đó, không phải tải hết tệp.
- Không phụ thuộc ổ đĩa cục bộ: playlist và segment nằm trên R2 và được phát qua CDN.

### Ngoài phạm vi
- DRM (Widevine/FairPlay), mã hoá AES-128 cho segment (để làm sau, cùng với F40 nếu cần).
- Phát trực tiếp (livestream).
- DASH.

## 3. User stories

- Là **học viên dùng 4G**, tôi muốn video tự hạ xuống 360p khi mạng yếu để xem không bị dừng.
- Là **giảng viên**, tôi muốn tua tới phút 47 của bài giảng 2 giờ mà video phát ngay, không phải chờ tải.
- Là **biên tập viên (SV4)**, tôi muốn trình phát trong Studio dùng cùng nguồn HLS với trang học viên để xem đúng thứ học viên sẽ thấy.

## 4. Yêu cầu chức năng

- **FR-1** Sau khi upload video gốc xong (status `UPLOADED`), hệ thống tạo job `HLS_PACKAGE` cho video đó. Job này chạy song song với analyze và không chặn analyze.
- **FR-2** Sau khi một clip trong `video_parts` chuyển sang `COMPLETED`, hệ thống tạo job `HLS_PACKAGE` cho clip đó.
- **FR-3** Bậc chất lượng (rendition):

  | Tên | Độ phân giải | Bitrate video | Bitrate audio | Điều kiện |
  |---|---|---|---|---|
  | 360p | 640×360 | 800k | 96k | luôn tạo |
  | 720p | 1280×720 | 2800k | 128k | nguồn cao ≥ 720 |
  | 1080p | 1920×1080 | 5000k | 128k | nguồn cao ≥ 1080 |

  Không upscale: nguồn chỉ 720p thì không tạo bậc 1080p.
- **FR-4** Segment dài 6 giây, định dạng fMP4 (`.m4s`), playlist chuẩn `VOD`.
- **FR-5** Cấu trúc trên R2: `autocut/hls/{videoId}/master.m3u8` và `autocut/hls/{videoId}/{360p|720p|1080p}/index.m3u8 + seg_00001.m4s ...`. Clip dùng `autocut/hls/parts/{partId}/...`.
- **FR-6** API trả URL playlist cho client. Client không tự ghép đường dẫn R2.
- **FR-7** Khi HLS chưa sẵn sàng, trình phát quay về MP4 cũ (hiện thông báo nhỏ "Đang tối ưu video để phát mượt hơn…").
- **FR-8** Trình phát có menu chọn chất lượng thủ công: "Tự động / 1080p / 720p / 360p".
- **FR-9** Xoá video hoặc clip thì xoá toàn bộ thư mục HLS tương ứng trên R2. Có thể làm qua job dọn dẹp ở F17.

## 5. Yêu cầu phi chức năng

- Thời gian đóng gói ≤ 1,5 lần thời lượng video khi dùng `-preset veryfast` trên máy 4 nhân (đo lại trên máy thật rồi ghi kết quả vào PR).
- Bắt đầu phát (time-to-first-frame) ≤ 2 giây trên mạng 10 Mbps.
- Upload segment song song tối đa 8 luồng. Chỉ kiểm tra hạn mức (F16 / trần R2) **một lần cho cả gói**, không kiểm tra theo từng segment.
- Header `Cache-Control`: playlist `public, max-age=60`; segment `public, max-age=31536000, immutable`.
- R2 bucket phải bật CORS cho domain frontend (header `Range`, method `GET, HEAD`).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__add_hls_assets.sql`:

```sql
CREATE TABLE IF NOT EXISTS hls_assets (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    video_part_id BIGINT REFERENCES video_parts(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING | PROCESSING | READY | FAILED
    master_key VARCHAR(500),                         -- autocut/hls/12/master.m3u8
    renditions JSONB,                                -- ["360p","720p"]
    total_bytes BIGINT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_hls_owner CHECK ((video_id IS NULL) <> (video_part_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hls_video ON hls_assets(video_id) WHERE video_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hls_part  ON hls_assets(video_part_id) WHERE video_part_id IS NOT NULL;
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/playback` | Chủ sở hữu, hoặc người có link chia sẻ (F40) | Trả nguồn phát của video gốc |
| GET | `/api/v1/parts/{partId}/playback` | như trên | Trả nguồn phát của clip |
| POST | `/api/v1/videos/{id}/hls:rebuild` | Admin | Đóng gói lại khi lỗi |

Response mẫu:

```json
{
  "type": "hls",
  "status": "READY",
  "hlsUrl": "https://cdn.autocut.vn/autocut/hls/12/master.m3u8",
  "mp4Url": "https://cdn.autocut.vn/autocut/users/u01/bai05/cuts/01_gioi-thieu.mp4",
  "renditions": ["360p", "720p"],
  "durationSec": 432.5
}
```

Khi chưa xong: `"type": "mp4", "status": "PROCESSING", "hlsUrl": null`. Lỗi: `404 VIDEO_NOT_FOUND`, `403 FORBIDDEN`.

### 6.3 Backend (Spring Boot)

- **Tạo** `com.autocut.video.HlsPackager` (SV1): hàm `HlsResult packageHls(File input, Path outDir, List<Rendition> renditions)`. Dùng `ProcessBuilder` và `StreamUtil` như `VideoCutter` để tránh deadlock khi đọc stderr.
- **Tạo** `com.autocut.video.Rendition` (record `name, width, height, videoKbps, audioKbps`) và hàm tĩnh `Rendition.ladderFor(int sourceHeight)`.
- **Tạo** `com.autocut.service.HlsService` (SV3): nhận job từ hàng đợi F09, gọi `HlsPackager`, upload cả thư mục lên R2, cập nhật `hls_assets`.
- **Sửa** `CloudflareR2Service`: thêm `uploadDirectory(Path dir, String prefix, Map<String,String> cacheControlByExt)`. Hàm này kiểm tra trần dung lượng **một lần** rồi upload song song bằng `ExecutorService` 8 luồng, và đặt `contentType` (`application/vnd.apple.mpegurl` cho `.m3u8`, `video/iso.segment` cho `.m4s`, `video/mp4` cho `init.mp4`).
- **Tạo** `com.autocut.controller.PlaybackController`. Không thêm vào `VideoController`.
- `GET /api/video/stream/{hash}` cũ: giữ lại để tương thích, đánh dấu `@Deprecated` và log cảnh báo. Xoá sau khi frontend chuyển xong.

Lệnh FFmpeg mẫu cho nguồn 1080p (một lệnh, nhiều đầu ra):

```bash
ffmpeg -y -i input.mp4 \
  -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2[v360];[v2]scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2[v720];[v3]scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2[v1080]" \
  -map "[v360]"  -c:v:0 libx264 -b:v:0 800k  -maxrate:v:0 856k  -bufsize:v:0 1200k \
  -map "[v720]"  -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k \
  -map "[v1080]" -c:v:2 libx264 -b:v:2 5000k -maxrate:v:2 5350k -bufsize:v:2 7500k \
  -map a:0 -c:a:0 aac -b:a:0 96k -ac 2 \
  -map a:0 -c:a:1 aac -b:a:1 128k -ac 2 \
  -map a:0 -c:a:2 aac -b:a:2 128k -ac 2 \
  -preset veryfast -g 48 -keyint_min 48 -sc_threshold 0 \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_flags independent_segments \
  -hls_segment_filename "out/%v/seg_%05d.m4s" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:360p v:1,a:1,name:720p v:2,a:2,name:1080p" \
  out/%v/index.m3u8
```

Ghi chú cho SV1:
- `-g` và `-keyint_min` = fps × 2. Lấy fps từ `ffprobe`; chỉ dùng 48 khi nguồn 24 fps.
- `-sc_threshold 0` giữ keyframe đều đặn để các segment khớp nhau giữa các bậc chất lượng.
- Video **không có audio** (quay màn hình không tiếng): bỏ phần `-map a:0` và đổi `var_stream_map` thành `v:0,name:360p ...`. Phải có test riêng cho trường hợp này.

### 6.5 Frontend (Next.js)

- **Tạo** `frontend/src/components/HlsVideo.tsx`: bọc thẻ `<video>`. Nếu `video.canPlayType('application/vnd.apple.mpegurl')` thì gán `src` trực tiếp (Safari/iOS); nếu không thì dùng `hls.js` (`Hls.isSupported()`); nếu cả hai không được thì dùng `mp4Url`.
- **Tạo** `frontend/src/lib/playback.ts`: `getPlayback(videoId)` và `getPartPlayback(partId)`.
- **Sửa** [VideoCanvasViewport.tsx:268](../../../frontend/src/components/VideoCanvasViewport.tsx#L268): thay `<video src={videoSrc}>` bằng `<HlsVideo>` nhưng giữ nguyên `ref`, `onTimeUpdate` và `onLoadedMetadata`. Dùng `forwardRef` để code đồng bộ `currentTime` hiện có vẫn chạy.
- Menu chất lượng: dùng nút `Settings` của lucide, chữ "Chất lượng: Tự động (720p)".
- Gỡ `hls.js` khi component unmount (`hls.destroy()`) để tránh rò rỉ bộ nhớ.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* video 1080p dài 10 phút đã upload, *When* job HLS chạy xong, *Then* `hls_assets.status = READY`, `renditions = ["360p","720p","1080p"]`, và R2 có `master.m3u8` cùng 3 thư mục con.
- **AC-2** — *Given* nguồn 720p, *When* đóng gói, *Then* không có bậc `1080p`.
- **AC-3** — *Given* video không có luồng âm thanh, *When* đóng gói, *Then* job vẫn `READY`.
- **AC-4** — *Given* Chrome desktop đã giả lập mạng "Fast 3G" trong DevTools, *When* phát video, *Then* sau ≤ 10 giây hls.js chuyển xuống 360p và video không dừng quá 2 giây.
- **AC-5** — *Given* video đang phát, *When* tua tới 80% thời lượng, *Then* tab Network chỉ tải các segment quanh vị trí đó, không tải lại từ đầu.
- **AC-6** — *Given* `hls_assets.status = PROCESSING`, *When* mở Studio, *Then* video vẫn phát bằng MP4 và có dòng thông báo "Đang tối ưu video…".
- **AC-7** — *Given* người dùng B không phải chủ video của A và không có link chia sẻ, *When* gọi `/api/v1/videos/{id}/playback`, *Then* nhận `403`.
- **AC-8** — Safari iOS phát được `master.m3u8` mà không cần hls.js (kiểm tra tay, chụp màn hình gắn vào PR).

## 8. Kế hoạch kiểm thử (TDD)

Viết các test sau trước khi viết code:

| Test | Loại | Nội dung |
|---|---|---|
| `RenditionTest.ladderFor_1080_returns3` | unit | nguồn 1080 → 3 bậc |
| `RenditionTest.ladderFor_480_returnsOnly360` | unit | không upscale |
| `HlsPackagerTest.buildCommand_containsVarStreamMap` | unit | lệnh có đúng `-var_stream_map`, `-hls_time 6` |
| `HlsPackagerTest.buildCommand_noAudio_omitsAudioMaps` | unit | không có `-map a:0` |
| `HlsPackagerTest.package_sampleClip_createsMaster` | integration (cần ffmpeg, đánh dấu `@Tag("ffmpeg")`) | dùng clip mẫu 10 giây sinh bằng `ffmpeg -f lavfi -i testsrc` |
| `CloudflareR2ServiceTest.uploadDirectory_checksQuotaOnce` | unit (mock S3Client) | `getCurrentUsageBytes` chỉ được gọi 1 lần |
| `CloudflareR2ServiceTest.uploadDirectory_setsContentTypeByExtension` | unit | `.m3u8` và `.m4s` có đúng content type |
| `PlaybackControllerTest.notReady_returnsMp4Fallback` | MockMvc | |
| `PlaybackControllerTest.otherOwner_returns403` | MockMvc | |
| `HlsVideo.test.tsx` (nếu dự án đã có Jest/Vitest, nếu chưa thì kiểm tra tay theo AC-4 và AC-8) | component | chọn đúng nhánh Safari / hls.js / MP4 |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Dung lượng R2 tăng khoảng 1,5–2 lần (gốc + 3 bậc) | Vượt trần 8 GB ([CloudflareR2Service.java:25](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L25)) | Video gốc chỉ đóng gói 2 bậc 360p/720p; clip đóng gói đủ bậc. Áp hạn mức F16. Bật F17 để xoá MP4 trung gian |
| Encode tốn CPU, tranh tài nguyên với job cắt | Job cắt chậm | Hàng đợi F09 có loại job riêng, giới hạn 1 job HLS chạy cùng lúc |
| CORS của R2 chưa cấu hình | hls.js báo lỗi `manifestLoadError` | Viết sẵn tệp `docs/r2-cors.json` và kiểm tra bằng `curl -H "Origin: ..."` |
| fps biến thiên (VFR) khi quay màn hình | Segment lệch, tua bị nhảy | Thêm `-fps_mode cfr -r <fps>` khi `ffprobe` phát hiện VFR |
| URL R2 công khai → ai biết link cũng xem được | Lộ bài giảng trả phí | Ở giai đoạn này chấp nhận rủi ro; F40 bổ sung signed URL/token |

## 10. Câu hỏi mở

- [ ] Có dùng **domain CDN riêng** cho R2 (ví dụ `cdn.autocut.vn`) không? Nếu không, trình duyệt phải gọi thẳng `r2.dev`, vốn bị giới hạn tốc độ.
- [ ] Video gốc có cần HLS không, hay chỉ cần cho clip? Bỏ HLS cho video gốc thì tiết kiệm khoảng 50% dung lượng.
- [ ] Có cần bậc 1080p không? Phần lớn bài giảng là quay màn hình, mà 720p thường đã đủ đọc chữ trên màn hình.
- [ ] Có giữ MP4 sau khi HLS sẵn sàng không? MP4 vẫn cần để học viên tải về và để làm F42.
