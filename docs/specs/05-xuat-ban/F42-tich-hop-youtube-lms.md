# F42 — Đẩy lên YouTube / Google Drive / LMS (LTI 1.3)

| Mục | Giá trị |
|---|---|
| **Mã** | F42 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (OAuth, upload, LTI) · SV4 (giao diện kết nối, chọn đích) |
| **Phụ thuộc** | F00 (`partId` ổn định), F35 (`render_kind`: chỉ đẩy clip `RELEASE`), F01, F02, F03 (`password_hash` nullable), F07 (lưu bí mật đã mã hoá), F09 (job nền), F22 (chapters cho mô tả YouTube), F23 (phụ đề), F43 (ảnh bìa); F40 và F41 cho phần LTI |
| **Ước lượng** | XL (> 2 tuần). Nên chia 3 PR: **42a YouTube**, **42b Drive**, **42c LTI 1.3** |
| **Thư viện mới cần duyệt** | **42a/42b:** không có thư viện backend mới. Gọi REST trực tiếp bằng `RestClient` của Spring; OAuth tự làm theo chuẩn (đổi code lấy token). Có thể dùng `spring-boot-starter-oauth2-client` nếu F03 đã thêm. **42b (frontend):** script **Google Picker** (`https://apis.google.com/js/api.js`) tải từ ngoài, nên cần duyệt theo AD-11. **42c:** `com.nimbusds:nimbus-jose-jwt` để kiểm tra `id_token` RS256 theo JWKS của LMS và ký JWT của tool. Nếu F01 đã dùng thư viện JWT khác thì chọn một, không dùng hai. |
| **Tham khảo** | Descript/Riverside "Publish to YouTube", Panopto & Kaltura LTI cho Moodle/Canvas, Loom Google Drive export |

> **Cập nhật 18/11/2026:** Theo review:
> - `videos.update` chỉ dùng khi đã cấp scope `youtube.force-ssl`.
> - User LTI được phép không có email; chỉ ánh xạ theo `(platform, sub)` và **không tự gộp tài khoản theo email**.
> - `QuotaGuard` dùng `INSERT … ON CONFLICT`.
> - Deep Linking trả lại claim `data`.
> - Giờ reset quota tính theo giờ Thái Bình Dương (14:00 hoặc 15:00 giờ Việt Nam tuỳ mùa).
> - Google Picker được đưa vào mục thư viện cần duyệt.
> - Endpoint LTI chuyển sang `/api/v1/lti/**`; phiên LTI dùng token trong header thay cho cookie; lỗi quyền theo AD-2.

## 1. Bối cảnh & vấn đề

- Sau khi cắt xong, `BatchVideoCutService.executeJob` ([BatchVideoCutService.java:166-279](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L166-L279)) đã có sẵn những thứ cần để đăng YouTube:
  - clip MP4 `libx264 + aac + faststart`, đạt chuẩn YouTube khuyến nghị ([VideoCutter.java:346-351](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L346-L351));
  - `chapters.txt` dạng `00:00 - Phần 1: ...` ([BatchVideoCutService.java:294](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L294)). YouTube tự nhận chapters khi mô tả có danh sách mốc giờ bắt đầu bằng `00:00`.
- Dù vậy, giảng viên vẫn phải tải clip về máy rồi tự upload từng clip lên YouTube, Drive hoặc Moodle. Một bài 15 clip mất khoảng 30 phút làm tay.
- Trường học dùng Moodle hoặc Canvas muốn **nhúng bài giảng vào LMS** (hệ thống quản lý học tập) mà học viên không phải đăng nhập thêm lần nữa. Chuẩn công nghiệp cho việc này là **LTI 1.3** (1EdTech).

## 2. Mục tiêu

