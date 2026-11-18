# F07 — Quản lý khoá API AI phía máy chủ

| Mục | Giá trị |
|---|---|
| **Mã** | F07 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend) · SV2 (đường gọi AI từ Python) · SV4 (giao diện chat, trang cài đặt) |
| **Phụ thuộc** | F01, F02 |
| **Bị phụ thuộc bởi** | F48 dùng lại bảng `provider_secrets` để lưu access/refresh token của Zalo OA; F15 đọc khoá qua `AiKeyService` |
| **Ước lượng** | M (4–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Mã hoá AES-256-GCM bằng `javax.crypto` có sẵn trong JDK; gọi HTTP bằng `java.net.http.HttpClient` |
| **Tham khảo** | Vercel/Netlify Environment Variables, OpenAI "Project API keys", tính năng "Bring your own key" của Cursor |

> **Cập nhật 18/11/2026:** Sửa nhận định về `NEXT_PUBLIC_*` cho chính xác (chỉ dùng trong route chạy trên máy chủ nên chưa bị đóng gói, nhưng vẫn phải đổi tên); liệt kê đủ 5 tệp Python đọc khoá và nguồn khoá trong `config.yaml`; chốt chat không stream; tên migration theo dấu thời gian. Khái quát bảng khoá thành bảng chung `provider_secrets` (dùng chung với F48), bỏ CHECK cứng 4 provider.

## 1. Bối cảnh & vấn đề
- [frontend/src/app/api/chat/route.ts:13,26](../../../frontend/src/app/api/chat/route.ts#L13) nhận `apiKey` từ body request và ưu tiên dùng nó (`customKey || process.env...`, các dòng 69, 135, 215, 274). Như vậy khoá người dùng **đi qua trình duyệt** và log mạng.
- Các dòng 72 và 138 fallback sang `process.env.NEXT_PUBLIC_WHISPER_API_KEY` và `NEXT_PUBLIC_GEMINI_API_KEY`. Hiện hai biến này **chỉ được đọc trong route handler chạy trên máy chủ** (`route.ts`), nên Next.js **chưa** đóng gói chúng vào JS gửi xuống trình duyệt. Nhưng tiền tố `NEXT_PUBLIC_` có nghĩa là "được phép đưa xuống trình duyệt": chỉ cần một component phía client đọc biến này là giá trị bị nhúng thẳng vào bundle lúc build. Vì vậy phải bỏ tiền tố này cho mọi khoá bí mật. Khoá vẫn có thể đã lộ theo đường khác (mục dưới).
- `/api/chat` và [`/api/groq`](../../../frontend/src/app/api/groq/route.ts) **không yêu cầu đăng nhập**. Bất kỳ ai cũng dùng được khoá Groq, Gemini, OpenAI, Anthropic của hệ thống.
- Backend đọc `LLM_API_KEY` và `WHISPER_API_KEY` từ `.env` ([ConfigService.java:102-107](../../../backend/src/main/java/com/autocut/service/ConfigService.java#L102-L107)). Khoá nằm rải rác ở hai nơi (Next.js và Spring), mỗi nơi một kiểu đặt tên.
- Python AI đọc khoá từ **ba nguồn** khác nhau:
  - [config_loader.py:11](../../../backend/ai/config_loader.py#L11) gọi `load_dotenv()` để nạp `.env`; dòng 61-63 lấy `WHISPER_API_KEY`, nếu không có thì lấy `transcript.api_key` trong **`config.yaml`** (tệp được commit lên git); dòng 73-75 lấy `GEMINI_API_KEY` hoặc `LLM_API_KEY`.
  - [groq_service.py:127-130](../../../backend/ai/groq_service.py#L127-L130) và [whisper_service.py:192-194](../../../backend/ai/whisper_service.py#L192-L194) đọc `WHISPER_API_KEY` trực tiếp từ môi trường hoặc qua `default_ai_config`.
  - [gemini_transcriber.py:105](../../../backend/ai/gemini_transcriber.py#L105) và [transcript_refiner.py:59](../../../backend/ai/transcript_refiner.py#L59) nhận `api_key` qua tham số, nếu không có thì lấy `default_ai_config.gemini_api_key`.
- Lỗ đọc tệp tuỳ ý (F04) và CORS mở (F05) cho phép đọc được `.env` của máy chủ. Vì vậy cần **xoay toàn bộ khoá** khi deploy F04 và F07.

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
- **FR-1** Bảng **chung** `provider_secrets` lưu mọi bí mật của bên thứ ba ở dạng mã hoá, khoá duy nhất là `(provider, secret_name)`. F07 dùng cho khoá AI với `secret_name = 'api_key'`; F48 dùng cho Zalo OA (`provider='zalo_oa'`, `secret_name ∈ {'access_token','refresh_token'}`). Cột `provider` là chuỗi tự do; danh sách provider hợp lệ **kiểm tra ở tầng service** (F07: `{groq, gemini, openai, anthropic}`), không dùng CHECK trong DB, để F48 và các spec sau thêm provider mà không cần migration.
- **FR-2** API chỉ trả khoá ở dạng **che**: 4 ký tự đầu + `…` + 4 ký tự cuối. Không có API nào trả khoá gốc.
- **FR-3** `POST /api/v1/admin/ai-keys/{provider}/test` gửi một request rẻ nhất (list models hoặc hoàn thành 1 token) để kiểm tra khoá và trả `ok` hoặc `error`.
- **FR-4** Tạo `POST /api/v1/ai/chat` trên Spring để thay `/api/chat` của Next.js, giữ nguyên định dạng `ChatRequestBody` (trừ `apiKey`) để frontend đổi ít nhất. Yêu cầu quyền View trên video nếu có `videoId` trong `videoContext`.
- **FR-5** `/api/groq` (bóc băng thử) chuyển sang backend hoặc xoá nếu không còn dùng (SV4 xác nhận).
- **FR-6** Python AI (`backend/ai/*.py`) nhận khoá qua **biến môi trường của tiến trình con** do Spring đặt khi gọi `ProcessBuilder` (`pb.environment().put(...)`), không qua tham số dòng lệnh (vì `ps` sẽ thấy). Giữ tên biến hiện có để sửa ít nhất: provider `gemini` → `GEMINI_API_KEY`; provider `groq` → `WHISPER_API_KEY` (Python đang dùng tên này cho Groq).
  - Biến do Spring đặt phải **thắng** giá trị trong `.env`: đổi `load_dotenv()` thành `load_dotenv(override=False)` (đây cũng là mặc định của python-dotenv, nhưng ghi rõ để không ai đổi nhầm). Giữ `load_dotenv` để dev vẫn chạy được `python -m backend.ai.cli` độc lập.
  - **Bỏ** việc đọc `transcript.api_key` từ `config.yaml` ([config_loader.py:63](../../../backend/ai/config_loader.py#L63)): `config.yaml` được commit lên git nên không được chứa khoá. Có giá trị ở đó thì log cảnh báo và bỏ qua.
- **FR-7** Khi khởi động, nếu thấy biến môi trường nào bắt đầu bằng `NEXT_PUBLIC_` và chứa `KEY` thì log cảnh báo.
- **FR-8** Thiếu `AUTOCUT_MASTER_KEY` (32 byte, base64) thì không cho lưu khoá vào DB, nhưng vẫn chạy bằng khoá trong biến môi trường.

## 5. Yêu cầu phi chức năng
- Mã hoá AES-256-GCM với IV 12 byte ngẫu nhiên mỗi lần ghi. Lưu `iv || ciphertext || tag` dạng base64.
- Khoá giải mã chỉ được cache trong bộ nhớ tối đa 5 phút.
- Log không bao giờ in khoá. Thông báo lỗi từ nhà cung cấp phải được lọc bỏ khoá trước khi trả về client.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__provider_secrets.sql`:
```sql
CREATE TABLE IF NOT EXISTS provider_secrets (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,          -- groq | gemini | openai | anthropic | zalo_oa | … (kiểm ở service)
    secret_name VARCHAR(50) NOT NULL,       -- F07: 'api_key'; F48: 'access_token' | 'refresh_token'
    encrypted_value TEXT NOT NULL,          -- base64(iv || ciphertext || tag), AES-256-GCM
    key_hint VARCHAR(20) NOT NULL,          -- "AIza…k9Qx"
    metadata JSONB,                         -- F07: { "defaultModel": "gemini-3.5-flash" }; F48: { "expiresAt": "…" }
    last_tested_at TIMESTAMPTZ,
    last_test_ok BOOLEAN,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_secret UNIQUE (provider, secret_name)
);
```
Ghi khoá bằng `INSERT … ON CONFLICT (provider, secret_name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, key_hint = EXCLUDED.key_hint, metadata = EXCLUDED.metadata, updated_by = EXCLUDED.updated_by, updated_at = NOW()` (AD-8). Như vậy F48 làm mới token Zalo không bị lỗi trùng khi hai luồng cùng ghi.

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
- `com.autocut.secret.ProviderSecretEntity`, `ProviderSecretRepository` (có hàm `upsert` dùng câu SQL ở 6.1).
- `com.autocut.secret.SecretStore` (dùng chung cho F07 và F48): `Optional<String> get(provider, secretName)`, `put(provider, secretName, plainValue, Map metadata, userId)`, `delete(provider, secretName)`, `List<MaskedSecret> list(provider…)`. Mã hoá và giải mã bằng `SecretCipher`; cache giá trị đã giải mã tối đa 5 phút.
- `AiKeyService`: kiểm tra `provider ∈ {groq, gemini, openai, anthropic}` (ngoài danh sách thì 400 `PROVIDER_NOT_SUPPORTED`), rồi gọi `SecretStore` với `secret_name='api_key'`. Có các hàm `resolveKey(provider) → Optional<String>` (DB trước, sau đó env), `maskedList()`, `save`, `test`. `defaultModel` lưu trong `metadata`.
- `AiChatService`: chuyển logic từ `route.ts` sang Java, gồm system prompt, ghép `videoContext` và gọi 4 provider bằng `HttpClient`. Sau mỗi lần gọi, ghi số token qua `AiUsageService.record(feature=CHAT, provider, model, inputTokens, outputTokens, userId)` của F15 (phụ thuộc mềm: chưa có F15 thì bỏ qua).
- `AiAdminController`, `AiChatController`.

Sửa:
- `VideoController` tại các chỗ gọi `ProcessBuilder` ([VideoController.java:424](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L424), [:805](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L805)) (sau F10 là worker job analyze): thêm `pb.environment().put("GEMINI_API_KEY", …)` và `put("WHISPER_API_KEY", …)`, lấy từ `AiKeyService`. Gom vào một hàm `PythonEnv.apply(pb, aiKeyService)` để mọi chỗ gọi Python dùng chung.
- `.env.example`: thêm `AUTOCUT_MASTER_KEY=` kèm hướng dẫn sinh khoá `openssl rand -base64 32`.

### 6.4 AI pipeline (Python)
Các tệp phải sửa (đã rà toàn bộ `backend/ai/`):

| Tệp | Hiện tại | Sửa |
|---|---|---|
| `config_loader.py` | `load_dotenv()`; khoá lấy từ env hoặc `config.yaml` | `load_dotenv(override=False)`; bỏ nhánh `transcript_cfg.get("api_key")`, cảnh báo nếu có |
| `groq_service.py` | Tham số `api_key`, sau đó `WHISPER_API_KEY`, sau đó `default_ai_config` | Giữ thứ tự, chỉ còn nguồn env (qua `default_ai_config`) |
| `whisper_service.py` | `default_ai_config.whisper_api_key` hoặc `WHISPER_API_KEY` | Không đổi logic; chỉ kiểm tra không còn nguồn khác |
| `gemini_transcriber.py` | Tham số hoặc `default_ai_config.gemini_api_key` | Không đổi logic |
| `transcript_refiner.py` | Tham số hoặc `default_ai_config.gemini_api_key` | Không đổi logic |
| `cli.py` | Không đọc khoá trực tiếp | Không được thêm tham số `--api-key` |

Thông báo lỗi Python (ví dụ `ValueError("Không tìm thấy GEMINI_API_KEY…")`) không được in giá trị khoá.

### 6.5 Frontend
- [AiAssistantChatPanel.tsx:148](../../../frontend/src/components/AiAssistantChatPanel.tsx#L148): đổi `fetch("/api/chat")` thành `apiFetch("/api/v1/ai/chat")`. Danh sách model lấy từ `/ai/providers`; model chưa cấu hình thì xám đi.
- Xoá `frontend/src/app/api/chat/route.ts` và `api/groq/route.ts` sau khi chuyển xong (hoặc tạm để trả 410 Gone).
- Tạo trang `frontend/src/app/settings/ai/page.tsx` (chỉ ADMIN) gồm bảng provider, ô nhập khoá dạng password, nút Lưu, Kiểm tra và Xoá.
- Rà `.env.local` và tài liệu, xoá mọi `NEXT_PUBLIC_*_API_KEY`.

## 7. Tiêu chí chấp nhận
- **AC-1** — Chạy `npm run build` rồi `grep -rE "AIza|sk-|gsk_" frontend/.next/static` không có kết quả.
- **AC-2** — *When* gọi `POST /api/v1/ai/chat` không có JWT *Then* nhận 401.
- **AC-3** — *Given* Admin lưu khoá Gemini *When* `SELECT encrypted_value FROM provider_secrets WHERE provider='gemini' AND secret_name='api_key'` *Then* giá trị không chứa khoá gốc; *When* `GET /admin/ai-keys` *Then* chỉ thấy `keyHint`.
- **AC-4** — *Given* khoá trong DB sai *When* bấm Kiểm tra *Then* nhận `lastTestOk=false` và message không chứa khoá.
- **AC-5** — *Given* gửi body có `"apiKey":"x"` *Then* máy chủ bỏ qua trường này và dùng khoá của hệ thống.
- **AC-6** — *Given* khoá trong DB và trong env khác nhau *Then* dùng khoá DB; xoá khoá DB thì quay về dùng env.
- **AC-7** — Trong lúc analyze chạy, `ps aux | grep cli.py` không thấy khoá trên dòng lệnh.
- **AC-8** — *Given* `.env` có `GEMINI_API_KEY=A` và Admin lưu khoá `B` trong DB *When* chạy analyze *Then* Python dùng khoá `B` (kiểm bằng máy chủ giả ghi lại header).
- **AC-9** — *Given* `config.yaml` có `transcript.api_key` *When* chạy Python *Then* giá trị này không được dùng và log có cảnh báo.

## 8. Kế hoạch kiểm thử (TDD)
- `SecretCipherTest`: `roundTrip`, `differentIvEachEncrypt`, `tamperedCiphertext_throws`, `wrongMasterKey_throws`.
- `AiKeyServiceTest`: `resolve_prefersDatabaseOverEnv`, `masked_showsFirst4Last4`, `missingMasterKey_saveThrows`, `unsupportedProvider_throws`.
- `SecretStoreIT` (Postgres theo AD-7): `put_twice_sameProviderAndName_updatesSingleRow`, `differentSecretNames_coexist` (ví dụ `zalo_oa/access_token` và `zalo_oa/refresh_token`), `concurrentPut_noUniqueViolation`.
- `AiChatServiceTest`: dùng `HttpServer` của JDK làm máy chủ giả cho từng provider; `providerError_messageIsScrubbed`.
- `AiChatControllerIT`: AC-2, AC-5.
- `PythonEnvTest`: `apply_putsKeysFromAiKeyService`, `apply_doesNotPutKeysOnCommandLine`.
- `tests/test_config_loader.py` (pytest): `env_overrides_dotenv`, `config_yaml_api_key_ignored_with_warning` (AC-8, AC-9).

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Mất `AUTOCUT_MASTER_KEY` | Không giải mã được khoá trong DB | Ghi rõ trong tài liệu vận hành; chỉ cần nhập lại khoá AI, không mất dữ liệu khác |
| Chuyển chat sang Java làm lệch hành vi (prompt, stream) | Chatbox trả lời khác trước | Viết test so khớp system prompt; giữ nguyên định dạng response cũ |
| Khoá cũ có thể đã lộ qua lỗ đọc tệp (F04) hoặc `config.yaml` | Bị dùng trộm | **Xoay toàn bộ khoá** ngay khi deploy F04 và F07; kiểm tra lịch sử git của `config.yaml` có từng chứa khoá không |

## 10. Câu hỏi mở
- [x] Chatbox có stream không: đã kiểm, `route.ts` hiện **không** stream (trả `NextResponse.json`). Java trả JSON thường; stream để sau nếu cần.
- [ ] Có cho mỗi giảng viên dùng khoá riêng (BYOK) không? Đề xuất: không ở MVP.
- [ ] Giữ cả 4 provider hay chỉ 1–2 cho gọn?
