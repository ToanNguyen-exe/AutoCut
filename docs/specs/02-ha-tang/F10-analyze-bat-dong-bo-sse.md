# F10 — Analyze bất đồng bộ + tiến độ thời gian thực

| Mục | Giá trị |
|---|---|
| **Mã** | F10 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (backend), SV2 (Python phát tiến độ), SV4 (frontend) |
| **Phụ thuộc** | F09 (hàng đợi job), F00 (analyze ghi topic vào DB theo F00 FR-4), F01 (vé ngắn hạn AD-4), F02 (quyền AD-1) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Dùng `SseEmitter` có sẵn trong Spring MVC và `EventSource` có sẵn trong trình duyệt. |
| **Tham khảo** | Descript ("Transcribing… 43%"), Opus Clip, YouTube Studio (thanh "Đang xử lý" khi upload) |

> **Cập nhật 18/11/2026:** Xác thực SSE chỉ dùng vé `SSE` theo AD-4 (bỏ phương án JWT trong cookie); frontend tự lấy vé mới khi kết nối lại; quyền theo AD-1/AD-2; job ANALYZE upsert kết quả vào DB theo F00; tên migration theo quy ước dấu thời gian.

## 1. Bối cảnh & vấn đề

- `POST /api/video/upload-sample` ([VideoController.java:164](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L164)) vừa nhận tệp vừa gọi Whisper + Gemini **đồng bộ** qua `generateTranscriptForUploadedVideo(...)` ([:245](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L245)). Hàm này chạy `ProcessBuilder` rồi `process.waitFor(30, TimeUnit.MINUTES)` ([:424-440](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L424)). Request HTTP bị treo tới 30 phút. Trình duyệt, proxy (Nginx, Cloudflare thường cắt sau 100 giây) hoặc người dùng đóng tab sẽ làm mất kết quả.
- `POST /api/video/analyze` ([:713](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L713)) cũng chạy Python đồng bộ với `waitFor(10, TimeUnit.MINUTES)` ([:821](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L821)).
- `process.getInputStream().readAllBytes()` ([:438](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L438), [:819](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L819)) chỉ đọc log **sau khi** tiến trình kết thúc, nên không thể có tiến độ thật.
- Frontend đang **giả lập** thanh tiến độ bằng số ngẫu nhiên: `tickerP = Math.min(85, tickerP + Math.floor(Math.random() * 8) + 4)` ([page.tsx:1061-1063](../../../frontend/src/app/page.tsx#L1061)) và `currentP + Math.floor(Math.random() * 8) + 3` ([page.tsx:729-731](../../../frontend/src/app/page.tsx#L729)). Người dùng thấy 85% nhưng thực tế có thể đã lỗi.
- Upload xong không có bản ghi `videos.status` phản ánh pipeline (đang có `UPLOADED` ở [:241](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L241) nhưng không đổi tiếp).

## 2. Mục tiêu

- Upload trả về ngay sau khi lưu tệp (hoặc sau khi F11 hoàn tất), kèm `videoId` và `jobId`.
- Bóc băng và analyze chạy dưới dạng job `TRANSCRIBE` và `ANALYZE` của F09.
- Tiến độ thật được đẩy về trình duyệt qua SSE (Server-Sent Events, kênh một chiều máy chủ đẩy dữ liệu về trình duyệt qua HTTP).
- `videos.status` đi theo một máy trạng thái rõ ràng.

### Ngoài phạm vi

- WebSocket hai chiều (chưa cần; SSE đủ dùng).
- Thay đổi thuật toán AI.

## 3. User stories

- Là giảng viên, tôi muốn upload xong là đóng tab được và quay lại sau vẫn thấy kết quả.
- Là giảng viên, tôi muốn thấy chính xác hệ thống đang ở bước nào (tách âm thanh, bóc băng, phân đoạn) và còn khoảng bao lâu.
- Là giảng viên, khi xử lý lỗi tôi muốn thấy lý do bằng tiếng Việt và nút "Thử lại".

## 4. Yêu cầu chức năng

- **FR-1** Máy trạng thái của `videos.status`:
  `UPLOADED → TRANSCRIBING → TRANSCRIBED → ANALYZING → READY` (rẽ sang `FAILED` ở bất kỳ bước nào). `REVIEWED` và `PUBLISHED` thuộc F35.
- **FR-2** Upload thành công thì tự tạo job `TRANSCRIBE`. Job này xong thì tự tạo job `ANALYZE` (chuỗi job). Job `ANALYZE` xong thì gọi `SegmentPersistenceService.upsertSegments(videoId, segs, AI)` (F00 FR-4), để topic có trong DB với `topicId` thật trước khi sự kiện `done` được gửi.
- **FR-3** Nếu `sha256` đã có transcript trong cache (`CacheService.getCachedTranscript`) thì job `TRANSCRIBE` hoàn tất ngay với `message="Dùng lại bản bóc băng đã có"`.
- **FR-4** Python CLI ghi tiến độ ra stdout theo từng dòng, định dạng:
  `@@PROGRESS {"stage":"whisper","percent":37,"message":"Đã bóc băng 12:30/34:00"}`.
  Java đọc stdout **theo từng dòng** khi tiến trình đang chạy (`BufferedReader.readLine`) và gọi `ctx.updateProgress`. Các dòng khác ghi vào log.
- **FR-4b** Ngoài `@@PROGRESS`, `PythonRunner` nhận thêm hai loại dòng:
  - `@@WARN {"code":"DIARIZATION_SKIPPED","message":"…"}`: gom vào mảng `jobs.result.warnings` và gửi sự kiện SSE `warning` (F20, F21, F24, F25, F29 dùng).
  - `@@USAGE {"feature":"ANALYZE","provider":"gemini","model":"…","inputTokens":…,"outputTokens":…}`: ghi qua `AiUsageService.record(...)` của F15 (phụ thuộc mềm).
  Khi Python thoát với lỗi có mã (dòng cuối `@@ERROR {"code":"TRANSCRIPT_TOO_LONG","message":"…"}`, ví dụ của F28), handler ghi `jobs.error_code` đúng mã đó và đánh dấu lỗi **không thử lại**.
- **FR-5** Tiến độ tổng của video gồm các chặng: probe 0–5%, tách âm thanh 5–10%, Whisper 10–70%, tinh chỉnh LLM 70–85%, phân đoạn và điểm cắt 85–100%.
- **FR-6** Endpoint SSE `GET /api/v1/videos/{id}/events?ticket=…` đẩy các sự kiện `progress`, `status`, `error`, `done`. Gửi `: ping` mỗi 20 giây để giữ kết nối. Xác thực bằng **vé `SSE`** theo AD-4, **dùng đúng cơ chế vé của F01 FR-10** (F10 không tự định nghĩa vé riêng): frontend gọi `POST /api/v1/auth/tickets {"purpose":"SSE","resourceId":<videoId>}` để lấy vé. Vé sống 60 giây và chỉ dùng một lần để **mở** kết nối; kết nối đã mở thì không cần vé nữa.
- **FR-7** Vì vé chỉ dùng một lần, cơ chế tự kết nối lại của `EventSource` (dùng lại URL cũ) sẽ thất bại. Hook `useVideoEvents` phải: bắt `onerror`, gọi `close()`, xin vé mới, rồi mở `EventSource` mới. Khoảng chờ giữa các lần thử tăng dần 1 → 2 → 4 → … tối đa 30 giây. Server gửi ngay trạng thái hiện tại khi có kết nối mới, nên không mất thông tin.
- **FR-8** Giữ endpoint cũ `/upload-sample` và `/analyze` trong 1 sprint, nhưng chuyển chúng thành bất đồng bộ (trả `202 Accepted` + `jobId`), có log cảnh báo deprecated.
- **FR-8b (hạn mức, AD-9)** Job `TRANSCRIBE` và `ANALYZE` được tạo bằng `JobService.enqueue`, nên được giữ chỗ phút xử lý qua `QuotaService.reserveForJob(...)` **trong cùng transaction** với việc tạo job (F09 FR-9b). Số phút ước tính bằng thời lượng video (`videos.duration`, làm tròn lên). Handler kết thúc thì `commit` (thành công) hoặc `release` (lỗi hoặc bị huỷ). Vượt hạn mức thì `POST /analyze` trả 402 `QUOTA_EXCEEDED`, và không có job nào được tạo. Trước khi có F16/F49, `QuotaService` là no-op.
- **FR-9** Timeout theo job: TRANSCRIBE = max(30 phút, 1,5 × thời lượng video); ANALYZE = 10 phút. Quá hạn thì `destroyForcibly()` và đánh dấu lỗi `RetryableJobException`.

## 5. Yêu cầu phi chức năng

- Request upload (không tính thời gian truyền tệp) phản hồi ≤ 2 giây.
- Một tab giữ tối đa 1 kết nối SSE cho mỗi video. Server giới hạn 500 kết nối SSE đồng thời và trả 503 nếu vượt.
- Sự kiện tiến độ tới trình duyệt chậm hơn ≤ 2 giây so với lúc Python in ra.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__video_pipeline_status.sql` (chạy sau migration `create_jobs` của F09):

```sql
ALTER TABLE videos ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS current_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
-- Code hiện tại chỉ ghi 'UPLOADED' (VideoController.java:241); chuẩn hoá giá trị lạ (nếu có) trước khi thêm CHECK
UPDATE videos SET status = 'UPLOADED' WHERE status NOT IN
  ('UPLOADING','UPLOADED','TRANSCRIBING','TRANSCRIBED','ANALYZING','READY','REVIEWED','PUBLISHED','FAILED');
ALTER TABLE videos ADD CONSTRAINT chk_video_status CHECK (status IN
  ('UPLOADING','UPLOADED','TRANSCRIBING','TRANSCRIBED','ANALYZING','READY','REVIEWED','PUBLISHED','FAILED'));
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos` | Đã đăng nhập, role khác `VIEWER` | Upload (multipart; F11 sẽ thay bằng upload chia khúc). Trả 202. |
| POST | `/api/v1/videos/{id}/analyze` | Quyền `EDIT` trên video | Chạy lại analyze (ví dụ sau khi đổi outline). Trả 202. |
| GET | `/api/v1/videos/{id}/status` | Quyền `VIEW` trên video | Trạng thái hiện tại (cho client không dùng SSE) |
| GET | `/api/v1/videos/{id}/events?ticket=` | Vé `SSE` hợp lệ cho đúng `videoId` | SSE stream |

Quyền kiểm qua `AccessService.require(user, videoId, …)` (AD-1). Không xem được video thì trả **404** `VIDEO_NOT_FOUND`; xem được nhưng không có quyền sửa thì `POST /analyze` trả **403** `FORBIDDEN_ACTION` (AD-2). Vé thiếu, hết hạn, đã dùng, hoặc cấp cho video khác thì trả **401** `TICKET_INVALID`.

Phản hồi `202`:

```json
{ "videoId": 42, "jobId": "3f0c7a1e-...", "status": "UPLOADED", "eventsUrl": "/api/v1/videos/42/events" }
```

Các sự kiện SSE:

```
event: progress
data: {"videoId":42,"stage":"whisper","percent":37,"message":"Đã bóc băng 12:30/34:00"}

event: status
data: {"videoId":42,"status":"ANALYZING"}

event: error
data: {"videoId":42,"code":"WHISPER_FAILED","message":"Không bóc băng được: tệp không có âm thanh","retryable":false}

event: done
data: {"videoId":42,"status":"READY","segmentsUrl":"/api/v1/videos/42/segments"}
```

> `EventSource` không gửi được header `Authorization`, nên dùng vé `SSE` theo AD-4 (do F01 định nghĩa). Không đặt JWT trong cookie hay trên URL.

### 6.3 Backend

- Tạo `com.autocut.job.handler.TranscribeJobHandler` và `AnalyzeJobHandler`, chuyển logic từ `generateTranscriptForUploadedVideo` và `analyzeVideo` sang đây.
- Tạo `com.autocut.pipeline.PythonRunner` (dùng chung): khởi chạy `backend.ai.cli`, đọc stdout từng dòng, nhận diện tiền tố `@@PROGRESS`, đăng ký `Process` vào `JobContext` để huỷ được, và áp timeout. Dùng chung cho cả hai handler để bỏ code `ProcessBuilder` đang lặp ở [:424](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L424) và [:805](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L805).
- Tạo `com.autocut.pipeline.VideoEventBroadcaster`: `Map<Long, Set<SseEmitter>>`. `JobContext.updateProgress` phát sự kiện qua lớp này. Emitter bị lỗi hoặc timeout thì tự gỡ khỏi map.
- Tạo `VideoPipelineController` cho các API ở mục 6.2.
- Sửa `VideoController.uploadSampleVideo`: bỏ đoạn gọi AI và đoạn chia segment giả ([:244-290](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L244)), thay bằng `jobService.enqueue(TRANSCRIBE, ...)`.

### 6.4 AI pipeline (Python)

- `backend/ai/cli.py`: thêm hàm `emit_progress(stage: str, percent: int, message: str)` để in `@@PROGRESS <json>` rồi `flush=True`.
- `whisper_service.py`: faster-whisper trả segment theo kiểu generator; sau mỗi segment tính `percent = seg.end / duration`, phát tiến độ tối đa 1 lần mỗi 2 giây.
- `transcript_refiner.py`, `prompt_builder.py`: phát tiến độ theo từng chunk gửi LLM.
- Mã thoát (exit code): `0` thành công, `2` lỗi đầu vào (không thử lại), `3` lỗi tạm thời từ API (thử lại được). Java ánh xạ các mã này sang `RetryableJobException` hoặc lỗi vĩnh viễn.

### 6.5 Frontend

- Tạo `frontend/src/lib/useVideoEvents.ts` (React hook): xin vé `SSE`, mở `EventSource`, trả về `{ status, percent, stage, message, error }`, đóng kết nối khi unmount hoặc khi nhận `done`. Khi gặp `onerror` thì tự xin vé mới và mở lại theo FR-7.
- `page.tsx`: **xoá** hai `setInterval` giả lập tiến độ ([:730](../../../frontend/src/app/page.tsx#L730), [:1062](../../../frontend/src/app/page.tsx#L1062)) và thay bằng `useVideoEvents`.
- `ExportProgressModal.tsx`: các bước `pending/running/completed` lấy theo `stage` thật.
- `VideoLibraryColumn.tsx`: thẻ video hiện nhãn trạng thái (Đang bóc băng 37%, Sẵn sàng, Lỗi) và vẫn cập nhật khi người dùng đang mở video khác.
- Thông báo lỗi luôn bằng tiếng Việt, kèm nút "Thử lại" (gọi `POST /analyze` hoặc `/jobs/{id}/retry`).

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* video 60 phút, *When* upload xong, *Then* API trả 202 trong ≤ 2 giây (tính từ khi nhận đủ byte), `videos.status=UPLOADED`.
- **AC-2** — *Given* đang bóc băng, *When* mở DevTools → Network → events, *Then* thấy sự kiện `progress` tối thiểu mỗi 5 giây và `percent` không bao giờ giảm.
- **AC-3** — *Given* đang ở 40%, *When* đóng tab rồi mở lại sau 2 phút, *Then* thẻ video hiện đúng tiến độ hiện tại (> 40%) mà không cần bấm gì.
- **AC-4** — *Given* tệp không có kênh âm thanh, *When* job chạy, *Then* trong ≤ 30 giây nhận sự kiện `error` với `retryable=false` và thông báo tiếng Việt; `videos.status=FAILED`, `error_message` có nội dung.
- **AC-5** — *Given* video đã từng được bóc băng (cùng sha256), *When* upload lại, *Then* chặng Whisper hoàn tất trong ≤ 3 giây.
- **AC-6** — Grep `Math.random` trong `page.tsx` không còn kết quả nào liên quan tới tiến độ.
- **AC-7** — *Given* proxy cắt kết nối sau 100 giây, *When* xử lý video dài, *Then* hook tự xin vé mới, mở lại kết nối trong ≤ 5 giây, và luồng sự kiện tiếp tục.
- **AC-8** — *Given* user B không có quyền trên video 42, *When* B xin vé `SSE` cho video 42, *Then* nhận 404. *Given* một vé đã dùng để mở kết nối, *When* dùng lại vé đó, *Then* nhận 401 `TICKET_INVALID`.
- **AC-9** — *Given* job ANALYZE xong, *When* nhận sự kiện `done`, *Then* `GET segmentsUrl` trả các segment có `topicId` số (F00).
- **AC-10** — *Given* `QuotaService` thật và user chỉ còn 5 phút, *When* gọi `POST /analyze` cho video 30 phút, *Then* nhận 402 `QUOTA_EXCEEDED` và bảng `jobs` không có dòng mới. *Given* job ANALYZE lỗi vĩnh viễn, *Then* số phút đã giữ chỗ được trả lại.

## 8. Kế hoạch kiểm thử (TDD)

- `PythonRunnerTest.parsesProgressLines_andForwardsToContext` (dùng script giả in `@@PROGRESS`)
- `PythonRunnerTest.timeout_destroysProcess_andThrowsRetryable`
- `PythonRunnerTest.collectsWarnLines_intoResultWarnings`, `forwardsUsageLines_toAiUsageService`, `errorLineWithCode_setsJobErrorCode_nonRetryable` (FR-4b)
- `PythonRunnerTest.exitCode2_isNonRetryable_exitCode3_isRetryable`
- `TranscribeJobHandlerTest.cacheHit_skipsWhisper_andEnqueuesAnalyze`
- `TranscribeJobHandlerTest.success_setsStatusTranscribed_andEnqueuesAnalyze`
- `VideoEventBroadcasterTest.newSubscriber_receivesCurrentStateImmediately`
- `VideoEventBroadcasterTest.deadEmitter_isRemoved`
- `VideoPipelineControllerTest.upload_returns202_withJobId`
- `VideoPipelineControllerTest.events_withoutTicket_returns401`, `events_reusedTicket_returns401`, `events_ticketForOtherVideo_returns401`
- `VideoPipelineControllerTest.analyze_noAccess_returns404`, `analyze_viewerOnly_returns403`
- `AnalyzeJobHandlerTest.success_upsertsTopicsWithOriginAi_beforeDone`
- `VideoPipelineControllerTest.analyze_quotaExceeded_returns402_andNoJobCreated`
- Python: `tests/test_progress.py::test_emit_progress_format` và `::test_whisper_emits_monotonic_percent`
- Frontend (thủ công, SV4 QA): checklist cho AC-2, AC-3, AC-7.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Nginx hoặc Cloudflare gom (buffer) dữ liệu SSE | Sự kiện tới trễ thành từng cục | Gửi header `X-Accel-Buffering: no` và `Cache-Control: no-cache` |
| Python in quá nhiều dòng log | Đầy bộ đệm pipe, tiến trình bị treo | Luôn đọc stdout ở một luồng riêng (ngay cả dòng không phải tiến độ) |
| Nhiều tab cùng mở một video | Nhiều kết nối SSE | Giới hạn mỗi user ≤ 10 emitter, emitter cũ bị đóng |
| Trạng thái `videos.status` và `jobs.status` lệch nhau | Giao diện sai | Chỉ cập nhật `videos.status` bên trong handler, trong cùng transaction với bước cập nhật job cuối |

## 10. Câu hỏi mở

- [x] Xác thực SSE: **Đã chốt theo AD-4** (vé `SSE` dùng một lần, do F01 cấp).
- [ ] Có tự chạy ANALYZE ngay sau TRANSCRIBE không, hay chờ giảng viên nhập outline (`videos.outline_text`) trước?
- [ ] Bỏ hẳn endpoint `/upload-sample` sau bao lâu?
