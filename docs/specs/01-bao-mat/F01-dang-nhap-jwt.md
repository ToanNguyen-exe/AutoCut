# F01 — Đăng nhập thật (JWT + BCrypt)

| Mục | Giá trị |
|---|---|
| **Mã** | F01 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend, chính) · SV4 (frontend) |
| **Phụ thuộc** | F13 (Flyway) phải xong trước |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `spring-boot-starter-security` (lọc request, BCrypt); `io.jsonwebtoken:jjwt-api/impl/jackson` 0.12.x (ký/đọc JWT). Phương án thay thế cho jjwt là `spring-boot-starter-oauth2-resource-server` (có sẵn Nimbus JOSE); team chọn một. `org.testcontainers:postgresql` (test, theo AD-7) |
| **Tham khảo** | Supabase Auth, Auth0 (access token ngắn hạn + refresh token xoay vòng) |

> **Cập nhật 18/11/2026:** Thêm cơ chế vé ngắn hạn dùng chung (`auth_tickets`, AD-4); đếm sai mật khẩu theo cửa sổ thời gian (`first_failed_at`); làm rõ SameSite khi frontend và backend khác tên miền; test chuyển sang Postgres/Testcontainers (AD-7); tên migration theo dấu thời gian.

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
  - SameSite tính theo **site** (tên miền đăng ký, ví dụ `autocut.vn`), không theo origin. Vì vậy `app.autocut.vn` gọi `api.autocut.vn` vẫn gửi được cookie `Strict` (kèm CORS `allowCredentials` theo F05).
  - Nếu frontend và backend nằm ở **hai tên miền đăng ký khác nhau** (ví dụ `*.vercel.app` và `*.onrender.com`), cookie `Strict`/`Lax` sẽ không được gửi. Cách xử lý bắt buộc trong trường hợp này: cho frontend gọi backend qua **Next.js `rewrites`** (cùng origin `/api/*`). **Không** chuyển sang `SameSite=None`.
- **FR-2** Sai email hoặc sai mật khẩu đều trả **cùng một** thông báo `INVALID_CREDENTIALS`, để không lộ email nào tồn tại.
- **FR-3** Đếm số lần sai mật khẩu theo **cửa sổ 15 phút** tính từ `first_failed_at`:
  - Sai lần đầu, hoặc lần sai trước đã quá 15 phút: đặt `first_failed_at = now()` và `failed_login_count = 1`.
  - Sai trong cửa sổ: tăng `failed_login_count`. Khi đạt 5 thì đặt `locked_until = now() + 15 phút` và trả `ACCOUNT_LOCKED`.
  - Đăng nhập đúng (khi không bị khoá): đặt lại `failed_login_count = 0` và `first_failed_at = NULL`.
  - Khi đang khoá, mọi lần thử (kể cả đúng mật khẩu) đều trả `ACCOUNT_LOCKED` và **không** cộng thêm vào bộ đếm, để kẻ tấn công không kéo dài thời gian khoá mãi.
