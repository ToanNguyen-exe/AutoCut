# F48 — Thông báo email / Zalo / Telegram

| Mục | Giá trị |
|---|---|
| **Mã** | F48 |
| **Nhóm** | Vận hành |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (dịch vụ thông báo, outbox) · SV4 (trang cài đặt, chuông thông báo) |
| **Phụ thuộc** | F01 (người dùng thật, email), F02 (ai được nhận thông báo của video), F07 (`SecretCipher` + bảng khoá mã hoá chung, xem §6.3), F09 (sự kiện job hoàn tất/lỗi), F13 |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `spring-boot-starter-mail` (gửi SMTP; là starter chính thức của Spring). Zalo và Telegram chỉ cần gọi HTTP bằng `RestClient` có sẵn, không thêm SDK. |
| **Tham khảo** | Descript/Riverside email "Your export is ready", GitHub notification settings |

> **Cập nhật 18/11/2026:** chống trùng bằng `INSERT … ON CONFLICT DO NOTHING` với khoá có chứa mã job hoặc ngày (AD-8); bỏ bảng `integration_secrets`, lưu token Zalo vào bảng khoá mã hoá chung của F07; đổi webhook sang `/api/v1/hooks/{provider}` (AD-5); unsubscribe tách thành GET hiển thị + POST thực hiện; mã liên kết Zalo/Telegram lưu dạng băm, có hạn và giới hạn số lần thử.

## 1. Bối cảnh & vấn đề
- Job cắt video chạy nền trong [BatchVideoCutService.java:166-287](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L166-L287). Khi xong, job chỉ gán `state.status = COMPLETED` (dòng 273) hoặc `FAILED` (dòng 180, 282). Người dùng chỉ biết kết quả nếu vẫn mở tab và frontend vẫn đang hỏi `/cut/status`.
- Bước analyze (Whisper + LLM) với video 2 tiếng có thể mất 10–20 phút. Giảng viên thường đóng tab đi làm việc khác.
- [.env.example](../../../.env.example) chưa có cấu hình SMTP, Zalo hay Telegram.

## 2. Mục tiêu
- Gửi thông báo khi: **analyze xong**, **analyze lỗi**, **xuất clip xong**, **xuất clip lỗi**, **sắp hết dung lượng (≥ 90%)**, **có bình luận mới / được giao duyệt** (khi có F35).
- Kênh: thông báo trong ứng dụng (chuông), Email (SMTP), Telegram Bot, Zalo OA.
- Người dùng tự bật/tắt theo từng loại sự kiện × kênh.
- Không gửi trùng, không spam, không mất thông báo khi máy chủ khởi động lại.

### Ngoài phạm vi
- SMS (tốn phí, để sau).
- Push notification trên trình duyệt hoặc điện thoại.
- Email marketing hay bản tin.

## 3. User stories
- Là **giảng viên**, tôi muốn nhận email "Video OOP_Buoi3 đã phân đoạn xong — 14 chủ đề" kèm link mở studio, để không phải canh tab.
- Là **giảng viên**, tôi muốn nhận tin Telegram khi xuất clip lỗi để xử lý ngay.
- Là **giảng viên**, tôi muốn tắt email cho "xuất clip xong" nhưng vẫn nhận khi có lỗi.
- Là **admin**, tôi muốn biết có bao nhiêu thông báo gửi thất bại.

## 4. Yêu cầu chức năng
- **FR-1 Outbox:** mọi thông báo được ghi vào bảng `notifications` **trong cùng transaction** với việc đổi trạng thái video/job (transactional outbox). Một worker riêng gửi đi, nên máy chủ có sập giữa chừng cũng không mất thông báo.
- **FR-2 Kênh trong ứng dụng:** chuông trên `Header`/`StudioHeader` hiện số chưa đọc. Click vào thì đánh dấu đã đọc và điều hướng tới `link`.
- **FR-3 Email (SMTP):** template HTML + text tiếng Việt có dấu, có link "Tắt loại thông báo này" (unsubscribe token ký HMAC chứa `userId`, `eventType`, `channel`, hết hạn sau 90 ngày, không cần đăng nhập).
  - Bấm link chỉ **mở trang xác nhận** (GET không đổi dữ liệu). Người dùng bấm nút "Tắt" thì frontend mới gọi POST. Cách này tránh việc trình quét link của hộp thư tự bấm làm tắt thông báo.
  - Có thêm header `List-Unsubscribe` (trỏ tới trang xác nhận) để Gmail hiện nút huỷ đăng ký.
