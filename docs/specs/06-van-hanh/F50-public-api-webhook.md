# F50 — Public API & webhook

| Mục | Giá trị |
|---|---|
| **Mã** | F50 |
| **Nhóm** | Vận hành & kinh doanh |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (API, webhook) · SV4 (trang quản lý khoá + tài liệu API) |
| **Phụ thuộc** | F00 (`videoId`/`topicId` ổn định), F01, F02 (`AccessService`), F06 (rate limit), F07 (`SecretCipher`), F09 (job), F10 (analyze bất đồng bộ), F11 (upload thẳng R2), F13, F48 (email báo endpoint bị tắt), F49 (tổ chức, hạn mức) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | (1) `springdoc-openapi-starter-webmvc-ui` để tự sinh tài liệu OpenAPI. **Cần xác minh phiên bản** hỗ trợ Spring Boot 4.x (`pom.xml` đang dùng 4.1.2) trước khi cài. (2) `org.apache.httpcomponents.client5:httpclient5` để **ghim IP đã kiểm tra** khi kết nối (custom `DnsResolver`, chống DNS rebinding, FR-17). `java.net.http.HttpClient` của JDK 17 không cho thay bộ phân giải DNS. Ký HMAC dùng `javax.crypto` có sẵn. |
| **Tham khảo** | Mux Video API & webhooks, Stripe API keys & webhook signatures, AssemblyAI webhooks, GitHub webhooks |

> **Cập nhật 18/11/2026:** đổi tiền tố Public API sang `/api/ext/v1/**` và tài liệu sang `/api/ext/v1/docs` (AD-5, hết trùng với link chia sẻ của F40); chống SSRF bằng cách ghim IP đã kiểm tra khi kết nối và mở rộng danh sách dải IP bị chặn; bảng `idempotency_records` có trạng thái `IN_PROGRESS` để trả 409; quyền quản lý dùng vai trò tổ chức của F49, tài nguyên ngoài tổ chức trả 404 (AD-2); tên migration theo dấu thời gian.

## 1. Bối cảnh & vấn đề
- Hiện mọi thao tác phải đi qua giao diện web. API trong [VideoController.java](../../../backend/src/main/java/com/autocut/controller/VideoController.java) là API nội bộ: nhận `Map<String,Object>` tự do (ví dụ `/analyze` dòng 713, `/save` dòng 1145, `/render` dòng 1414), không có phiên bản, không ổn định, nên không thể đưa cho bên ngoài dùng.
- Trường học thường đã có hệ thống ghi hình lớp học hoặc LMS. Họ muốn **tự động gửi video vào** AutoCut và **nhận kết quả về** mà không cần người bấm tay.
- Trạng thái job chỉ hỏi được qua `/cut/status?jobId=` ([VideoController.java:1587](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1587)). Chưa có cơ chế đẩy kết quả (push) ra ngoài.

## 2. Mục tiêu
- Public API `/api/ext/v1` ổn định, có tài liệu OpenAPI, xác thực bằng **API key** theo tổ chức (AD-5).
- Tối thiểu cho phép: tạo video từ URL hoặc upload, chạy analyze, đọc segments/transcript, xuất clip, lấy link tải.
- **Webhook**: gửi sự kiện tới URL của khách, ký HMAC-SHA256, có thử lại lùi dần, xem lại lịch sử và gửi lại thủ công.

### Ngoài phạm vi
- OAuth2 cho ứng dụng bên thứ ba thay mặt người dùng (để bản sau).
- SDK chính thức cho Python/JS (chỉ có tài liệu + ví dụ `curl`).
- GraphQL.

## 3. User stories
- Là **kỹ sư IT của trường**, tôi muốn gọi API đưa URL video lớp học vào AutoCut sau mỗi buổi và nhận webhook khi đã cắt xong, để tự đẩy clip lên LMS.
- Là **chủ tổ chức**, tôi muốn tạo, đặt tên và thu hồi API key; mỗi key chỉ có quyền tối thiểu cần dùng.
- Là **kỹ sư tích hợp**, tôi muốn kiểm tra webhook đúng là từ AutoCut và không bị phát lại (replay).