- **FR-4** `POST /api/v1/auth/refresh` đọc cookie, cấp access token mới và **refresh token mới**, đồng thời thu hồi token cũ. Nếu một refresh token đã thu hồi bị dùng lại: thu hồi **toàn bộ** phiên của user đó (phát hiện bị đánh cắp token).
- **FR-5** `POST /api/v1/auth/logout` thu hồi refresh token hiện tại và xoá cookie.
- **FR-6** `GET /api/v1/auth/me` trả thông tin người đang đăng nhập.
- **FR-7** `POST /api/v1/auth/change-password` bắt nhập mật khẩu cũ. Mật khẩu mới ≥ 8 ký tự, có cả chữ và số. Đổi xong thì thu hồi mọi refresh token khác.
- **FR-8** Admin dùng `POST /api/v1/admin/users` để tạo user với mật khẩu tạm và cờ `must_change_password=true`. Khi cờ này bật, mọi API khác trả `PASSWORD_CHANGE_REQUIRED` cho tới khi user đổi mật khẩu.
- **FR-9** Lần chạy đầu tiên: nếu chưa có user `ADMIN` nào, tạo Admin từ biến môi trường `AUTOCUT_BOOTSTRAP_ADMIN_EMAIL` và `AUTOCUT_BOOTSTRAP_ADMIN_PASSWORD`, với `must_change_password=true`. Không có mật khẩu mặc định viết cứng trong code. F02 mở rộng runner này để gán video chưa có chủ cho Admin (vì runner chạy **sau** Flyway nên lúc đó mới chắc chắn đã có Admin).
- **FR-9b — Nhận lời mời đang chờ (phụ thuộc mềm vào F36, F41).** Mỗi khi một user có **email đã được xác minh** đăng nhập thành công lần đầu, `AuthService` gọi `InvitationService.acceptPendingFor(user)` để chuyển các lời mời đang chờ theo email (`video_invitations` của F36, `course_invitations` của F41) thành quyền thật. Ở F01, email được coi là đã xác minh khi tài khoản do Admin tạo; với F03 là khi SSO xác nhận email theo F03 FR-2. Nếu chưa có `InvitationService` (F36/F41 chưa làm) thì bỏ qua: dùng `ObjectProvider<InvitationService>` để không bắt buộc bean này. Lỗi trong hook chỉ log WARN, không làm đăng nhập thất bại.
- **FR-10 — Vé ngắn hạn (định nghĩa chung cho toàn hệ thống, theo AD-4).** Thẻ `<video>`, `EventSource` và `<a download>` không gửi được header `Authorization`, nên dùng vé:
  - `POST /api/v1/auth/tickets` (cần JWT) với body `{ "purpose": "SSE" | "STREAM" | "DOWNLOAD", "resourceId": "<id>" }`.
  - Server kiểm tra người gọi có quyền **xem** tài nguyên (qua `AccessService` của F02; trước khi có F02 thì chỉ cần đã đăng nhập). Sau đó sinh vé ngẫu nhiên 256 bit (base64url), lưu **SHA-256** của vé vào `auth_tickets`, trả vé gốc đúng một lần.
  - Thời hạn và số lần dùng:

    | purpose | Hạn | Số lần dùng | Dùng cho |
    |---|---|---|---|
    | `SSE` | 60 giây | **1 lần** (để mở kết nối; kết nối đã mở thì giữ tiếp) | F10, F36 |
    | `STREAM` | 5 phút | Nhiều lần trong hạn (trình duyệt gửi nhiều Range request) | `/stream`, F39 |
    | `DOWNLOAD` | 5 phút | Nhiều lần trong hạn | F04, F12 |

  - Endpoint nhận vé đọc từ `?ticket=`. `TicketAuthFilter` chỉ chấp nhận vé khi `purpose` và `resourceId` của vé **khớp** với endpoint đang gọi (ví dụ vé `STREAM` cho video 42 không mở được SSE của job 7). Vé hợp lệ thì đặt `AuthPrincipal` của chủ vé vào SecurityContext.
  - Vé sai, hết hạn, đã dùng (với `SSE`), hoặc user đã bị khoá (`is_active=false`) đều trả 401 `TICKET_INVALID`.
  - Không bao giờ đặt JWT vào URL hay cookie đọc được bằng JS. Không ghi `?ticket=` ra log truy cập (che bằng `***`).

