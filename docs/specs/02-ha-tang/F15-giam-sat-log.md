# F15 — Giám sát, log & đo chi phí AI

| Mục | Giá trị |
|---|---|
| **Mã** | F15 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (backend, Actuator), SV2 (đo token và chi phí trong Python), SV4 (trang chi phí cho Admin) |
| **Phụ thuộc** | F09 (gắn chi phí theo job), F13 (bảng mới), F14 (health check của container) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | **Có**: (1) `spring-boot-starter-actuator`: health và metrics, chính chủ Spring. (2) Tuỳ chọn `io.sentry:sentry-spring-boot-starter` và `@sentry/nextjs`: gom lỗi, có gói miễn phí 5.000 lỗi/tháng. Nếu Sentry không được duyệt thì vẫn đủ dùng với log JSON + Actuator. Không cần Prometheus/Grafana ở giai đoạn này. |
| **Tham khảo** | Spring Boot Actuator, Sentry, Langfuse/Helicone (theo dõi chi phí LLM), trang Usage của OpenAI |

## 1. Bối cảnh & vấn đề

- Không có endpoint health. Docker (F14) hay load balancer không biết backend còn sống hay đã treo.
- Log là văn bản tự do (`log.info("Đang chạy Whisper + Gemini ...")` ở [VideoController.java:422](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L422)), không có `requestId`, `userId`, `videoId`, `jobId`. Khi lỗi xảy ra với một người dùng cụ thể, không lọc được log của riêng họ.
- Thông báo lỗi nội bộ bị trả thẳng cho client: `"Lỗi server: " + e.getMessage()` ([VideoController.java:319](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L319)). Cách này có thể lộ đường dẫn hoặc câu SQL.
- Lỗi bị nuốt mất: `catch (Exception ignored) {}` xuất hiện ít nhất 6 lần trong [VideoController.java](../../../backend/src/main/java/com/autocut/controller/VideoController.java) (dòng [456](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L456), 839, 949, 1666, 1676, 1685). Điều này vi phạm CONSTRAINTS §2 (Strict Error Handling).
- **Không đo chi phí AI.** Hệ thống gọi nhiều nhà cung cấp:
  - Gemini: [gemini_transcriber.py:203](../../../backend/ai/gemini_transcriber.py#L203), [transcript_refiner.py:76](../../../backend/ai/transcript_refiner.py#L76) (có tự đổi model khi lỗi).
  - Groq Whisper: [groq_service.py:56](../../../backend/ai/groq_service.py#L56).
  - Chat: Groq, Gemini, OpenAI, Anthropic trong [frontend/src/app/api/chat/route.ts:92-288](../../../frontend/src/app/api/chat/route.ts#L92).
  Không ai biết một video 1 giờ tốn bao nhiêu tiền, ai dùng nhiều nhất, hay khi nào sắp vượt ngân sách.
- Không có cảnh báo: chỉ biết job lỗi khi người dùng phàn nàn.

## 2. Mục tiêu

- `/actuator/health` phản ánh đúng tình trạng DB, R2, ffmpeg, Python và hàng đợi job.
- Log JSON có cấu trúc, mỗi dòng có `requestId`, `userId`, `videoId`, `jobId` nếu có.
- Mọi lần gọi AI đều được ghi vào bảng `ai_usage` (nhà cung cấp, model, token, số giây audio, chi phí USD ước tính, gắn với user, video, job).
- Lỗi chưa xử lý được gom về một nơi (Sentry nếu được duyệt, nếu không thì log ERROR + bảng `jobs.error_*`).
- Có cảnh báo cơ bản: tỉ lệ job lỗi cao, chi phí trong ngày vượt ngưỡng.

### Ngoài phạm vi

- Dashboard Grafana và tracing phân tán (OpenTelemetry).
- Trang thống kê cho người dùng cuối (F46 sẽ dùng dữ liệu từ đây).

## 3. User stories

- Là trưởng nhóm, tôi muốn biết chi phí AI hôm nay, tuần này, theo từng người dùng và từng video.
- Là người trực sự cố, tôi muốn nhập một `requestId` từ ảnh chụp lỗi của người dùng và xem toàn bộ log liên quan.
- Là người vận hành, tôi muốn nhận email hoặc Telegram khi hơn 20% job lỗi trong 1 giờ.

## 4. Yêu cầu chức năng

### Health & metrics
- **FR-1** Bật Actuator: `/actuator/health` (public, chỉ trả `UP`/`DOWN`), `/actuator/health/details`, `/actuator/metrics`, `/actuator/flyway` (chỉ Admin, sau F01/F02).
- **FR-2** Các `HealthIndicator` tự viết: `r2` (`HeadBucket`), `ffmpeg` (`ffmpeg -version` chạy lúc khởi động và cache kết quả), `python` (`python -c "import faster_whisper, google.genai"` chạy lúc khởi động), `jobQueue` (`DOWN` nếu có job `QUEUED` chờ > 30 phút).
- **FR-3** Metrics tự định nghĩa (Micrometer, có sẵn trong Actuator): `autocut.jobs.duration{type,status}`, `autocut.jobs.queued{type}`, `autocut.ai.cost.usd{provider,model}`, `autocut.upload.bytes`.

### Log
- **FR-4** Log ra JSON ở profile `prod` (Spring Boot 3.4+ hỗ trợ sẵn `logging.structured.format.console=ecs`, không cần thư viện), log văn bản thường ở `dev`.
- **FR-5** Filter `RequestIdFilter`: đọc header `X-Request-Id` hoặc tự sinh UUID, đưa vào MDC cùng `userId`; trả lại header `X-Request-Id` trong response. `JobWorker` (F09) đưa `jobId` và `videoId` vào MDC khi chạy job.
- **FR-6** Exception handler chung (`@RestControllerAdvice GlobalExceptionHandler`) trả lỗi theo định dạng chuẩn trong README và **không bao giờ** trả `e.getMessage()` của lỗi không lường trước. Response kèm `requestId` để người dùng báo lại.
  ```json
  { "error": { "code": "INTERNAL_ERROR", "message": "Có lỗi xảy ra. Mã tra cứu: 7f3a-…", "requestId": "7f3a-…" } }
  ```
- **FR-7** Không ghi log dữ liệu nhạy cảm: mật khẩu, JWT, khoá API, nội dung transcript đầy đủ. Viết `LogSanitizer` để che các chuỗi có dạng khoá API.
- **FR-8** Thay mọi `catch (... ignored) {}` bằng log WARN có lý do (sửa trong các tệp đang đụng tới).

### Chi phí AI
- **FR-9** Python: mọi lần gọi AI đi qua một hàm chung `record_usage(provider, model, input_tokens, output_tokens, audio_seconds, latency_ms, success, error_code)`. Hàm này in một dòng `@@USAGE {...}` ra stdout (cùng cơ chế với `@@PROGRESS` của F10). Java đọc dòng này rồi ghi vào `ai_usage` với `job_id`, `video_id`, `owner_id`.
  - Gemini: lấy `response.usage_metadata.prompt_token_count` và `candidates_token_count`.
  - Groq Whisper: tính theo `audio_seconds` (độ dài tệp mp3).
- **FR-10** Next.js API route `chat`: sau mỗi lần gọi thì `POST /api/v1/internal/ai-usage` lên backend (xác thực bằng secret nội bộ). Khi F07 chuyển chat về backend thì ghi trực tiếp.
- **FR-11** Bảng giá đặt trong `config.yaml` → `ai_pricing` (USD trên 1 triệu token, USD trên 1 phút audio), có ngày hiệu lực. Chi phí được tính lúc ghi và lưu lại, nên đổi bảng giá không làm thay đổi số liệu cũ.
- **FR-12** API cho Admin:
  - `GET /api/v1/admin/ai-usage/summary?from=&to=&groupBy=day|user|provider|model`
  - `GET /api/v1/admin/ai-usage?videoId=&userId=&page=`
- **FR-13** Ngân sách: `autocut.ai.daily-budget-usd` (mặc định 5). Đạt 80% thì gửi cảnh báo; đạt 100% thì **chặn** tạo job AI mới (trả 503 `AI_BUDGET_EXCEEDED`), Admin bỏ chặn được.

### Cảnh báo
- **FR-14** `AlertService` (`@Scheduled` mỗi 5 phút) kiểm: tỉ lệ job FAILED trong 1 giờ > 20%, health `DOWN` > 5 phút, chi phí trong ngày ≥ 80% ngân sách. Gửi qua kênh của F48; trước khi có F48 thì chỉ log ERROR. Chống spam: mỗi loại cảnh báo gửi tối đa 1 lần mỗi giờ.

## 5. Yêu cầu phi chức năng

- Ghi `ai_usage` không được làm chậm job: ghi lỗi thì chỉ log WARN, không làm hỏng job.
- Overhead của filter log ≤ 1 ms mỗi request.
- Log giữ 14 ngày (do Docker log driver hoặc nền tảng hosting đảm nhiệm).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V7__ai_usage.sql`:

```sql
CREATE TABLE ai_usage (
    id             BIGSERIAL PRIMARY KEY,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    owner_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    video_id       BIGINT REFERENCES videos(id) ON DELETE SET NULL,
    job_id         UUID   REFERENCES jobs(id) ON DELETE SET NULL,
    feature        VARCHAR(30) NOT NULL,     -- TRANSCRIBE | REFINE | SEGMENT | CHAT | TITLE | ...
    provider       VARCHAR(20) NOT NULL,     -- gemini | groq | openai | anthropic
    model          VARCHAR(60) NOT NULL,
    input_tokens   INTEGER,
    output_tokens  INTEGER,
    audio_seconds  NUMERIC(10,2),
    latency_ms     INTEGER,
    success        BOOLEAN NOT NULL,
    error_code     VARCHAR(50),
    cost_usd       NUMERIC(12,6) NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_usage_time  ON ai_usage(occurred_at);
CREATE INDEX idx_ai_usage_owner ON ai_usage(owner_id, occurred_at);
CREATE INDEX idx_ai_usage_video ON ai_usage(video_id);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/actuator/health` | Public | `{"status":"UP"}` |
| GET | `/actuator/health/details`, `/actuator/metrics/**` | Admin | Chi tiết |
| GET | `/api/v1/admin/ai-usage/summary` | Admin | Tổng hợp |
| GET | `/api/v1/admin/ai-usage` | Admin | Danh sách chi tiết |
| POST | `/api/v1/internal/ai-usage` | Secret nội bộ (header `X-Internal-Token`) | Next.js gửi số liệu lên |

Ví dụ `summary?groupBy=provider`:

```json
{ "from": "2026-11-01", "to": "2026-11-17", "totalUsd": 12.84,
  "rows": [ { "key": "gemini", "calls": 412, "inputTokens": 3100000, "outputTokens": 420000, "costUsd": 9.10 },
            { "key": "groq",   "calls": 37,  "audioSeconds": 81000, "costUsd": 3.74 } ] }
```

### 6.3 Backend

- Tạo `com.autocut.observability.RequestIdFilter`, `GlobalExceptionHandler`, `LogSanitizer`, các `HealthIndicator` (`R2HealthIndicator`, `FfmpegHealthIndicator`, `PythonHealthIndicator`, `JobQueueHealthIndicator`).
- Tạo `com.autocut.aiusage.AiUsageEntity`, `AiUsageRepository`, `AiPricing` (đọc từ `config.yaml` qua `ConfigService`), `AiUsageService.record(...)`, `AiBudgetGuard` (gọi trước `jobService.enqueue` cho các job AI), `AiUsageAdminController`.
- `PythonRunner` (F10): nhận diện dòng `@@USAGE` và gọi `AiUsageService.record`.
- `AlertService`.
- `application-prod.properties`: `logging.structured.format.console=ecs`, `management.endpoints.web.exposure.include=health,metrics,flyway`.

### 6.4 AI pipeline (Python)

- Tạo `backend/ai/usage.py` với hàm `record_usage(...)` và context manager `track(provider, model, feature)` đo `latency_ms`.
- Bọc các chỗ gọi: `gemini_transcriber.py:203`, `transcript_refiner.py:76` (ghi **mỗi lần thử**, kể cả model dự phòng và lần lỗi), `groq_service.py:56`.

### 6.5 Frontend

- Trang `frontend/src/app/admin/usage/page.tsx` (chỉ Admin): bảng chi phí theo ngày, theo người dùng, theo nhà cung cấp; ô hiển thị "Hôm nay: $1,24 / $5,00".
- `src/lib/api.ts`: khi nhận lỗi thì hiện "Mã tra cứu: …" lấy từ `error.requestId` để người dùng chụp màn hình gửi lại.
- (Tuỳ chọn, nếu Sentry được duyệt) `@sentry/nextjs` gom lỗi phía client.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* tắt container Postgres, *When* gọi `/actuator/health`, *Then* trả 503 với `DOWN` trong ≤ 10 giây.
- **AC-2** — *Given* profile `prod`, *When* gọi bất kỳ API nào, *Then* mỗi dòng log là JSON hợp lệ, có `requestId`; response có header `X-Request-Id` trùng giá trị đó.
- **AC-3** — *Given* một lỗi `NullPointerException` trong controller, *When* client nhận phản hồi, *Then* body không chứa tên lớp Java, đường dẫn hay stack trace, chỉ có `INTERNAL_ERROR` + `requestId`.
- **AC-4** — *Given* xử lý xong 1 video 10 phút, *When* xem `ai_usage`, *Then* có ≥ 1 dòng cho TRANSCRIBE và ≥ 1 dòng cho REFINE/SEGMENT, có `video_id` và `job_id`, `cost_usd > 0`.
- **AC-5** — *Given* tổng chi phí `ai_usage` của một video, *When* so với trang Usage của Google AI Studio cho cùng khoảng thời gian, *Then* lệch ≤ 10%.
- **AC-6** — *Given* `daily-budget-usd=0.01` và đã tiêu $0.02, *When* tạo job ANALYZE, *Then* nhận 503 `AI_BUDGET_EXCEEDED` với thông báo tiếng Việt.
- **AC-7** — Grep `catch (Exception ignored)` và `catch (IOException ignored)` trong các tệp mà PR này sửa không còn kết quả.
- **AC-8** — Log không chứa chuỗi bắt đầu bằng `AIza`, `gsk_`, `sk-`, `sk-ant-` (kiểm bằng test của `LogSanitizer` và grep log trong smoke test).

## 8. Kế hoạch kiểm thử (TDD)

- `GlobalExceptionHandlerTest.unexpectedException_hidesMessage_returnsRequestId`
- `RequestIdFilterTest.reusesIncomingHeader_orGeneratesNew`
- `LogSanitizerTest.masksGeminiGroqOpenAiAnthropicKeys`
- `AiPricingTest.computesCost_tokensAndAudio`
- `AiPricingTest.unknownModel_costZero_andWarns`
- `AiUsageServiceTest.recordFailure_doesNotThrow`
- `AiBudgetGuardTest.overBudget_blocksAiJobs_butNotCutJobs`
- `PythonRunnerTest.parsesUsageLine_andRecords`
- `JobQueueHealthIndicatorTest.oldQueuedJob_reportsDown`
- Python: `tests/test_usage.py::test_track_records_latency_and_tokens` và `::test_failed_call_records_success_false`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bảng giá AI thay đổi | Chi phí ước tính sai | Bảng giá có ngày hiệu lực; AC-5 đối soát hằng tháng |
| Health check gọi R2 quá dày | Tốn request và chậm | Cache kết quả 30 giây |
| Next.js gửi số liệu lên backend thất bại | Thiếu dữ liệu chi phí chat | Chấp nhận ở bản này; F07 chuyển chat về backend sẽ xử lý triệt để |
| Chặn ngân sách đúng lúc lớp học đang dùng | Gián đoạn | Cảnh báo ở 80%; Admin bỏ chặn được bằng 1 nút |

## 10. Câu hỏi mở

- [ ] Duyệt Actuator? Duyệt Sentry (dữ liệu lỗi gửi ra dịch vụ bên ngoài)?
- [ ] Ngân sách AI mỗi ngày bao nhiêu? Ngân sách theo từng người dùng hay chung toàn hệ thống?
- [ ] Gửi cảnh báo tới ai và qua kênh nào trước khi F48 xong?
