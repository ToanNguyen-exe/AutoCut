# F01 — Đăng nhập thật (JWT + BCrypt)

| Mục | Giá trị |
|---|---|
| **Mã** | F01 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend, chính) · SV4 (frontend) |
| **Phụ thuộc** | F13 (Flyway) nên xong trước; nếu chưa có thì viết migration SQL tay và chuyển sang Flyway sau |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `spring-boot-starter-security` (lọc request, BCrypt); `io.jsonwebtoken:jjwt-api/impl/jackson` 0.12.x (ký/đọc JWT). Phương án thay thế cho jjwt là `spring-boot-starter-oauth2-resource-server` (có sẵn Nimbus JOSE); team chọn một |
| **Tham khảo** | Supabase Auth, Auth0 (access token ngắn hạn + refresh token xoay vòng) |

## 1. Bối cảnh & vấn đề

Hiện hệ thống **không có xác thực thật**:

- [frontend/src/lib/auth.ts:10-25](../../../frontend/src/lib/auth.ts#L10-L25): `getCurrentUser()` thấy `localStorage` trống thì **tự gán tài khoản Admin đầu tiên**. Ai mở trang cũng thành Admin.
- [frontend/src/lib/auth.ts:27-41](../../../frontend/src/lib/auth.ts#L27-L41): `loginUser()` so mật khẩu ngay trên trình duyệt với [frontend/src/mock-data/users.json](../../../frontend/src/mock-data/users.json). Tệp này chứa mật khẩu dạng chữ thường (`admin123`, `video123`…) và được đóng gói vào JS gửi cho mọi người truy cập.
- [frontend/src/app/login/page.tsx:136-143](../../../frontend/src/app/login/page.tsx#L136-L143) hiển thị luôn `username / password` của mọi tài khoản trên màn hình đăng nhập.
- [frontend/src/lib/auth.ts:49-66](../../../frontend/src/lib/auth.ts#L49-L66): đổi mật khẩu chỉ ghi vào `localStorage`, không lưu ở máy chủ.
- Backend không có Spring Security ([backend/pom.xml](../../../backend/pom.xml)). Bảng `users` đã có cột `password_hash` ([database/schema.sql:8-18](../../../database/schema.sql#L8-L18)) nhưng chưa có `UserEntity` hay API nào dùng tới.

## 2. Mục tiêu

- Xác thực ở **máy chủ**, lưu mật khẩu bằng **BCrypt** (cost 12).
- Dùng **access token JWT ngắn hạn** (15 phút) và **refresh token** dài hạn (14 ngày), xoay vòng mỗi lần dùng và thu hồi được.
- Toàn bộ `/api/**` yêu cầu JWT, trừ các endpoint public ở §6.2.
- Frontend bỏ hoàn toàn `users.json` và đăng nhập giả.

### Ngoài phạm vi
- Phân quyền chi tiết theo vai trò và theo chủ sở hữu (xem F02).
- SSO Google/Microsoft (xem F03).
- Xác thực 2 lớp (2FA).
- Tự đăng ký tài khoản công khai: ở MVP, Admin tạo tài khoản cho thành viên.

## 3. User stories
- Là giảng viên, tôi muốn đăng nhập bằng email và mật khẩu để chỉ tôi thấy video của mình.
- Là người dùng, tôi muốn vẫn đăng nhập sau khi đóng trình duyệt (trong 14 ngày) để khỏi gõ lại.
- Là người dùng, tôi muốn đổi mật khẩu; sau khi đổi, mọi phiên trên thiết bị khác bị đăng xuất.
- Là Admin, tôi muốn tạo tài khoản và đặt mật khẩu tạm cho thành viên.

## 4. Yêu cầu chức năng
- **FR-1** `POST /api/v1/auth/login` nhận `email` và `password`. Nếu đúng: trả access token trong body và đặt refresh token vào cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- **FR-2** Sai email hoặc sai mật khẩu đều trả **cùng một** thông báo `INVALID_CREDENTIALS`, để không lộ email nào tồn tại.
- **FR-3** Sai mật khẩu 5 lần liên tiếp trong 15 phút: khoá đăng nhập tài khoản đó 15 phút (`ACCOUNT_LOCKED`).
- **FR-4** `POST /api/v1/auth/refresh` đọc cookie, cấp access token mới và **refresh token mới**, đồng thời thu hồi token cũ. Nếu một refresh token đã thu hồi bị dùng lại: thu hồi **toàn bộ** phiên của user đó (phát hiện bị đánh cắp token).
- **FR-5** `POST /api/v1/auth/logout` thu hồi refresh token hiện tại và xoá cookie.
- **FR-6** `GET /api/v1/auth/me` trả thông tin người đang đăng nhập.
- **FR-7** `POST /api/v1/auth/change-password` bắt nhập mật khẩu cũ. Mật khẩu mới ≥ 8 ký tự, có cả chữ và số. Đổi xong thì thu hồi mọi refresh token khác.
- **FR-8** Admin dùng `POST /api/v1/admin/users` để tạo user với mật khẩu tạm và cờ `must_change_password=true`. Khi cờ này bật, mọi API khác trả `PASSWORD_CHANGE_REQUIRED` cho tới khi user đổi mật khẩu.
- **FR-9** Lần chạy đầu tiên: nếu bảng `users` trống, tạo Admin từ biến môi trường `AUTOCUT_BOOTSTRAP_ADMIN_EMAIL` và `AUTOCUT_BOOTSTRAP_ADMIN_PASSWORD`. Không có mật khẩu mặc định viết cứng trong code.

## 5. Yêu cầu phi chức năng
- Khoá ký JWT (`JWT_SECRET`, ≥ 256 bit) chỉ đọc từ `.env`. Thiếu khoá thì ứng dụng **không khởi động** và báo lỗi rõ ràng.
- Thuật toán HS256. Claims gồm `sub` (userId), `role`, `iat`, `exp` và `jti`.
- `/login` trả kết quả trong p95 < 400 ms (BCrypt cost 12 tốn khoảng 250 ms).
- Không bao giờ ghi mật khẩu, token hay header `Authorization` ra log.
- Refresh token lưu trong DB dưới dạng **SHA-256 hash**, không lưu giá trị gốc.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V2__auth.sql`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    family_id UUID NOT NULL,              -- chuỗi xoay vòng cùng 1 phiên đăng nhập
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent VARCHAR(255),
    ip VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
```
Cột `role` giữ nguyên, giá trị chuẩn hoá ở F02.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Public | Đăng nhập |
| POST | `/api/v1/auth/refresh` | Public (cookie) | Lấy token mới |
| POST | `/api/v1/auth/logout` | Đã đăng nhập | Đăng xuất |
| GET | `/api/v1/auth/me` | Đã đăng nhập | Thông tin bản thân |
| PATCH | `/api/v1/auth/me` | Đã đăng nhập | Sửa `fullName` |
| POST | `/api/v1/auth/change-password` | Đã đăng nhập | Đổi mật khẩu |
| POST | `/api/v1/admin/users` | ADMIN | Tạo user |
| GET | `/` , `/actuator/health` | Public | Healthcheck |

Login thành công:
```json
// POST /api/v1/auth/login
{ "email": "gv@truong.edu.vn", "password": "MatKhau123" }
// 200
{ "accessToken": "eyJhbGciOi...", "expiresIn": 900,
  "user": { "id": 1, "email": "gv@truong.edu.vn", "fullName": "Nguyễn Văn A", "role": "ADMIN", "mustChangePassword": false } }
```
Các lỗi:
| HTTP | code | message |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | Email hoặc mật khẩu không đúng |
| 423 | `ACCOUNT_LOCKED` | Tài khoản tạm khoá, thử lại sau 15 phút |
| 401 | `TOKEN_EXPIRED` | Phiên đăng nhập đã hết hạn |
| 401 | `REFRESH_TOKEN_REUSED` | Phát hiện phiên bất thường, vui lòng đăng nhập lại |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Bạn cần đổi mật khẩu trước khi tiếp tục |
| 400 | `WEAK_PASSWORD` | Mật khẩu cần ít nhất 8 ký tự, gồm chữ và số |

### 6.3 Backend (Spring Boot)
Tạo mới trong `com.autocut.auth`:
- `UserEntity`, `UserRepository`, `RefreshTokenEntity`, `RefreshTokenRepository`.
- `JwtService`: `issueAccessToken(UserEntity)` và `parse(String) → AuthPrincipal(userId, role)`.
- `AuthService`: login, refresh (xoay vòng + phát hiện token bị dùng lại), logout, changePassword, đếm số lần sai và khoá tài khoản.
- `AuthController`, `AdminUserController`.
- `SecurityConfig`: `SecurityFilterChain` stateless, tắt CSRF cho `/api/**` (dùng Bearer), thêm `JwtAuthFilter` trước `UsernamePasswordAuthenticationFilter`, khai báo `BCryptPasswordEncoder(12)` và danh sách đường dẫn public.
- `BootstrapAdminRunner` (`ApplicationRunner`) cho FR-9.
- `GlobalExceptionHandler` (`@RestControllerAdvice`) trả lỗi theo định dạng chung trong README.

Sửa:
- `ConfigService`: thêm `getJwtSecret()`; thiếu khoá thì ném `IllegalStateException`.
- `.env.example`: thêm `JWT_SECRET=`, `AUTOCUT_BOOTSTRAP_ADMIN_EMAIL=`, `AUTOCUT_BOOTSTRAP_ADMIN_PASSWORD=`.
- Các endpoint cũ `/api/video/**` cũng phải đi qua JWT filter. Chưa đổi tên đường dẫn (giữ tương thích cho frontend).

### 6.4 AI pipeline (Python)
Không đổi. Python được Spring gọi qua `ProcessBuilder` nên không lộ ra ngoài.

### 6.5 Frontend (Next.js)
- Viết lại [frontend/src/lib/auth.ts](../../../frontend/src/lib/auth.ts): bỏ import `users.json`; giữ access token **trong bộ nhớ** (biến module), không ghi `localStorage`; thêm các hàm `login`, `logout`, `refresh`, `me`, `changePassword` gọi API.
- Tạo `frontend/src/lib/http.ts`: hàm `apiFetch()` gắn `Authorization: Bearer`, gặp 401 `TOKEN_EXPIRED` thì gọi `/refresh` **đúng một lần** rồi gửi lại request (có khoá để nhiều request cùng lúc không refresh song song). [frontend/src/lib/api.ts](../../../frontend/src/lib/api.ts) chuyển sang dùng `apiFetch` và `credentials: "include"`.
- [login/page.tsx](../../../frontend/src/app/login/page.tsx): đổi ô username thành email; **xoá khối tài khoản demo** (dòng 130–145); hiện lỗi tiếng Việt theo `code`.
- Thêm `frontend/src/middleware.ts` hoặc chặn ở client trong `page.tsx`: chưa đăng nhập thì chuyển về `/login`. Khi `mustChangePassword` bật thì mở `AccountModal` ở tab `password` và không cho đóng.
- [AccountModal.tsx](../../../frontend/src/components/AccountModal.tsx): tab mật khẩu gọi API thật.
- Xoá `frontend/src/mock-data/users.json` và `mock-data/users.json` ở thư mục gốc **sau khi** không còn chỗ nào import tới.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* user `gv@x.vn`/`MatKhau123` đang hoạt động *When* gọi `/login` đúng thông tin *Then* nhận 200, `accessToken` có `exp - iat = 900`, response có header `Set-Cookie` gồm `HttpOnly` và `Secure`.
- **AC-2** — *Given* sai mật khẩu *When* gọi `/login` *Then* nhận 401 `INVALID_CREDENTIALS`, nội dung lỗi giống hệt trường hợp email không tồn tại.
- **AC-3** — *Given* đã sai 5 lần trong 15 phút *When* đăng nhập lần thứ 6, kể cả đúng mật khẩu *Then* nhận 423 `ACCOUNT_LOCKED`.
- **AC-4** — *Given* không gửi header Authorization *When* gọi `GET /api/video/list` *Then* nhận 401.
- **AC-5** — *Given* refresh token R1 đã được dùng để lấy R2 *When* gửi lại R1 *Then* nhận 401 `REFRESH_TOKEN_REUSED`, và R2 cũng bị thu hồi.
- **AC-6** — *Given* user đăng nhập trên 2 trình duyệt *When* đổi mật khẩu ở trình duyệt A *Then* trình duyệt B refresh thất bại với 401.
- **AC-7** — Trong DB, `password_hash` bắt đầu bằng `$2a$12$` hoặc `$2b$12$`; `refresh_tokens.token_hash` dài 64 ký tự hex.
- **AC-8** — Chạy `npm run build` rồi `grep -r "admin123" frontend/.next` không có kết quả.
- **AC-9** — Khởi động backend khi thiếu `JWT_SECRET`: tiến trình dừng và log có dòng `JWT_SECRET chưa được cấu hình`.

## 8. Kế hoạch kiểm thử (TDD)
Unit:
- `JwtServiceTest`: `issue_thenParse_returnsSameUserId`, `parse_expiredToken_throwsTokenExpired`, `parse_tamperedSignature_throws`.
- `AuthServiceTest`: `login_wrongPassword_incrementsFailedCount`, `login_fifthFailure_locksAccount15Minutes`, `refresh_rotatesAndRevokesOld`, `refresh_reusedToken_revokesWholeFamily`, `changePassword_revokesOtherSessions`, `changePassword_weak_throwsWeakPassword`.

Integration (`@SpringBootTest` + H2 hoặc Testcontainers Postgres, MockMvc):
- `AuthControllerIT`: các AC 1–6.
- `SecurityConfigIT`: `videoList_withoutToken_returns401`, `healthcheck_withoutToken_returns200`.
- Cập nhật `VideoControllerTest` và `SaveProjectTest` cho có token, dùng `@WithMockUser` hoặc helper `TestTokens.admin()`. **Không xoá test cũ** (CONSTRAINTS §1).

Frontend: test thủ công trên trình duyệt theo AC-8; kiểm tra trong DevTools → Application thấy `localStorage` không chứa token.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bật Security làm hỏng hàng loạt test cũ | CI đỏ | Làm theo từng bước: thêm helper token cho test trước, sau đó mới bật filter |
| `<video src="/stream/...">` không gửi được header Bearer | Video không phát | Tạm cho `/stream/**` dùng tham số `?t=<token ngắn hạn 5 phút>`; về lâu dài dùng link ký sẵn (presigned URL) R2 theo F04/F39 |
| Cookie `Secure` không chạy trên `http://localhost` | Dev không refresh được | Bật `Secure` theo profile: tắt ở `dev`, bật ở `prod` |
| Frontend (3000) và backend (8080) khác origin nên cookie không gửi kèm | Refresh thất bại | Cấu hình CORS theo F05 với `allowCredentials` và origin cụ thể, hoặc proxy qua Next `rewrites` |
| Bị đoán mật khẩu từ nhiều IP | Chiếm tài khoản | Đã có khoá theo tài khoản (FR-3), cộng thêm rate limit theo IP ở F06 |

## 10. Câu hỏi mở
- [ ] Dùng `jjwt` hay `oauth2-resource-server` (Nimbus)?
- [ ] Access token 15 phút và refresh 14 ngày có hợp không? Có cần "Ghi nhớ đăng nhập" để chọn giữa phiên ngắn và dài không?
- [ ] Dữ liệu `videos` hiện có `owner_id = NULL`: gán cho Admin bootstrap hay để F02 xử lý?
- [ ] Có cần trang "Quên mật khẩu" qua email ở MVP không? Nếu có thì phụ thuộc F48 (gửi email).
