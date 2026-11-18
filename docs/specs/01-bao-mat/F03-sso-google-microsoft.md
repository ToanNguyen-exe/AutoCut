# F03 — Đăng nhập Google/Microsoft (SSO)

| Mục | Giá trị |
|---|---|
| **Mã** | F03 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (chính) · SV4 (nút đăng nhập) |
| **Phụ thuộc** | F01, F02 |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | `spring-boot-starter-oauth2-client`: chuẩn OAuth2/OIDC của Spring, đã xử lý sẵn `state` và `nonce`; PKCE phải bật thêm (§6.3). `spring-security-test` (test, có hàm `oidcLogin()`) |
| **Tham khảo** | Panopto, Kaltura, Canvas (đăng nhập bằng tài khoản Google Workspace hoặc Microsoft 365 của trường) |

> **Cập nhật 18/11/2026:** Tách quy tắc tin email cho Microsoft (Entra ID thường không có `email_verified`: dùng tenant được duyệt + claim `xms_edov`); ghi rõ phải tự viết `HttpCookieOAuth2AuthorizationRequestRepository` và tự bật PKCE; khoá định danh Microsoft dùng `tid` + `oid`; tên migration theo dấu thời gian.

## 1. Bối cảnh & vấn đề
Trường học thường cấp sẵn tài khoản Google Workspace (`@truong.edu.vn`) hoặc Microsoft 365 cho giảng viên. Hiện màn hình [login/page.tsx](../../../frontend/src/app/login/page.tsx) chỉ có ô username/password giả. Sau F01, Admin phải tạo tay từng tài khoản và giảng viên phải nhớ thêm một mật khẩu.

## 2. Mục tiêu
- Có nút "Đăng nhập bằng Google" và "Đăng nhập bằng Microsoft" (OIDC: chuẩn đăng nhập dựa trên OAuth2).
- Chỉ cho phép email thuộc **danh sách tên miền được duyệt**, ví dụ `truong.edu.vn`.
- Lần đầu đăng nhập SSO thì tự tạo user vai trò mặc định `INSTRUCTOR` (cấu hình được).
- Sau khi SSO thành công, hệ thống cấp **JWT của AutoCut** như F01. Các phần khác giữ nguyên.

### Ngoài phạm vi
- SAML. Một số trường dùng SAML, để giai đoạn sau.
- Đồng bộ nhóm hoặc lớp từ Google Classroom.
- Đăng nhập Facebook hoặc Zalo.

## 3. User stories
- Là giảng viên, tôi bấm "Đăng nhập bằng Google", chọn tài khoản trường và vào thẳng Studio.
- Là Admin, tôi chỉ muốn email `@truong.edu.vn` vào được, email Gmail cá nhân bị từ chối.
- Là user đã có tài khoản email/mật khẩu, tôi muốn đăng nhập Google cùng email đó và vẫn vào **đúng tài khoản cũ**.

## 4. Yêu cầu chức năng
- **FR-1** `GET /api/v1/auth/oauth2/authorize/{provider}` với `provider ∈ {google, microsoft}` chuyển hướng sang trang đăng nhập của nhà cung cấp, dùng PKCE và tham số `state`.
- **FR-2** Callback `/api/v1/auth/oauth2/callback/{provider}` kiểm tra `id_token` (chữ ký, `aud`, `iss`, `exp`, `nonce`; Spring làm sẵn), sau đó kiểm tra **email có đáng tin không** theo từng nhà cung cấp:
  - **Google:** bắt buộc `email_verified = true`. Nếu `AUTOCUT_SSO_GOOGLE_HD` được cấu hình thì claim `hd` (tên miền Workspace) phải khớp.
  - **Microsoft (Entra ID):** token của Microsoft **thường không có** `email_verified`, nên không dùng claim này. Thay vào đó:
    1. Claim `tid` (tenant) phải nằm trong `AUTOCUT_SSO_MS_ALLOWED_TENANTS` (danh sách tenant ID của trường). Không chấp nhận tenant `common`/`consumers`, vì tài khoản Microsoft cá nhân có thể tự đặt email tuỳ ý.
    2. Email lấy từ claim `email`, nếu không có thì lấy `preferred_username`.
    3. Chỉ **tự liên kết với tài khoản cũ theo email** (FR-4) khi token có `xms_edov = true` (claim tuỳ chọn "email domain owner verified"; phải bật trong App registration → Token configuration). Không có `xms_edov` thì vẫn đăng nhập hoặc tạo user mới được, nhưng **không** gộp vào tài khoản đã có; trả lỗi `ACCOUNT_LINK_REQUIRED` để Admin liên kết tay.