- **42a YouTube:** kết nối tài khoản YouTube, đẩy một hoặc nhiều clip lên kèm tiêu đề, mô tả, chapters, phụ đề, ảnh bìa, playlist, chế độ riêng tư.
- **42b Google Drive:** đẩy clip, phụ đề và `chapters.txt` vào một thư mục Drive do người dùng chọn.
- **42c LTI 1.3:** AutoCut trở thành **LTI Tool**. Giảng viên chèn clip hoặc khoá học (F41) vào khoá Moodle/Canvas qua **Deep Linking**; học viên bấm vào thì xem ngay, tự đăng nhập bằng danh tính từ LMS.

### Ngoài phạm vi
- Facebook, TikTok (cân nhắc ở F45 với khung dọc 9:16).
- Gửi điểm về LMS (LTI Assignment and Grade Services). Chỉ làm khi đã có F29 quiz.
- LTI 1.1 (đã lỗi thời, không an toàn).

## 3. User stories

- Là **giảng viên**, tôi muốn bấm "Đăng lên YouTube", chọn 15 clip, chọn playlist "Java cơ bản", chế độ "Không công khai", rồi đi pha cà phê.
- Là **giảng viên**, tôi muốn phụ đề tiếng Việt (F23) tự gắn vào video YouTube.
- Là **quản trị LMS của trường**, tôi muốn đăng ký AutoCut làm External Tool một lần cho cả trường.
- Là **giảng viên trong Moodle**, tôi muốn bấm "Thêm hoạt động → AutoCut", chọn clip, rồi clip hiện ngay trong khoá học.
- Là **học viên trong Moodle**, tôi muốn xem clip ngay trong Moodle mà không phải tạo tài khoản AutoCut.

## 4. Yêu cầu chức năng

### 42a — YouTube
- **FR-1** Kết nối qua OAuth 2.0 Authorization Code (máy chủ web), scope tối thiểu:
  - `https://www.googleapis.com/auth/youtube.upload` (upload video);
  - `https://www.googleapis.com/auth/youtube.force-ssl`: chỉ xin khi người dùng bật "Gắn phụ đề", "Thêm vào playlist" hoặc "Cập nhật thông tin video đã đăng". `captions.insert`, `playlistItems.insert` và `videos.update` đều cần scope này; `youtube.upload` **không** đủ để gọi `videos.update`.

  Dùng `access_type=offline` và `prompt=consent` để lấy `refresh_token`, và `include_granted_scopes=true` để xin thêm scope sau (incremental authorization). Lưu danh sách scope đã cấp vào `oauth_connections.scopes`.
- **FR-2** `refresh_token` được mã hoá bằng cơ chế của F07 trước khi lưu DB. Không bao giờ trả `refresh_token` về frontend.
- **FR-3** Upload bằng giao thức **resumable upload** (`uploadType=resumable`), mỗi khúc 8 MB (bội số của 256 KB). Khi lỗi mạng hoặc 5xx thì hỏi vị trí đã nhận (`PUT` với header `Content-Range: bytes */<total>`) rồi upload tiếp. Thử lại theo exponential backoff, tối đa 5 lần.
- **FR-4** Dữ liệu gửi kèm:
  - `snippet.title`: tiêu đề clip, ≤ 100 ký tự, bỏ ký tự `<` `>`.
  - `snippet.description`: tóm tắt (F21) + chapters (F22, dòng đầu bắt buộc là `00:00`), ≤ 5.000 byte.
  - `snippet.categoryId = 27` (Education), `snippet.defaultLanguage = vi`.
  - `status.privacyStatus`: `private` / `unlisted` / `public`; `status.selfDeclaredMadeForKids = false`.
- **FR-5** Sau khi upload video: lần lượt gọi `thumbnails.set` (F43), `captions.insert` (tệp SRT từ F23), `playlistItems.insert`. Mỗi bước lỗi thì ghi lỗi riêng cho bước đó, không coi cả job là thất bại.
- **FR-6** Lưu `external_id` (YouTube videoId) để lần sau không upload trùng. Khi người dùng bấm "Đẩy lại" một clip đã có trên YouTube:
  - Nếu `oauth_connections.scopes` có `youtube.force-ssl`, gọi `videos.update` để cập nhật tiêu đề và mô tả.
  - Nếu không, hỏi người dùng cấp thêm quyền (incremental). Từ chối thì báo "Cần cấp thêm quyền để cập nhật video đã đăng" và **không** upload bản mới.

  Chỉ đẩy được clip `status='COMPLETED'` **và `render_kind='RELEASE'`** (F35).
  - Clip `STALE` (F00): báo "Clip cần render lại trước khi đẩy".
  - Clip `DRAFT`: trả `409 PART_NOT_RELEASED`, báo "Clip nháp chưa được duyệt để phát hành".

  Deep Linking (FR-10) cũng chỉ liệt kê clip `RELEASE`.

