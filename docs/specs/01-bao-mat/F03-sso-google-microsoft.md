# F03 — Đăng nhập Google/Microsoft (SSO)

| Mục | Giá trị |
|---|---|
| **Mã** | F03 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (chính) · SV4 (nút đăng nhập) |
| **Phụ thuộc** | F01, F02 |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | `spring-boot-starter-oauth2-client`: chuẩn OAuth2/OIDC của Spring, đã xử lý sẵn `state`, `nonce` và PKCE |
| **Tham khảo** | Panopto, Kaltura, Canvas (đăng nhập bằng tài khoản Google Workspace hoặc Microsoft 365 của trường) |

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
- **FR-2** Callback `/api/v1/auth/oauth2/callback/{provider}` kiểm tra `id_token` (chữ ký, `aud`, `iss`, `exp`, `nonce`) và yêu cầu `email_verified = true`.
- **FR-3** Tên miền email không thuộc `AUTOCUT_SSO_ALLOWED_DOMAINS` (danh sách cách nhau bằng dấu phẩy) thì chuyển về `/login?error=DOMAIN_NOT_ALLOWED`.
- **FR-4** Tìm user theo `(provider, subject)` trong bảng `user_identities`. Không có thì tìm theo email:
  - Email đã tồn tại: **liên kết** danh tính SSO vào user đó.
  - Email chưa có: tạo user mới với `password_hash = NULL` và vai trò `AUTOCUT_SSO_DEFAULT_ROLE`.
- **FR-5** Thành công thì đặt cookie refresh token (như F01) rồi chuyển về `FRONTEND_URL/auth/callback`. Trang này gọi `/auth/refresh` để lấy access token. **Không** đưa access token lên URL.
- **FR-6** User chỉ có SSO (`password_hash IS NULL`) gọi `/login` bằng mật khẩu thì nhận `INVALID_CREDENTIALS`.
- **FR-7** Nhà cung cấp chưa cấu hình (thiếu client id) thì ẩn nút tương ứng. Frontend biết điều này qua `GET /api/v1/auth/providers`.

## 5. Yêu cầu phi chức năng
- `client_secret` chỉ đặt trong `.env`.
- Callback xong trong < 2 giây (không tính thời gian chờ nhà cung cấp).
- Microsoft dùng tenant `organizations` hoặc tenant ID riêng của trường (cấu hình được).

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V4__sso.sql`:
```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS user_identities (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,      -- google | microsoft
    subject VARCHAR(255) NOT NULL,      -- claim "sub"
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

Mã lỗi gắn vào query khi chuyển về frontend: `DOMAIN_NOT_ALLOWED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`, `SSO_FAILED`.

### 6.3 Backend
- Cấu hình `spring.security.oauth2.client.registration.google.*` và `...microsoft.*` trong `application.properties`, đọc giá trị từ biến môi trường `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`.
- `SecurityConfig`: thêm `.oauth2Login()` với `authorizationEndpoint.baseUri("/api/v1/auth/oauth2/authorize")` và `redirectionEndpoint.baseUri("/api/v1/auth/oauth2/callback/*")`. Thêm `successHandler(SsoSuccessHandler)` và `failureHandler(SsoFailureHandler)`.
- Lưu trạng thái OAuth2 tạm thời trong cookie (`HttpCookieOAuth2AuthorizationRequestRepository`) để giữ backend stateless.
- `SsoUserService.resolveOrCreate(provider, OidcUser)` thực hiện FR-3 và FR-4.
- `SsoSuccessHandler`: gọi `AuthService.issueRefreshCookie(user)` (tách ra từ F01) rồi chuyển hướng.

### 6.5 Frontend
- [login/page.tsx](../../../frontend/src/app/login/page.tsx): thêm hai nút có logo Google và Microsoft, href tới `${API}/api/v1/auth/oauth2/authorize/google`. Nút ẩn hoặc hiện theo `/auth/providers`.
- Tạo trang `frontend/src/app/auth/callback/page.tsx`: gọi `refresh()`, thành công thì vào `/`, lỗi thì quay `/login`.
- Hiện lỗi từ `?error=` bằng tiếng Việt, ví dụ "Email của bạn không thuộc tên miền được phép".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* `ALLOWED_DOMAINS=truong.edu.vn` *When* đăng nhập Google bằng `a@gmail.com` *Then* về `/login?error=DOMAIN_NOT_ALLOWED` và DB không có user mới.
- **AC-2** — *Given* chưa có user `gv@truong.edu.vn` *When* SSO thành công *Then* có 1 dòng `users` (role INSTRUCTOR, `password_hash` NULL) và 1 dòng `user_identities`.
- **AC-3** — *Given* user `gv@truong.edu.vn` đã tạo bằng mật khẩu *When* đăng nhập Google cùng email *Then* không có user mới, `user_identities.user_id` trỏ đúng user cũ.
- **AC-4** — *Given* chưa cấu hình `MS_CLIENT_ID` *When* mở trang login *Then* không thấy nút Microsoft.
- **AC-5** — URL callback và lịch sử trình duyệt không chứa access token.
- **AC-6** — *Given* `id_token` có `email_verified=false` *Then* nhận lỗi `EMAIL_NOT_VERIFIED`.

## 8. Kế hoạch kiểm thử (TDD)
- `SsoUserServiceTest`: `disallowedDomain_throws`, `newEmail_createsUserWithDefaultRole`, `existingEmail_linksIdentity`, `existingIdentity_returnsSameUser`, `unverifiedEmail_throws`.
- `SsoFlowIT`: dùng `MockMvc` với `oidcLogin()` của `spring-security-test` để mô phỏng callback.
- Kiểm thử thủ công với Google OAuth client loại "Testing" và email trường thật.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Liên kết theo email bị lạm dụng khi nhà cung cấp không xác minh email | Chiếm tài khoản | Bắt buộc `email_verified=true`; Microsoft chỉ nhận tenant của trường |
| Cookie SameSite chặn khi chuyển hướng giữa các trang | Mất `state`, callback lỗi | Cookie tạm cho OAuth đặt `SameSite=Lax` |
| Sai redirect URI giữa môi trường dev và prod | Lỗi `redirect_uri_mismatch` | Ghi rõ URI cần đăng ký cho từng môi trường trong README |

## 10. Câu hỏi mở
- [ ] Danh sách tên miền trường được phép là gì? Có cho Gmail cá nhân ở môi trường demo không?
- [ ] User SSO mới mặc định là INSTRUCTOR hay VIEWER, chờ Admin nâng quyền?
- [ ] Có cho user SSO đặt thêm mật khẩu để đăng nhập dự phòng không?
