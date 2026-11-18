# F40 — Link chia sẻ & mã nhúng

| Mục | Giá trị |
|---|---|
| **Mã** | F40 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API, token, DB) · SV4 (hộp thoại chia sẻ, trang xem công khai, middleware CSP) |
| **Phụ thuộc** | F00 (`partId`/`topicId` ổn định), F35 (`render_kind`: chỉ clip `RELEASE` mới được chia sẻ), F01 (BCrypt), F02 (`AccessService`), F04 (bỏ tải tệp theo đường dẫn), F06 (rate limit), F39 (proxy playlist có chữ ký và presigned URL; nếu chưa có HLS thì phát MP4 presigned) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Băm mật khẩu link dùng `BCryptPasswordEncoder` đã có ở F01; token sinh bằng `SecureRandom` của JDK; presign dùng `S3Presigner` của AWS SDK v2 đang có. |
| **Tham khảo** | Vimeo (Privacy: Password / Unlisted), Loom share link, YouTube "Không công khai", Google Drive "Anyone with the link" |

> **Cập nhật 18/11/2026:** Theo review: đổi tiền tố sang `/api/v1/share/**` (AD-5); dùng lại proxy có chữ ký của F39 (viết lại cả master, playlist bậc và `init.mp4`); kiểm tra `partId` có thuộc link không (chống IDOR); CSP `frame-ancestors` do Next.js middleware đặt; phiên xem mật khẩu dùng token trong header thay cho cookie bên thứ ba; `resolve()` trả thêm cờ `analyticsEnabled` để F47 dùng lại (cột do F47 thêm); bucket private theo AD-3; lỗi quyền theo AD-2.

## 1. Bối cảnh & vấn đề

