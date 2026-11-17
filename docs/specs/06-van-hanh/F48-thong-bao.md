# F48 — Thông báo email / Zalo / Telegram

| Mục | Giá trị |
|---|---|
| **Mã** | F48 |
| **Nhóm** | Vận hành |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (dịch vụ thông báo, outbox) · SV4 (trang cài đặt, chuông thông báo) |
| **Phụ thuộc** | F01 (người dùng thật, email), F09 (sự kiện job hoàn tất/lỗi), F13 |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | `spring-boot-starter-mail` (gửi SMTP; là starter chính thức của Spring). Zalo và Telegram chỉ cần gọi HTTP bằng `RestClient` có sẵn, không thêm SDK. |
| **Tham khảo** | Descript/Riverside email "Your export is ready", GitHub notification settings |

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
- **FR-3 Email (SMTP):** template HTML + text tiếng Việt có dấu, có link "Tắt loại thông báo này" (unsubscribe token ký HMAC, không cần đăng nhập).
- **FR-4 Telegram:** người dùng bấm "Kết nối Telegram" thì nhận deep link `https://t.me/<bot>?start=<linkToken>`. Bot nhận `/start <linkToken>` qua webhook, lưu `chat_id`. Gửi bằng `sendMessage`.
- **FR-5 Zalo OA:** người dùng quan tâm (follow) OA. Liên kết qua mã 6 số: người dùng nhắn mã vào OA, webhook `user_send_text` khớp mã thì lưu `zalo_user_id`. Gửi bằng API tin tư vấn `POST https://openapi.zalo.me/v3.0/oa/message/cs`. Lưu ý giới hạn của Zalo: OA chỉ được nhắn tư vấn miễn phí trong cửa sổ tương tác cho phép; ngoài cửa sổ phải dùng ZNS (template đăng ký trước, có phí). Xem câu hỏi mở.
- **FR-6 Chống spam:**
  - Khoá chống trùng `dedupe_key` (ví dụ `analyze_done:video:41`). Trùng khoá trong 24 giờ thì không tạo bản ghi mới.
  - Mỗi người dùng tối đa **20 thông báo/giờ cho mỗi kênh ngoài** (email/Telegram/Zalo). Vượt thì gom thành 1 tin tóm tắt ("Bạn có 7 cập nhật mới") gửi sau 15 phút.
  - **Giờ yên tĩnh** tuỳ chọn (mặc định 22:00–07:00 giờ VN): thông báo không khẩn cấp được hoãn lại; thông báo lỗi vẫn gửi.
  - Job thử lại nhiều lần (F09) chỉ thông báo khi **lỗi cuối cùng**, không báo mỗi lần thử.
- **FR-7 Thử lại khi gửi lỗi:** lùi dần 1 phút → 5 phút → 30 phút → 2 giờ, tối đa 4 lần, sau đó `FAILED`. Lỗi 4xx vĩnh viễn (email sai, bot bị chặn) thì dừng ngay và tắt kênh đó cho người dùng, kèm thông báo trong ứng dụng.
- **FR-8 Trang cài đặt:** `/settings/notifications` hiện ma trận loại sự kiện × kênh dạng checkbox, cùng trạng thái kết nối Telegram/Zalo và nút "Gửi thử".

