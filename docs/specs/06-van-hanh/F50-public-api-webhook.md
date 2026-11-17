# F50 — Public API & webhook

| Mục | Giá trị |
|---|---|
| **Mã** | F50 |
| **Nhóm** | Vận hành & kinh doanh |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (API, webhook) · SV4 (trang quản lý khoá + tài liệu API) |
| **Phụ thuộc** | F01, F02, F06 (rate limit), F09 (job), F10 (analyze bất đồng bộ), F11 (upload thẳng R2), F13, F49 (tổ chức, hạn mức) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `springdoc-openapi-starter-webmvc-ui` (tự sinh tài liệu OpenAPI/Swagger). Ký HMAC dùng `javax.crypto` có sẵn. |
| **Tham khảo** | Mux Video API & webhooks, Stripe API keys & webhook signatures, AssemblyAI webhooks, GitHub webhooks |

## 1. Bối cảnh & vấn đề
- Hiện mọi thao tác phải đi qua giao diện web. API trong [VideoController.java](../../../backend/src/main/java/com/autocut/controller/VideoController.java) là API nội bộ: nhận `Map<String,Object>` tự do (ví dụ `/analyze` dòng 713, `/save` dòng 1145, `/render` dòng 1414), không có phiên bản, không ổn định, nên không thể đưa cho bên ngoài dùng.
- Trường học thường đã có hệ thống ghi hình lớp học hoặc LMS. Họ muốn **tự động gửi video vào** AutoCut và **nhận kết quả về** mà không cần người bấm tay.
- Trạng thái job chỉ hỏi được qua `/cut/status?jobId=` ([VideoController.java:1587](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1587)). Chưa có cơ chế đẩy kết quả (push) ra ngoài.

## 2. Mục tiêu
- Public API `/api/public/v1` ổn định, có tài liệu OpenAPI, xác thực bằng **API key** theo tổ chức.
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
- **FR-7** Mọi request tạo tài nguyên (`POST`) nhận `Idempotency-Key`. Gửi lại cùng key trong 24 giờ thì trả lại đúng phản hồi cũ, không tạo trùng.
- **FR-8** Danh sách có phân trang kiểu cursor (`?limit=20&cursor=...`).
- **FR-9** Lỗi theo định dạng chung trong README, kèm `requestId`.

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
- **FR-17 Chống SSRF** (lừa máy chủ gọi vào mạng nội bộ): URL webhook bắt buộc `https`, chặn IP nội bộ hoặc loopback (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `::1`, `fc00::/7`) **sau khi phân giải DNS**, mỗi lần gửi đều kiểm tra lại, và không tự đi theo redirect.

## 5. Yêu cầu phi chức năng
- Public API tách hẳn khỏi API nội bộ (`/api/public/v1/**`), dùng DTO có kiểu rõ ràng, không dùng `Map<String,Object>`.
- Thay đổi gây vỡ tương thích (breaking change) phải ra `/v2`. `/v1` được giữ ít nhất 12 tháng.
- Tài liệu OpenAPI xem tại `/api/public/docs`.
- Webhook dispatcher chạy độc lập với request: khách có endpoint chậm cũng không làm chậm hệ thống.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V50__public_api_webhooks.sql`:
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
    response_status INT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (api_key_id, key)
);
CREATE TABLE webhook_endpoints (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    events TEXT[] NOT NULL,
    secret_enc TEXT NOT NULL,           -- mã hoá AES-GCM bằng khoá F07
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

**Quản lý (dùng JWT người dùng, OWNER/ADMIN của tổ chức):**
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

**Public (dùng API key):**
| Method | Path | Scope | Mô tả |
|---|---|---|---|
| POST | `/api/public/v1/uploads` | videos:write | Xin URL upload R2 ký sẵn (dùng lại F11) |
| POST | `/api/public/v1/videos` | videos:write | Tạo video từ `uploadId` hoặc `sourceUrl` |
| GET | `/api/public/v1/videos?cursor=&limit=` | videos:read | Danh sách |
| GET | `/api/public/v1/videos/{id}` | videos:read | Chi tiết + trạng thái |
| POST | `/api/public/v1/videos/{id}/analyze` | videos:write | Chạy analyze (job F10) |
| GET | `/api/public/v1/videos/{id}/segments` | videos:read | Sections/topics |
| GET | `/api/public/v1/videos/{id}/transcript?format=json\|srt\|vtt` | videos:read | Transcript |
| POST | `/api/public/v1/videos/{id}/exports` | exports:write | Xuất clip |
| GET | `/api/public/v1/exports/{id}` | videos:read | Trạng thái + link tải ký sẵn (hết hạn sau 1 giờ) |

Ví dụ tạo video:
```http
POST /api/public/v1/videos
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
            "segmentsUrl": "https://api.autocut.vn/api/public/v1/videos/vid_41/segments" } }