## 4. Yêu cầu chức năng

### API key
- **FR-1** Định dạng `ak_live_<24 ký tự base62>` (môi trường thật) hoặc `ak_test_...`. Chỉ hiện **một lần** khi tạo. DB chỉ lưu `prefix` (8 ký tự đầu, để nhận diện) và `SHA-256(key)`.
- **FR-2** Gửi key qua header `Authorization: Bearer ak_live_...`. **Không** nhận key qua query string.
- **FR-3** Phạm vi quyền (scopes): `videos:read`, `videos:write`, `exports:write`, `webhooks:manage`.
- **FR-4** Key thuộc **tổ chức** (F49), không thuộc cá nhân. Mức dùng tính vào hạn mức tổ chức. Key có `expires_at` tuỳ chọn, cập nhật `last_used_at` (tối đa 1 lần/phút để đỡ ghi DB).
- **FR-5** Thu hồi key có hiệu lực ngay (cache tối đa 30s).
- **FR-6** Rate limit theo key (dùng F06): mặc định 60 req/phút, 10 analyze/giờ. Trả header `X-RateLimit-Limit`, `X-RateLimit-Remaining` và `Retry-After` khi bị 429.

### Endpoint
- **FR-7** Mọi request tạo tài nguyên (`POST`) nhận `Idempotency-Key`. Gửi lại cùng key trong 24 giờ thì trả lại đúng phản hồi cũ, không tạo trùng. Quy trình (AD-8):
  1. `INSERT INTO idempotency_records (…, status='IN_PROGRESS') ON CONFLICT DO NOTHING`. Chèn được thì xử lý request, xong ghi `status='COMPLETED'` kèm phản hồi.
  2. Không chèn được, dòng cũ `IN_PROGRESS` → `409 IDEMPOTENCY_IN_PROGRESS`. Nếu dòng `IN_PROGRESS` đã quá 5 phút (máy chủ sập giữa chừng) thì cho request mới chiếm lại.
  3. Dòng cũ `COMPLETED` cùng `request_hash` → trả lại đúng phản hồi cũ. Khác `request_hash` → `422 IDEMPOTENCY_KEY_REUSED`.
  4. Request lỗi 5xx thì xoá dòng `IN_PROGRESS` để khách thử lại được với cùng khoá.
- **FR-8** Danh sách có phân trang kiểu cursor (`?limit=20&cursor=...`).
- **FR-9** Lỗi theo định dạng chung trong README, kèm `requestId`. Video, export… không thuộc tổ chức của key thì trả `404` như không tồn tại (AD-2), không trả 403.

### Webhook
- **FR-10** Tổ chức đăng ký tối đa 5 endpoint, mỗi endpoint chọn loại sự kiện: `video.uploaded`, `video.analyzed`, `video.analyze_failed`, `export.completed`, `export.failed`.
- **FR-11** Mỗi endpoint có `signing_secret` riêng (`whsec_...`), hiện một lần khi tạo, có thể đổi (rotate). Sau khi đổi, secret cũ còn hiệu lực thêm 24 giờ và webhook được ký bằng **cả hai** secret.
- **FR-12 Chữ ký:** header gửi kèm:
  ```
  AutoCut-Webhook-Id: evt_01JD7...
  AutoCut-Webhook-Timestamp: 1763366400
  AutoCut-Signature: v1=<hex HMAC-SHA256(secret, "{id}.{timestamp}.{rawBody}")>
  ```
  Bên nhận phải kiểm tra chữ ký và **bỏ qua nếu timestamp lệch quá 5 phút** (chống phát lại). Tài liệu có ví dụ code kiểm tra bằng Node.js và Python.