- **FR-4 Telegram:** người dùng bấm "Kết nối Telegram" thì nhận deep link `https://t.me/<bot>?start=<linkToken>`. `linkToken` ngẫu nhiên 128 bit, lưu dạng băm SHA-256 trong `channel_link_codes`, hết hạn 10 phút, dùng **một lần**. Bot nhận `/start <linkToken>` qua webhook, lưu `chat_id`. Gửi bằng `sendMessage`.
- **FR-5 Zalo OA:** người dùng quan tâm (follow) OA. Liên kết qua mã 6 số: người dùng nhắn mã vào OA, webhook `user_send_text` khớp mã thì lưu `zalo_user_id`.
  - Mã 6 số sinh bằng `SecureRandom`, lưu dạng băm, hết hạn 10 phút, dùng một lần, không trùng với mã khác đang còn hạn.
  - **Giới hạn thử:** mỗi `zalo_user_id` gửi sai tối đa 5 lần/giờ; vượt thì bỏ qua tin nhắn chứa mã trong 1 giờ và OA trả lời "Bạn đã nhập sai quá nhiều lần, thử lại sau". Không có giới hạn này thì 1 triệu mã khả dĩ có thể bị dò ra. Gửi bằng API tin tư vấn `POST https://openapi.zalo.me/v3.0/oa/message/cs`. Lưu ý giới hạn của Zalo: OA chỉ được nhắn tư vấn miễn phí trong cửa sổ tương tác cho phép; ngoài cửa sổ phải dùng ZNS (template đăng ký trước, có phí). Xem câu hỏi mở.
- **FR-6 Chống spam:**
  - Khoá chống trùng `dedupe_key` **luôn chứa mã sự kiện gốc hoặc khung thời gian**, nên chỉ cần ràng buộc UNIQUE vĩnh viễn (AD-8):
    - Sự kiện của job: `analyze_done:job:<jobId>`, `export_failed:job:<jobId>`. Job thử lại nhiều lần vẫn cùng `jobId` nên chỉ báo một lần.
    - Sự kiện theo ngày: `quota_90:user:<userId>:<yyyy-MM-dd>` (mỗi ngày tối đa một lần).
    - Bình luận: `comment_new:comment:<commentId>`.
  - Ghi bằng `INSERT … ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id`. Không có dòng trả về thì không tạo delivery. **Không** bắt lỗi unique violation rồi bỏ qua, vì Postgres sẽ huỷ luôn transaction đang chạy.
  - Mỗi người dùng tối đa **20 thông báo/giờ cho mỗi kênh ngoài** (email/Telegram/Zalo). Vượt thì gom thành 1 tin tóm tắt ("Bạn có 7 cập nhật mới") gửi sau 15 phút.
  - **Giờ yên tĩnh** tuỳ chọn (mặc định 22:00–07:00 giờ VN): thông báo không khẩn cấp được hoãn lại; thông báo lỗi vẫn gửi.
  - Job thử lại nhiều lần (F09) chỉ thông báo khi **lỗi cuối cùng**, không báo mỗi lần thử.
- **FR-7 Thử lại khi gửi lỗi:** lùi dần 1 phút → 5 phút → 30 phút → 2 giờ, tối đa 4 lần, sau đó `FAILED`. Lỗi 4xx vĩnh viễn (email sai, bot bị chặn) thì dừng ngay và tắt kênh đó cho người dùng, kèm thông báo trong ứng dụng.
- **FR-8 Trang cài đặt:** `/settings/notifications` hiện ma trận loại sự kiện × kênh dạng checkbox, cùng trạng thái kết nối Telegram/Zalo và nút "Gửi thử".

