# F39 — Phát video HLS

| Mục | Giá trị |
|---|---|
| **Mã** | F39 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV1 (đóng gói HLS bằng FFmpeg) · SV3 (API, proxy playlist, R2, DB) · SV4 (trình phát) |
| **Phụ thuộc** | F00 (`partId` ổn định, `video_parts` do job ghi), F01 (vé `STREAM` của F01 FR-10, AD-4), F35 (`video_parts.render_kind`), F02 (`AccessService`), F04 (không nhận đường dẫn tệp từ client), F09 (job `HLS_PACKAGE`), F13 (Flyway), F16 (hạn mức) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `hls.js` (frontend, ~1.5.x, giấy phép Apache-2.0). Lý do: Chrome, Firefox, Edge trên desktop không tự phát được `.m3u8`, chỉ Safari và iOS phát được sẵn. Backend không cần thư viện mới (FFmpeg và `S3Presigner` trong AWS SDK đã có). |
| **Tham khảo** | Mux Video, Vimeo, Cloudflare Stream, YouTube (ABR — tự đổi chất lượng theo tốc độ mạng) |

> **Cập nhật 18/11/2026:** Theo review: chuyển sang R2 private + proxy playlist có chữ ký. Master và playlist từng bậc được viết lại, segment và `init.mp4` dùng presigned URL. Sửa `-map 0:a:0`. Video gốc thống nhất chỉ đóng gói 2 bậc, clip tối đa 3 bậc. Người không có quyền nhận 404 (AD-2). Chỉ đóng gói HLS cho clip `RELEASE` (F35). Endpoint cũ dùng vé `STREAM` của F01 FR-10. Thêm phụ thuộc F00/F01/F35.

## 1. Bối cảnh & vấn đề

Hiện tại video chỉ phát được bằng cách tải nguyên tệp MP4:

- `GET /api/video/stream/{hash}` ([VideoController.java:531-573](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L531-L573)) duyệt thư mục `uploads/`, tìm tệp có tên bắt đầu bằng `hash`, rồi trả về `FileSystemResource`. Endpoint này:
  - đọc thẳng ổ đĩa cục bộ của máy chủ, nên không chạy được khi có nhiều instance hoặc khi tệp chỉ còn trên R2;
  - phải gọi `Files.list` mỗi lần có request;
  - chỉ có một chất lượng (tệp gốc, có thể vài GB). Sinh viên dùng 4G sẽ bị giật hoặc không tua được.