## 5. Yêu cầu phi chức năng
- Khoá ký JWT (`JWT_SECRET`, ≥ 256 bit) chỉ đọc từ `.env`. Thiếu khoá thì ứng dụng **không khởi động** và báo lỗi rõ ràng.
- Thuật toán HS256. Claims gồm `sub` (userId), `role`, `iat`, `exp` và `jti`.
- `/login` trả kết quả trong p95 < 400 ms (BCrypt cost 12 tốn khoảng 250 ms).
- Không bao giờ ghi mật khẩu, token hay header `Authorization` ra log.
- Refresh token lưu trong DB dưới dạng **SHA-256 hash**, không lưu giá trị gốc.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__auth.sql`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_failed_at TIMESTAMPTZ;   -- đầu cửa sổ đếm sai (FR-3)
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

-- Vé ngắn hạn dùng chung (FR-10, AD-4)
CREATE TABLE IF NOT EXISTS auth_tickets (
    id BIGSERIAL PRIMARY KEY,
    ticket_hash CHAR(64) NOT NULL UNIQUE,         -- SHA-256 hex của vé
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('SSE','STREAM','DOWNLOAD')),
    resource_id VARCHAR(100) NOT NULL,            -- videoId / jobId / partId dạng chuỗi
    single_use BOOLEAN NOT NULL,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tickets_expires ON auth_tickets(expires_at);
```
Cột `role` giữ nguyên, giá trị chuẩn hoá ở F02.

Dùng vé `SSE` (một lần) bằng **một câu lệnh nguyên tử** để hai request cùng lúc không dùng được cùng một vé:
```sql
UPDATE auth_tickets SET used_at = NOW()
 WHERE ticket_hash = :hash AND purpose = :purpose AND resource_id = :rid
   AND expires_at > NOW() AND (single_use = FALSE OR used_at IS NULL)
RETURNING user_id;
```
Vé hết hạn được xoá bằng job dọn dẹp của F17 (`DELETE … WHERE expires_at < NOW() - INTERVAL '1 day'`).

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Public | Đăng nhập |
| POST | `/api/v1/auth/refresh` | Public (cookie) | Lấy token mới |
| POST | `/api/v1/auth/logout` | Đã đăng nhập | Đăng xuất |
| GET | `/api/v1/auth/me` | Đã đăng nhập | Thông tin bản thân |
| PATCH | `/api/v1/auth/me` | Đã đăng nhập | Sửa `fullName` |
| POST | `/api/v1/auth/change-password` | Đã đăng nhập | Đổi mật khẩu |
| POST | `/api/v1/auth/tickets` | Đã đăng nhập + quyền xem tài nguyên | Xin vé ngắn hạn (FR-10) |
| POST | `/api/v1/admin/users` | ADMIN | Tạo user (bắt buộc truyền `role`) |
| POST | `/api/v1/admin/users/{id}/unlock` | ADMIN | Mở khoá tài khoản bị khoá do sai mật khẩu |
| GET | `/` (và `/actuator/health` sau khi có F15) | Public | Healthcheck |

Xin vé:
```json
// POST /api/v1/auth/tickets
{ "purpose": "STREAM", "resourceId": "42" }
// 201
{ "ticket": "q3V8l0…", "expiresAt": "2026-11-18T09:05:00Z" }
```

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
| 401 | `TICKET_INVALID` | Liên kết đã hết hạn, vui lòng tải lại trang |
| 404 | `VIDEO_NOT_FOUND` (hoặc mã tương ứng) | Xin vé cho tài nguyên không có quyền xem (theo AD-2) |

