# F06 — Giới hạn tần suất gọi API (Rate limit)

| Mục | Giá trị |
|---|---|
| **Mã** | F06 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend) · SV4 (hiển thị thông báo 429) |
| **Phụ thuộc** | F01 (để giới hạn theo userId). Trước F01 chỉ giới hạn được theo IP |
| **Ước lượng** | M (3–4 ngày) |
| **Thư viện mới cần duyệt** | **Không bắt buộc.** Đề xuất tự viết token bucket bằng `ConcurrentHashMap` (≈ 80 dòng) vì hiện chỉ có 1 instance backend. Khi chạy nhiều instance thì cân nhắc `bucket4j` + Postgres/Redis (cần duyệt lúc đó) |
| **Tham khảo** | GitHub API (`X-RateLimit-*`), OpenAI API (giới hạn theo phút và theo ngày) |

> **Cập nhật 18/11/2026:** Tách `/refresh` và `/auth/tickets` khỏi nhóm đăng nhập; nới giới hạn IP và ghi rõ rủi ro NAT của trường; quy định endpoint nào của F11 tính vào nhóm `upload`; định nghĩa header khi một nhóm có nhiều giới hạn; thêm nhóm theo tiền tố AD-5 (`share`, `hooks`, `ext`).

## 1. Bối cảnh & vấn đề
- `POST /api/video/analyze` ([VideoController.java:713](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L713)) gọi Whisper và Gemini/Groq. Mỗi lần tốn tiền API và vài phút CPU. Chưa có giới hạn nào.
- `POST /api/video/upload-sample` ([VideoController.java:164](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L164)) nhận tệp tới 5 GB ([application.properties:5-6](../../../backend/src/main/resources/application.properties#L5-L6)). Spam vài lần là đầy ổ đĩa.
- `POST /api/chat` của Next.js ([frontend/src/app/api/chat/route.ts:24](../../../frontend/src/app/api/chat/route.ts#L24)) gọi LLM bằng khoá của hệ thống mà không cần đăng nhập. Ai biết URL cũng dùng được khoá miễn phí.
- `/render`, `/cut`, `/concat` chạy ffmpeg nặng; `BatchVideoCutService` chỉ có 2 luồng ([BatchVideoCutService.java:70](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L70)). Một người spam là cả hệ thống đứng.
- `POST /auth/login` (F01) cần chặn dò mật khẩu theo IP.

## 2. Mục tiêu
- Giới hạn theo **userId** (đã đăng nhập) hoặc theo **IP** (chưa đăng nhập), riêng cho từng nhóm endpoint.
- Vượt giới hạn thì trả **429** kèm `Retry-After`; frontend hiện thông báo tiếng Việt dễ hiểu.
- Giới hạn cấu hình được qua `application.properties`, không viết cứng trong code.
- Có **hạn mức theo ngày** cho các thao tác tốn tiền AI (analyze, chat).

### Ngoài phạm vi
- Hạn mức theo gói cước của tổ chức (xem F49).
- Chống DDoS ở tầng mạng (do Cloudflare hoặc hạ tầng đảm nhận).
- Hạn mức dung lượng lưu trữ (xem F16).

## 3. User stories
- Là người vận hành, tôi không muốn một tài khoản đốt hết tiền API AI trong một đêm.
- Là giảng viên, khi bị giới hạn tôi muốn biết **bao lâu nữa** thì thử lại được.

## 4. Yêu cầu chức năng
- **FR-1** Bảng giới hạn mặc định:

| Nhóm | Endpoint | Khoá | Giới hạn |
|---|---|---|---|
| `login` | `POST /api/v1/auth/login`, `GET /api/v1/auth/oauth2/authorize/*` (F03) | IP | 30 / phút |
| `refresh` | `POST /api/v1/auth/refresh` | IP | 120 / phút (mỗi tab đang mở đều refresh, nên không gộp với `login`) |
| `ticket` | `POST /api/v1/auth/tickets` (F01) | user | 120 / phút |
| `upload` | `POST /api/video/upload-sample`; sau F11 là request **khởi tạo** phiên upload | user | 10 / giờ |
| `analyze` | `POST /api/video/analyze` (và endpoint analyze mới của F10) | user | 5 / giờ **và** 20 / ngày |
| `chat` | `POST /api/chat` (Next) hoặc `/api/v1/ai/chat` (F07) | user | 30 / phút **và** 300 / ngày |
| `render` | `/render`, `/cut`, `/concat` | user | 20 / giờ |
| `share` | `/api/v1/share/**` (F40, F41, F47; người xem ẩn danh) | IP | 120 / phút |
| `ext` | `/api/ext/v1/**` (F50) | API key | 600 / phút (F50 có thể ghi đè theo gói) |
| `default` | `/api/**` còn lại | user, nếu chưa đăng nhập thì IP | 300 / phút |

  - **Không giới hạn:** `/api/v1/hooks/**` (callback VNPay, Stripe, Telegram, Zalo). Các bên này tự thử lại khi gặp lỗi, nên trả 429 chỉ làm chậm việc xác nhận thanh toán. Các hook này đã được bảo vệ bằng chữ ký (F48, F49).
  - Sau F11: các request **xin URL ký cho từng khúc** và **báo tiến độ / hoàn tất** của một phiên upload đã khởi tạo thì tính vào `default`, không tính vào `upload` (một tệp 5 GB có hàng trăm khúc).
  - Đăng nhập sai nhiều lần **theo tài khoản** đã được F01 FR-3 chặn (khoá 15 phút), nên giới hạn theo IP ở đây có thể nới tới 30/phút để không chặn oan cả lớp học dùng chung một IP.

- **FR-2** Mọi response của các nhóm trên có header `X-RateLimit-Limit`, `X-RateLimit-Remaining` và `X-RateLimit-Reset` (epoch giây). Nhóm có **nhiều giới hạn** (ví dụ `analyze` 5/giờ và 20/ngày) thì ba header lấy theo bucket **đang chặt nhất**, tức bucket có `Remaining` nhỏ nhất; nếu bằng nhau thì lấy bucket có `Reset` muộn hơn.
- **FR-3** Vượt giới hạn: trả 429 kèm `Retry-After: <giây>` và body:
  ```json
  { "error": { "code": "RATE_LIMITED", "message": "Bạn đã dùng hết lượt phân tích trong giờ này. Thử lại sau 23 phút.",
               "details": { "group": "analyze", "retryAfterSeconds": 1380 } } }
  ```
- **FR-4** User vai trò `ADMIN` được nhân giới hạn lên 10 lần (cấu hình được).
- **FR-5** IP lấy từ `X-Forwarded-For` **chỉ khi** request đi qua proxy tin cậy (`server.forward-headers-strategy=framework` và danh sách proxy). Nếu không thì dùng `remoteAddr`, tránh bị giả IP.
- **FR-6** Request bị từ chối do giới hạn thì không trừ thêm lượt.
- **FR-7** Bucket không dùng quá 10 phút thì tự xoá để không rò bộ nhớ.

## 5. Yêu cầu phi chức năng
- Overhead mỗi request < 0,5 ms.
- Bộ nhớ: tối đa khoảng 50.000 bucket. Vượt mức thì xoá bucket cũ nhất trước (LRU).
- Thread-safe khi nhiều request đến cùng lúc.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không đổi ở phiên bản 1 instance (lưu trong bộ nhớ). Hạn mức **theo ngày** cho analyze và chat sẽ mất khi khởi động lại; chấp nhận được ở MVP. F15 sẽ ghi lượt dùng AI vào DB.

### 6.2 API
Không có endpoint mới. Cấu hình:
```properties
autocut.ratelimit.enabled=true
autocut.ratelimit.groups.analyze.limits=5/PT1H,20/P1D
autocut.ratelimit.groups.chat.limits=30/PT1M,300/P1D
autocut.ratelimit.groups.upload.limits=10/PT1H
autocut.ratelimit.groups.render.limits=20/PT1H
autocut.ratelimit.groups.login.limits=30/PT1M
autocut.ratelimit.groups.refresh.limits=120/PT1M
autocut.ratelimit.groups.ticket.limits=120/PT1M
autocut.ratelimit.groups.share.limits=120/PT1M
autocut.ratelimit.groups.ext.limits=600/PT1M
autocut.ratelimit.groups.default.limits=300/PT1M
autocut.ratelimit.admin-multiplier=10
autocut.ratelimit.exempt-paths=/api/v1/hooks/**
autocut.ratelimit.ip-allowlist=
```

### 6.3 Backend
Tạo mới trong `com.autocut.ratelimit`:
- `TokenBucket`: `tryConsume() → ConsumeResult(allowed, remaining, resetEpoch, retryAfterSec)`, dùng `synchronized` hoặc `AtomicLong`; nạp lại token theo thời gian, nhận `Clock` qua constructor để test được.
- `RateLimitProperties` (`@ConfigurationProperties("autocut.ratelimit")`).
- `RateLimitRegistry`: `Map<String /*group:key*/, List<TokenBucket>>` và hàm `evictIdle()` chạy theo `@Scheduled(fixedDelay = 60000)`.
- `RateLimitFilter extends OncePerRequestFilter`: xác định nhóm theo method và đường dẫn (bảng FR-1), lấy khoá (userId từ `SecurityContext` hoặc IP), gọi registry, gắn header. Đặt filter **sau** JWT filter của F01.
- `@EnableScheduling` trong `BackendApplication` nếu chưa có.

Next.js `/api/chat`: sau F07, chat đi qua backend Spring nên được filter này giới hạn luôn. Nếu chưa làm F07 thì tạm đặt giới hạn theo IP trong `route.ts` bằng `Map` trong bộ nhớ, cùng thuật toán.

### 6.5 Frontend
- Trong `apiFetch` (F01): gặp 429 thì hiện toast bằng `error.message` từ máy chủ và **không tự thử lại**.
- Nút "Phân tích AI" bị vô hiệu trong khi chờ `retryAfterSeconds`, có đếm ngược.
- [AiAssistantChatPanel.tsx](../../../frontend/src/components/AiAssistantChatPanel.tsx): hiện tin nhắn hệ thống "Bạn đã gửi quá nhiều tin nhắn, vui lòng chờ …".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* giới hạn analyze 5/giờ *When* user A gọi analyze lần thứ 6 trong 1 giờ *Then* nhận 429, header `Retry-After` > 0.
- **AC-2** — *Given* A đã bị giới hạn *When* user B gọi analyze *Then* B nhận 200 (bucket tách riêng theo user).
- **AC-3** — *When* cùng 1 IP gọi `/auth/login` 31 lần trong 1 phút *Then* lần 31 nhận 429. *When* cùng IP đó gọi `/auth/refresh` *Then* vẫn 200 (khác nhóm).
- **AC-4** — *Given* user mới trong ngày *When* gọi analyze 3 lần trong 1 giờ *Then* `X-RateLimit-Limit=5` và `X-RateLimit-Remaining` lần lượt là 4, 3, 2 (theo bucket giờ, vì bucket ngày còn 19, 18, 17).
- **AC-8** — *Given* một phiên upload F11 đã khởi tạo *When* xin URL cho 500 khúc *Then* không request nào bị 429 do nhóm `upload`.
- **AC-9** — `POST /api/v1/hooks/vnpay` không bao giờ nhận 429 và không có header `X-RateLimit-*`.
- **AC-5** — *Given* client gửi header `X-Forwarded-For: 1.2.3.4` nhưng không qua proxy tin cậy *Then* khoá IP vẫn là `remoteAddr`.
- **AC-6** — Đặt `autocut.ratelimit.enabled=false` thì không có 429 và không có header rate limit.
- **AC-7** — Bắn 100 luồng đồng thời vào giới hạn 50 thì đúng 50 request thành công.

## 8. Kế hoạch kiểm thử (TDD)
- `TokenBucketTest` (dùng `Clock` giả): `consumesUntilEmpty`, `refillsAfterWindow`, `retryAfterIsAccurate`, `concurrentConsume_neverExceedsCapacity` (AC-7).
- `RateLimitRegistryTest`: `evictIdle_removesOldBuckets`, `multipleLimits_allMustPass` (5/giờ và 20/ngày), `headersReportTightestBucket`.
- `RateLimitGroupResolverTest`: `refreshNotInLoginGroup`, `uploadPartsInDefaultGroup`, `hooksExempt`, `sharePrefixIsIpKeyed`.
- `RateLimitFilterIT` (MockMvc): AC 1–6, AC-8, AC-9.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Chạy nhiều instance backend | Giới hạn bị nhân theo số instance | Ghi rõ là chỉ chạy được 1 instance; khi scale thì chuyển sang bucket4j + Postgres hoặc Redis |
| Nhiều người cùng trường dùng chung 1 IP (NAT): đầu giờ học cả lớp cùng đăng nhập | Bị chặn oan ở nhóm `login`/`share` | Giới hạn theo IP chỉ áp cho `login`, `refresh`, `share`; các nhóm khác theo user. Đặt mức `login` 30/phút và cấu hình được; dò mật khẩu theo tài khoản đã có F01 FR-3 chặn. Nếu trường báo bị chặn thì thêm IP của trường vào `autocut.ratelimit.ip-allowlist` (chỉ nới giới hạn IP, không bỏ khoá theo tài khoản) |
| Đặt sau proxy nhưng cấu hình sai proxy tin cậy | Mọi người dùng chung IP của proxy, cả hệ thống bị 429 | Kiểm tra `remoteAddr` thật khi deploy (AC-5); F14 ghi cấu hình proxy |
| Khởi động lại thì reset hạn mức ngày | Lách được hạn mức | Chấp nhận ở MVP; F15 lưu lượt dùng vào DB |

## 10. Câu hỏi mở
- [ ] Con số giới hạn ở FR-1 đã hợp lý chưa? Cần SV2 ước chi phí 1 lần analyze cho video 1 giờ.
- [ ] Có cần cho Admin chỉnh giới hạn riêng cho từng user không? (Đề xuất: để F49.)
- [ ] Danh sách IP của các trường đối tác cho `ip-allowlist` (nếu có).