### 42b — Google Drive
- **FR-7** Scope `https://www.googleapis.com/auth/drive.file`: ứng dụng chỉ thấy tệp do chính nó tạo, không cần Google thẩm định scope nhạy cảm. Người dùng chọn thư mục đích bằng Google Picker. Nếu không chọn thì tạo thư mục `AutoCut/<tên bài học>`.
- **FR-8** Upload resumable giống FR-3 (endpoint `upload/drive/v3/files?uploadType=resumable`). Tệp trùng tên trong thư mục thì đổi thành `tên (2).mp4`.

### 42c — LTI 1.3
- **FR-9** AutoCut cung cấp các endpoint chuẩn cho Tool (tiền tố `/api/v1/lti/**`, tự xác thực bằng JWT của LTI, không dùng JWT của AutoCut):
  - **OIDC login initiation** `GET|POST /api/v1/lti/login`: nhận `iss`, `login_hint`, `target_link_uri`, `lti_message_hint`, `client_id`. Chuyển hướng tới `auth_login_url` của Platform kèm `state` và `nonce` ngẫu nhiên (mỗi cái 32 byte).
    - `state` và `nonce` lưu **bản băm** trong bảng `lti_nonces`, sống 10 phút, chỉ dùng một lần.
    - `state` còn được đặt vào cookie `lti_state` (`SameSite=None; Secure; HttpOnly`, 10 phút) để gắn với trình duyệt. Nếu trình duyệt chặn cookie bên thứ ba (Safari) mà Platform có gửi `lti_storage_target`, dùng **LTI Client-Side postMessage Storage** để lưu và đọc `state`. Không có cả hai thì trả trang "Mở trong cửa sổ mới" (LTI cho phép `target=window`).
  - **Launch** `POST /api/v1/lti/launch`: nhận `id_token` (JWT) và `state`.
    - Kiểm tra chữ ký RS256 bằng JWKS của Platform.
    - Kiểm tra `iss`, `aud == client_id` (nếu có `azp` thì phải bằng `client_id`), `exp`/`iat` (lệch tối đa 60 giây), `nonce` (dùng một lần), `state` khớp, `https://purl.imsglobal.org/spec/lti/claim/deployment_id` nằm trong `deployment_ids`, `version == "1.3.0"`, `message_type ∈ {LtiResourceLinkRequest, LtiDeepLinkingRequest}`.
  - **JWKS của Tool** `GET /api/v1/lti/.well-known/jwks.json`: khoá công khai RSA 2048 để Platform kiểm tra JWT trả lời Deep Linking.
- **FR-10** **Deep Linking 2.0:** khi `message_type = LtiDeepLinkingRequest`, mở trang chọn nội dung (clip, bài, khoá học F41). Sau khi chọn, AutoCut tạo JWT `LtiDeepLinkingResponse`, ký bằng khoá riêng (header có `kid`), rồi tự POST form (`JWT=<token>`) về `deep_link_return_url`. JWT gồm:
  - `iss = client_id`, `aud = issuer của Platform`, `iat`, `exp` (+5 phút), `nonce` mới;
  - claim `deployment_id`, `message_type = "LtiDeepLinkingResponse"`, `version = "1.3.0"`;
  - `content_items` kiểu `ltiResourceLink` (`url = /api/v1/lti/launch`, `custom.autocut_target = "PART:55"`);
  - **bắt buộc trả lại nguyên giá trị** claim `https://purl.imsglobal.org/spec/lti-dl/claim/data`, nếu request Deep Linking có claim này.
