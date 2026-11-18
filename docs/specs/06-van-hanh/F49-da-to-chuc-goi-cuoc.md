# F49 — Đa tổ chức & gói cước

| Mục | Giá trị |
|---|---|
| **Mã** | F49 |
| **Nhóm** | Vận hành & kinh doanh |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (dữ liệu, thanh toán) · SV4 (trang gói cước, thanh toán) · Trưởng nhóm (chốt giá, pháp lý) |
| **Phụ thuộc** | F00 (`videoId`), F01, F02 (`video_access`, `AccessService`), F08 (audit), F09 (job), F13, F15 (đo phút xử lý), F16 (hạn mức dung lượng) |
| **Ước lượng** | XL (>2 tuần) — nên chia 3 PR: (a) tổ chức + thành viên, (b) gói cước + hạn mức, (c) thanh toán |
| **Thư viện mới cần duyệt** | `com.stripe:stripe-java` (nếu dùng Stripe, để kiểm tra chữ ký webhook đúng chuẩn). VNPay không có SDK Java chính thức nên tự ký HMAC-SHA512 bằng `javax.crypto` có sẵn. |
| **Tham khảo** | Descript Teams, Opus Clip Plans, Panopto Site License, Slack Workspaces |

> **Cập nhật 18/11/2026:** IPN VNPay bắt buộc kiểm tra `vnp_ResponseCode` và `vnp_TransactionStatus` bằng `"00"` (giao dịch huỷ/lỗi không còn kích hoạt gói); phút xử lý được **giữ chỗ khi tạo job** dưới khoá dòng (hết race, AD-9); Stripe **đặt** kỳ theo `current_period_end` của subscription thay vì cộng thêm (không gia hạn 2 lần); chống trùng bằng `ON CONFLICT` (AD-8); vai trò tổ chức chỉ dùng để quản trị tổ chức và hạn mức, quyền trên video vẫn qua `video_access` (AD-1); webhook chuyển sang `/api/v1/hooks/{provider}` (AD-5); tên migration theo dấu thời gian.