- **FR-13 Gửi:** `POST` JSON, timeout 10s. Mã 2xx là thành công. Mã khác, timeout hoặc lỗi mạng thì thử lại theo lịch **1 phút, 5 phút, 30 phút, 2 giờ, 6 giờ, 12 giờ, 24 giờ** (8 lần tính cả lần đầu), mỗi lần cộng thêm độ trễ ngẫu nhiên ±10% (jitter).
- **FR-14** Endpoint thất bại liên tục 3 ngày thì tự **vô hiệu hoá**, gửi email cho chủ tổ chức (dùng F48).
- **FR-15** Cùng một sự kiện luôn giữ nguyên `AutoCut-Webhook-Id` qua mọi lần thử lại, để bên nhận tự lọc trùng. Không đảm bảo thứ tự giữa các sự kiện.
- **FR-16** Có trang xem 30 ngày lịch sử gửi (mã trạng thái, thời gian phản hồi, 1 KB đầu của phản hồi), nút "Gửi lại" và nút "Gửi sự kiện thử".
- **FR-17 Chống SSRF** (lừa máy chủ gọi vào mạng nội bộ), áp dụng cho **cả** URL webhook lẫn `sourceUrl`:
  - Chỉ chấp nhận `https`, chỉ cổng 443, không có user/password trong URL, host không được là IP viết dạng số lạ (thập phân, bát phân, hex).
  - **Ghim IP:** khi gửi, client tự phân giải DNS **một lần** qua `PinnedDnsResolver`, kiểm tra **mọi** IP trả về, rồi chỉ kết nối tới các IP đã qua kiểm tra. Kiểm tra TLS vẫn theo tên miền gốc (SNI + chứng chỉ). Nhờ vậy không còn khe hở giữa lúc kiểm tra và lúc kết nối (DNS rebinding). Kiểm tra lúc đăng ký chỉ để báo lỗi sớm cho người dùng; kiểm tra thật nằm ở mỗi lần kết nối.
  - Dải bị chặn: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8`, `169.254.0.0/16` (metadata cloud), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`; IPv6 `::/128`, `::1/128`, `::ffff:0:0/96` (IPv4-mapped: lấy IPv4 bên trong rồi kiểm tra lại theo danh sách IPv4), `64:ff9b::/96` (NAT64, cũng kiểm tra IPv4 bên trong), `fc00::/7`, `fe80::/10`, `ff00::/8`.
  - Không tự đi theo redirect. Giới hạn kích thước phản hồi đọc về (webhook: 1 KB; `sourceUrl`: theo hạn mức dung lượng).