- **FR-11** **Resource Link Launch:**
  - Đọc `custom.autocut_target` rồi ánh xạ người dùng LMS **chỉ theo `(platform_id, sub)`** trong `lti_user_links`.
  - Chưa có liên kết thì tạo user mới: role `VIEWER`, `auth_source='LTI'`, `email = NULL`, `password_hash = NULL`. Claim `email` (nếu có) chỉ lưu vào `lti_user_links.lti_email` để hiển thị.
  - **Không tự gộp** với tài khoản AutoCut có cùng email, vì LMS khác có thể đặt email tuỳ ý. Muốn gộp thì người dùng tự bấm "Liên kết tài khoản AutoCut" và đăng nhập bằng mật khẩu/SSO của tài khoản đó (luồng tách riêng, có xác nhận).
  - Sau khi launch, cấp `ltiViewerToken`: ngẫu nhiên, sống 2 giờ, DB lưu bản băm, gắn với user và target. Token được đưa vào trang trình phát qua fragment URL (`#t=…`), client giữ trong `sessionStorage` và gửi qua header `X-Lti-Viewer`. Không dùng cookie phiên (AD-4).
  - Trình phát hiển thị giống `/embed` (F40), nguồn lấy qua proxy có chữ ký của F39. Nếu target là khoá học thì ghi tiến độ vào F41.
- **FR-12** Vai trò LMS: claim `roles` chứa `.../membership#Instructor` thì được Deep Linking; `#Learner` chỉ được xem.
- **FR-13** Trang quản trị "Kết nối LMS" (chỉ Admin) để đăng ký Platform gồm `issuer`, `client_id`, `deployment_id`, `auth_login_url`, `auth_token_url`, `jwks_url`. Trang này hiển thị sẵn 4 URL của AutoCut để quản trị viên copy sang Moodle: Tool URL, Login URL, Redirect URL, JWKS URL.

## 5. Yêu cầu phi chức năng

- **Hạn mức YouTube Data API v3:** mặc định 10.000 đơn vị/ngày cho mỗi project Google Cloud. Chi phí tham khảo: `videos.insert` ≈ 1.600, `captions.insert` 400, `thumbnails.set` 50, `playlistItems.insert` 50. **Phải đối chiếu lại bảng giá quota hiện hành** trước khi chốt thiết kế. Tính ra chỉ được khoảng **5 clip/ngày cho cả hệ thống**. Vì vậy:
  - Đếm quota đã dùng theo ngày theo múi giờ `America/Los_Angeles`, vì YouTube reset quota lúc nửa đêm giờ Thái Bình Dương. Theo giờ Việt Nam, đó là **15:00** khi Mỹ dùng giờ chuẩn (PST, khoảng tháng 11–3) và **14:00** khi dùng giờ mùa hè (PDT, khoảng tháng 3–11). Giờ hiển thị cho người dùng phải tính bằng `ZonedDateTime`, không viết cứng.
  - Trước khi upload, kiểm tra còn đủ quota không. Thiếu thì job chuyển `WAITING_QUOTA`, đặt `run_after` (F09) bằng thời điểm reset kế tiếp, và báo người dùng.
  - Nộp đơn tăng quota (YouTube API Services Audit) trước khi chạy thật.