- Clip sau khi cắt được upload lên R2 dạng MP4 có `+faststart` ([VideoCutter.java:337-351](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L337-L351); [BatchVideoCutService.java:211-215](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L211-L215)). Xem được, nhưng chưa tự đổi chất lượng theo mạng.
- `CloudflareR2Service.uploadFile` trả về URL **công khai** ghép từ `R2_PUBLIC_URL` ([CloudflareR2Service.java:136-137](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L136-L137)). Ai có link cũng xem được mãi mãi. Điều này trái với AD-3 (bucket private).
- Trình xem trước [VideoPlayerPreview.tsx:36-48](../../../frontend/src/components/VideoPlayerPreview.tsx#L36-L48) chỉ giả lập phát bằng `setInterval`. Trình phát thật ở [VideoCanvasViewport.tsx:268-272](../../../frontend/src/components/VideoCanvasViewport.tsx#L268-L272) dùng `<video src=...>` trỏ thẳng tới tệp MP4.
- `uploadFile` ([CloudflareR2Service.java:98-140](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L98-L140)) upload từng tệp và gọi `getCurrentUsageBytes()` (liệt kê toàn bucket) cho **mỗi** tệp. Một bản HLS có hàng trăm segment `.m4s`, nên làm vậy sẽ rất chậm.

## 2. Mục tiêu

- Đóng gói HLS nhiều bậc chất lượng:
  - **video gốc**: 360p và 720p (để xem lại, tiết kiệm dung lượng);
  - **clip**: 360p, 720p, và 1080p nếu nguồn đủ lớn.
- Trình phát trong Studio và trang học viên (F41) tự đổi chất lượng; tua tới đâu phát được ngay tới đó.
- Không phụ thuộc ổ đĩa cục bộ. Bucket R2 **private** (AD-3): mọi tệp đều được đọc qua presigned URL hoặc proxy có chữ ký. Không có URL công khai vĩnh viễn.
- Một bộ proxy playlist dùng chung cho người dùng đã đăng nhập (F39) và người xem qua link chia sẻ (F40).

### Ngoài phạm vi
- DRM (Widevine/FairPlay), mã hoá segment AES-128.
- Phát trực tiếp (livestream), DASH.
- Tuỳ chỉnh CDN/custom domain (xem rủi ro ở §9).

## 3. User stories

- Là **học viên dùng 4G**, tôi muốn video tự hạ xuống 360p khi mạng yếu để xem không bị dừng.
- Là **giảng viên**, tôi muốn tua tới phút 47 của bài giảng 2 giờ mà video phát ngay, không phải chờ tải.
- Là **biên tập viên (SV4)**, tôi muốn trình phát trong Studio dùng cùng nguồn HLS với trang học viên để xem đúng thứ học viên sẽ thấy.
- Là **chủ bài giảng**, tôi không muốn ai lấy được link tệp rồi xem mãi mãi khi không có quyền.

## 4. Yêu cầu chức năng

- **FR-1** Video gốc upload xong (status `UPLOADED`) thì hệ thống tạo job `HLS_PACKAGE` (bảng `jobs`, F09) với `target=VIDEO`. Job này chạy song song với analyze, không chặn analyze.
- **FR-2** Một `video_parts` chuyển sang `COMPLETED` (do job cắt ghi, F00 FR-7) **và có `render_kind='RELEASE'`** (F35) thì tạo job `HLS_PACKAGE` với `target=PART`. Clip `DRAFT` không đóng gói HLS (tiết kiệm dung lượng); Studio phát clip nháp bằng MP4 presigned (FR-8). Part chuyển `STALE` thì đặt `hls_assets.status = STALE` và **không** xoá ngay; F17 dọn sau.
- **FR-3** Thang chất lượng (rendition):

  | Tên | Độ phân giải | Bitrate video | Bitrate audio | Video gốc | Clip |
  |---|---|---|---|---|---|
  | 360p | 640×360 | 800k | 96k | luôn tạo | luôn tạo |
  | 720p | 1280×720 | 2800k | 128k | khi nguồn cao ≥ 720 | khi nguồn cao ≥ 720 |
  | 1080p | 1920×1080 | 5000k | 128k | **không tạo** | khi nguồn cao ≥ 1080 |

  Không upscale. Bậc cao nhất được chặn bởi cấu hình `hls.max_rendition_video` (mặc định `720p`) và `hls.max_rendition_part` (mặc định `1080p`).
- **FR-4** Segment dài 6 giây, định dạng fMP4 (`init.mp4` + `.m4s`), playlist kiểu `VOD`.
- **FR-5** Cấu trúc trên R2: `hls/videos/{videoId}/master.m3u8`, `hls/videos/{videoId}/{rendition}/index.m3u8`, `init.mp4`, `seg_00001.m4s`… Clip dùng `hls/parts/{partId}/...`. DB chỉ lưu `master_key` (AD-3).
- **FR-6 — Lấy nguồn phát.** Client gọi `GET /api/v1/videos/{id}/playback` hoặc `GET /api/v1/parts/{partId}/playback`, có JWT. Server kiểm quyền xem qua `AccessService` rồi trả:
  - `hlsUrl`: URL proxy master playlist, đã ký sẵn (FR-7);
  - `mp4Url`: presigned R2 URL của MP4, hết hạn 15 phút (AD-3).

  Client **không** tự ghép đường dẫn R2.
- **FR-7 — Proxy playlist có chữ ký** (dùng chung với F40):
  - **Master:** `GET /api/v1/playback/hls/{assetId}/master.m3u8?exp=&sig=`. Backend đọc master từ R2 và viết lại **mỗi URI playlist bậc** thành `/api/v1/playback/hls/{assetId}/{rendition}/index.m3u8?exp=&sig=` (cùng `exp`, chữ ký riêng cho từng đường dẫn).
  - **Playlist bậc:** backend viết lại `#EXT-X-MAP:URI="init.mp4"` và mọi dòng `seg_xxxxx.m4s` thành **presigned R2 URL**.
  - `sig = HMAC-SHA256(secret, assetId|path|exp)`. Secret là biến môi trường `PLAYBACK_SIGNING_KEY`.
  - **Thời hạn:** với HLS, `exp` = bây giờ + `min(thời lượng × 1,5 + 30 phút, 6 giờ)`. Phải dài hơn 15 phút của AD-3, vì hls.js chỉ tải playlist bậc một lần cho VOD và có thể đổi bậc giữa chừng. Đây là **ngoại lệ của AD-3, chỉ áp dụng cho HLS**.
  - Chữ ký sai hoặc hết hạn thì trả `404` (không lộ asset có tồn tại).
- **FR-8** HLS chưa sẵn sàng (`status ≠ READY`) thì `type="mp4"`, trình phát dùng `mp4Url` và hiện thông báo nhỏ "Đang tối ưu video để phát mượt hơn…".
- **FR-9** Trình phát có menu chọn chất lượng thủ công: "Tự động / 1080p / 720p / 360p" (chỉ hiện các bậc có thật).
- **FR-10** Xoá video hoặc clip (sau thùng rác F17) thì xoá cả thư mục HLS trên R2, do job dọn dẹp của F17 thực hiện.

## 5. Yêu cầu phi chức năng

- Thời gian đóng gói ≤ 1,5 lần thời lượng video với `-preset veryfast` trên máy 4 nhân. Đo trên máy thật và ghi vào PR.
- Bắt đầu phát (time-to-first-frame) ≤ 2 giây trên mạng 10 Mbps.
- Upload segment song song tối đa 8 luồng. Kiểm tra hạn mức (F16) **một lần cho cả gói** bằng tổng dung lượng thư mục, không kiểm từng segment.
- Response của proxy: master `Cache-Control: private, no-store`, playlist bậc `private, max-age=60`. Object trên R2: segment `max-age=31536000, immutable`.
- R2 bucket bật CORS cho domain frontend trên **endpoint S3 API** (method `GET, HEAD`, header `Range`).
- Proxy viết lại playlist bằng streaming (đọc theo dòng), không giữ toàn bộ tệp trong bộ nhớ. Playlist 2 giờ có khoảng 1.200 dòng.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__add_hls_assets.sql`:

```sql
CREATE TABLE IF NOT EXISTS hls_assets (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    video_part_id BIGINT REFERENCES video_parts(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    master_key VARCHAR(500),                         -- hls/videos/12/master.m3u8
    renditions JSONB,                                -- ["360p","720p"]
    total_bytes BIGINT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_hls_owner CHECK ((video_id IS NULL) <> (video_part_id IS NULL)),
    CONSTRAINT chk_hls_status CHECK (status IN ('PENDING','PROCESSING','READY','FAILED','STALE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hls_video ON hls_assets(video_id) WHERE video_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hls_part  ON hls_assets(video_part_id) WHERE video_part_id IS NOT NULL;
```

Tạo dòng `hls_assets` cho mỗi job bằng `INSERT … ON CONFLICT (…) DO UPDATE SET status='PENDING'` (AD-8).

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/playback` | JWT + quyền xem video | Nguồn phát của video gốc |
| GET | `/api/v1/parts/{partId}/playback` | JWT + quyền xem video chứa part | Nguồn phát của clip |
| GET | `/api/v1/playback/hls/{assetId}/master.m3u8?exp=&sig=` | Chữ ký (không cần JWT) | Proxy master (FR-7) |
| GET | `/api/v1/playback/hls/{assetId}/{rendition}/index.m3u8?exp=&sig=` | Chữ ký | Proxy playlist bậc (FR-7) |
| POST | `/api/v1/videos/{id}/hls:rebuild` | `OWNER` hoặc `ADMIN` | Tạo lại job đóng gói khi lỗi |

Response mẫu:

```json
{
  "type": "hls",
  "status": "READY",
  "hlsUrl": "https://api.autocut.vn/api/v1/playback/hls/88/master.m3u8?exp=1763460000&sig=3f9a…",
  "mp4Url": "https://<account>.r2.cloudflarestorage.com/autocut/users/…/01_gioi-thieu.mp4?X-Amz-Expires=900&X-Amz-Signature=…",
  "renditions": ["360p", "720p"],
  "durationSec": 432.5,
  "expiresAt": "2026-11-18T10:40:00Z"
}
```

Khi chưa xong: `"type": "mp4", "status": "PROCESSING", "hlsUrl": null`.
Lỗi theo AD-2:
- Không có quyền xem, hoặc video/part không tồn tại: `404 VIDEO_NOT_FOUND` / `404 PART_NOT_FOUND`.
- Có quyền xem nhưng không có quyền `hls:rebuild`: `403 FORBIDDEN_ACTION`.

Playlist bậc sau khi viết lại (trích):
```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="https://<account>.r2.cloudflarestorage.com/autocut/hls/parts/55/720p/init.mp4?X-Amz-…"
#EXTINF:6.000,
https://<account>.r2.cloudflarestorage.com/autocut/hls/parts/55/720p/seg_00001.m4s?X-Amz-…
```

### 6.3 Backend (Spring Boot)

- **Tạo** `com.autocut.video.HlsPackager` (SV1): `HlsResult packageHls(File input, Path outDir, List<Rendition> renditions, boolean hasAudio)`, cùng hàm package-private `List<String> buildCommand(...)` để test, giống cách `VideoCutter.buildCommand` ([VideoCutter.java:337](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L337)). Dùng `ProcessBuilder` và `StreamUtil` để tránh deadlock khi đọc stderr.
- **Tạo** `com.autocut.video.Rendition` (record `name, width, height, videoKbps, audioKbps`) và `Rendition.ladderFor(int sourceHeight, String maxRendition)`.
- **Tạo** `com.autocut.service.HlsService` (SV3): là handler của job `HLS_PACKAGE` trong F09, chạy theo thứ tự: tải nguồn về thư mục làm việc của job (F17) → `HlsPackager` → upload thư mục lên R2 → cập nhật `hls_assets`.
- **Sửa** `CloudflareR2Service`:
  - Thêm `uploadDirectory(Path dir, String prefix, Map<String,String> cacheControlByExt)`: kiểm tra hạn mức **một lần**, upload song song 8 luồng (dùng executor riêng của hàm, đóng sau khi xong), đặt `contentType` theo đuôi tệp (`application/vnd.apple.mpegurl` cho `.m3u8`, `video/iso.segment` cho `.m4s`, `video/mp4` cho `init.mp4`).
  - Thêm `presignGet(String key, Duration ttl)` và `openStream(String key)`.
  - Code mới **không** dùng URL trả về từ `uploadFile` nữa, chỉ lưu key.
- **Tạo** `com.autocut.playback.HlsPlaylistRewriter` (hàm thuần, dễ test):
  - `rewriteMaster(Reader in, Function<String,String> variantUrl)`: sửa mọi dòng URI không bắt đầu bằng `#`.
  - `rewriteVariant(Reader in, Function<String,String> objectUrl)`: sửa các dòng segment và thuộc tính `URI="…"` trong `#EXT-X-MAP`.
- **Tạo** `com.autocut.playback.PlaybackSigner`: `sign(assetId, path, exp)` và `verify(...)`, so sánh bằng `MessageDigest.isEqual` (không lộ thông tin qua thời gian so sánh).
- **Tạo** `com.autocut.controller.v1.PlaybackController`: 4 endpoint GET ở §6.2. Không thêm vào `VideoController`.
- `GET /api/video/stream/{hash}` cũ: giữ để tương thích, đánh dấu `@Deprecated`. Sau F01 bắt buộc `?ticket=`, là vé `STREAM` xin qua `POST /api/v1/auth/tickets` (**F01 FR-10**; F39 không tự định nghĩa vé). Xoá endpoint này khi frontend đã chuyển xong.
- **Phân biệt với vé:** chữ ký `exp/sig` của proxy playlist (FR-7) **không phải** vé người dùng. Nó giống presigned URL của R2 cho tài nguyên HLS: không gắn với phiên đăng nhập, chỉ cấp sau khi `/playback` đã kiểm JWT và quyền, và tồn tại vì vé `STREAM` (5 phút) quá ngắn cho một phiên xem HLS dài.

Lệnh FFmpeg mẫu cho **clip** nguồn 1080p, có audio (một lệnh, nhiều đầu ra):

```bash
ffmpeg -y -i input.mp4 \
  -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=w=640:h=360:force_original_aspect_ratio=decrease:force_divisible_by=2[v360];[v2]scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2[v720];[v3]scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2[v1080]" \
  -map "[v360]"  -c:v:0 libx264 -b:v:0 800k  -maxrate:v:0 856k  -bufsize:v:0 1200k \
  -map "[v720]"  -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k \
  -map "[v1080]" -c:v:2 libx264 -b:v:2 5000k -maxrate:v:2 5350k -bufsize:v:2 7500k \
  -map 0:a:0 -c:a:0 aac -b:a:0 96k  -ac 2 \
  -map 0:a:0 -c:a:1 aac -b:a:1 128k -ac 2 \
  -map 0:a:0 -c:a:2 aac -b:a:2 128k -ac 2 \
  -preset veryfast -g 48 -keyint_min 48 -sc_threshold 0 \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -hls_flags independent_segments \
  -hls_segment_filename "out/%v/seg_%05d.m4s" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:360p v:1,a:1,name:720p v:2,a:2,name:1080p" \
  out/%v/index.m3u8
```

Ghi chú cho SV1:
- `-g` và `-keyint_min` = fps × 2. Lấy fps bằng `ffprobe`; giá trị 48 chỉ đúng khi nguồn 24 fps.
- `-sc_threshold 0` giữ keyframe đều đặn để segment khớp nhau giữa các bậc.
- Video **không có audio** (quay màn hình không tiếng): bỏ các `-map 0:a:0`, đổi `var_stream_map` thành `v:0,name:360p v:1,name:720p …`. Phát hiện bằng `ffprobe -select_streams a`.
- Video gốc dùng cùng lệnh với 2 bậc (`split=2`).

### 6.5 Frontend (Next.js)

- **Tạo** `frontend/src/components/HlsVideo.tsx`, bọc thẻ `<video>`, chọn cách phát theo thứ tự:
  1. `video.canPlayType('application/vnd.apple.mpegurl')` được thì gán `src = hlsUrl` (Safari/iOS);
  2. nếu không, dùng `hls.js` khi `Hls.isSupported()`;
  3. nếu cả hai không được thì dùng `mp4Url`.

  Trước `expiresAt` 2 phút, gọi lại `/playback` để lấy URL mới **chỉ khi người dùng tua hoặc đổi bậc mà bị lỗi 403/404** (`Hls.Events.ERROR`, `details=manifestLoadError|fragLoadError`). Sau đó `hls.loadSource(newUrl)` tại đúng vị trí `currentTime`.
- **Tạo** `frontend/src/lib/playback.ts`: `getPlayback(videoId)` và `getPartPlayback(partId)`. `videoId` lấy từ state dự án theo F00.
- **Sửa** [VideoCanvasViewport.tsx:268](../../../frontend/src/components/VideoCanvasViewport.tsx#L268): thay `<video src={videoSrc}>` bằng `<HlsVideo>`, giữ `ref`, `onTimeUpdate`, `onLoadedMetadata` (dùng `forwardRef`).
- Menu chất lượng dùng biểu tượng `Settings` của lucide, chữ "Chất lượng: Tự động (720p)".
- Unmount thì gọi `hls.destroy()`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* **clip** nguồn 1080p dài 10 phút, *When* job HLS chạy xong, *Then* `hls_assets.status = READY`, `renditions = ["360p","720p","1080p"]`, và R2 có `master.m3u8`, 3 thư mục con, mỗi thư mục có `init.mp4`.
- **AC-2** — *Given* **video gốc** nguồn 1080p, *When* đóng gói, *Then* `renditions = ["360p","720p"]`. *Given* clip nguồn 720p, *Then* không có bậc `1080p`.
- **AC-3** — *Given* video không có luồng âm thanh, *When* đóng gói, *Then* job vẫn `READY` và phát được.
- **AC-4** — *Given* Chrome desktop giả lập "Fast 3G" trong DevTools, *When* phát video, *Then* sau ≤ 10 giây hls.js chuyển xuống 360p và video không dừng quá 2 giây.
- **AC-5** — *Given* video đang phát, *When* tua tới 80%, *Then* tab Network chỉ tải các segment quanh vị trí đó.
- **AC-6** — *Given* `hls_assets.status = PROCESSING`, *When* mở Studio, *Then* video phát bằng `mp4Url` (presigned) và có dòng "Đang tối ưu video…".
- **AC-7** — *Given* người dùng B không có quyền xem video của A, *When* gọi `/api/v1/videos/{id}/playback`, *Then* nhận `404 VIDEO_NOT_FOUND`, giống hệt video không tồn tại (AD-2).
- **AC-8** — *Given* `hlsUrl` hợp lệ, *When* tải master, *Then* mọi URI playlist bậc đều trỏ về `/api/v1/playback/hls/...` và có `sig`. Khi tải playlist bậc thì `#EXT-X-MAP` và mọi segment đều là presigned R2 URL. **Không** dòng nào còn đường dẫn tương đối.
- **AC-9** — *Given* sửa 1 ký tự trong `sig`, hoặc `exp` đã qua, *When* gọi proxy, *Then* nhận `404`.
- **AC-10** — *Given* bucket R2 đã đặt private, *When* gọi thẳng `https://<bucket>/hls/...` không có chữ ký, *Then* nhận `403` từ R2.
- **AC-11** — Safari iOS phát được `hlsUrl` mà không cần hls.js (kiểm tra tay, chụp màn hình gắn vào PR).

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại | Nội dung |
|---|---|---|
| `RenditionTest.ladderFor_1080_part_returns3` | unit | clip nguồn 1080 → 3 bậc |
| `RenditionTest.ladderFor_1080_video_capsAt720` | unit | video gốc chặn ở 720p (AC-2) |
| `RenditionTest.ladderFor_480_returnsOnly360` | unit | không upscale |
| `HlsPackagerTest.buildCommand_containsVarStreamMapAndInit` | unit | có `-var_stream_map`, `-hls_time 6`, `-hls_fmp4_init_filename init.mp4`, `-map 0:a:0` |
| `HlsPackagerTest.buildCommand_noAudio_omitsAudioMaps` | unit | không có `-map 0:a:0` |
| `HlsPackagerTest.package_sampleClip_createsMaster` | integration (`@Tag("ffmpeg")`) | clip 10 giây sinh bằng `ffmpeg -f lavfi -i testsrc` |
| `HlsPlaylistRewriterTest.master_rewritesAllVariantUris` | unit | AC-8 (master) |
| `HlsPlaylistRewriterTest.variant_rewritesSegmentsAndExtXMap` | unit | AC-8 (playlist bậc), có `#EXT-X-MAP` |
| `PlaybackSignerTest.tamperedOrExpired_rejected` | unit | AC-9 |
| `CloudflareR2ServiceTest.uploadDirectory_checksQuotaOnce` | unit (mock S3Client) | kiểm tra hạn mức chỉ 1 lần |
| `CloudflareR2ServiceTest.uploadDirectory_setsContentTypeByExtension` | unit | đúng content type cho `.m3u8`, `.m4s`, `init.mp4` |
| `PlaybackControllerTest.notReady_returnsPresignedMp4` | MockMvc | AC-6 |
| `PlaybackControllerTest.noAccess_returns404` | MockMvc | AC-7 |
| `HlsVideo.test.tsx` (khi Vitest được duyệt; trước đó kiểm tra tay theo AC-4, AC-11) | component | chọn đúng nhánh Safari / hls.js / MP4 |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Dung lượng R2 tăng khoảng 1,5–2 lần | Vượt trần 8 GB ([CloudflareR2Service.java:25](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L25)) | Video gốc chỉ 2 bậc (FR-3); áp hạn mức F16; F17 xoá MP4 trung gian và HLS `STALE` |
| Encode tốn CPU, tranh tài nguyên với job cắt | Job cắt chậm | F09: loại job `HLS_PACKAGE` giới hạn 1 job chạy cùng lúc |
| Presigned URL hết hạn khi xem video dài | Lỗi khi tua sau nhiều giờ | TTL theo thời lượng (FR-7); frontend tự xin lại nguồn khi gặp lỗi tải (§6.5) |
| Presigned URL của R2 chỉ chạy trên endpoint S3 API, không chạy trên custom domain | Không dùng được CDN domain riêng | Chấp nhận ở giai đoạn này; segment vẫn được cache phía trình duyệt nhờ `immutable` |
| CORS của R2 chưa cấu hình | hls.js báo `manifestLoadError`/`fragLoadError` | Viết `docs/r2-cors.json`, kiểm tra bằng `curl -H "Origin: ..."` |
| fps biến thiên (VFR) khi quay màn hình | Segment lệch, tua bị nhảy | Thêm `-fps_mode cfr -r <fps>` khi `ffprobe` phát hiện VFR |
| Lộ `PLAYBACK_SIGNING_KEY` | Giả được chữ ký proxy | Lưu trong `.env`/secret; đổi khoá thì mọi link cũ hết hiệu lực (chấp nhận được) |

## 10. Câu hỏi mở

- [x] ~~Có dùng domain CDN riêng không?~~ Đã chốt theo AD-3: bucket private, dùng presigned URL trên endpoint S3 API của R2.
- [x] ~~Video gốc có cần HLS không?~~ Đã chốt: có, chỉ 2 bậc 360p/720p (FR-3).
- [ ] Clip có cần bậc 1080p không? Hiện để mặc định `hls.max_rendition_part=1080p`. Nếu phần lớn bài giảng là quay màn hình thì 720p thường đã đủ đọc chữ.
- [ ] Có giữ MP4 sau khi HLS sẵn sàng không? Đề xuất: giữ, vì cần cho tải về (F40), F42 và F45.