- **FR-3** Tên miền email không thuộc `AUTOCUT_SSO_ALLOWED_DOMAINS` (danh sách cách nhau bằng dấu phẩy) thì chuyển về `/login?error=DOMAIN_NOT_ALLOWED`.
- **FR-4** Tìm user theo `(provider, subject)` trong bảng `user_identities`. `subject` là claim `sub` với Google, và chuỗi `"{tid}:{oid}"` với Microsoft (`oid` ổn định trong một tenant, còn `sub` của Microsoft thay đổi theo từng ứng dụng). Không có thì tìm theo email (chỉ khi email đáng tin theo FR-2):
  - Email đã tồn tại: **liên kết** danh tính SSO vào user đó.
  - Email chưa có: tạo user mới với `password_hash = NULL`, `auth_source = 'GOOGLE'` hoặc `'MICROSOFT'`, và vai trò `AUTOCUT_SSO_DEFAULT_ROLE`. Liên kết vào user cũ thì **không** đổi `auth_source` của user đó (vẫn là `LOCAL`).
- **FR-5** Thành công thì đặt cookie refresh token (như F01) rồi chuyển về `FRONTEND_URL/auth/callback`. Trang này gọi `/auth/refresh` để lấy access token. **Không** đưa access token lên URL.
- **FR-6** User chỉ có SSO (`password_hash IS NULL`) gọi `/login` bằng mật khẩu thì nhận `INVALID_CREDENTIALS`.
- **FR-7** Nhà cung cấp chưa cấu hình (thiếu client id) thì ẩn nút tương ứng. Frontend biết điều này qua `GET /api/v1/auth/providers`.
- **FR-8** User bị khoá (`is_active = false`, F01) thì SSO cũng bị từ chối với `ACCOUNT_DISABLED`.

## 5. Yêu cầu phi chức năng
- `client_secret` chỉ đặt trong `.env`.
- Callback xong trong < 2 giây (không tính thời gian chờ nhà cung cấp).
- Microsoft dùng **tenant ID riêng của trường** (`MS_TENANT`). Nếu nhiều trường dùng chung thì để `organizations` ở URL đăng nhập, nhưng vẫn lọc `tid` theo `AUTOCUT_SSO_MS_ALLOWED_TENANTS` (FR-2).

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__sso.sql`:
```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
-- Nguồn tạo tài khoản. F03 tạo cột; F42 (LTI) chỉ dùng thêm giá trị 'LTI'
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source VARCHAR(20) NOT NULL DEFAULT 'LOCAL';
ALTER TABLE users ADD CONSTRAINT chk_users_auth_source
  CHECK (auth_source IN ('LOCAL','GOOGLE','MICROSOFT','LTI'));
CREATE TABLE IF NOT EXISTS user_identities (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,      -- google | microsoft
    subject VARCHAR(255) NOT NULL,      -- Google: "sub"; Microsoft: "{tid}:{oid}"
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, subject)
);
```

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/auth/providers` | Public | `{ "google": true, "microsoft": false, "password": true }` |
| GET | `/api/v1/auth/oauth2/authorize/{provider}` | Public | 302 sang nhà cung cấp |
| GET | `/api/v1/auth/oauth2/callback/{provider}` | Public | 302 về frontend |

Mã lỗi gắn vào query khi chuyển về frontend: `DOMAIN_NOT_ALLOWED`, `TENANT_NOT_ALLOWED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_LINK_REQUIRED`, `ACCOUNT_DISABLED`, `SSO_FAILED`.

### 6.3 Backend
- Cấu hình `spring.security.oauth2.client.registration.google.*` và `...microsoft.*` trong `application.properties`, đọc giá trị từ biến môi trường `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`, `AUTOCUT_SSO_MS_ALLOWED_TENANTS`, `AUTOCUT_SSO_GOOGLE_HD`.
- `SecurityConfig`: thêm `.oauth2Login()` với `authorizationEndpoint.baseUri("/api/v1/auth/oauth2/authorize")` và `redirectionEndpoint.baseUri("/api/v1/auth/oauth2/callback/*")`. Thêm `successHandler(SsoSuccessHandler)` và `failureHandler(SsoFailureHandler)`.
- **Bật PKCE**: client bí mật (confidential client) của Spring mặc định không gửi PKCE, nên phải cấu hình `DefaultOAuth2AuthorizationRequestResolver` với `OAuth2AuthorizationRequestCustomizers.withPkce()`.
- **Tự viết** `HttpCookieOAuth2AuthorizationRequestRepository` (lớp này **không có sẵn** trong Spring; mặc định Spring lưu vào HTTP session, trái với backend stateless của F01). Lớp này cài `AuthorizationRequestRepository<OAuth2AuthorizationRequest>`: tuần tự hoá request thành JSON, ký HMAC bằng `JWT_SECRET`, lưu vào cookie `oauth2_auth_request` (`HttpOnly; Secure; SameSite=Lax; Max-Age=300`), và xoá cookie sau callback. Không dùng Java serialization.
- `SsoUserService.resolveOrCreate(provider, OidcUser)` thực hiện FR-2 (phần email đáng tin), FR-3, FR-4 và FR-8.
- `SsoSuccessHandler`: gọi `AuthService.issueRefreshCookie(user)` (tách ra từ F01) rồi chuyển hướng.