- **Project chưa qua audit:** video upload từ API project chưa được YouTube thẩm định sẽ **bị khoá ở chế độ riêng tư**. UI phải ghi rõ điều này cho tới khi audit xong.
- **Màn hình xin quyền OAuth (consent screen):** scope YouTube bị xếp loại *sensitive*, nên phải qua Google verification thì mới hết cảnh báo "App chưa được xác minh" và mới vượt giới hạn 100 người dùng thử.
- Token truy cập (sống khoảng 1 giờ) chỉ giữ trong bộ nhớ của job; mỗi lần cần thì làm mới bằng `refresh_token`.
- **LTI:** khoá riêng RSA của Tool lưu ở biến môi trường hoặc kho bí mật (F07), không lưu DB dạng rõ. Có hỗ trợ xoay khoá: JWKS trả cả khoá cũ và khoá mới, phân biệt bằng `kid`.
- Trang launch LTI chạy trong iframe của LMS. Chỉ cookie `lti_state` (10 phút) cần `SameSite=None; Secure`. Phiên xem sau launch dùng token trong header (FR-11), nên không phụ thuộc cookie bên thứ ba.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_integrations.sql`:

```sql
-- User LTI có thể không có email (F03 đã cho password_hash nullable)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;   -- UNIQUE vẫn giữ; Postgres cho nhiều NULL
-- Cột users.auth_source do F03 tạo (CHECK LOCAL|GOOGLE|MICROSOFT|LTI). F42 chỉ dùng giá trị 'LTI', không tự thêm cột.
ALTER TABLE users ADD CONSTRAINT chk_users_email_required
  CHECK (auth_source = 'LTI' OR email IS NOT NULL);

CREATE TABLE IF NOT EXISTS oauth_connections (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,              -- YOUTUBE | GDRIVE
    external_account VARCHAR(255),              -- tên kênh / email Google
    refresh_token_enc TEXT NOT NULL,            -- mã hoá AES-GCM theo F07
    scopes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT uq_conn UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS publish_targets (
    id BIGSERIAL PRIMARY KEY,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,
    external_id VARCHAR(100),                   -- youtube videoId / drive fileId
    external_url VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED | UPLOADING | PROCESSING | DONE | FAILED | WAITING_QUOTA
    step_errors JSONB,                          -- {"captions":"403 forbidden"}
    resumable_session_url TEXT,
    bytes_sent BIGINT DEFAULT 0,
    options JSONB NOT NULL,                     -- privacy, playlistId, folderId...
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pub UNIQUE (video_part_id, provider)
);

CREATE TABLE IF NOT EXISTS api_quota_usage (
    provider VARCHAR(20) NOT NULL,
    usage_date DATE NOT NULL,                   -- theo America/Los_Angeles
    units_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, usage_date)
);

CREATE TABLE IF NOT EXISTS lti_platforms (
    id BIGSERIAL PRIMARY KEY,
    issuer VARCHAR(255) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    deployment_ids TEXT[] NOT NULL,
    auth_login_url VARCHAR(500) NOT NULL,
    auth_token_url VARCHAR(500) NOT NULL,
    jwks_url VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lti UNIQUE (issuer, client_id)
);

CREATE TABLE IF NOT EXISTS lti_nonces (
    value_hash CHAR(64) PRIMARY KEY,            -- SHA-256 của state hoặc nonce
    kind VARCHAR(5) NOT NULL,                   -- STATE | NONCE
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lti_user_links (
    platform_id BIGINT NOT NULL REFERENCES lti_platforms(id) ON DELETE CASCADE,
    lti_sub VARCHAR(255) NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lti_email VARCHAR(255),                     -- chỉ để hiển thị, KHÔNG dùng để gộp tài khoản
    PRIMARY KEY (platform_id, lti_sub)
);

CREATE TABLE IF NOT EXISTS lti_viewer_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target VARCHAR(40) NOT NULL,                -- "PART:55" | "COURSE:3"
    expires_at TIMESTAMPTZ NOT NULL
);
```

Đánh dấu nonce đã dùng bằng một câu atomic:
`UPDATE lti_nonces SET used_at = NOW() WHERE value_hash = :h AND kind = 'NONCE' AND used_at IS NULL AND expires_at > NOW()`.
Câu lệnh cập nhật 0 dòng nghĩa là nonce đã dùng hoặc đã hết hạn, trả `401`.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/integrations/{provider}/connect` | Giảng viên | Chuyển hướng 302 tới trang đồng ý của Google |
| GET | `/api/v1/integrations/oauth/callback` | Public (kiểm `state`) | Đổi `code` lấy token, lưu kết nối |
| DELETE | `/api/v1/integrations/{provider}` | Chủ kết nối | Huỷ kết nối và gọi `https://oauth2.googleapis.com/revoke` |
| POST | `/api/v1/publish` | Quyền `EDIT` trên video chứa clip | Tạo job đẩy |
| GET | `/api/v1/publish?videoId=12` | Quyền xem video | Trạng thái từng clip |
| GET/POST | `/api/v1/lti/login` | Public | OIDC initiation |
| POST | `/api/v1/lti/launch` | Public (kiểm `id_token` + `state`) | Launch / Deep Linking |
| POST | `/api/v1/lti/deep-link/submit` | `ltiViewerToken` có role Instructor | Trả `content_items` |
| GET | `/api/v1/lti/.well-known/jwks.json` | Public | JWKS của Tool |
| CRUD | `/api/v1/admin/lti-platforms` | `ADMIN` | Đăng ký Moodle/Canvas |