```
Webhook chỉ gửi tóm tắt kèm URL. Bên nhận gọi lại API để lấy dữ liệu đầy đủ, nhờ vậy payload nhỏ và không lộ transcript nếu URL webhook bị lộ.

Mã lỗi: `401 INVALID_API_KEY`, `403 INSUFFICIENT_SCOPE`, `402 QUOTA_EXCEEDED`, `409 IDEMPOTENCY_IN_PROGRESS`, `422 IDEMPOTENCY_KEY_REUSED`, `429 RATE_LIMITED`.

### 6.3 Backend
- `security/ApiKeyAuthFilter.java`: chỉ áp dụng cho `/api/public/**`. Băm key, tra `api_keys` (cache 30s), kiểm tra `revoked_at`/`expires_at`, đặt `OrgContext` + scopes. Annotation `@RequireScope("videos:write")` kiểm tra bằng interceptor.
- `web/IdempotencyInterceptor.java`: với `POST` có `Idempotency-Key`:
  - Đã có bản ghi cùng `request_hash` → trả lại phản hồi cũ.
  - Đã có bản ghi nhưng body khác → 422.
  - Request trước cùng key đang xử lý → 409.
- `controller/publicapi/PublicVideoController.java`, `PublicExportController.java`: gọi lại service hiện có (analyze, cut). **Không** gọi `VideoController`.
- `dto/publicapi/*`: các record Java có kiểu rõ ràng.
- `service/webhook/WebhookPublisher.java`: hàm `publish(orgId, type, data)` được gọi **trong cùng transaction** với việc đổi trạng thái (outbox, giống F48). Hàm ghi `webhook_events` và tạo `webhook_deliveries` cho các endpoint đăng ký loại sự kiện đó.
- `service/webhook/WebhookDispatcher.java`: `@Scheduled(fixedDelay = 5000)`, lấy delivery tới hạn bằng `FOR UPDATE SKIP LOCKED`, gửi qua `java.net.http.HttpClient` (`followRedirects(NEVER)`, timeout 10s), ký bằng `WebhookSigner`, cập nhật kết quả và lịch thử lại.
- `service/webhook/WebhookSigner.java`: `sign(secret, id, ts, body)` trả `v1=<hex>`. Khi có secret cũ còn hạn thì header là `v1=<sig_new>,v1=<sig_old>`.
- `service/webhook/SsrfGuard.java`: phân giải DNS, kiểm tra mọi IP; dùng lúc đăng ký và **trước mỗi lần gửi** (chống DNS rebinding: lần đầu tên miền trỏ ra ngoài, sau đó đổi sang IP nội bộ).
- `config/OpenApiConfig.java`: nhóm `public-v1` chỉ quét gói `controller.publicapi`.

### 6.5 Frontend
- `app/settings/developers/page.tsx`: tab **API keys** (tạo, chọn scope, hiện key 1 lần kèm nút sao chép và cảnh báo "Bạn sẽ không thấy lại khoá này", thu hồi) và tab **Webhooks** (thêm URL, chọn sự kiện, xem/đổi secret, lịch sử gửi, gửi thử, gửi lại).
- Link "Tài liệu API" mở `/api/public/docs`.
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
- **AC-9** — *Given* đăng ký URL `https://169.254.169.254/latest` hoặc một tên miền phân giải ra `10.0.0.5`. *Then* bị từ chối với `400 WEBHOOK_URL_NOT_ALLOWED`.
- **AC-10** — *Given* endpoint trả 302 tới URL khác. *Then* không đi theo redirect; lần gửi bị tính là thất bại.
- **AC-11** — *Given* key vượt 60 req/phút. *Then* nhận 429 kèm `Retry-After`.
- **AC-12** — *Given* đổi secret. *Then* trong 24 giờ, header chữ ký chứa 2 giá trị `v1=`, cả hai đều kiểm tra đúng.

## 8. Kế hoạch kiểm thử (TDD)
- `ApiKeyServiceTest.generatesKeyAndStoresOnlyHash`
- `ApiKeyAuthFilterTest.rejectsRevokedKey`, `rejectsExpiredKey`, `rejectsKeyInQueryString`
- `ScopeInterceptorTest.rejectsMissingScope`
- `IdempotencyInterceptorTest.replaysSameResponse`, `rejects422OnDifferentBody`, `returns409WhileInProgress`
- `WebhookSignerTest.matchesKnownVector` (cố định secret/id/ts/body và chuỗi hex mong đợi; đưa cùng vector này vào tài liệu cho khách tự đối chiếu)
- `WebhookSignerTest.includesBothSignaturesDuringRotation`
- `WebhookDispatcherTest.schedulesBackoffOnFailure`
- `WebhookDispatcherTest.disablesEndpointAfterThreeDays`
- `WebhookDispatcherTest.doesNotFollowRedirects`
- `SsrfGuardTest.blocksPrivateRanges` (IPv4 + IPv6), `blocksDnsResolvingToPrivate`
- `PublicVideoControllerTest.createsVideoFromSourceUrl`
- Test tích hợp: dựng một HTTP server giả bằng `com.sun.net.httpserver.HttpServer` (có sẵn trong JDK) để nhận webhook.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| SSRF qua URL webhook hoặc `sourceUrl` | Đọc được metadata cloud, mạng nội bộ | `SsrfGuard` cho **cả** `sourceUrl` lẫn webhook, chặn redirect, giới hạn kích thước tải |
| Lộ API key trong log | Kẻ xấu dùng hạn mức | Không log header `Authorization`; log chỉ in `prefix` |
| Endpoint khách chậm làm nghẽn dispatcher | Webhook trễ cho mọi khách | Timeout 10s, thread pool riêng, giới hạn số delivery song song mỗi endpoint |
| Bảng `webhook_events`/`deliveries` phình | Tốn DB | Giữ 30 ngày, F17 dọn |
| `sourceUrl` trỏ tới tệp rất lớn | Hết đĩa | Kiểm tra `Content-Length` và giới hạn theo hạn mức dung lượng (F16/F49) |
| API công khai bị thay đổi vô tình | Tích hợp của khách bị vỡ | Test so sánh OpenAPI (snapshot) trong CI (F14) |

## 10. Câu hỏi mở
- [ ] Bản đầu có cho tạo video từ `sourceUrl`, hay chỉ cho upload qua URL ký sẵn (an toàn hơn)?
- [ ] Gói nào được dùng Public API: chỉ Enterprise, hay cả Team (xem F49)?
- [ ] Hạn mức mặc định 60 req/phút và 10 analyze/giờ có đủ cho trường học không?
- [ ] Có cần môi trường `ak_test_` riêng (dữ liệu giả, không tính phí) ngay từ đầu không?
- [ ] Domain public API là gì (ví dụ `api.autocut.vn`)?