### 6.3 Backend (Spring Boot)
Tạo mới trong `com.autocut.auth`:
- `UserEntity`, `UserRepository`, `RefreshTokenEntity`, `RefreshTokenRepository`.
- `JwtService`: `issueAccessToken(UserEntity)` và `parse(String) → AuthPrincipal(userId, role)`.
- `AuthService`: login, refresh (xoay vòng + phát hiện token bị dùng lại), logout, changePassword, đếm số lần sai và khoá tài khoản.
- `AuthController`, `AdminUserController`.
- `AuthTicketEntity`, `AuthTicketRepository`, `TicketService` (`issue(user, purpose, resourceId)`, `consume(ticket, purpose, resourceId) → AuthPrincipal`), `TicketAuthFilter` (FR-10).
- `SecurityConfig`: `SecurityFilterChain` stateless, tắt CSRF cho `/api/**` (dùng Bearer), thêm `JwtAuthFilter` và `TicketAuthFilter` trước `UsernamePasswordAuthenticationFilter`, khai báo `BCryptPasswordEncoder(12)` và danh sách đường dẫn public (`/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/share/**`, `/api/v1/hooks/**` theo AD-5).
- `BootstrapAdminRunner` (`ApplicationRunner`) cho FR-9.
- Trong `AuthService.login` (và `SsoSuccessHandler` của F03): gọi `invitationService.ifAvailable(s -> s.acceptPendingFor(user))` theo FR-9b.
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
- Thêm `getTicket(purpose, resourceId)` trong `lib/http.ts`. Trước khi gán `src` cho `<video>` hoặc mở `EventSource`, gọi hàm này rồi nối `?ticket=`. Vé `STREAM` sắp hết hạn (còn < 30 giây) thì xin vé mới và gán lại `src`, giữ nguyên `currentTime`.
- Xoá `frontend/src/mock-data/users.json` và `mock-data/users.json` ở thư mục gốc **sau khi** không còn chỗ nào import tới.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* user `gv@x.vn`/`MatKhau123` đang hoạt động *When* gọi `/login` đúng thông tin *Then* nhận 200, `accessToken` có `exp - iat = 900`, response có header `Set-Cookie` gồm `HttpOnly` và `Secure`.
- **AC-2** — *Given* sai mật khẩu *When* gọi `/login` *Then* nhận 401 `INVALID_CREDENTIALS`, nội dung lỗi giống hệt trường hợp email không tồn tại.
- **AC-3** — *Given* đã sai 5 lần trong 15 phút *When* đăng nhập lần thứ 6, kể cả đúng mật khẩu *Then* nhận 423 `ACCOUNT_LOCKED`. *Given* sai 4 lần, đợi 16 phút rồi sai thêm 1 lần *Then* chưa bị khoá (`failed_login_count = 1`).
- **AC-4** — *Given* không gửi header Authorization *When* gọi `GET /api/video/list` *Then* nhận 401.
- **AC-5** — *Given* refresh token R1 đã được dùng để lấy R2 *When* gửi lại R1 *Then* nhận 401 `REFRESH_TOKEN_REUSED`, và R2 cũng bị thu hồi.
- **AC-6** — *Given* user đăng nhập trên 2 trình duyệt *When* đổi mật khẩu ở trình duyệt A *Then* trình duyệt B refresh thất bại với 401.
- **AC-7** — Trong DB, `password_hash` bắt đầu bằng `$2a$12$` hoặc `$2b$12$`; `refresh_tokens.token_hash` dài 64 ký tự hex.
- **AC-8** — Chạy `npm run build` rồi `grep -r "admin123" frontend/.next` không có kết quả.
- **AC-9** — Khởi động backend khi thiếu `JWT_SECRET`: tiến trình dừng và log có dòng `JWT_SECRET chưa được cấu hình`.
- **AC-10** — *Given* vé `SSE` cho job 7 *When* dùng vé lần 1 *Then* mở được SSE; *When* dùng lại lần 2 *Then* 401 `TICKET_INVALID`.
- **AC-11** — *Given* vé `STREAM` cho video 42 *When* trình duyệt gửi 3 Range request trong 5 phút *Then* cả 3 đều 206; *When* dùng vé này cho video 43 hoặc cho SSE *Then* 401 `TICKET_INVALID`; *When* dùng sau 5 phút *Then* 401.
- **AC-12** — *Given* user A không có quyền xem video 99 *When* A xin vé `STREAM` cho video 99 *Then* nhận 404 (AD-2).