Lỗi quyền theo AD-2:
- Clip (hoặc video chứa clip) mà người gọi không có quyền xem: `404 PART_NOT_FOUND`.
- Xem được nhưng không có quyền `EDIT`: `403 FORBIDDEN_ACTION`.
- Learner gửi Deep Linking: `403 FORBIDDEN_ACTION`.

`POST /api/v1/publish`:

```json
{
  "provider": "YOUTUBE",
  "partIds": [55, 56, 57],
  "options": {
    "privacy": "unlisted",
    "playlistId": "PLx9...",
    "attachCaptions": true,
    "attachThumbnail": true,
    "descriptionTemplate": "{summary}\n\n{chapters}\n\nBài giảng: {lessonTitle}"
  }
}
```

Response `202`: `{ "jobId": "pub_8f2c", "estimatedQuotaUnits": 6300, "quotaRemainingToday": 10000 }`.
Không đủ quota: vẫn trả `202`, kèm `"retryAt": "2026-11-19T08:00:00Z"` và `"warning": "Vượt hạn mức YouTube hôm nay, 2 clip sẽ được đẩy sau 15:00 ngày 19/11 (giờ Việt Nam)."`. Giờ trong câu cảnh báo được tính từ `retryAt` (14:00 hoặc 15:00 tuỳ mùa, xem §5).

### 6.3 Backend (Spring Boot)

- `integration/GoogleOAuthClient`: tạo URL đồng ý, đổi code lấy token, làm mới token, thu hồi token. Bên trong dùng `RestClient`.
- `integration/YouTubeUploader`: `startResumableSession`, `uploadChunks`, `queryOffset`, `setThumbnail`, `insertCaption`, `addToPlaylist`. Lưu `resumable_session_url` và `bytes_sent` sau mỗi khúc để upload tiếp được khi máy chủ khởi động lại (kết hợp F09).
- `integration/DriveUploader`.
- `integration/QuotaGuard`: `tryReserve(provider, units)` bằng **một câu atomic**, kể cả khi ngày đó chưa có dòng nào (AD-8):
  ```sql
  INSERT INTO api_quota_usage (provider, usage_date, units_used)
  SELECT :p, :d, :u WHERE :u <= :limit
  ON CONFLICT (provider, usage_date) DO UPDATE
    SET units_used = api_quota_usage.units_used + EXCLUDED.units_used
    WHERE api_quota_usage.units_used + EXCLUDED.units_used <= :limit
  RETURNING units_used;
  ```
  Không có dòng trả về nghĩa là vượt hạn mức, trả `false`. Bước nào gọi YouTube lỗi trước khi tốn quota thì `release(provider, units)` để trả lại.
- `service/PublishService`: handler của job `PUBLISH` trong F09 (AD-10), mỗi clip là một bước.
- Nguồn tệp: đọc clip từ R2 bằng `CloudflareR2Service.openStream(key)` (F39) và đẩy thẳng từng khúc 8 MB sang Google. Không đọc tệp theo đường dẫn tuỳ ý (F04).
- `lti/LtiLoginController`, `lti/LtiLaunchController`, `lti/LtiTokenValidator` (Nimbus `DefaultJWTProcessor` + `RemoteJWKSet`, cache JWKS 1 giờ), `lti/DeepLinkingResponseBuilder` (trả lại claim `data`).
- Dọn `lti_nonces` và `lti_viewer_sessions` hết hạn bằng job dọn dẹp của F17.