### 6.5 Frontend
- [login/page.tsx](../../../frontend/src/app/login/page.tsx): thêm hai nút có logo Google và Microsoft, href tới `${API}/api/v1/auth/oauth2/authorize/google`. Nút ẩn hoặc hiện theo `/auth/providers`.
- Tạo trang `frontend/src/app/auth/callback/page.tsx`: gọi `refresh()`, thành công thì vào `/`, lỗi thì quay `/login`.
- Hiện lỗi từ `?error=` bằng tiếng Việt, ví dụ "Email của bạn không thuộc tên miền được phép".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* `ALLOWED_DOMAINS=truong.edu.vn` *When* đăng nhập Google bằng `a@gmail.com` *Then* về `/login?error=DOMAIN_NOT_ALLOWED` và DB không có user mới.
- **AC-2** — *Given* chưa có user `gv@truong.edu.vn` *When* SSO Google thành công *Then* có 1 dòng `users` (role INSTRUCTOR, `password_hash` NULL, `auth_source='GOOGLE'`) và 1 dòng `user_identities`. User có sẵn trước migration đều có `auth_source='LOCAL'`.
- **AC-3** — *Given* user `gv@truong.edu.vn` đã tạo bằng mật khẩu *When* đăng nhập Google cùng email *Then* không có user mới, `user_identities.user_id` trỏ đúng user cũ.
- **AC-4** — *Given* chưa cấu hình `MS_CLIENT_ID` *When* mở trang login *Then* không thấy nút Microsoft.
- **AC-5** — URL callback và lịch sử trình duyệt không chứa access token.
- **AC-6** — *Given* `id_token` Google có `email_verified=false` *Then* nhận lỗi `EMAIL_NOT_VERIFIED`.
- **AC-7** — *Given* token Microsoft có `tid` không thuộc danh sách được duyệt *Then* về `/login?error=TENANT_NOT_ALLOWED`.
- **AC-8** — *Given* token Microsoft hợp lệ, không có `email_verified` và không có `xms_edov`, email trùng user cũ *Then* không tự liên kết, nhận `ACCOUNT_LINK_REQUIRED`. *Given* có `xms_edov=true` *Then* liên kết vào user cũ.
- **AC-9** — Request tới `/oauth2/authorize/google` trả 302 có tham số `code_challenge` và `code_challenge_method=S256`.

## 8. Kế hoạch kiểm thử (TDD)
- `SsoUserServiceTest`: `disallowedDomain_throws`, `newEmail_createsUserWithDefaultRole`, `existingEmail_linksIdentity`, `existingIdentity_returnsSameUser`, `googleUnverifiedEmail_throws`, `microsoftDisallowedTenant_throws`, `microsoftWithoutEdov_doesNotLinkExisting`, `microsoftWithEdov_linksExisting`, `microsoftSubjectIsTidOid`, `inactiveUser_throwsDisabled`.
- `HttpCookieOAuth2AuthorizationRequestRepositoryTest`: `saveThenLoad_roundTrips`, `tamperedCookie_returnsNull`, `removeClearsCookie`.
- `SsoFlowIT`: dùng `MockMvc` với `oidcLogin()` của `spring-security-test` để mô phỏng callback.
- Kiểm thử thủ công với Google OAuth client loại "Testing" và email trường thật.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Liên kết theo email bị lạm dụng khi nhà cung cấp không xác minh email | Chiếm tài khoản | Google: bắt buộc `email_verified=true`. Microsoft: chỉ nhận tenant được duyệt và chỉ tự liên kết khi có `xms_edov=true` (FR-2) |
| Trường chưa bật claim `xms_edov` | Giảng viên đã có tài khoản mật khẩu không tự liên kết được | Hướng dẫn Admin của trường bật claim; trong lúc chờ, Admin AutoCut liên kết tay |
| Cookie SameSite chặn khi chuyển hướng giữa các trang | Mất `state`, callback lỗi | Cookie tạm cho OAuth đặt `SameSite=Lax` |
| Sai redirect URI giữa môi trường dev và prod | Lỗi `redirect_uri_mismatch` | Ghi rõ URI cần đăng ký cho từng môi trường trong README |

## 10. Câu hỏi mở
- [ ] Danh sách tên miền trường được phép là gì? Có cho Gmail cá nhân ở môi trường demo không?
- [ ] User SSO mới mặc định là INSTRUCTOR hay VIEWER, chờ Admin nâng quyền?
- [ ] Có cho user SSO đặt thêm mật khẩu để đăng nhập dự phòng không?