## 8. Kế hoạch kiểm thử (TDD)
Unit:
- `JwtServiceTest`: `issue_thenParse_returnsSameUserId`, `parse_expiredToken_throwsTokenExpired`, `parse_tamperedSignature_throws`.
- `AuthServiceTest`: `login_wrongPassword_incrementsFailedCount`, `login_fifthFailureWithinWindow_locksAccount15Minutes`, `login_failureAfterWindow_resetsCounter`, `login_whileLocked_doesNotExtendLock`, `refresh_rotatesAndRevokesOld`, `refresh_reusedToken_revokesWholeFamily`, `changePassword_revokesOtherSessions`, `changePassword_weak_throwsWeakPassword`.
- `TicketServiceTest`: `sseTicket_secondUse_rejected`, `streamTicket_multiUseWithinTtl_ok`, `ticket_wrongResource_rejected`, `ticket_expired_rejected`, `ticket_inactiveUser_rejected`.

Integration (`@SpringBootTest` + Postgres qua Testcontainers hoặc `TEST_DATABASE_URL`, theo AD-7; MockMvc):
- `AuthControllerIT`: các AC 1–6.
- `TicketAuthIT`: AC-10, AC-11, AC-12 (AC-12 bật sau khi có F02). Có thêm test hai request song song dùng cùng một vé `SSE`: chỉ một request thành công.
- `SecurityConfigIT`: `videoList_withoutToken_returns401`, `healthcheck_withoutToken_returns200`.
- Cập nhật `VideoControllerTest` và `SaveProjectTest` cho có token, dùng `@WithMockUser` hoặc helper `TestTokens.admin()`. **Không xoá test cũ** (CONSTRAINTS §1).

Frontend: test thủ công trên trình duyệt theo AC-8; kiểm tra trong DevTools → Application thấy `localStorage` không chứa token.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bật Security làm hỏng hàng loạt test cũ | CI đỏ | Làm theo từng bước: thêm helper token cho test trước, sau đó mới bật filter |
| `<video src="/stream/...">` không gửi được header Bearer | Video không phát | Vé `STREAM` theo FR-10 (AD-4). Tệp trên R2 thì dùng presigned URL (AD-3) |
| Cookie `Secure` không chạy trên `http://localhost` | Dev không refresh được | Bật `Secure` theo profile: tắt ở `dev`, bật ở `prod` |
| Frontend và backend khác **tên miền đăng ký** nên cookie `Strict` không được gửi | Refresh thất bại | Proxy qua Next `rewrites` (FR-1). Khác cổng trên localhost (3000/8080) vẫn là cùng site nên không bị ảnh hưởng |
| Bị đoán mật khẩu từ nhiều IP | Chiếm tài khoản | Đã có khoá theo tài khoản (FR-3), cộng thêm rate limit theo IP ở F06 |
| Kẻ xấu cố tình gõ sai để **khoá tài khoản người khác** (DoS) | Giảng viên không đăng nhập được 15 phút | Khoá có thời hạn ngắn, không kéo dài khi đang khoá (FR-3); rate limit theo IP (F06); Admin mở khoá tay qua `POST /api/v1/admin/users/{id}/unlock` |
| Vé lộ qua lịch sử trình duyệt hoặc log proxy | Người khác xem được video trong ≤ 5 phút | Vé ngắn hạn, gắn với một tài nguyên và một mục đích; che `?ticket=` trong log |

## 10. Câu hỏi mở
- [ ] Dùng `jjwt` hay `oauth2-resource-server` (Nimbus)?
- [ ] Access token 15 phút và refresh 14 ngày có hợp không? Có cần "Ghi nhớ đăng nhập" để chọn giữa phiên ngắn và dài không?
- [x] Dữ liệu `videos` hiện có `owner_id = NULL`: đã chốt là F02 mở rộng `BootstrapAdminRunner` để gán cho Admin (FR-9).
- [x] Video phát thế nào khi đã có JWT: đã chốt theo AD-4 (vé ngắn hạn) và AD-3 (presigned URL).
- [ ] Có cần trang "Quên mật khẩu" qua email ở MVP không? Đã đưa vào đề xuất F85 (chờ duyệt), phụ thuộc F48 (gửi email).