- Hiện chưa có cách nào gửi clip cho học viên ngoài việc tải tệp về rồi gửi thủ công:
  - [ExportProgressModal.tsx:325](../../../frontend/src/components/ExportProgressModal.tsx#L325) tạo link `getDownloadClipUrl(clip.path)`, gọi `/api/video/download-clip?path=...` ([VideoController.java:1557](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1557)). Endpoint này đang có lỗi lộ tệp (path traversal, F04).
  - Nút "copy" ở [ExportProgressModal.tsx:77](../../../frontend/src/components/ExportProgressModal.tsx#L77) chỉ sao chép **đường dẫn thư mục trên máy chủ**, người khác không dùng được.
- `CloudflareR2Service.uploadFile` ([CloudflareR2Service.java:136-137](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L136-L137)) trả URL R2 **công khai, vĩnh viễn**. Ai biết URL là xem được, không thu hồi được. AD-3 chuyển bucket sang private; F40 là nơi đầu tiên người ngoài hệ thống xem nội dung, nên phải tuân thủ ngay.
- Bảng `video_parts` ([schema.sql](../../../database/schema.sql)) chưa có khái niệm "ai được xem".

## 2. Mục tiêu

- Người có quyền chia sẻ (`OWNER`, `EDITOR` theo AD-1) tạo link cho **một clip**, **một video gốc**, hoặc **cả bài học** (danh sách clip). F41 dùng thêm loại **khoá học**.
- Mỗi link có chế độ, mật khẩu, ngày hết hạn, bật/tắt cho phép tải về và bật/tắt thống kê.
- Có mã nhúng `<iframe>` để dán vào Moodle, Google Sites, blog.
- Thu hồi được bất kỳ lúc nào. Từ lúc thu hồi, không xin được nguồn phát hay playlist mới. URL đã cấp sẽ tự hết hạn theo TTL (xem AC-4).

### Ngoài phạm vi
- Chia sẻ theo danh sách email (F36, F41).
- Thống kê lượt xem chi tiết (F47). Spec này chỉ đếm `view_count` đơn giản.
- DRM.

## 3. User stories

- Là **giảng viên**, tôi muốn gửi link clip "Vòng lặp for" qua Zalo cho lớp; học viên mở trên điện thoại là xem được ngay, không phải đăng nhập.
- Là **giảng viên**, tôi muốn đặt mật khẩu và hạn 7 ngày cho link bài kiểm tra để không lan truyền ra ngoài.
- Là **giảng viên**, tôi muốn copy mã nhúng để dán vào trang Moodle của khoá học.
- Là **giảng viên**, tôi muốn thu hồi link khi phát hiện bị chia sẻ lên nhóm Facebook.

## 4. Yêu cầu chức năng

- **FR-1** `target_type` gồm 4 loại:
  - `VIDEO`: video gốc, `target_id = videos.id`.
  - `PART`: một clip, `target_id = video_parts.id`. Chỉ tạo được khi part có `render_kind='RELEASE'` (F35); nếu không thì trả `409 PART_NOT_RELEASED`.
  - `LESSON`: mọi clip `COMPLETED` **và `render_kind='RELEASE'`** thuộc topic `ACTIVE` của một video, xếp theo `sections.position` rồi `topics.position`; `target_id = videos.id`.
  - `COURSE`: do F41 dùng, `target_id = courses.id`.
- **FR-2** Chế độ (`access`):
  - `PUBLIC_LINK`: ai có link đều xem được.
  - `PASSWORD`: phải nhập mật khẩu (4–64 ký tự).
  - `DISABLED`: đã thu hồi.
- **FR-3** Tuỳ chọn thêm:
  - `expires_at`: không bắt buộc.
  - `allow_download`: mặc định `false`.
  - `allow_embed`: mặc định `true`.
  - `allowed_embed_domains`: danh sách tên miền được phép nhúng, không bắt buộc.
  - `analytics_enabled`: mặc định `true`; F47 chỉ thu số liệu khi bật. **Cột này do migration của F47 thêm** vào `share_links` (và `courses`). Trước khi có F47, API và hộp thoại chưa có tuỳ chọn này.
- **FR-4** Token chia sẻ gồm 22 ký tự base64url, sinh từ 16 byte `SecureRandom` (128 bit). Không dùng ID tăng dần.
- **FR-5** Link xem `https://<frontend>/s/{token}`, link nhúng `https://<frontend>/embed/{token}`.
- **FR-6** Trang xem công khai không yêu cầu đăng nhập. Trang gồm:
  - trình phát và tiêu đề;
  - tóm tắt (nếu có F21) và chapters (nếu có F22);
  - nút tải về, nếu `allow_download` bật.
- **FR-7 — Phiên xem cho link mật khẩu.** Nhập đúng mật khẩu thì server trả `viewerToken`:
  - 32 byte ngẫu nhiên, sống 12 giờ, gắn với `share_link_id`; DB chỉ lưu bản băm SHA-256.
  - Client lưu vào `localStorage` theo khoá `share:{token}` và gửi qua header `X-Share-Viewer` ở mọi request `/api/v1/share/{token}/**`.
  - Không dùng cookie, nên chạy được cả trong iframe; trình duyệt chặn cookie bên thứ ba cũng không ảnh hưởng.
- **FR-8 — Nguồn phát** (AD-3, dùng lại F39):
  - MP4: presigned R2 URL, hết hạn 15 phút.
  - HLS: `hlsUrl` là URL proxy master **có chữ ký** do `PlaybackSigner` của F39 sinh ra, chữ ký có thêm tham số `sl={shareLinkId}`. Mỗi lần gọi playlist (master và playlist bậc), proxy kiểm tra link `sl` vẫn hợp lệ (chưa thu hồi, chưa hết hạn); không còn hợp lệ thì trả `404`.
  - **F40 không có proxy riêng.** Proxy của F39 đã viết lại cả master, playlist bậc, `#EXT-X-MAP:URI` và segment.
- **FR-9 — Chống IDOR khi tải về.** `GET /api/v1/share/{token}/download/{partId}` chỉ cho tải khi `partId` **thuộc** đối tượng của link:
  - `PART`: `partId = target_id`.
  - `LESSON`: part có `status=COMPLETED`, `render_kind='RELEASE'`, topic `ACTIVE` và `topic.video_id = target_id`.
  - Ở **mọi** loại target, part nào không phải `RELEASE`, hoặc đang `STALE`, đều bị coi là không thuộc link.
  - `COURSE`: part nằm trong một bài học của khoá (F41).
  - `VIDEO`: chỉ tải video gốc qua `/download/source`, không tải part.

  Part không thuộc link thì trả `404 PART_NOT_FOUND`, giống hệt part không tồn tại (AD-2).
- **FR-10** Mỗi đối tượng có thể có nhiều link (ví dụ một link cho lớp A, một cho lớp B). Hộp thoại liệt kê các link kèm số lượt xem.
- **FR-11** Link hết hạn hoặc bị thu hồi: trang hiện "Liên kết đã hết hạn hoặc bị thu hồi. Vui lòng liên hệ giảng viên.", API trả `410 SHARE_GONE`. Token không tồn tại thì trả `404 SHARE_NOT_FOUND`.
- **FR-12 — Đếm lượt xem.** Mỗi người xem chỉ được đếm 1 lần mỗi 30 phút cho mỗi link:
  - `viewer_key = SHA-256(ip + user-agent + ngày)`, không lưu IP thô.
  - Ghi `share_view_marks` bằng `INSERT … ON CONFLICT DO NOTHING RETURNING` (AD-8). Chỉ khi có dòng mới mới `UPDATE share_links SET view_count = view_count + 1`.

## 5. Yêu cầu phi chức năng

- Rate limit (F06): tối đa 10 lần nhập sai mật khẩu cho mỗi IP và mỗi token trong 15 phút, quá thì `429`.
- Mật khẩu link lưu dạng BCrypt hash, không bao giờ trả về qua API.
- **CSP do frontend đặt.** Trang `/embed/{token}` do Next.js phục vụ, nên header `Content-Security-Policy: frame-ancestors …` do `frontend/src/middleware.ts` đặt (xem §6.5), không phải backend. Các trang khác dùng `frame-ancestors 'self'`.
- API công khai không lộ `owner_id`, email, `r2_key`, `password_hash`.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_share_links.sql`:

```sql
CREATE TABLE IF NOT EXISTS share_links (
    id BIGSERIAL PRIMARY KEY,
    token VARCHAR(32) UNIQUE NOT NULL,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(10) NOT NULL,
    target_id BIGINT NOT NULL,                 -- videos.id | video_parts.id | courses.id
    label VARCHAR(100),                        -- "Lớp CNTT K18"
    access VARCHAR(20) NOT NULL DEFAULT 'PUBLIC_LINK',
    password_hash VARCHAR(100),
    expires_at TIMESTAMPTZ,
    allow_download BOOLEAN NOT NULL DEFAULT FALSE,
    allow_embed BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_embed_domains TEXT[],
    -- analytics_enabled BOOLEAN NOT NULL DEFAULT TRUE: do migration của F47 thêm, KHÔNG tạo ở đây
    view_count BIGINT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_share_target CHECK (target_type IN ('VIDEO','PART','LESSON','COURSE')),
    CONSTRAINT chk_share_access CHECK (access IN ('PUBLIC_LINK','PASSWORD','DISABLED')),
    CONSTRAINT chk_share_pw CHECK (access <> 'PASSWORD' OR password_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_share_target ON share_links(target_type, target_id);

CREATE TABLE IF NOT EXISTS share_viewer_sessions (
    token_hash CHAR(64) PRIMARY KEY,           -- SHA-256 của viewerToken
    share_link_id BIGINT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS share_view_marks (
    share_link_id BIGINT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    viewer_key CHAR(64) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,         -- làm tròn xuống mốc 30 phút
    PRIMARY KEY (share_link_id, viewer_key, window_start)
);
```
Hai bảng phụ được dọn bởi job của F17: xoá session hết hạn, xoá mark cũ hơn 1 ngày.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/share-links` | JWT, quyền `SHARE` trên target (OWNER/EDITOR) | Tạo link |
| GET | `/api/v1/share-links?targetType=PART&targetId=55` | JWT, quyền xem target | Liệt kê link |
| PATCH | `/api/v1/share-links/{id}` | JWT, quyền `SHARE` | Sửa chế độ, mật khẩu, hạn, tuỳ chọn |
| DELETE | `/api/v1/share-links/{id}` | JWT, quyền `SHARE` | Thu hồi (đặt `access=DISABLED`, giữ bản ghi) |
| GET | `/api/v1/share/{token}` | Ẩn danh (+ `X-Share-Viewer` nếu có mật khẩu) | Metadata + nguồn phát |
| POST | `/api/v1/share/{token}/unlock` | Ẩn danh | Gửi mật khẩu, nhận `viewerToken` |
| GET | `/api/v1/share/{token}/embed-policy` | Ẩn danh | `{ allowEmbed, allowedEmbedDomains }`, dùng cho middleware Next.js |
| GET | `/api/v1/share/{token}/download/{partId}` | Ẩn danh, cần `allow_download` | 302 tới presigned URL có `response-content-disposition=attachment` (FR-9) |
| GET | `/api/v1/share/{token}/download/source` | như trên, chỉ với `VIDEO` | 302 tải video gốc |
| GET | `/api/v1/share/{token}/download.zip` | như trên, chỉ với `LESSON` | Gọi `ZipExportService` của F12 với `releaseOnly=true` (chỉ clip `RELEASE` + `COMPLETED`) |
| GET | `/api/v1/share/{token}/chapters?format=youtube\|vtt\|json` | Ẩn danh | Gọi `ChapterService` của F22 cho đối tượng của link |
| GET | `/api/v1/share/{token}/subtitles?format=srt\|vtt&lang=` | Ẩn danh | Gọi `SubtitleService` của F23 (và bản dịch F24 khi có `lang`) |

Tạo link — request:

```json
{
  "targetType": "PART",
  "targetId": 55,
  "label": "Lớp CNTT K18",
  "access": "PASSWORD",
  "password": "vonglap2026",
  "expiresAt": "2026-12-01T23:59:59+07:00",
  "allowDownload": false,
  "allowEmbed": true,
  "allowedEmbedDomains": ["lms.truong.edu.vn"],
  "analyticsEnabled": true
}
```

Response `201`:

```json
{
  "id": 9,
  "token": "q3V8kZb2Q1y0xWn7aP4tRg",
  "url": "https://autocut.vn/s/q3V8kZb2Q1y0xWn7aP4tRg",
  "embedCode": "<iframe src=\"https://autocut.vn/embed/q3V8kZb2Q1y0xWn7aP4tRg\" width=\"960\" height=\"540\" style=\"border:0\" allow=\"fullscreen; picture-in-picture\" allowfullscreen></iframe>",
  "access": "PASSWORD",
  "expiresAt": "2026-12-01T16:59:59Z"
}
```

`GET /api/v1/share/{token}`, trường hợp `LESSON`:

```json
{
  "title": "Bài 05 – Vòng lặp",
  "targetType": "LESSON",
  "requiresPassword": false,
  "allowDownload": true,
  "items": [
    { "partId": 55, "title": "Giới thiệu vòng lặp", "section": "Lý thuyết", "durationSec": 96.4,
      "playback": { "type": "hls",
        "hlsUrl": "https://api.autocut.vn/api/v1/playback/hls/88/master.m3u8?sl=9&exp=1763460000&sig=…",
        "mp4Url": "https://<account>.r2.cloudflarestorage.com/…?X-Amz-Expires=900&X-Amz-Signature=…" } }
  ]
}
```

Mã lỗi:

| HTTP | Mã | Khi nào |
|---|---|---|
| 404 | `SHARE_NOT_FOUND` | Token không tồn tại |
| 410 | `SHARE_GONE` | Link hết hạn hoặc đã thu hồi |
| 401 | `SHARE_PASSWORD_REQUIRED` | Link mật khẩu, chưa có `viewerToken` hợp lệ |
| 401 | `SHARE_PASSWORD_INVALID` | Nhập sai mật khẩu |
| 403 | `FORBIDDEN_ACTION` | Gọi tải về khi `allow_download=false` |
| 404 | `PART_NOT_FOUND` | Part không thuộc link (FR-9) |
| 429 | `TOO_MANY_ATTEMPTS` | Nhập sai quá số lần cho phép |
| 404 | `VIDEO_NOT_FOUND` | Khi tạo link: target không tồn tại hoặc người tạo không có quyền xem (AD-2) |
| 403 | `FORBIDDEN_ACTION` | Khi tạo link: xem được target nhưng không có quyền `SHARE` (ví dụ `VIEWER`) |

### 6.3 Backend (Spring Boot)

- **Tạo** `entity/ShareLinkEntity`, `repository/ShareLinkRepository`.
- **Tạo** `service/ShareLinkService`:
  - `create`, `update`, `revoke`.
  - `resolve(token, viewerToken)`: kiểm tra lần lượt tồn tại → `access != DISABLED` → chưa hết hạn → mật khẩu / `viewerToken`. Trả record `ResolvedShare(shareLinkId, targetType, targetId, allowDownload, analyticsEnabled)`. **F47 dùng lại hàm này** khi nhận beacon `/api/v1/share/view-events`. Trước khi có F47 thì `analyticsEnabled` luôn bằng `false`.
  - `unlock(token, password)`.
  - `assertPartBelongs(link, partId)`: hàm riêng cho FR-9, có test.
- **Tạo** `controller/v1/ShareLinkController` cho `/api/v1/share-links` và `controller/v1/ShareController` cho `/api/v1/share/**`. Trong Spring Security, `permitAll` **chỉ** cho `/api/v1/share/**` (AD-5).
- **Dùng lại** từ F39: `CloudflareR2Service.presignGet(key, ttl, downloadFileName)` (thêm tham số `downloadFileName` để đặt `response-content-disposition`), `PlaybackSigner` (thêm tham số tuỳ chọn `shareLinkId` vào chuỗi được ký) và `PlaybackController`. Proxy của F39, khi thấy `sl`, gọi `ShareLinkService.assertActive(sl)` trước khi trả playlist.
- Tăng lượt xem theo FR-12.

### 6.5 Frontend (Next.js)

- **Tạo** `frontend/src/components/ShareDialog.tsx`. Mở từ nút "Chia sẻ" (icon `Share2` của lucide) trên từng clip ở [ExportProgressModal.tsx:302](../../../frontend/src/components/ExportProgressModal.tsx#L302) và trên thẻ video trong thư viện. Hộp thoại có:
  - Tab "Liên kết": chọn chế độ, nhập mật khẩu, chọn ngày hết hạn, công tắc "Cho phép tải về", công tắc "Thu thập thống kê lượt xem", nút "Sao chép liên kết".
  - Tab "Nhúng": chọn kích thước (640×360, 960×540, Tự co giãn), ô mã có nút "Sao chép mã nhúng".
  - Danh sách link đã tạo: nhãn, lượt xem, hạn, nút "Thu hồi" có hộp xác nhận.
- **Tạo** route `frontend/src/app/s/[token]/page.tsx` (trang xem) và `frontend/src/app/embed/[token]/page.tsx` (chỉ có trình phát, không header, nền đen).
- **Tạo** `frontend/src/middleware.ts` cho các đường dẫn `/embed/:token*` và `/s/:token*`:
  - `/embed/...`: gọi `GET /api/v1/share/{token}/embed-policy` (cache 60 giây), rồi đặt `Content-Security-Policy: frame-ancestors <domains>`. Danh sách rỗng thì dùng `*`; `allowEmbed=false` thì dùng `'none'`.
  - `/s/...`: đặt `frame-ancestors 'self'`.
  - Logic tạo giá trị header viết thành hàm thuần `buildFrameAncestors(policy)` trong `lib/csp.ts`.
- Trang `/s/...` hiện form mật khẩu khi API trả `401 SHARE_PASSWORD_REQUIRED`, hiện thông báo khi `410`, và dùng `HlsVideo` (F39). `viewerToken` lưu trong `localStorage` theo FR-7.
- Thẻ `<meta property="og:title|og:image">` để link dán vào Zalo/Facebook có ảnh xem trước. Ảnh lấy từ F43 (presigned), chưa có thì dùng ảnh mặc định.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* clip đã `COMPLETED`, *When* tạo link `PUBLIC_LINK`, *Then* mở `/s/{token}` trong cửa sổ ẩn danh xem được ngay, không phải đăng nhập.
- **AC-2** — *Given* link `PASSWORD`, *When* nhập sai, *Then* hiện "Mật khẩu không đúng". *When* nhập đúng, *Then* video phát, và F5 trong vòng 12 giờ không phải nhập lại. Kịch bản này cũng phải chạy được **bên trong iframe**.
- **AC-3** — *Given* link có `expiresAt` ở quá khứ, *When* mở, *Then* nhận `410 SHARE_GONE` và trang báo hết hạn.
- **AC-4** — *Given* link đang được xem, *When* bấm "Thu hồi", *Then*:
  - (a) tải lại trang thì nhận `410`;
  - (b) gọi lại `hlsUrl` cũ (master hoặc playlist bậc) thì nhận `404`;
  - (c) segment và MP4 đã cấp vẫn tải được cho tới khi URL hết hạn: MP4 tối đa 15 phút, HLS theo TTL của F39. Giới hạn này được ghi rõ trong hộp thoại thu hồi.
- **AC-5** — *Given* `allow_download = false`, *When* gọi `/download/{partId}`, *Then* nhận `403 FORBIDDEN_ACTION`, và trang không hiện nút tải.
- **AC-6** — *Given* link `PART` cho part 55 có `allow_download=true`, *When* gọi `/download/56` (part của video khác), *Then* nhận `404 PART_NOT_FOUND`. *Given* link `LESSON` của video 12, *When* tải một part thuộc video 13, *Then* cũng nhận `404`.
- **AC-7** — *Given* `allowedEmbedDomains = ["lms.truong.edu.vn"]`, *When* nhúng iframe trên `evil.com`, *Then* trình duyệt chặn, và response của trang `/embed/{token}` có header `Content-Security-Policy: frame-ancestors https://lms.truong.edu.vn`.
- **AC-8** — *Given* người dùng B không có quyền xem video của A, *When* `POST /api/v1/share-links` với `targetId` thuộc A, *Then* nhận `404 VIDEO_NOT_FOUND`. *Given* B là `VIEWER` của video, *Then* nhận `403 FORBIDDEN_ACTION`.
- **AC-9** — Response công khai không chứa `owner_id`, `created_by`, `email`, `r2_key`, `password_hash`. Test kiểm tra bằng JSON path.
- **AC-10** — Sai mật khẩu lần thứ 11 trong 15 phút thì nhận `429`.
- **AC-11** — *Given* cùng một người xem mở trang 5 lần trong 30 phút, *Then* `view_count` chỉ tăng 1.
- **AC-12** — *Given* video có 3 clip `RELEASE` và 2 clip `DRAFT`, *When* mở link `LESSON`, *Then* chỉ thấy 3 clip. Tạo link `PART` cho clip `DRAFT` thì nhận `409 PART_NOT_RELEASED`.

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `ShareTokenGeneratorTest.token_is22CharsBase64Url_andUnique10k` | unit |
| `ShareLinkServiceTest.resolve_disabled_throwsGone` | unit |
| `ShareLinkServiceTest.resolve_expired_throwsGone` | unit (dùng `Clock` cố định) |
| `ShareLinkServiceTest.resolve_passwordWithoutViewerToken_throwsPasswordRequired` | unit |
| `ShareLinkServiceTest.unlock_correct_returnsViewerTokenValid12h` | unit |
| `ShareLinkServiceTest.assertPartBelongs_partFromOtherVideo_throwsNotFound` | unit (AC-6, đủ 4 loại target) |
| `ShareLinkControllerTest.create_noAccess_returns404_viewer_returns403` | MockMvc (AC-8) |
| `ShareControllerTest.get_doesNotLeakPrivateFields` | MockMvc (AC-9) |
| `ShareControllerTest.download_disallowed_returns403` | MockMvc (AC-5) |
| `PlaybackControllerTest.sharedMaster_afterRevoke_returns404` | MockMvc (AC-4b, dùng proxy F39) |
| `ShareViewCounterTest.sameViewerWithin30m_countsOnce` | integration Postgres (AC-11) |
| `csp.test.ts: buildFrameAncestors_domains_none_empty` | unit frontend (khi Vitest được duyệt) |
| E2E tay: AC-1, AC-2 (cả trong iframe), AC-7 trên Chrome và Safari iOS | manual |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| `cloud_url` công khai cũ vẫn truy cập được | Thu hồi link nhưng video vẫn lộ | Chuyển bucket sang private (AD-3), bỏ `publicUrl` ([CloudflareR2Service.java:136](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L136)); code mới không đọc `cloud_url` |
| Viết lại playlist tốn CPU khi nhiều người xem | Chậm | Proxy F39 viết lại theo dòng; cache playlist bậc **chưa ký** trong bộ nhớ 10 phút theo `assetId/rendition`, chỉ ký lại lúc trả về |
| Segment HLS đã cấp còn hạn sau khi thu hồi | Người đang xem vẫn xem tiếp được | Chấp nhận, ghi rõ trong giao diện (AC-4c) |
| `viewerToken` bị lộ (chia sẻ cùng link) | Người khác vào được mà không cần mật khẩu | Token chỉ sống 12 giờ, gắn với một link; đổi mật khẩu thì xoá mọi session của link |
| Học viên tải về rồi phát tán | Mất kiểm soát | Mặc định `allow_download=false`; F44 có watermark |

## 10. Câu hỏi mở

- [x] ~~Có chuyển bucket R2 sang private ngay trong F40 không?~~ Đã chốt theo AD-3: có.
- [ ] Link `LESSON` có tự cập nhật khi thêm clip mới không? Spec giả định **có**, vì luôn đọc dữ liệu mới nhất.
- [ ] Có cần chế độ "Chỉ thành viên tổ chức đã đăng nhập" (dùng F03 SSO) không?
- [ ] Domain frontend chính thức là gì? Cần biết để sinh `url` và `embedCode`.