## 5. Yêu cầu phi chức năng
- Thông báo được gửi đi trong vòng 60 giây sau sự kiện (p95), trừ khi rơi vào giờ yên tĩnh hoặc bị gom.
- Token bot, mật khẩu SMTP và access token Zalo **chỉ** để trong `.env`, không commit. Thêm tên biến (không có giá trị) vào `.env.example`.
- Không đưa dữ liệu nhạy cảm (nội dung transcript) vào nội dung thông báo, chỉ đưa tên video và số liệu.
- Access token Zalo OA hết hạn (khoảng 25 giờ) nên phải có job tự làm mới bằng refresh token.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V48__notifications.sql`:
```sql
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,   -- ANALYZE_DONE|ANALYZE_FAILED|EXPORT_DONE|EXPORT_FAILED|QUOTA_90|COMMENT_NEW|REVIEW_ASSIGNED
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    link VARCHAR(500),
    severity VARCHAR(10) NOT NULL DEFAULT 'INFO', -- INFO|ERROR
    dedupe_key VARCHAR(150),
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT DEFAULT 22;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_end SMALLINT DEFAULT 7;
```
Mặc định khi chưa có preference: bật kênh trong ứng dụng cho mọi loại; bật email cho `*_FAILED` và `ANALYZE_DONE`; tắt Telegram/Zalo cho đến khi người dùng liên kết.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/notifications?unread=true&page=0` | Đăng nhập | Danh sách thông báo trong ứng dụng |
| POST | `/api/v1/notifications/{id}/read` | Chủ | Đánh dấu đã đọc |
| POST | `/api/v1/notifications/read-all` | Đăng nhập | Đọc hết |
| GET/PUT | `/api/v1/notifications/preferences` | Đăng nhập | Ma trận bật/tắt |
| POST | `/api/v1/notifications/test?channel=EMAIL` | Đăng nhập | Gửi thử (giới hạn 3 lần/giờ) |
| POST | `/api/v1/integrations/telegram/link` | Đăng nhập | Trả deep link |
| POST | `/api/v1/integrations/telegram/webhook` | Public, kiểm tra header `X-Telegram-Bot-Api-Secret-Token` | Nhận `/start` |
| POST | `/api/v1/integrations/zalo/link` | Đăng nhập | Trả mã 6 số, hết hạn 10 phút |
| POST | `/api/v1/integrations/zalo/webhook` | Public, kiểm tra chữ ký `X-ZEvent-Signature` | Nhận tin nhắn chứa mã |
| GET | `/api/v1/public/unsubscribe?token=...` | Public (token HMAC) | Tắt 1 loại × kênh |

PUT preferences mẫu:
```json
{ "preferences": [
  { "eventType": "EXPORT_DONE", "channel": "EMAIL", "enabled": false },
  { "eventType": "EXPORT_FAILED", "channel": "TELEGRAM", "enabled": true }
], "quietHours": { "start": 22, "end": 7 } }
```

### 6.3 Backend
- `service/notification/NotificationService.java`: hàm `notify(userId, eventType, title, body, link, dedupeKey, severity)`. Hàm này chạy chung transaction với service gọi nó, ghi `notifications` và tạo `notification_deliveries` dựa theo preference. Gặp lỗi trùng `dedupe_key` thì bỏ qua.
- `service/notification/NotificationDispatcher.java`: `@Scheduled(fixedDelay = 10000)`, lấy tối đa 50 delivery tới hạn bằng `SELECT ... FOR UPDATE SKIP LOCKED` (an toàn khi chạy nhiều instance), áp dụng giờ yên tĩnh và rate limit/gom tin, rồi gọi kênh tương ứng.
- Mỗi kênh một lớp, cùng hàm `send(...)` (đã có 3 cách triển khai nên dùng interface là hợp lý theo quy tắc "Rule of Three"): `EmailChannel` (JavaMailSender), `TelegramChannel` (`https://api.telegram.org/bot<TOKEN>/sendMessage`, `parse_mode=HTML`), `ZaloChannel` (header `access_token`).
- `service/notification/ZaloTokenRefresher.java`: `@Scheduled` mỗi 20 giờ, gọi `https://oauth.zaloapp.com/v4/oa/access_token` với `grant_type=refresh_token`. Token lưu trong bảng `integration_secrets` (đã mã hoá, xem F07), không lưu trong `.env`, vì refresh token đổi sau mỗi lần làm mới.
- Điểm gọi `notify`:
  - Analyze xong/lỗi (sau F10, trong job handler analyze).
  - `BatchVideoCutService.executeJob` dòng 273 (`COMPLETED`) và 180/282 (`FAILED`). Sau F09 thì gọi ở handler job.
  - F16 khi dung lượng vượt 90%.