### 6.5 Frontend (Next.js)

- `components/PublishDialog.tsx` có 3 tab: YouTube / Google Drive / LMS. Tab LMS chỉ để hướng dẫn copy URL, vì trong LTI luồng bắt đầu từ phía LMS.
- Bảng trạng thái từng clip: Đang chờ / Đang tải lên 45% / Đang xử lý trên YouTube / Xong (link) / Lỗi (nút "Thử lại").
- `app/settings/integrations/page.tsx`: nút "Kết nối YouTube" hiện tên kênh đã kết nối; nút "Ngắt kết nối".
- `app/lti/deep-link/page.tsx`: trang chọn clip trong iframe LMS, giao diện gọn.
- `app/admin/lti/page.tsx`: form đăng ký Platform và 4 URL kèm nút copy.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* đã kết nối YouTube, *When* đẩy 3 clip `unlisted`, *Then* trên YouTube Studio có 3 video với tiêu đề đúng; mô tả có chapters bắt đầu `00:00`; phụ đề tiếng Việt; ảnh bìa đúng.
- **AC-2** — *Given* đang upload clip 300 MB, *When* tắt mạng máy chủ 30 giây rồi bật lại, *Then* upload chạy tiếp từ `bytes_sent`, không bắt đầu lại từ 0 (đối chiếu log `Content-Range`).
- **AC-3** — *Given* `api_quota_usage.units_used = 9.000`, *When* đẩy 1 clip (≈ 1.600 đơn vị), *Then* job chuyển `WAITING_QUOTA`, UI báo giờ thử lại, và không có request nào gửi tới YouTube.
- **AC-4** — *Given* `captions.insert` trả `403`, *When* job kết thúc, *Then* `status = DONE`, `step_errors.captions` có nội dung lỗi, và UI hiện cảnh báo vàng.
- **AC-5** — `refresh_token_enc` trong DB không chứa chuỗi bắt đầu bằng `1//` (đã được mã hoá). Không API nào trả trường này về.
- **AC-6** — *Given* Moodle 4.x đã đăng ký AutoCut làm LTI 1.3 tool, *When* giảng viên chọn "Thêm hoạt động → AutoCut", chọn clip, *Then* Moodle tạo hoạt động; học viên bấm vào thì xem được clip trong iframe.
- **AC-7** — *Given* `id_token` có `nonce` đã dùng, *When* POST `/api/v1/lti/launch` lại lần nữa, *Then* nhận `401` (chặn replay attack).
- **AC-8** — *Given* `id_token` ký bằng khoá không có trong JWKS của Platform, *Then* nhận `401`.
- **AC-9** — *Given* claim `roles` chỉ có `Learner`, *When* gửi `LtiDeepLinkingRequest`, *Then* nhận `403 FORBIDDEN_ACTION`.
- **AC-10** — *Given* request Deep Linking có claim `…/lti-dl/claim/data = "abc123"`, *When* giảng viên chọn clip, *Then* JWT trả về có đúng claim `data = "abc123"`.
- **AC-11** — *Given* đã có user AutoCut `gv@truong.edu.vn`, *When* một launch LTI có claim `email = gv@truong.edu.vn` và `sub` mới, *Then* hệ thống tạo user **mới** (`auth_source='LTI'`), **không** gắn vào tài khoản có sẵn.
- **AC-12** — *Given* `api_quota_usage` chưa có dòng nào cho hôm nay, *When* hai job cùng gọi `tryReserve(1600)` song song với limit 2000, *Then* đúng một job thành công và `units_used = 1600`.
- **AC-13** — *Given* kết nối chỉ có scope `youtube.upload`, *When* bấm "Đẩy lại" clip đã đăng, *Then* giao diện xin thêm quyền và không có request `videos.update` nào được gửi.

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `YouTubeMetadataBuilderTest.description_startsChaptersAt0000_andTrimsTo5000Bytes` | unit |
| `YouTubeMetadataBuilderTest.title_stripsAngleBrackets_andTrimsTo100` | unit |
| `YouTubeUploaderTest.resume_queriesOffsetThenSendsRemaining` | unit (mock HTTP bằng `MockRestServiceServer`) |
| `YouTubeUploaderTest.retry_5xx_backoff_max5` | unit |
| `QuotaGuardTest.tryReserve_overLimit_returnsFalse_andNoUpdate` | integration Postgres (AD-7) |
| `QuotaGuardTest.tryReserve_noRowYet_concurrent_onlyOneWins` | integration Postgres (AC-12) |
| `QuotaGuardTest.usageDate_usesPacificTime` | unit (Clock cố định 23:30 giờ Việt Nam) |
| `QuotaGuardTest.nextReset_is15hVnInWinter_14hVnInSummer` | unit (hai mốc ngày 18/11 và 18/07) |
| `YouTubePublisherTest.republish_withoutForceSslScope_doesNotCallVideosUpdate` | unit (AC-13) |
| `LtiUserMapperTest.sameEmailDifferentSub_createsNewUser` | integration (AC-11) |
| `DeepLinkingResponseBuilderTest.echoesDataClaim` | unit (AC-10) |
| `GoogleOAuthClientTest.callback_invalidState_rejected` | MockMvc |
| `LtiTokenValidatorTest.validToken_ok` / `wrongAud_rejected` / `expired_rejected` / `reusedNonce_rejected` / `unknownKid_rejected` | unit (tự sinh cặp khoá RSA trong test) |
| `DeepLinkingResponseBuilderTest.contentItems_signedWithToolKey_verifiableWithJwks` | unit |
| E2E: Moodle chạy Docker (`moodlehq/moodle-php-apache`) + AutoCut local, làm theo AC-6 | manual, ghi checklist vào PR |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Quota 10.000/ngày quá thấp | Không đẩy được hàng loạt | Bước 1: mỗi người dùng tự tạo Google Cloud project và nhập client ID/secret của họ (tuỳ chọn nâng cao). Bước 2: nộp audit để tăng quota |
| Video bị khoá riêng tư vì project chưa audit | Giảng viên tưởng là lỗi | Ghi chú rõ trong UI; nộp audit sớm |
| `refresh_token` bị thu hồi (người dùng đổi mật khẩu Google) | Job lỗi `invalid_grant` | Đánh dấu kết nối là `revoked`, gửi thông báo (F48) yêu cầu kết nối lại |
| Clip trên R2 lớn, phải tải về rồi mới upload lên Google | Tốn băng thông và ổ đĩa | Đọc stream từ R2 và đẩy thẳng từng khúc 8 MB sang Google, không lưu nguyên tệp |
| Mỗi LMS cài LTI hơi khác nhau | Launch lỗi | Test với Moodle trước; Canvas để sau. Log đầy đủ claims (đã che email) khi launch lỗi |
| Khoá riêng LTI bị lộ | Kẻ xấu giả mạo Deep Linking | Lưu theo F07; có quy trình xoay khoá bằng `kid` |

## 10. Câu hỏi mở

- [ ] Dùng **một Google Cloud project chung** của AutoCut (phải qua verification và audit) hay cho mỗi trường tự cấu hình project? Ảnh hưởng lớn tới quota.
- [ ] Trường mục tiêu dùng LMS nào: Moodle, Canvas hay Google Classroom? Google Classroom **không** dùng LTI mà có API riêng.
- [x] ~~Học viên đi vào từ LTI có cần tài khoản AutoCut đầy đủ không?~~ Đã chốt: tạo user `VIEWER` với `auth_source='LTI'`, không cần email (FR-11).
- [ ] Có cần đồng bộ ngược (sửa tiêu đề trong AutoCut thì tự cập nhật lên YouTube) không? Spec hiện chỉ cập nhật khi người dùng bấm "Đẩy lại".
