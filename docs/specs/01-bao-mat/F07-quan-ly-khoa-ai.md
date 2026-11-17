# F07 — Quản lý khoá API AI phía máy chủ

| Mục | Giá trị |
|---|---|
| **Mã** | F07 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend) · SV2 (đường gọi AI từ Python) · SV4 (giao diện chat, trang cài đặt) |
| **Phụ thuộc** | F01, F02 |
| **Ước lượng** | M (4–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Mã hoá AES-256-GCM bằng `javax.crypto` có sẵn trong JDK; gọi HTTP bằng `java.net.http.HttpClient` |
| **Tham khảo** | Vercel/Netlify Environment Variables, OpenAI "Project API keys", tính năng "Bring your own key" của Cursor |

## 1. Bối cảnh & vấn đề
- [frontend/src/app/api/chat/route.ts:13,26](../../../frontend/src/app/api/chat/route.ts#L13) nhận `apiKey` từ body request và ưu tiên dùng nó (`customKey || process.env...`, các dòng 69, 135, 215, 274). Như vậy khoá người dùng **đi qua trình duyệt** và log mạng.
- Các dòng 72 và 138 fallback sang `process.env.NEXT_PUBLIC_WHISPER_API_KEY` và `NEXT_PUBLIC_GEMINI_API_KEY`. Biến có tiền tố `NEXT_PUBLIC_` được Next.js **đóng gói vào JS gửi cho trình duyệt**, nên nếu từng đặt thì khoá đã lộ cho mọi người truy cập.
- `/api/chat` và [`/api/groq`](../../../frontend/src/app/api/groq/route.ts) **không yêu cầu đăng nhập**. Bất kỳ ai cũng dùng được khoá Groq, Gemini, OpenAI, Anthropic của hệ thống.
- Backend đọc `LLM_API_KEY` và `WHISPER_API_KEY` từ `.env` ([ConfigService.java:102-107](../../../backend/src/main/java/com/autocut/service/ConfigService.java#L102-L107)). Khoá nằm rải rác ở hai nơi (Next.js và Spring), mỗi nơi một kiểu đặt tên.

## 2. Mục tiêu
- **Mọi lời gọi AI đi qua backend Spring** (có JWT, phân quyền và rate limit F06). Trình duyệt không bao giờ thấy khoá.
- Admin nhập khoá cho từng nhà cung cấp trên giao diện. Khoá được **mã hoá khi lưu DB** (AES-GCM) bằng `AUTOCUT_MASTER_KEY` đặt trong `.env`.
- Thứ tự ưu tiên khi chọn khoá: khoá trong DB, nếu không có thì biến môi trường server.
- Xoá hẳn tham số `apiKey` khỏi body và mọi biến `NEXT_PUBLIC_*_API_KEY`.

### Ngoài phạm vi
- Mỗi tổ chức một bộ khoá riêng (thêm cột `org_id` ở F49).
- Đo chi phí theo token (xem F15).
- Định tuyến thông minh giữa các model.

## 3. User stories
- Là Admin, tôi nhập khoá Gemini một lần trên trang Cài đặt, thấy khoá hiển thị dạng `AIza…k9Qx`, và bấm "Kiểm tra" để biết khoá còn dùng được.
- Là giảng viên, tôi chọn model trong chatbox mà không bao giờ phải dán khoá.
- Là người vận hành, tôi xoay khoá (đổi khoá mới) mà không cần build lại frontend.

## 4. Yêu cầu chức năng
- **FR-1** Bảng `ai_provider_keys` lưu khoá đã mã hoá theo `provider ∈ {groq, gemini, openai, anthropic}`, mỗi provider tối đa 1 khoá đang hoạt động.
- **FR-2** API chỉ trả khoá ở dạng **che**: 4 ký tự đầu + `…` + 4 ký tự cuối. Không có API nào trả khoá gốc.
- **FR-3** `POST /api/v1/admin/ai-keys/{provider}/test` gửi một request rẻ nhất (list models hoặc hoàn thành 1 token) để kiểm tra khoá và trả `ok` hoặc `error`.
- **FR-4** Tạo `POST /api/v1/ai/chat` trên Spring để thay `/api/chat` của Next.js, giữ nguyên định dạng `ChatRequestBody` (trừ `apiKey`) để frontend đổi ít nhất. Yêu cầu quyền View trên video nếu có `videoId` trong `videoContext`.
- **FR-5** `/api/groq` (bóc băng thử) chuyển sang backend hoặc xoá nếu không còn dùng (SV4 xác nhận).
- **FR-6** Python AI (`backend/ai/*.py`) nhận khoá qua **biến môi trường của tiến trình con** do Spring đặt khi gọi `ProcessBuilder` (`pb.environment().put(...)`), không qua tham số dòng lệnh (vì `ps` sẽ thấy).
- **FR-7** Khi khởi động, nếu thấy biến môi trường nào bắt đầu bằng `NEXT_PUBLIC_` và chứa `KEY` thì log cảnh báo.
- **FR-8** Thiếu `AUTOCUT_MASTER_KEY` (32 byte, base64) thì không cho lưu khoá vào DB, nhưng vẫn chạy bằng khoá trong biến môi trường.

## 5. Yêu cầu phi chức năng
- Mã hoá AES-256-GCM với IV 12 byte ngẫu nhiên mỗi lần ghi. Lưu `iv || ciphertext || tag` dạng base64.
- Khoá giải mã chỉ được cache trong bộ nhớ tối đa 5 phút.
- Log không bao giờ in khoá. Thông báo lỗi từ nhà cung cấp phải được lọc bỏ khoá trước khi trả về client.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V5__ai_provider_keys.sql`:
```sql
CREATE TABLE IF NOT EXISTS ai_provider_keys (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(20) NOT NULL UNIQUE CHECK (provider IN ('groq','gemini','openai','anthropic')),
    encrypted_key TEXT NOT NULL,
    key_hint VARCHAR(20) NOT NULL,         -- "AIza…k9Qx"
    default_model VARCHAR(100),
    last_tested_at TIMESTAMPTZ,
    last_test_ok BOOLEAN,
    updated_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/admin/ai-keys` | ADMIN | Danh sách provider + gợi ý khoá + trạng thái |
| PUT | `/api/v1/admin/ai-keys/{provider}` | ADMIN | `{ "apiKey": "...", "defaultModel": "gemini-3.5-flash" }` |
| DELETE | `/api/v1/admin/ai-keys/{provider}` | ADMIN | Xoá khoá trong DB, quay về dùng biến môi trường |
| POST | `/api/v1/admin/ai-keys/{provider}/test` | ADMIN | Kiểm tra khoá |
| GET | `/api/v1/ai/providers` | Đã đăng nhập | `[{ "provider":"gemini", "available":true }]` để hiển thị lựa chọn model |
| POST | `/api/v1/ai/chat` | Đã đăng nhập | Thay `/api/chat` |

```json
// GET /api/v1/admin/ai-keys → 200
[ { "provider": "gemini", "source": "DATABASE", "keyHint": "AIza…k9Qx", "defaultModel": "gemini-3.5-flash", "lastTestOk": true },
  { "provider": "openai", "source": "ENV", "keyHint": "sk-p…3fA1", "defaultModel": null, "lastTestOk": null },
  { "provider": "anthropic", "source": "NONE" } ]
```
Lỗi: `PROVIDER_NOT_CONFIGURED` (400), `PROVIDER_ERROR` (502, message đã lọc khoá), `MASTER_KEY_MISSING` (500).

### 6.3 Backend
Tạo mới trong `com.autocut.ai`:
- `SecretCipher`: `encrypt(String)`, `decrypt(String)` dùng AES/GCM/NoPadding.
- `AiProviderKeyEntity`, `AiProviderKeyRepository`.
- `AiKeyService`: `resolveKey(provider) → Optional<String>` (DB trước, sau đó env), `maskedList()`, `save`, `test`.
- `AiChatService`: chuyển logic từ `route.ts` sang Java, gồm system prompt, ghép `videoContext` và gọi 4 provider bằng `HttpClient`.
- `AiAdminController`, `AiChatController`.

Sửa:
- `VideoController` tại các chỗ gọi `ProcessBuilder` ([VideoController.java:424](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L424), [:805](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L805)): thêm `pb.environment().put("GEMINI_API_KEY", ...)` và các khoá tương tự, lấy từ `AiKeyService`.
- `.env.example`: thêm `AUTOCUT_MASTER_KEY=` kèm hướng dẫn sinh khoá `openssl rand -base64 32`.

### 6.4 AI pipeline (Python)
- `gemini_transcriber.py` và `groq_service.py` chỉ đọc khoá bằng `os.environ[...]`. Xoá mọi fallback đọc khoá từ tệp hay tham số CLI nếu có.

### 6.5 Frontend
- [AiAssistantChatPanel.tsx:148](../../../frontend/src/components/AiAssistantChatPanel.tsx#L148): đổi `fetch("/api/chat")` thành `apiFetch("/api/v1/ai/chat")`. Danh sách model lấy từ `/ai/providers`; model chưa cấu hình thì xám đi.
- Xoá `frontend/src/app/api/chat/route.ts` và `api/groq/route.ts` sau khi chuyển xong (hoặc tạm để trả 410 Gone).
- Tạo trang `frontend/src/app/settings/ai/page.tsx` (chỉ ADMIN) gồm bảng provider, ô nhập khoá dạng password, nút Lưu, Kiểm tra và Xoá.
- Rà `.env.local` và tài liệu, xoá mọi `NEXT_PUBLIC_*_API_KEY`.

## 7. Tiêu chí chấp nhận
- **AC-1** — Chạy `npm run build` rồi `grep -rE "AIza|sk-|gsk_" frontend/.next/static` không có kết quả.
- **AC-2** — *When* gọi `POST /api/v1/ai/chat` không có JWT *Then* nhận 401.
- **AC-3** — *Given* Admin lưu khoá Gemini *When* `SELECT encrypted_key` *Then* giá trị không chứa khoá gốc; *When* `GET /admin/ai-keys` *Then* chỉ thấy `keyHint`.
- **AC-4** — *Given* khoá trong DB sai *When* bấm Kiểm tra *Then* nhận `lastTestOk=false` và message không chứa khoá.
- **AC-5** — *Given* gửi body có `"apiKey":"x"` *Then* máy chủ bỏ qua trường này và dùng khoá của hệ thống.
- **AC-6** — *Given* khoá trong DB và trong env khác nhau *Then* dùng khoá DB; xoá khoá DB thì quay về dùng env.
- **AC-7** — Trong lúc analyze chạy, `ps aux | grep cli.py` không thấy khoá trên dòng lệnh.

## 8. Kế hoạch kiểm thử (TDD)
- `SecretCipherTest`: `roundTrip`, `differentIvEachEncrypt`, `tamperedCiphertext_throws`, `wrongMasterKey_throws`.
- `AiKeyServiceTest`: `resolve_prefersDatabaseOverEnv`, `masked_showsFirst4Last4`, `missingMasterKey_saveThrows`.
- `AiChatServiceTest`: dùng `HttpServer` của JDK làm máy chủ giả cho từng provider; `providerError_messageIsScrubbed`.
- `AiChatControllerIT`: AC-2, AC-5.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Mất `AUTOCUT_MASTER_KEY` | Không giải mã được khoá trong DB | Ghi rõ trong tài liệu vận hành; chỉ cần nhập lại khoá AI, không mất dữ liệu khác |
| Chuyển chat sang Java làm lệch hành vi (prompt, stream) | Chatbox trả lời khác trước | Viết test so khớp system prompt; giữ nguyên định dạng response cũ |
| Khoá cũ đã lộ qua `NEXT_PUBLIC_` | Bị dùng trộm | **Xoay toàn bộ khoá** ngay khi deploy F07 |

## 10. Câu hỏi mở
- [ ] Chatbox có cần trả lời dạng stream (SSE) không? Hiện `route.ts` có stream không? (SV4 kiểm tra; nếu có thì Java phải dùng `SseEmitter`.)
- [ ] Có cho mỗi giảng viên dùng khoá riêng (BYOK) không? Đề xuất: không ở MVP.
- [ ] Giữ cả 4 provider hay chỉ 1–2 cho gọn?