## 5. Yêu cầu phi chức năng
- Thông báo được gửi đi trong vòng 60 giây sau sự kiện (p95), trừ khi rơi vào giờ yên tĩnh hoặc bị gom.
- Token bot, mật khẩu SMTP, app secret Zalo **chỉ** để trong `.env`, không commit. Thêm tên biến (không có giá trị) vào `.env.example`. Riêng access/refresh token Zalo thay đổi liên tục nên lưu trong DB, mã hoá bằng `SecretCipher` của F07.
- Không đưa dữ liệu nhạy cảm (nội dung transcript) vào nội dung thông báo, chỉ đưa tên video và số liệu.
- Access token Zalo OA hết hạn (khoảng 25 giờ) nên phải có job tự làm mới bằng refresh token.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__notifications.sql`:
```sql
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,   -- ANALYZE_DONE|ANALYZE_FAILED|EXPORT_DONE|EXPORT_FAILED|QUOTA_90|COMMENT_NEW|REVIEW_ASSIGNED
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    link VARCHAR(500),
    severity VARCHAR(10) NOT NULL DEFAULT 'INFO', -- INFO|ERROR
    dedupe_key VARCHAR(150),           -- luôn chứa jobId/commentId/ngày (FR-6)
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
    ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id BIGSERIAL PRIMARY KEY,
    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,      -- EMAIL|TELEGRAM|ZALO
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING|SENT|FAILED|SKIPPED|DEFERRED
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON notification_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,
    channel VARCHAR(10) NOT NULL,
    enabled BOOLEAN NOT NULL,
    PRIMARY KEY (user_id, event_type, channel)
);

CREATE TABLE IF NOT EXISTS user_channel_links (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,      -- TELEGRAM|ZALO
    external_id VARCHAR(100) NOT NULL, -- chat_id / zalo user_id
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel)
);

