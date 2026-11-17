# F40 — Link chia sẻ & mã nhúng

| Mục | Giá trị |
|---|---|
| **Mã** | F40 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API, token, DB) · SV4 (hộp thoại chia sẻ, trang xem công khai) |
| **Phụ thuộc** | F01 (JWT), F02 (sở hữu), F04 (bỏ tải tệp theo đường dẫn), F39 (nên có để phát mượt; nếu chưa có thì dùng MP4) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Băm mật khẩu link dùng `BCryptPasswordEncoder` đã thêm ở F01; token sinh bằng `SecureRandom` của JDK. |
| **Tham khảo** | Vimeo (Privacy: Password / Unlisted / Hide from Vimeo), Loom share link, YouTube "Không công khai", Google Drive "Anyone with the link" |

## 1. Bối cảnh & vấn đề

- Hiện chưa có cách nào gửi clip cho học viên ngoài việc tải tệp về rồi gửi thủ công:
  - [ExportProgressModal.tsx:325](../../../frontend/src/components/ExportProgressModal.tsx#L325) tạo link `getDownloadClipUrl(clip.path)`, tức là gọi `/api/video/download-clip?path=...` ([VideoController.java:1557](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1557)). Endpoint này đang có lỗi lộ tệp (path traversal, F04).
  - Nút "copy" ở [ExportProgressModal.tsx:77](../../../frontend/src/components/ExportProgressModal.tsx#L77) chỉ sao chép **đường dẫn thư mục trên máy chủ**, người khác không dùng được.
- `CloudflareR2Service.uploadFile` ([CloudflareR2Service.java:136-139](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L136-L139)) trả về URL R2 **công khai, vĩnh viễn**. Ai biết URL là xem được, không thu hồi được, không có ngày hết hạn.
- Bảng `video_parts` ([schema.sql](../../../database/schema.sql)) chỉ có `cloud_url`, chưa có khái niệm "ai được xem".

## 2. Mục tiêu

- Chủ video tạo link chia sẻ cho **một clip**, **một video gốc** hoặc **cả bài học (playlist clip)**.
- Mỗi link có thể đặt chế độ, mật khẩu, ngày hết hạn, và bật/tắt cho phép tải về.
- Có mã nhúng `<iframe>` để dán vào Moodle, Google Sites, blog.
- Thu hồi được link bất kỳ lúc nào. Thu hồi xong thì người đã có link cũng hết xem được.

### Ngoài phạm vi
- Chia sẻ theo danh sách email cụ thể (sẽ làm ở F36/F41).
- Thống kê lượt xem chi tiết (F47). Spec này chỉ đếm `view_count` đơn giản.
- DRM.

## 3. User stories

- Là **giảng viên**, tôi muốn gửi link clip "Vòng lặp for" qua Zalo cho lớp. Học viên mở trên điện thoại là xem được ngay, không phải đăng nhập.
- Là **giảng viên**, tôi muốn đặt mật khẩu và hạn 7 ngày cho link bài kiểm tra để không lan truyền ra ngoài.
- Là **giảng viên**, tôi muốn copy mã nhúng để dán vào trang Moodle của khoá học.
- Là **giảng viên**, tôi muốn thu hồi link khi phát hiện bị chia sẻ lên nhóm Facebook.

## 4. Yêu cầu chức năng

- **FR-1** Đối tượng chia sẻ (`target_type`) có 3 loại (F41 thêm loại thứ 4 là `COURSE`): `VIDEO` (video gốc), `PART` (một clip), `LESSON` (toàn bộ clip `COMPLETED` của một video, xếp theo `sections.position` rồi `topics.position`).
- **FR-2** Chế độ (`access`):
  - `PUBLIC_LINK`: ai có link đều xem được.
  - `PASSWORD`: phải nhập mật khẩu (4–64 ký tự).
  - `DISABLED`: đã thu hồi.
- **FR-3** Tuỳ chọn thêm: `expires_at` (không bắt buộc), `allow_download` (mặc định `false`), `allow_embed` (mặc định `true`), `allowed_embed_domains` (danh sách tên miền được phép nhúng, không bắt buộc).
- **FR-4** Token chia sẻ gồm 22 ký tự base64url, sinh từ 16 byte `SecureRandom` (128 bit). Không dùng ID tăng dần.
- **FR-5** Link xem: `https://<frontend>/s/{token}`. Link nhúng: `https://<frontend>/embed/{token}`.
- **FR-6** Trang xem công khai không yêu cầu đăng nhập. Trang gồm trình phát, tiêu đề, tóm tắt (nếu đã có F21), chapters (nếu đã có F22), và nút tải về nếu `allow_download` bật.
- **FR-7** Link `PASSWORD`: sau khi nhập đúng, server cấp **cookie phiên xem** (`HttpOnly`, `SameSite=None; Secure` để chạy được trong iframe), sống 12 giờ và gắn với token đó.
- **FR-8** URL video trả cho người xem là **URL R2 có chữ ký (presigned), hạn 2 giờ**, không phải `cloud_url` công khai. Với HLS (F39) thì trả playlist qua proxy: xem 6.3.
- **FR-9** Mỗi đối tượng có thể có nhiều link (ví dụ một link cho lớp A, một link cho lớp B). Hộp thoại liệt kê các link kèm số lượt xem.
- **FR-10** Link hết hạn hoặc bị thu hồi thì trang hiển thị "Liên kết đã hết hạn hoặc bị thu hồi. Vui lòng liên hệ giảng viên." và trả HTTP 410.

## 5. Yêu cầu phi chức năng

- Rate limit (F06): tối đa 10 lần nhập sai mật khẩu mỗi IP mỗi token mỗi 15 phút, quá thì trả `429`.
- Mật khẩu link lưu dạng BCrypt hash, không bao giờ trả về qua API.
- Trang `/embed/*` gửi header `Content-Security-Policy: frame-ancestors <danh sách allowed_embed_domains>`, hoặc `*` nếu danh sách rỗng. Các trang khác giữ `frame-ancestors 'self'`.
- API công khai không lộ `owner_id`, email hay `r2_key`.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_share_links.sql`:

```sql
CREATE TABLE IF NOT EXISTS share_links (
    id BIGSERIAL PRIMARY KEY,
    token VARCHAR(32) UNIQUE NOT NULL,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(10) NOT NULL,          -- VIDEO | PART | LESSON
    target_id BIGINT NOT NULL,                 -- videos.id hoặc video_parts.id
    label VARCHAR(100),                        -- "Lớp CNTT K18"
    access VARCHAR(20) NOT NULL DEFAULT 'PUBLIC_LINK', -- PUBLIC_LINK | PASSWORD | DISABLED
    password_hash VARCHAR(100),
    expires_at TIMESTAMPTZ,
    allow_download BOOLEAN NOT NULL DEFAULT FALSE,
    allow_embed BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_embed_domains TEXT[],
    view_count BIGINT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_share_target CHECK (target_type IN ('VIDEO','PART','LESSON','COURSE')), -- COURSE dùng cho F41
    CONSTRAINT chk_share_pw CHECK (access <> 'PASSWORD' OR password_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_share_target ON share_links(target_type, target_id);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/share-links` | Chủ sở hữu target | Tạo link |
| GET | `/api/v1/share-links?targetType=PART&targetId=55` | Chủ sở hữu | Liệt kê link |
| PATCH | `/api/v1/share-links/{id}` | Chủ sở hữu | Sửa chế độ, mật khẩu, hạn |
| DELETE | `/api/v1/share-links/{id}` | Chủ sở hữu | Thu hồi (đặt `access=DISABLED`, giữ bản ghi để thống kê) |
| GET | `/api/public/s/{token}` | Public | Metadata + nguồn phát |
| POST | `/api/public/s/{token}/unlock` | Public | Gửi mật khẩu, nhận cookie phiên xem |
| GET | `/api/public/s/{token}/download/{partId}` | Public, cần `allow_download` | Chuyển hướng 302 tới presigned URL có `response-content-disposition=attachment` |

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
  "allowedEmbedDomains": ["lms.truong.edu.vn"]
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

`GET /api/public/s/{token}` — trường hợp `LESSON`:

```json
{
  "title": "Bài 05 – Vòng lặp",
  "targetType": "LESSON",
  "requiresPassword": false,
  "allowDownload": true,
  "items": [
    { "partId": 55, "title": "Giới thiệu vòng lặp", "section": "Lý thuyết", "durationSec": 96.4,
      "playback": { "type": "hls", "hlsUrl": "https://api.autocut.vn/api/public/s/q3V8.../hls/55/master.m3u8", "mp4Url": "https://...presigned..." } }
  ]
}
```

Mã lỗi: `404 SHARE_NOT_FOUND`, `401 SHARE_PASSWORD_REQUIRED`, `403 SHARE_PASSWORD_INVALID`, `410 SHARE_EXPIRED`, `429 TOO_MANY_ATTEMPTS`.

### 6.3 Backend (Spring Boot)

- **Tạo** `entity/ShareLinkEntity`, `repository/ShareLinkRepository`.
- **Tạo** `service/ShareLinkService` với các hàm `create`, `revoke`, `resolve(token, sessionCookie)`. Hàm `resolve` kiểm tra lần lượt: tồn tại → `access != DISABLED` → chưa hết hạn → mật khẩu.
- **Tạo** `controller/ShareLinkController` cho `/api/v1/share-links` và `controller/PublicShareController` cho `/api/public/s/**`. Trong cấu hình Spring Security, chỉ mở `permitAll` cho `/api/public/**`.
- **Sửa** `CloudflareR2Service`: thêm `String presignGet(String key, Duration ttl, String downloadFileName)` dùng `S3Presigner` có sẵn trong AWS SDK v2 mà dự án đang dùng, không cần thư viện mới.
- **HLS (F39) và presigned URL:** playlist `.m3u8` chứa đường dẫn tương đối tới segment, nên không ký trước từng segment được. Cách làm: `PublicShareController` phục vụ `GET /api/public/s/{token}/hls/{partId}/{file}`:
  - Với `.m3u8`: đọc playlist từ R2, viết lại mỗi dòng segment thành presigned URL (TTL 2 giờ) rồi trả về.
  - Với `.m4s`: không đi qua proxy này; client tải thẳng từ presigned URL đã nằm trong playlist.
- Tăng `view_count` bằng một lệnh `UPDATE ... SET view_count = view_count + 1` (atomic). Mỗi cặp token + phiên chỉ đếm 1 lần mỗi 30 phút.

### 6.5 Frontend (Next.js)

- **Tạo** `frontend/src/components/ShareDialog.tsx`: mở từ nút "Chia sẻ" (icon `Share2` của lucide) trên từng clip ở [ExportProgressModal.tsx:302](../../../frontend/src/components/ExportProgressModal.tsx#L302) và trên thẻ video trong thư viện. Hộp thoại có:
  - Tab "Liên kết": chọn chế độ, nhập mật khẩu, chọn ngày hết hạn, công tắc "Cho phép tải về", nút "Sao chép liên kết".
  - Tab "Nhúng": chọn kích thước (640×360, 960×540, Tự co giãn), ô mã có nút "Sao chép mã nhúng".
  - Danh sách link đã tạo: nhãn, lượt xem, hạn, nút "Thu hồi" có hộp xác nhận.
- **Tạo** route `frontend/src/app/s/[token]/page.tsx` (trang xem) và `frontend/src/app/embed/[token]/page.tsx` (chỉ có trình phát, không header, nền đen).
- Trang `/s/...` có form mật khẩu khi API trả `401`, có thông báo lỗi khi `410`, và dùng `HlsVideo` (F39) hoặc `<video>`.
- Thẻ `<meta property="og:title|og:image">` để link dán vào Zalo/Facebook có ảnh xem trước. Ảnh lấy từ F43; nếu chưa có thì dùng ảnh mặc định.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* clip đã `COMPLETED`, *When* chủ sở hữu tạo link `PUBLIC_LINK`, *Then* mở `/s/{token}` trong cửa sổ ẩn danh xem được ngay, không phải đăng nhập.
- **AC-2** — *Given* link `PASSWORD`, *When* nhập sai, *Then* hiện "Mật khẩu không đúng"; *When* nhập đúng, *Then* video phát và F5 không phải nhập lại trong 12 giờ.
- **AC-3** — *Given* link có `expiresAt` ở quá khứ, *When* mở, *Then* nhận HTTP 410 và trang báo hết hạn.
- **AC-4** — *Given* link đang được xem, *When* chủ sở hữu bấm "Thu hồi", *Then* lần tải trang tiếp theo trả 410. URL presigned đã cấp trước đó tự hết hạn sau tối đa 2 giờ (giới hạn đã biết, ghi rõ trong UI).
- **AC-5** — *Given* `allow_download = false`, *When* gọi `/download/{partId}`, *Then* nhận `403`, và trang không hiện nút tải.
- **AC-6** — *Given* `allowedEmbedDomains = ["lms.truong.edu.vn"]`, *When* nhúng iframe trên `evil.com`, *Then* trình duyệt chặn (header CSP `frame-ancestors`).
- **AC-7** — *Given* người dùng B, *When* gọi `POST /api/v1/share-links` với `targetId` thuộc A, *Then* nhận `403`.
- **AC-8** — Response public không chứa các trường `owner_id`, `email`, `r2_key`, `password_hash`. Test kiểm tra bằng JSON path.
- **AC-9** — Sai mật khẩu lần thứ 11 trong vòng 15 phút thì nhận `429`.

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `ShareTokenGeneratorTest.token_is22CharsBase64Url_andUnique10k` | unit |
| `ShareLinkServiceTest.resolve_disabled_throwsGone` | unit |
| `ShareLinkServiceTest.resolve_expired_throwsGone` | unit (dùng `Clock` cố định) |
| `ShareLinkServiceTest.resolve_passwordWithoutSession_throwsPasswordRequired` | unit |
| `ShareLinkServiceTest.unlock_wrongPassword_incrementsAttempt` | unit |
| `ShareLinkControllerTest.create_notOwner_returns403` | MockMvc |
| `PublicShareControllerTest.get_doesNotLeakPrivateFields` | MockMvc |
| `PublicShareControllerTest.embed_setsFrameAncestorsHeader` | MockMvc |
| `PublicShareControllerTest.hlsPlaylist_rewritesSegmentsToPresigned` | unit, playlist mẫu đầu vào → kiểm tra mọi dòng `.m4s` có `X-Amz-Signature` |
| `CloudflareR2ServiceTest.presignGet_containsContentDispositionWhenDownload` | unit |
| E2E tay: AC-1, AC-2, AC-6 trên Chrome và Safari iOS | manual |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| `cloud_url` công khai cũ vẫn truy cập được | Thu hồi link nhưng video vẫn lộ | Chuyển bucket R2 sang private, bỏ `publicUrl` ([CloudflareR2Service.java:136](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java#L136)), mọi nơi đổi sang presigned. Cần migration dữ liệu: cột `cloud_url` không còn dùng để phát |
| Viết lại playlist tốn CPU khi nhiều người xem | Chậm | Cache playlist đã ký trong bộ nhớ 10 phút, theo khoá `token + partId` |
| Cookie `SameSite=None` bị trình duyệt chặn cookie bên thứ ba khi xem trong iframe | Link có mật khẩu không chạy trong iframe | Ghi rõ: link `PASSWORD` không hỗ trợ nhúng. Hộp thoại khoá tab "Nhúng" khi chọn chế độ mật khẩu |
| Học viên tải về rồi phát tán | Mất kiểm soát | Mặc định `allow_download=false`; F44 có thể gắn watermark tên trường |

## 10. Câu hỏi mở

- [ ] Có chuyển bucket R2 sang **private** ngay trong F40 không? Đây là việc nên làm nhưng phải sửa mọi nơi đang dùng `cloud_url`.
- [ ] Link `LESSON` có tự cập nhật khi thêm clip mới sau này không? Spec hiện tại giả định **có**, vì luôn đọc dữ liệu mới nhất.
- [ ] Có cần chế độ "Chỉ thành viên đã đăng nhập trong tổ chức" (dùng F03 SSO) không?
- [ ] Domain frontend chính thức là gì? Cần biết để sinh `url` và `embedCode`.