## 5. Yêu cầu phi chức năng
- Public API tách hẳn khỏi API nội bộ (`/api/ext/v1/**`), dùng DTO có kiểu rõ ràng, không dùng `Map<String,Object>`.
- Thay đổi gây vỡ tương thích (breaking change) phải ra `/v2`. `/v1` được giữ ít nhất 12 tháng.
- Tài liệu OpenAPI xem tại `/api/ext/v1/docs`.
- Webhook dispatcher chạy độc lập với request: khách có endpoint chậm cũng không làm chậm hệ thống.
- Việc nặng (tải video từ `sourceUrl`, analyze, xuất clip) đều là job trong bảng `jobs` của F09 (AD-10). Riêng `webhook_deliveries` là outbox gửi tin nhẹ, giống `notification_deliveries` của F48.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__public_api_webhooks.sql`:
```sql
CREATE TABLE api_keys (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    prefix VARCHAR(16) NOT NULL,
    key_hash CHAR(64) UNIQUE NOT NULL,
    scopes TEXT[] NOT NULL,
    created_by BIGINT REFERENCES users(id),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE idempotency_records (
    key VARCHAR(100) NOT NULL,
    api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    request_hash CHAR(64) NOT NULL,     -- phát hiện cùng key nhưng body khác → 422
    status VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS','COMPLETED')),
    response_status INT,                -- NULL khi IN_PROGRESS
    response_body JSONB,                -- NULL khi IN_PROGRESS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours', -- F17 dọn dòng hết hạn
    PRIMARY KEY (api_key_id, key),
    CONSTRAINT chk_idem_completed CHECK (status <> 'COMPLETED' OR response_status IS NOT NULL)
);
CREATE TABLE webhook_endpoints (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    events TEXT[] NOT NULL,
    secret_enc TEXT NOT NULL,           -- mã hoá bằng SecretCipher (AES-GCM) của F07
    previous_secret_enc TEXT,
    previous_secret_expires_at TIMESTAMPTZ,
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|DISABLED
    failing_since TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE webhook_events (
    id VARCHAR(40) PRIMARY KEY,         -- evt_<ulid>
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(40) NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
    endpoint_id BIGINT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL DEFAULT 'PENDING', -- PENDING|SUCCEEDED|FAILED
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_status_code INT,
    last_response_snippet VARCHAR(1024),
    last_duration_ms INT,
    UNIQUE (event_id, endpoint_id)
);
CREATE INDEX idx_wh_deliveries_due ON webhook_deliveries(status, next_attempt_at);
```

### 6.2 API

**Quản lý (dùng JWT người dùng, `ORG_OWNER`/`ORG_ADMIN` của tổ chức theo F49; không phải thành viên → 404, thành viên thường → 403 `FORBIDDEN_ACTION`):**
| Method | Path | Mô tả |
|---|---|---|
| GET/POST | `/api/v1/orgs/{id}/api-keys` | Danh sách / tạo key (trả key đầy đủ 1 lần) |
| DELETE | `/api/v1/orgs/{id}/api-keys/{keyId}` | Thu hồi |
| GET/POST | `/api/v1/orgs/{id}/webhooks` | Danh sách / tạo endpoint |
| PATCH/DELETE | `/api/v1/orgs/{id}/webhooks/{whId}` | Sửa / xoá |
| POST | `/api/v1/orgs/{id}/webhooks/{whId}/rotate-secret` | Đổi secret |
| POST | `/api/v1/orgs/{id}/webhooks/{whId}/test` | Gửi sự kiện `ping` |
| GET | `/api/v1/orgs/{id}/webhooks/{whId}/deliveries` | Lịch sử |
| POST | `/api/v1/webhook-deliveries/{id}/retry` | Gửi lại |

**Public API (dùng API key, tiền tố `/api/ext/v1`):**
| Method | Path | Scope | Mô tả |
|---|---|---|---|
| POST | `/api/ext/v1/uploads` | videos:write | Xin URL upload R2 ký sẵn (dùng lại F11) |
| POST | `/api/ext/v1/videos` | videos:write | Tạo video từ `uploadId` hoặc `sourceUrl` |
| GET | `/api/ext/v1/videos?cursor=&limit=` | videos:read | Danh sách |
| GET | `/api/ext/v1/videos/{id}` | videos:read | Chi tiết + trạng thái |
| POST | `/api/ext/v1/videos/{id}/analyze` | videos:write | Chạy analyze (job F10) |
| GET | `/api/ext/v1/videos/{id}/segments` | videos:read | Sections/topics |
| GET | `/api/ext/v1/videos/{id}/transcript?format=json\|srt\|vtt` | videos:read | Transcript |
| POST | `/api/ext/v1/videos/{id}/exports` | exports:write | Xuất clip |
| GET | `/api/ext/v1/exports/{id}` | videos:read | Trạng thái + link tải ký sẵn (hết hạn sau 1 giờ) |

Ví dụ tạo video:
```http
POST /api/ext/v1/videos
Authorization: Bearer ak_live_3fK9...
Idempotency-Key: lop-oop-2026-11-17
Content-Type: application/json

{ "sourceUrl": "https://storage.truong.edu.vn/rec/oop-b3.mp4",
  "title": "OOP Buổi 3", "preset": "lecture_programming",
  "outline": "1. Kế thừa\n2. Đa hình", "autoAnalyze": true }
```
```json
{ "id": "vid_41", "status": "QUEUED", "createdAt": "2026-11-17T08:00:00Z" }
```
Payload webhook `video.analyzed`:
```json
{ "id": "evt_01JD7Q...", "type": "video.analyzed", "createdAt": "2026-11-17T08:14:22Z",
  "data": { "videoId": "vid_41", "durationSec": 5412.3, "sections": 4, "topics": 14,
            "segmentsUrl": "https://api.autocut.vn/api/ext/v1/videos/vid_41/segments" } }
```
Webhook chỉ gửi tóm tắt kèm URL. Bên nhận gọi lại API để lấy dữ liệu đầy đủ, nhờ vậy payload nhỏ và không lộ transcript nếu URL webhook bị lộ.

Mã lỗi: `401 INVALID_API_KEY`, `403 INSUFFICIENT_SCOPE`, `402 QUOTA_EXCEEDED`, `409 IDEMPOTENCY_IN_PROGRESS`, `422 IDEMPOTENCY_KEY_REUSED`, `429 RATE_LIMITED`.

### 6.3 Backend
- `security/ApiKeyAuthFilter.java`: chỉ áp dụng cho `/api/ext/**` (không đụng tới `/api/v1/share/**` của F40 hay `/api/v1/hooks/**`). Băm key, tra `api_keys` (cache 30s), kiểm tra `revoked_at`/`expires_at`, đặt `OrgContext` + scopes. Annotation `@RequireScope("videos:write")` kiểm tra bằng interceptor.
- `web/IdempotencyInterceptor.java`: với `POST` có `Idempotency-Key`:
  - Thực hiện đúng quy trình FR-7 bằng `INSERT … ON CONFLICT DO NOTHING` (AD-8), không bắt lỗi unique violation.
- `controller/ext/ExtVideoController.java`, `ExtExportController.java`: gọi lại service hiện có (upsert của F00, tạo job analyze/cut của F09/F10 kèm giữ chỗ hạn mức của F49). **Không** gọi `VideoController`. Tạo video từ `sourceUrl` thì tạo job `IMPORT_FROM_URL`, job này tải bằng client có `PinnedDnsResolver`.
- `dto/ext/*`: các record Java có kiểu rõ ràng.
- `service/webhook/WebhookPublisher.java`: hàm `publish(orgId, type, data)` được gọi **trong cùng transaction** với việc đổi trạng thái (outbox, giống F48). Hàm ghi `webhook_events` và tạo `webhook_deliveries` cho các endpoint đăng ký loại sự kiện đó.
- `service/webhook/WebhookDispatcher.java`: `@Scheduled(fixedDelay = 5000)`, lấy delivery tới hạn bằng `FOR UPDATE SKIP LOCKED`, gửi qua `SafeHttpClient` (FR-17, không theo redirect, timeout 10s), ký bằng `WebhookSigner`, cập nhật kết quả và lịch thử lại. Mỗi lượt xử lý tối đa 20 delivery, mỗi endpoint tối đa 2 delivery song song.
- `service/webhook/WebhookSigner.java`: `sign(secret, id, ts, body)` trả `v1=<hex>`. Khi có secret cũ còn hạn thì header là `v1=<sig_new>,v1=<sig_old>`.
- `security/ssrf/IpRangePolicy.java` (hàm thuần): `isAllowed(InetAddress)` theo danh sách FR-17, có xử lý IPv4-mapped và NAT64.
- `security/ssrf/PinnedDnsResolver.java` (cài `org.apache.hc.client5.http.DnsResolver`): phân giải một lần, loại IP bị chặn, ném `SsrfBlockedException` nếu không còn IP nào. `SafeHttpClient` dùng resolver này nên kết nối chỉ đi tới IP đã kiểm tra (chống DNS rebinding: lần đầu tên miền trỏ ra ngoài, sau đó đổi sang IP nội bộ).
- `security/ssrf/UrlPolicy.java`: kiểm tra scheme, cổng, userinfo, dạng host (FR-17).
- `config/OpenApiConfig.java`: nhóm `ext-v1` chỉ quét gói `controller.ext`, phục vụ tại `/api/ext/v1/docs`.

### 6.5 Frontend
- `app/settings/developers/page.tsx`: tab **API keys** (tạo, chọn scope, hiện key 1 lần kèm nút sao chép và cảnh báo "Bạn sẽ không thấy lại khoá này", thu hồi) và tab **Webhooks** (thêm URL, chọn sự kiện, xem/đổi secret, lịch sử gửi, gửi thử, gửi lại).
- Link "Tài liệu API" mở `/api/ext/v1/docs`.
- Mọi chữ hiển thị bằng tiếng Việt; tên trường JSON trong ví dụ giữ nguyên tiếng Anh.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* key có scope `videos:read`. *When* gọi `POST /videos`. *Then* nhận 403 `INSUFFICIENT_SCOPE`.
- **AC-2** — *Given* key đã thu hồi. *When* gọi API sau tối đa 30s. *Then* nhận 401.
- **AC-3** — *Given* DB bị lộ. *Then* không khôi phục được key gốc: chỉ có `key_hash` và `prefix`; test kiểm tra không có cột nào chứa key thô.
- **AC-4** — *Given* gửi 2 lần `POST /videos` cùng `Idempotency-Key` và cùng body. *Then* chỉ có 1 video, 2 phản hồi giống hệt nhau.
- **AC-5** — *Given* cùng `Idempotency-Key` nhưng body khác. *Then* nhận 422.
- **AC-6** — *Given* analyze xong. *Then* trong vòng 30s endpoint nhận `video.analyzed`, chữ ký kiểm tra đúng với secret theo công thức FR-12.
- **AC-7** — *Given* endpoint trả 500. *Then* có thử lại theo lịch FR-13; `AutoCut-Webhook-Id` giữ nguyên ở mọi lần.
- **AC-8** — *Given* endpoint lỗi liên tục 3 ngày. *Then* `status = DISABLED`, chủ tổ chức nhận email.
- **AC-9** — *Given* đăng ký URL `https://169.254.169.254/latest`, một tên miền phân giải ra `10.0.0.5`, `100.64.1.1`, `[::ffff:127.0.0.1]` hoặc `[fe80::1]`, hoặc URL có cổng 8080. *Then* bị từ chối với `400 WEBHOOK_URL_NOT_ALLOWED`.
- **AC-9b** — *Given* tên miền lúc đăng ký phân giải ra IP công khai, nhưng tới lúc gửi thì phân giải ra `127.0.0.1` (DNS rebinding). *Then* không có kết nối nào tới `127.0.0.1`, delivery bị tính là thất bại với lỗi `SSRF_BLOCKED`.
- **AC-9c** — *Given* `sourceUrl` trỏ tới tên miền phân giải ra `169.254.169.254`. *Then* job `IMPORT_FROM_URL` thất bại với `SSRF_BLOCKED`, không có request nào tới địa chỉ đó.
- **AC-4b** — *Given* request thứ nhất với `Idempotency-Key: K` đang xử lý. *When* gửi request thứ hai cùng `K`. *Then* nhận 409 `IDEMPOTENCY_IN_PROGRESS`.
- **AC-1b** — *Given* key của tổ chức A. *When* gọi `GET /api/ext/v1/videos/{id}` với video của tổ chức B. *Then* nhận 404.
- **AC-1c** — *Given* gọi `GET /api/v1/share/{token}` của F40 không kèm API key. *Then* `ApiKeyAuthFilter` không chặn (request đi tiếp theo luật của F40).
- **AC-10** — *Given* endpoint trả 302 tới URL khác. *Then* không đi theo redirect; lần gửi bị tính là thất bại.
- **AC-11** — *Given* key vượt 60 req/phút. *Then* nhận 429 kèm `Retry-After`.
- **AC-12** — *Given* đổi secret. *Then* trong 24 giờ, header chữ ký chứa 2 giá trị `v1=`, cả hai đều kiểm tra đúng.

## 8. Kế hoạch kiểm thử (TDD)
- `ApiKeyServiceTest.generatesKeyAndStoresOnlyHash`
- `ApiKeyAuthFilterTest.rejectsRevokedKey`, `rejectsExpiredKey`, `rejectsKeyInQueryString`, `doesNotApplyToShareOrHooksPaths` (AC-1c)
- `ExtVideoControllerTest.otherOrgVideoReturns404` (AC-1b)
- `ScopeInterceptorTest.rejectsMissingScope`
- `IdempotencyInterceptorTest.replaysSameResponse`, `rejects422OnDifferentBody`, `returns409WhileInProgress`
- `WebhookSignerTest.matchesKnownVector` (cố định secret/id/ts/body và chuỗi hex mong đợi; đưa cùng vector này vào tài liệu cho khách tự đối chiếu)
- `WebhookSignerTest.includesBothSignaturesDuringRotation`
- `WebhookDispatcherTest.schedulesBackoffOnFailure`
- `WebhookDispatcherTest.disablesEndpointAfterThreeDays`
- `WebhookDispatcherTest.doesNotFollowRedirects`
- `IpRangePolicyTest.blocksAllListedRanges` (bảng tham số: mọi dải ở FR-17, kể cả `::ffff:10.0.0.1`, `64:ff9b::a00:1`, `100.64.0.1`, `0.0.0.0`)
- `UrlPolicyTest.rejectsNonHttpsNon443UserinfoAndOddIpNotation`
- `PinnedDnsResolverTest.connectsOnlyToValidatedIp` (resolver giả đổi kết quả giữa hai lần gọi, AC-9b)
- `ImportFromUrlJobTest.blocksMetadataAddress` (AC-9c)
- `ExtVideoControllerTest.createsVideoFromSourceUrl`
- Test tích hợp: dựng một HTTP server giả bằng `com.sun.net.httpserver.HttpServer` (có sẵn trong JDK) để nhận webhook.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| SSRF qua URL webhook hoặc `sourceUrl` | Đọc được metadata cloud, mạng nội bộ | Ghim IP qua `PinnedDnsResolver` cho **cả** `sourceUrl` lẫn webhook, danh sách chặn đầy đủ, chặn redirect, giới hạn kích thước tải |
| Lộ API key trong log | Kẻ xấu dùng hạn mức | Không log header `Authorization`; log chỉ in `prefix` |
| Endpoint khách chậm làm nghẽn dispatcher | Webhook trễ cho mọi khách | Timeout 10s, tối đa 20 delivery mỗi lượt và 2 delivery song song mỗi endpoint |
| Bảng `webhook_events`/`deliveries` phình | Tốn DB | Giữ 30 ngày, F17 dọn |
| `sourceUrl` trỏ tới tệp rất lớn | Hết đĩa | Kiểm tra `Content-Length` và giới hạn theo hạn mức dung lượng (F16/F49) |
| API công khai bị thay đổi vô tình | Tích hợp của khách bị vỡ | Test so sánh OpenAPI (snapshot) trong CI (F14) |

## 10. Câu hỏi mở
- [ ] Bản đầu có cho tạo video từ `sourceUrl`, hay chỉ cho upload qua URL ký sẵn (an toàn hơn)?
- [ ] Gói nào được dùng Public API: chỉ Enterprise, hay cả Team (xem F49)?
- [ ] Hạn mức mặc định 60 req/phút và 10 analyze/giờ có đủ cho trường học không?
- [ ] Có cần môi trường `ak_test_` riêng (dữ liệu giả, không tính phí) ngay từ đầu không?
- [ ] Domain public API là gì (ví dụ `api.autocut.vn`)?