-- Mã liên kết Telegram (linkToken) và Zalo (6 số); chỉ lưu bản băm
CREATE TABLE IF NOT EXISTS channel_link_codes (
    code_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,      -- TELEGRAM|ZALO
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

-- Đếm số lần nhập sai mã Zalo theo người gửi (FR-5)
CREATE TABLE IF NOT EXISTS channel_link_failures (
    channel VARCHAR(10) NOT NULL,
    external_id VARCHAR(100) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL, -- làm tròn xuống đầu giờ
    failures INT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel, external_id, window_start)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT DEFAULT 22;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_end SMALLINT DEFAULT 7;
```
Mặc định khi chưa có preference: bật kênh trong ứng dụng cho mọi loại; bật email cho `*_FAILED` và `ANALYZE_DONE`; tắt Telegram/Zalo cho đến khi người dùng liên kết.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/notifications?unread=true&page=0` | Đăng nhập | Danh sách thông báo trong ứng dụng |
| POST | `/api/v1/notifications/{id}/read` | Chủ thông báo (thông báo của người khác trả 404, AD-2) | Đánh dấu đã đọc |
| POST | `/api/v1/notifications/read-all` | Đăng nhập | Đọc hết |
| GET/PUT | `/api/v1/notifications/preferences` | Đăng nhập | Ma trận bật/tắt |
| POST | `/api/v1/notifications/test?channel=EMAIL` | Đăng nhập | Gửi thử (giới hạn 3 lần/giờ) |
| POST | `/api/v1/integrations/telegram/link` | Đăng nhập | Trả deep link |
| POST | `/api/v1/hooks/telegram` | Không cần JWT; kiểm tra header `X-Telegram-Bot-Api-Secret-Token` (AD-5) | Nhận `/start` |
| POST | `/api/v1/integrations/zalo/link` | Đăng nhập | Trả mã 6 số, hết hạn 10 phút |
| POST | `/api/v1/hooks/zalo` | Không cần JWT; kiểm tra chữ ký `X-ZEvent-Signature` (AD-5) | Nhận tin nhắn chứa mã |
| GET | `/api/v1/notifications/unsubscribe?token=...` | Không cần JWT (token HMAC) | **Chỉ đọc:** trả loại sự kiện × kênh sẽ bị tắt, để trang xác nhận hiển thị |
| POST | `/api/v1/notifications/unsubscribe` | Không cần JWT (token HMAC trong body) | Tắt 1 loại × kênh |

PUT preferences mẫu:
```json
{ "preferences": [
  { "eventType": "EXPORT_DONE", "channel": "EMAIL", "enabled": false },
  { "eventType": "EXPORT_FAILED", "channel": "TELEGRAM", "enabled": true }
], "quietHours": { "start": 22, "end": 7 } }
```

### 6.3 Backend
- `service/notification/NotificationService.java`: hàm `notify(userId, eventType, title, body, link, dedupeKey, severity)`. Hàm này chạy chung transaction với service gọi nó. Ghi `notifications` bằng `INSERT … ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id` (native query); chỉ khi có `id` trả về mới tạo `notification_deliveries` theo preference.
- `service/notification/NotificationDispatcher.java`: `@Scheduled(fixedDelay = 10000)`, lấy tối đa 50 delivery tới hạn bằng `SELECT ... FOR UPDATE SKIP LOCKED` (an toàn khi chạy nhiều instance), áp dụng giờ yên tĩnh và rate limit/gom tin, rồi gọi kênh tương ứng.
  - **Ghi chú về AD-10:** bảng `notification_deliveries` là outbox, đóng vai trò hàng đợi riêng cho việc gửi tin (có lịch thử lại theo từng kênh). Dispatcher chỉ là một vòng lặp hỏi DB trên luồng của Spring scheduler, không tạo `ExecutorService` riêng. Việc gửi tin rất nhẹ nên không cần một dòng `jobs` cho mỗi tin.
- Mỗi kênh một lớp, cùng hàm `send(...)` (đã có 3 cách triển khai nên dùng interface là hợp lý theo quy tắc "Rule of Three"): `EmailChannel` (JavaMailSender), `TelegramChannel` (`https://api.telegram.org/bot<TOKEN>/sendMessage`, `parse_mode=HTML`), `ZaloChannel` (header `access_token`).
- `service/notification/ZaloTokenRefresher.java`: `@Scheduled` mỗi 20 giờ, gọi `https://oauth.zaloapp.com/v4/oa/access_token` với `grant_type=refresh_token`. Access token và refresh token được mã hoá bằng `SecretCipher` (F07) và lưu vào bảng `provider_secrets` của F07 với `provider='zalo_oa'`, `secret_name` = `access_token` / `refresh_token`. Không lưu trong `.env`, vì refresh token đổi sau mỗi lần làm mới.
  - Dùng `SecretStore` của F07 (bảng `provider_secrets`, `UNIQUE(provider, secret_name)`), ghi bằng `ON CONFLICT … DO UPDATE`. Thời điểm hết hạn của access token lưu ở `metadata.expiresAt`. F48 **không** tự tạo bảng bí mật thứ hai.
- Điểm gọi `notify`:
  - Analyze xong/lỗi (sau F10, trong job handler analyze).
  - `BatchVideoCutService.executeJob` dòng 273 (`COMPLETED`) và 180/282 (`FAILED`). Sau F09 thì gọi ở handler job.
  - F16 khi dung lượng vượt 90%.
- `.env.example` bổ sung: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_SECRET_KEY`, `NOTIFY_UNSUBSCRIBE_SECRET`, `APP_PUBLIC_URL`.

### 6.5 Frontend
- `components/NotificationBell.tsx` đặt trong `Header.tsx` và `StudioHeader.tsx`: hỏi `/notifications?unread=true` mỗi 30s (hoặc nghe SSE của F10 nếu đã có), hiện badge số chưa đọc.
- `app/settings/notifications/page.tsx`: bảng checkbox, khu "Kết nối Telegram" (mở deep link), "Kết nối Zalo" (hiện mã 6 số và hướng dẫn "Nhắn mã này cho OA AutoCut"), nút "Gửi thử".
- `app/unsubscribe/page.tsx`: gọi GET để hiện "Bạn sắp tắt thông báo *Xuất clip xong* qua *Email*" cùng nút "Tắt thông báo này"; bấm nút thì gọi POST rồi hiện "Đã tắt".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* job xuất clip chuyển sang `COMPLETED`. *Then* trong vòng 60s có 1 bản ghi `notifications` và email gửi tới chủ video với link `/studio?videoId=<id>`.
- **AC-2** — *Given* máy chủ tắt ngay sau khi job xong nhưng email chưa kịp gửi. *When* máy chủ khởi động lại. *Then* email vẫn được gửi đúng 1 lần.
- **AC-3** — *Given* `notify` được gọi 2 lần với cùng `dedupe_key` **bên trong một transaction đang cập nhật trạng thái job**. *Then* chỉ có 1 thông báo **và** transaction vẫn commit thành công (trạng thái job vẫn được lưu).
- **AC-4** — *Given* 25 sự kiện cho cùng người dùng trong 1 giờ. *Then* gửi email tối đa 20 tin riêng lẻ, phần còn lại gom thành 1 tin tóm tắt.
- **AC-5** — *Given* lúc 23:00, sự kiện `EXPORT_DONE`. *Then* delivery ở trạng thái `DEFERRED`, gửi lúc 07:00. *Given* `EXPORT_FAILED` cùng giờ. *Then* gửi ngay.
- **AC-6** — *Given* Telegram trả 403 "bot was blocked by the user". *Then* delivery `FAILED`, liên kết Telegram bị xoá, người dùng nhận thông báo trong ứng dụng "Kết nối Telegram đã ngắt".
- **AC-7** — *Given* webhook Telegram thiếu hoặc sai secret token header. *Then* trả 401 và không lưu gì.
- **AC-8** — *Given* link unsubscribe bị sửa token. *Then* trả 400 và không đổi preference.
- **AC-8b** — *Given* link unsubscribe hợp lệ. *When* chỉ gọi GET (như trình quét email). *Then* preference **không đổi**. *When* gọi POST. *Then* preference tương ứng thành `enabled=false`.
- **AC-8c** — *Given* một `zalo_user_id` gửi 5 mã sai trong 1 giờ. *When* gửi mã thứ 6, kể cả mã đúng. *Then* không liên kết, OA trả lời đã khoá tạm.
- **AC-8d** — *Given* mã Zalo hoặc `linkToken` Telegram đã dùng hoặc quá 10 phút. *Then* không liên kết được.
- **AC-9** — *Given* SMTP trả lỗi tạm thời (421). *Then* `attempts` tăng và `next_attempt_at` = now + 1 phút, rồi 5 phút, 30 phút, 2 giờ; sau 4 lần thì `FAILED`.

## 8. Kế hoạch kiểm thử (TDD)
- `NotificationServiceTest.shouldSkipDuplicateDedupeKey`
- `NotificationServiceTest.duplicateDedupeKeyDoesNotAbortOuterTransaction` (AC-3, test tích hợp trên Postgres theo AD-7)
- `NotificationServiceTest.shouldCreateDeliveriesFromPreferences`
- `NotificationServiceTest.shouldUseDefaultPreferencesWhenNoneSaved`
- `NotificationDispatcherTest.shouldDeferInfoDuringQuietHours`
- `NotificationDispatcherTest.shouldSendErrorDuringQuietHours`
- `NotificationDispatcherTest.shouldDigestWhenOverHourlyLimit`
- `NotificationDispatcherTest.shouldBackoffOnTransientError`
- `NotificationDispatcherTest.shouldDisableChannelOnPermanentError`
- `TelegramWebhookControllerTest.rejectsWrongSecretToken`
- `TelegramWebhookControllerTest.linksChatIdOnStartCommand`
- `ZaloWebhookControllerTest.rejectsInvalidSignature`
- `UnsubscribeControllerTest.rejectsTamperedToken`
- `UnsubscribeControllerTest.getDoesNotChangePreference` (AC-8b)
- `ZaloWebhookControllerTest.locksAfterFiveWrongCodesPerHour` (AC-8c)
- `ChannelLinkServiceTest.rejectsUsedOrExpiredCode` (AC-8d)
- Gửi email thật thì dùng GreenMail hoặc MailHog trong Docker Compose (F14) để test tích hợp. Nếu dùng GreenMail thì cần xin duyệt thư viện test.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Email rơi vào thư rác | Người dùng không nhận | Dùng SMTP có SPF/DKIM (SendGrid, Amazon SES, Gmail Workspace), tên miền riêng |
| Zalo OA giới hạn tin tư vấn ngoài cửa sổ tương tác | Tin Zalo không tới | Ghi rõ trong UI; dài hạn chuyển sang ZNS (cần đăng ký template, có phí) |
| Token Zalo hết hạn | Ngừng gửi Zalo | Job làm mới tự động + cảnh báo admin khi làm mới lỗi |
| Công thức chữ ký webhook Zalo (`X-ZEvent-Signature`) mô tả chưa chắc chắn | Bỏ sót kiểm tra hoặc chặn nhầm | Người làm phải đối chiếu tài liệu Zalo OA mới nhất trước khi code, và viết test bằng payload mẫu chính thức |
| Lộ bot token | Kẻ xấu gửi tin giả mạo | Chỉ để trong `.env`; có thể đổi token qua BotFather |
| Gửi quá nhiều khi một loạt job lỗi | Spam | Dedupe + giới hạn mỗi giờ + gom tin |

## 10. Câu hỏi mở
- [ ] Nhóm có OA Zalo đã xác thực chưa? Nếu chưa, có làm Zalo ở bản này không, hay chỉ làm Email + Telegram trước?
- [ ] Dùng nhà cung cấp SMTP nào (SES, SendGrid, Gmail Workspace)? Gửi từ tên miền nào?
- [ ] Giờ yên tĩnh mặc định 22:00–07:00 có hợp lý không?
- [ ] Có cần gửi thông báo cho cả người được mời cộng tác (F36), hay chỉ chủ video?