- `.env.example` bổ sung: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_SECRET_KEY`, `NOTIFY_UNSUBSCRIBE_SECRET`, `APP_PUBLIC_URL`.

### 6.5 Frontend
- `components/NotificationBell.tsx` đặt trong `Header.tsx` và `StudioHeader.tsx`: hỏi `/notifications?unread=true` mỗi 30s (hoặc nghe SSE của F10 nếu đã có), hiện badge số chưa đọc.
- `app/settings/notifications/page.tsx`: bảng checkbox, khu "Kết nối Telegram" (mở deep link), "Kết nối Zalo" (hiện mã 6 số và hướng dẫn "Nhắn mã này cho OA AutoCut"), nút "Gửi thử".
- `app/unsubscribe/page.tsx`: hiện "Đã tắt thông báo … qua email".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* job xuất clip chuyển sang `COMPLETED`. *Then* trong vòng 60s có 1 bản ghi `notifications` và email gửi tới chủ video với link `/studio?videoId=<id>`.
- **AC-2** — *Given* máy chủ tắt ngay sau khi job xong nhưng email chưa kịp gửi. *When* máy chủ khởi động lại. *Then* email vẫn được gửi đúng 1 lần.
- **AC-3** — *Given* `notify` được gọi 2 lần với cùng `dedupe_key`. *Then* chỉ có 1 thông báo.
- **AC-4** — *Given* 25 sự kiện cho cùng người dùng trong 1 giờ. *Then* gửi email tối đa 20 tin riêng lẻ, phần còn lại gom thành 1 tin tóm tắt.
- **AC-5** — *Given* lúc 23:00, sự kiện `EXPORT_DONE`. *Then* delivery ở trạng thái `DEFERRED`, gửi lúc 07:00. *Given* `EXPORT_FAILED` cùng giờ. *Then* gửi ngay.
- **AC-6** — *Given* Telegram trả 403 "bot was blocked by the user". *Then* delivery `FAILED`, liên kết Telegram bị xoá, người dùng nhận thông báo trong ứng dụng "Kết nối Telegram đã ngắt".
- **AC-7** — *Given* webhook Telegram thiếu hoặc sai secret token header. *Then* trả 401 và không lưu gì.
- **AC-8** — *Given* link unsubscribe bị sửa token. *Then* trả 400 và không đổi preference.
- **AC-9** — *Given* SMTP trả lỗi tạm thời (421). *Then* `attempts` tăng và `next_attempt_at` = now + 1 phút, rồi 5 phút, 30 phút, 2 giờ; sau 4 lần thì `FAILED`.

## 8. Kế hoạch kiểm thử (TDD)
- `NotificationServiceTest.shouldSkipDuplicateDedupeKey`
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
- Gửi email thật thì dùng GreenMail hoặc MailHog trong Docker Compose (F14) để test tích hợp. Nếu dùng GreenMail thì cần xin duyệt thư viện test.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Email rơi vào thư rác | Người dùng không nhận | Dùng SMTP có SPF/DKIM (SendGrid, Amazon SES, Gmail Workspace), tên miền riêng |
| Zalo OA giới hạn tin tư vấn ngoài cửa sổ tương tác | Tin Zalo không tới | Ghi rõ trong UI; dài hạn chuyển sang ZNS (cần đăng ký template, có phí) |
| Token Zalo hết hạn | Ngừng gửi Zalo | Job làm mới tự động + cảnh báo admin khi làm mới lỗi |
| Lộ bot token | Kẻ xấu gửi tin giả mạo | Chỉ để trong `.env`; có thể đổi token qua BotFather |
| Gửi quá nhiều khi một loạt job lỗi | Spam | Dedupe + giới hạn mỗi giờ + gom tin |

## 10. Câu hỏi mở
- [ ] Nhóm có OA Zalo đã xác thực chưa? Nếu chưa, có làm Zalo ở bản này không, hay chỉ làm Email + Telegram trước?
- [ ] Dùng nhà cung cấp SMTP nào (SES, SendGrid, Gmail Workspace)? Gửi từ tên miền nào?
- [ ] Giờ yên tĩnh mặc định 22:00–07:00 có hợp lý không?
- [ ] Có cần gửi thông báo cho cả người được mời cộng tác (F36), hay chỉ chủ video?