## 1. Bối cảnh & vấn đề
- Bảng `users` trong [schema.sql](../../../database/schema.sql) có `role` và `storage_limit_bytes` cố định 2 GB. Bảng `videos` chỉ có `owner_id`. Chưa có khái niệm **tổ chức** (trường, khoa, trung tâm), nên không thể bán cho một trường với nhiều giảng viên dùng chung hạn mức.
- `role` hiện là chuỗi tự do. Mock user ([users.json](../../../frontend/src/mock-data/users.json)) có role kiểu "SV1 - Video Engine (FFmpeg)", không phải quyền hệ thống.
- Không giới hạn số phút xử lý. Mỗi lần analyze gọi Whisper/Gemini đều tốn tiền ([ConfigService.java:102-106](../../../backend/src/main/java/com/autocut/service/ConfigService.java#L102-L106) dùng một khoá API chung), nên một người có thể đốt hết ngân sách.

## 2. Mục tiêu
- Thêm **tổ chức (organization)**: mỗi video, dự án và hạn mức thuộc về một tổ chức. Một người dùng có thể thuộc nhiều tổ chức và chuyển qua lại.
- Thêm **gói cước** (Free, Pro, Team, Enterprise) với hạn mức: phút xử lý/tháng, dung lượng, số thành viên, tính năng bật/tắt.
- Thanh toán: **VNPay** (khách Việt Nam, thẻ ATM/QR) và **Stripe** (thẻ quốc tế, tự gia hạn).
- Xử lý webhook thanh toán an toàn: kiểm tra chữ ký, **idempotent** (nhận trùng không cộng tiền hai lần).

### Ngoài phạm vi
- Xuất hoá đơn VAT điện tử (tích hợp nhà cung cấp hoá đơn) → để phiên bản sau, tạm xuất phiếu thu PDF thủ công.
- Mã giảm giá, chương trình giới thiệu.
- Tính tiền theo mức dùng vượt hạn mức (overage) — bản này chặn cứng khi hết.

## 3. User stories
- Là **trưởng khoa**, tôi muốn tạo tổ chức "Khoa CNTT", mời 15 giảng viên, cả khoa dùng chung 3.000 phút/tháng.
- Là **giảng viên tự do**, tôi muốn dùng gói Free 60 phút/tháng, khi cần thì nâng lên Pro bằng VNPay QR.
- Là **chủ tổ chức**, tôi muốn xem đã dùng bao nhiêu phút và ai dùng nhiều nhất.
- Là **admin hệ thống**, tôi muốn tặng thêm phút hoặc đổi gói thủ công cho khách hàng trường học trả chuyển khoản.

## 4. Yêu cầu chức năng
- **FR-1 Tổ chức:** tạo, đổi tên, mời thành viên qua email (link mời hết hạn sau 7 ngày), xoá thành viên. Vai trò trong tổ chức (`organization_members.role`): `ORG_OWNER`, `ORG_ADMIN`, `ORG_MEMBER`. Theo AD-1, vai trò này **chỉ** quyết định:
  - ai được quản trị tổ chức (mời/xoá thành viên, đổi gói, thanh toán: `ORG_OWNER`, `ORG_ADMIN`; riêng thanh toán chỉ `ORG_OWNER`);
  - video mới được tính hạn mức vào tổ chức nào.

  Quyền trên **từng video** vẫn nằm ở `video_access` (F02). Là `ORG_MEMBER` không tự động xem được video của đồng nghiệp. `ORG_OWNER` và `ORG_ADMIN` có quyền ngầm như `OWNER` trên mọi video có `videos.org_id` thuộc tổ chức: F49 thêm nhánh này vào điểm mở rộng `AccessService.effectivePermissions(...)` của F02, không viết chỗ kiểm tra quyền thứ hai.
- **FR-2 Tổ chức cá nhân (AD-9):** khi đăng ký, mỗi người dùng tự có 1 tổ chức cá nhân gói Free (`is_personal = true`, người đó là `ORG_OWNER`). Migration tạo tổ chức cá nhân cho mọi user hiện có và gán toàn bộ video cũ vào tổ chức cá nhân của `owner_id`. Nhờ vậy hạn mức của F16 chuyển từ "theo user" sang "theo tổ chức" mà không phải viết lại logic: `StorageQuotaService` của F16 đổi nguồn hạn mức từ `users.storage_limit_bytes` sang `plans.storage_bytes` của tổ chức, và tính dung lượng đã dùng theo `videos.org_id` (video trong thùng rác F17 **vẫn tính** cho tới khi bị xoá hẳn).
  - Ràng buộc `UNIQUE(owner_id, sha256_hash)` của F02 giữ nguyên: hai thành viên cùng tổ chức upload cùng một tệp thì mỗi người có một bản video riêng, và dung lượng tính hai lần.
- **FR-3 Ngữ cảnh tổ chức:** frontend gửi header `X-Org-Id` để chọn tổ chức đang làm việc. Header này quyết định: (a) video mới upload thuộc tổ chức nào, (b) màn hình thư viện lọc video theo `org_id` (trong số video người dùng **có quyền xem** theo `AccessService`), (c) hạn mức nào bị trừ. Người dùng không phải thành viên tổ chức trong header thì nhận `404 ORG_NOT_FOUND` (AD-2). Thiếu header thì dùng tổ chức cá nhân.
- **FR-4 Gói cước:** bảng `plans` khai báo hạn mức. Đổi giá không cần sửa code.

  | Gói | Phút xử lý/tháng | Dung lượng | Thành viên | Ghi chú |
  |---|---|---|---|---|
  | Free | 60 | 2 GB | 1 | Có watermark (F44) |
  | Pro | 600 | 50 GB | 1 | |
  | Team | 3.000 | 500 GB | 20 | Duyệt (F35), cộng tác (F36) |
  | Enterprise | Thoả thuận | Thoả thuận | Không giới hạn | SSO (F03), API (F50) |

  *(Con số chỉ là đề xuất, cần chốt ở mục 10.)*
- **FR-5 Đo mức dùng — giữ chỗ khi tạo job (AD-9):**
  1. Khi tạo job analyze, **trong cùng một transaction**: khoá dòng `subscriptions` của tổ chức (`SELECT … FOR UPDATE`), tính `used` = tổng `quantity` của các dòng `usage_records` trong kỳ hiện tại có `status IN ('RESERVED','COMMITTED')` cộng các điều chỉnh, rồi kiểm tra `used + ceil(duration/60) ≤ limit`.
  2. Đủ hạn mức: chèn dòng `usage_records` `status='RESERVED'` với `idempotency_key = 'analyze:job:<jobId>'`, rồi tạo job. Không đủ: trả `402 QUOTA_EXCEEDED`, không tạo job.
  3. Job thành công: đổi dòng đó sang `COMMITTED`. Job thất bại **lần cuối** (hết lượt thử của F09): đổi sang `RELEASED` (trả lại phút). Job thử lại thì vẫn dùng chung một dòng giữ chỗ.
  4. Vì việc giữ chỗ xảy ra dưới khoá dòng, hai request song song không thể cùng lọt qua bước kiểm tra.
- **FR-6 Kỳ tính cước:** theo tháng dương lịch theo giờ VN (Free) hoặc theo ngày bắt đầu đăng ký (gói trả phí).
- **FR-7 Thanh toán VNPay (trả trước 1, 6 hoặc 12 tháng):**
  1. Client gọi `POST /billing/checkout` với `provider=VNPAY`. Backend tạo `payments` trạng thái `PENDING`, `vnp_TxnRef = payment.public_id`, ký `vnp_SecureHash` bằng HMAC-SHA512 trên chuỗi tham số đã sắp xếp, rồi trả URL thanh toán.
  2. Người dùng thanh toán xong, VNPay gọi **IPN** `GET /api/v1/hooks/vnpay` (đây là nguồn sự thật) và chuyển trình duyệt về `ReturnURL` (chỉ dùng để hiển thị kết quả).
  3. IPN, xử lý **theo đúng thứ tự** sau, trong một transaction có khoá dòng `payments` (`SELECT … FOR UPDATE`):
     1. Chữ ký sai → `RspCode=97`, không đổi gì.
     2. Không tìm thấy payment theo `vnp_TxnRef` → `RspCode=01`.
     3. `vnp_Amount ≠ amount_minor × 100` → `RspCode=04`, payment `FAILED`.
     4. Payment không còn `PENDING` (đã `PAID` hoặc `FAILED`) → `RspCode=02`, không xử lý lại.
     5. Ghi `payment_events` bằng `INSERT … ON CONFLICT (provider, provider_event_id) DO NOTHING` (AD-8).
     6. **Chỉ khi `vnp_ResponseCode == "00"` VÀ `vnp_TransactionStatus == "00"`:** đánh dấu `PAID`, gia hạn subscription với `current_period_end = max(current_period_end, now()) + months`.
     7. Ngược lại (người dùng huỷ, thẻ bị từ chối, hết thời gian…): đánh dấu `FAILED`, lưu mã lỗi, **không** gia hạn.
     8. Trả `{"RspCode":"00","Message":"Confirm Success"}` cho cả bước 6 và 7, vì với VNPay mã `00` ở đây nghĩa là "merchant đã ghi nhận kết quả", không có nghĩa giao dịch thành công.
- **FR-8 Thanh toán Stripe (tự gia hạn hằng tháng):** dùng Stripe Checkout Session ở chế độ `subscription`. Kiểm tra header `Stripe-Signature` bằng `Webhook.constructEvent`. Webhook nhận các event sau:
  - `checkout.session.completed`: **chỉ liên kết** `provider_subscription_id` với tổ chức, **không** gia hạn.
  - `invoice.paid` và `customer.subscription.updated`: lấy subscription từ Stripe rồi **gán** `current_period_start`/`current_period_end` bằng đúng giá trị của Stripe, không cộng thêm. Nhờ vậy event đến trùng hoặc đến lệch thứ tự vẫn ra cùng kết quả, và kỳ đầu không bị cộng hai lần. (Ở một số phiên bản API mới, Stripe chuyển `current_period_end` xuống từng subscription item; người làm cần xác minh theo phiên bản API đang dùng.)
  - `invoice.payment_failed`: chuyển `PAST_DUE` và đặt `grace_until`.
  - `customer.subscription.deleted`: chuyển `CANCELED`.
- **FR-9 Idempotency:**
  - Bảng `payment_events` có `UNIQUE(provider, provider_event_id)`. Ghi bằng `INSERT … ON CONFLICT DO NOTHING RETURNING id`; không có dòng trả về nghĩa là event đã xử lý, nên trả 200 (Stripe) hoặc `RspCode=02` (VNPay) mà không làm gì thêm. **Không** bắt lỗi unique violation rồi bỏ qua (AD-8).
  - API `POST /billing/checkout` nhận header `Idempotency-Key` (frontend sinh UUID mới cho mỗi lần bấm "Thanh toán"). Ghi `payments` bằng `INSERT … ON CONFLICT (created_by, idempotency_key) DO NOTHING`, rồi đọc lại dòng theo khoá: cùng khoá thì luôn trả cùng `paymentId` và `redirectUrl`. Nếu payment đó đã quá hạn thanh toán (URL VNPay hết hạn sau 15 phút) thì trả `409 CHECKOUT_EXPIRED` để frontend tạo khoá mới.
- **FR-10 Hết hạn / thanh toán lỗi:** cho 3 ngày ân hạn (grace period). Sau đó hạ về Free: không xoá dữ liệu, nhưng chặn analyze mới nếu vượt hạn mức Free và chặn upload nếu vượt dung lượng.
- **FR-11 Admin:** trang `/admin/orgs` để đổi gói thủ công, cộng phút (`usage_adjustments`), xem lịch sử thanh toán.

## 5. Yêu cầu phi chức năng
- **Không lưu số thẻ.** Mọi dữ liệu thẻ nằm ở VNPay/Stripe.
- Secret (`VNPAY_HASH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) chỉ để trong `.env`.
- Mọi thay đổi gói, thành viên và thanh toán đều ghi audit log (F08).
- Tiền lưu bằng số nguyên theo đơn vị nhỏ nhất (`amount_minor`: VND không có số lẻ, USD tính bằng cent) kèm `currency`. Không dùng `double`.
- Webhook phải phản hồi trong dưới 5s (VNPay/Stripe sẽ gửi lại nếu chậm).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__organizations.sql`:
```sql
CREATE TABLE organizations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(80) UNIQUE NOT NULL,
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE organization_members (
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(12) NOT NULL CHECK (role IN ('ORG_OWNER','ORG_ADMIN','ORG_MEMBER')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);
CREATE TABLE organization_invites (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(12) NOT NULL CHECK (role IN ('ORG_ADMIN','ORG_MEMBER')),
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ
);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
-- Backfill: tạo org cá nhân cho mỗi user (role ORG_OWNER), gán videos.org_id theo owner_id (viết trong cùng migration).
-- Video có owner_id NULL (nếu còn) giữ org_id NULL; BootstrapAdminRunner của F02 gán chủ rồi gán org cá nhân của chủ.
CREATE INDEX IF NOT EXISTS idx_videos_org ON videos(org_id);
```
`V<yyyyMMddHHmm>__plans_billing.sql` (dấu thời gian lớn hơn migration tổ chức):
```sql
CREATE TABLE plans (
    code VARCHAR(20) PRIMARY KEY,       -- FREE|PRO|TEAM|ENTERPRISE
    name VARCHAR(50) NOT NULL,
    minutes_per_period INT NOT NULL,
    storage_bytes BIGINT NOT NULL,
    max_members INT NOT NULL,
    features JSONB NOT NULL DEFAULT '{}',   -- {"watermark":true,"review":false,...}
    price_vnd_month BIGINT, price_usd_cents_month BIGINT,
    stripe_price_id VARCHAR(100),
    active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE subscriptions (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_code VARCHAR(20) NOT NULL REFERENCES plans(code),
    status VARCHAR(12) NOT NULL,        -- ACTIVE|PAST_DUE|CANCELED
    provider VARCHAR(10),               -- VNPAY|STRIPE|MANUAL
    provider_subscription_id VARCHAR(100),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    grace_until TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE usage_records (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id),
    video_id BIGINT REFERENCES videos(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL,          -- ANALYZE_MINUTES|ADJUSTMENT
    status VARCHAR(10) NOT NULL DEFAULT 'COMMITTED'
        CHECK (status IN ('RESERVED','COMMITTED','RELEASED')), -- ADJUSTMENT luôn COMMITTED
    quantity INT NOT NULL,              -- có thể âm với ADJUSTMENT
    idempotency_key VARCHAR(100) UNIQUE, -- vd: analyze:job:<jobId>
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_usage_org_time ON usage_records(org_id, created_at);
CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(40) UNIQUE NOT NULL,   -- dùng làm vnp_TxnRef
    org_id BIGINT NOT NULL REFERENCES organizations(id),
    provider VARCHAR(10) NOT NULL,
    plan_code VARCHAR(20) NOT NULL,
    months INT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'PENDING', -- PENDING|PAID|FAILED|EXPIRED
    failure_code VARCHAR(20),                       -- vnp_ResponseCode khi FAILED
    idempotency_key VARCHAR(100),
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    UNIQUE (created_by, idempotency_key)
);
CREATE TABLE payment_events (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(10) NOT NULL,
    provider_event_id VARCHAR(120) NOT NULL,  -- Stripe event.id / VNPay '<vnp_TxnRef>:<vnp_TransactionNo>'
    payment_id BIGINT REFERENCES payments(id),
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_event_id)
);
```

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET/POST | `/api/v1/orgs` | Đăng nhập | Danh sách / tạo tổ chức |
| POST | `/api/v1/orgs/{id}/invites` | `ORG_OWNER`/`ORG_ADMIN` | Mời thành viên |
| POST | `/api/v1/invites/{token}/accept` | Đăng nhập | Nhận lời mời |
| DELETE | `/api/v1/orgs/{id}/members/{userId}` | `ORG_OWNER`/`ORG_ADMIN` | Xoá thành viên |
| GET | `/api/v1/orgs/{id}/usage` | Thành viên | Đã dùng/hạn mức kỳ hiện tại |
| GET | `/api/v1/plans` | Không cần đăng nhập | Bảng giá |
| POST | `/api/v1/billing/checkout` | `ORG_OWNER` | Tạo phiên thanh toán |
| GET | `/api/v1/hooks/vnpay` | Không cần JWT; kiểm tra chữ ký (AD-5) | IPN VNPay |
| GET | `/api/v1/billing/vnpay/return` | Không cần đăng nhập | Trang trả về (chỉ hiển thị, không đổi dữ liệu) |
| POST | `/api/v1/hooks/stripe` | Không cần JWT; kiểm tra `Stripe-Signature` (AD-5) | Webhook Stripe |
| POST | `/api/v1/admin/orgs/{id}/plan` | ADMIN hệ thống | Đổi gói thủ công |

`POST /billing/checkout`:
```http
Idempotency-Key: 6c1f0b0e-...
X-Org-Id: 12
```
```json
{ "planCode": "PRO", "provider": "VNPAY", "months": 6 }
```
```json
{ "paymentId": "pay_01JD...", "redirectUrl": "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=...&vnp_SecureHash=..." }
```
`GET /orgs/{id}/usage`:
```json
{ "plan": "PRO", "periodEnd": "2026-12-17T00:00:00+07:00",
  "minutes": { "used": 412, "limit": 600 },
  "storage": { "usedBytes": 21474836480, "limitBytes": 53687091200 },
  "members": { "used": 1, "limit": 1 } }
```
Người không phải thành viên gọi `/orgs/{id}/…` nhận `404 ORG_NOT_FOUND`; thành viên thường gọi thao tác quản trị nhận `403 FORBIDDEN_ACTION` (AD-2).

Lỗi analyze khi hết hạn mức:
```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "Tổ chức đã dùng 590/600 phút trong kỳ. Video này cần 45 phút.",
  "details": { "used": 590, "limit": 600, "required": 45 } } }
```

### 6.3 Backend
- `entity/` + `repository/`: `Organization`, `OrganizationMember`, `OrganizationInvite`, `Plan`, `Subscription`, `UsageRecord`, `Payment`, `PaymentEvent`.
- `security/OrgContextFilter.java`: đọc `X-Org-Id`, kiểm tra quyền thành viên, đặt vào `OrgContext` (request attribute).
- **Sửa** `AccessService.effectivePermissions` (F02): thêm nhánh "`ORG_OWNER`/`ORG_ADMIN` của `videos.org_id` có quyền như `OWNER`" (FR-1).
- **Cài đặt thật** lớp dùng chung `com.autocut.quota.QuotaService` do F16 tạo (không tạo lớp thứ hai trong `service/billing`): `reserveForJob(orgId, videoId, jobId, durationSec)` (FR-5 bước 1–2, khoá dòng `subscriptions` bằng `SELECT … FOR UPDATE`, gọi trong cùng transaction tạo job), `commit(jobId)`, `release(jobId)`. Handler job của F09 gọi `commit` khi thành công và `release` khi thất bại lần cuối.
- `service/billing/VnpayService.java`: `buildPaymentUrl`, `verifySignature(Map<String,String>)`. Thuật toán: bỏ `vnp_SecureHash`/`vnp_SecureHashType`, sắp xếp key theo thứ tự chữ cái, URL-encode giá trị, nối bằng `&`, rồi tính `HMAC-SHA512(hashSecret, data)` dạng hex. **So sánh bằng `MessageDigest.isEqual`** (so sánh thời gian hằng, tránh lộ thông tin qua thời gian phản hồi).
- `service/billing/StripeService.java`: tạo Checkout Session, xử lý event.
- `service/billing/SubscriptionService.java`: `activateVnpay(paymentId)` (idempotent: payment không còn `PENDING` thì không làm gì), `syncFromStripe(stripeSubscription)` (gán kỳ, không cộng), `downgradeExpired`. Theo AD-10, `downgradeExpired` là job `SUBSCRIPTION_DOWNGRADE` do một `@Scheduled` mỗi giờ tạo trong bảng `jobs` (khoá chống trùng theo giờ).
- `controller/v1/OrgController.java`, `controller/v1/BillingController.java`, `controller/v1/hooks/PaymentHookController.java`.
- Sửa nơi tạo job analyze (F10) để gọi `QuotaService.reserveForJob` **trong cùng transaction** tạo job.
- `.env.example` bổ sung: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAY_URL`, `VNPAY_RETURN_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

### 6.5 Frontend
- `components/OrgSwitcher.tsx` đặt trong `Header`: chọn tổ chức; lưu `orgId` vào `localStorage` và gắn vào `X-Org-Id` trong `lib/api.ts`.
- `app/settings/org/page.tsx`: thành viên, lời mời, vai trò.
- `app/pricing/page.tsx`: bảng giá từ `/plans`.
- `app/settings/billing/page.tsx`: gói hiện tại, thanh dùng phút/dung lượng, lịch sử thanh toán, nút "Nâng cấp".
- `app/billing/result/page.tsx`: trang sau khi thanh toán. Trang này **hỏi lại backend** trạng thái payment, không tin tham số trên URL.
- Khi analyze bị 402 thì hiện hộp thoại "Đã hết phút xử lý tháng này" kèm nút nâng cấp.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* người dùng A thuộc org 1, không thuộc org 2. *When* gọi `/api/v1/videos` với `X-Org-Id: 2`. *Then* nhận 404 `ORG_NOT_FOUND` (AD-2).
- **AC-1b** — *Given* B là `ORG_MEMBER` của org 1 và video V của A thuộc org 1, B không có dòng `video_access` với V. *When* B mở V. *Then* nhận 404. *Given* C là `ORG_ADMIN` của org 1. *Then* C mở và sửa được V.
- **AC-2** — *Given* org Free đã dùng 50/60 phút. *When* analyze video 15 phút. *Then* nhận 402 `QUOTA_EXCEEDED`, không có job được tạo.
- **AC-3** — *Given* 2 request analyze đồng thời, mỗi video 40 phút, org còn 60 phút. *Then* chỉ 1 request tạo được job; request kia nhận 402. Bảng `usage_records` có đúng 1 dòng `RESERVED`.
- **AC-3b** — *Given* job analyze ở AC-3 thất bại sau khi hết lượt thử. *Then* dòng giữ chỗ chuyển `RELEASED` và org lại còn 60 phút. *Given* job thành công. *Then* dòng chuyển `COMMITTED`.
- **AC-4** — *Given* IPN VNPay hợp lệ cho payment PENDING với `vnp_ResponseCode=00` và `vnp_TransactionStatus=00`. *Then* payment thành `PAID`, subscription gia hạn đúng số tháng, phản hồi `RspCode=00`.
- **AC-4b** — *Given* IPN có chữ ký hợp lệ, số tiền đúng, nhưng `vnp_ResponseCode=24` (khách huỷ giao dịch). *Then* payment thành `FAILED` với `failure_code='24'`, `current_period_end` **không đổi**, gói không đổi, phản hồi `RspCode=00`.
- **AC-4c** — *Given* `vnp_ResponseCode=00` nhưng `vnp_TransactionStatus=02`. *Then* xử lý như AC-4b.
- **AC-4d** — *Given* `vnp_TxnRef` không tồn tại. *Then* phản hồi `RspCode=01`.
- **AC-5** — *Given* cùng IPN đó được gửi lại lần 2. *Then* phản hồi `RspCode=02`, `current_period_end` không đổi.
- **AC-6** — *Given* IPN có `vnp_SecureHash` sai. *Then* phản hồi `RspCode=97`, không đổi dữ liệu.
- **AC-7** — *Given* IPN có `vnp_Amount` khác `amount_minor × 100`. *Then* phản hồi `RspCode=04`, payment `FAILED`.
- **AC-8** — *Given* webhook Stripe `invoice.paid` gửi 2 lần cùng `event.id`. *Then* chỉ gia hạn 1 lần.
- **AC-8b** — *Given* kỳ đầu của subscription Stripe: nhận cả `checkout.session.completed` và `invoice.paid` (thứ tự bất kỳ). *Then* `current_period_end` bằng đúng `current_period_end` của subscription trên Stripe (1 tháng), không phải 2 tháng.
- **AC-9** — *Given* webhook Stripe sai chữ ký. *Then* trả 400.
- **AC-10** — *Given* gọi `POST /billing/checkout` 2 lần cùng `Idempotency-Key`. *Then* trả cùng `paymentId`.
- **AC-11** — *Given* subscription Pro hết hạn quá 3 ngày ân hạn. *When* job hạ cấp chạy. *Then* org về FREE, dữ liệu còn nguyên.
- **AC-12** — *Given* migration chạy trên DB có sẵn video. *Then* mọi video có `org_id` khác null, trỏ tới org cá nhân của `owner_id`.

## 8. Kế hoạch kiểm thử (TDD)
- `VnpayServiceTest.signatureMatchesOfficialSample` (dùng bộ tham số mẫu và hash trong tài liệu sandbox VNPay)
- `VnpayServiceTest.rejectsTamperedAmount`
- `PaymentHookControllerTest.vnpayIpnIsIdempotent`
- `PaymentHookControllerTest.vnpayIpnRejectsAmountMismatch`
- `PaymentHookControllerTest.vnpayCancelledTransactionDoesNotActivate` (AC-4b)
- `PaymentHookControllerTest.vnpayTransactionStatusNotSuccessDoesNotActivate` (AC-4c)
- `PaymentHookControllerTest.vnpayUnknownTxnRefReturns01` (AC-4d)
- `PaymentHookControllerTest.stripeRejectsInvalidSignature`
- `PaymentHookControllerTest.stripeDuplicateEventIgnored`
- `SubscriptionServiceTest.stripeFirstPeriodNotDoubleExtended` (AC-8b)
- `QuotaServiceTest.blocksWhenExceedingLimit`
- `QuotaServiceTest.concurrentReserveDoesNotOverspend` (2 luồng, Postgres thật theo AD-7)
- `QuotaServiceTest.releaseOnFinalFailureReturnsMinutes` (AC-3b)
- `AccessServiceTest.orgAdminActsAsOwner_orgMemberHasNoImplicitAccess` (AC-1b)
- `QuotaServiceTest.adjustmentAddsMinutes`
- `SubscriptionServiceTest.downgradesAfterGracePeriod`
- `OrgContextFilterTest.rejectsNonMember`
- `OrganizationMigrationTest.backfillsPersonalOrgForExistingVideos`
- Thử end-to-end bằng tài khoản **sandbox** VNPay và Stripe CLI (`stripe listen --forward-to ...`).

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Tin vào ReturnURL thay vì IPN | Người dùng sửa URL để được nâng gói miễn phí | Chỉ IPN/webhook mới đổi trạng thái |
| Webhook đến trước khi transaction tạo payment commit | Không tìm thấy payment | Trả lỗi để nhà cung cấp gửi lại; VNPay/Stripe đều có cơ chế gửi lại |
| Đếm phút sai khi job analyze thử lại | Tính tiền 2 lần | Một dòng giữ chỗ cho mỗi job: `usage_records.idempotency_key = analyze:job:<jobId>` |
| Job bị kẹt mãi ở `RESERVED` (máy chủ sập) | Phút bị giữ không trả lại | Reaper của F09 đưa job về hàng đợi; khi job kết thúc thì `commit`/`release` như thường |
| Thêm `org_id` làm vỡ truy vấn cũ | Lộ dữ liệu giữa tổ chức | Test F02 phải chạy lại với nhiều org; review mọi `findAll()` |
| Quy định pháp lý về thu tiền, hoá đơn | Rủi ro pháp lý | Trưởng nhóm làm việc với kế toán trước khi mở thu tiền thật |
| Stripe chưa hỗ trợ tài khoản doanh nghiệp tại Việt Nam | Không nhận được tiền | Cần pháp nhân ở nước được hỗ trợ (ví dụ Singapore); nếu không thì chỉ dùng VNPay |

## 10. Câu hỏi mở
- [ ] Giá và hạn mức từng gói là bao nhiêu? Đơn vị tính là phút video gốc hay phút clip xuất ra?
- [ ] Có pháp nhân để đăng ký merchant VNPay chưa? Có cần Stripe ở bản đầu không?
- [ ] VNPay chỉ trả trước (không tự gia hạn), vậy gửi nhắc gia hạn trước bao nhiêu ngày (dùng F48)?
- [ ] Khi hạ cấp mà dung lượng vượt hạn mức Free: chỉ chặn upload, hay sau 30 ngày xoá bớt video gốc?
- [x] Hạn mức theo user hay theo tổ chức? **Đã chốt theo AD-9:** theo tổ chức sau F49; mỗi user có tổ chức cá nhân.
- [ ] Gói Free có bắt watermark (F44) không?
