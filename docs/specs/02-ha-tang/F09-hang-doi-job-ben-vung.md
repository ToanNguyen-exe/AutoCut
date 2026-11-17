# F09 — Hàng đợi job bền vững

| Mục | Giá trị |
|---|---|
| **Mã** | F09 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (chính), SV1 (đánh giá phần cắt video) |
| **Phụ thuộc** | F13 (Flyway). Nên có F01/F02 để gắn `owner_id`, nhưng có thể làm trước với `owner_id` cho phép NULL. |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. Dùng Postgres làm hàng đợi (`SELECT ... FOR UPDATE SKIP LOCKED`) và `@Scheduled` có sẵn trong Spring. Không dùng Redis hay RabbitMQ ở giai đoạn này. |
| **Tham khảo** | Mux/Vimeo transcoding jobs, thư viện db-scheduler/JobRunr (chỉ tham khảo thiết kế), bài "Postgres SKIP LOCKED queue" |

## 1. Bối cảnh & vấn đề

- Job cắt video hiện chỉ lưu trong RAM: `private final Map<String, JobState> jobStore = new ConcurrentHashMap<>();` ([BatchVideoCutService.java:48](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L48)). Khởi động lại backend (deploy, sập máy) là mất toàn bộ trạng thái. Client gọi `/cut/status?jobId=...` sẽ nhận 404 ([VideoController.java:1587-1597](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1587)).
- Bộ chạy job là `Executors.newFixedThreadPool(2)` ([BatchVideoCutService.java:70](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L70)), dùng chung cho mọi người dùng. Hàng đợi không giới hạn, không có ưu tiên, không tự thử lại, không huỷ được.
- `jobStore` không bao giờ được dọn, nên bộ nhớ tăng mãi theo thời gian chạy.
- Các tác vụ nặng khác (bóc băng Whisper khi upload ở [VideoController.java:382-470](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L382), analyze ở [:713](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L713)) hoàn toàn không đi qua hàng đợi. F10 sẽ chuyển chúng sang hàng đợi này.

## 2. Mục tiêu

- Một bảng `jobs` duy nhất làm hàng đợi cho mọi loại tác vụ nặng: `CUT`, `TRANSCRIBE`, `ANALYZE` (F10), và về sau `HLS` (F39), `EXPORT` (F45).
- Job còn nguyên sau khi khởi động lại. Job đang chạy dở lúc sập máy được tự động đưa lại vào hàng đợi.
- Tự thử lại khi lỗi tạm thời (backoff tăng dần), tối đa `max_attempts` lần.
- Huỷ được job đang chờ hoặc đang chạy.
- Giới hạn số job chạy đồng thời theo **loại** job và theo **người dùng**.

### Ngoài phạm vi

- Chạy nhiều backend instance song song. Thiết kế với `SKIP LOCKED` đã sẵn sàng cho việc này, nhưng chưa cần test ở bản này.
- Message broker ngoài (Redis, RabbitMQ, Kafka).
- Giao diện quản trị job cho Admin. Chỉ cần API; phần giao diện thuộc F46.

## 3. User stories

- Là giảng viên, tôi muốn job cắt video vẫn chạy tiếp sau khi server khởi động lại, để không phải bấm cắt lại từ đầu.
- Là giảng viên, tôi muốn huỷ một job đã bấm nhầm để không tốn thời gian chờ.
- Là quản trị viên, tôi muốn một người upload 10 video không chiếm hết máy chủ của người khác.

## 4. Yêu cầu chức năng

- **FR-1** Khi tạo job, ghi một bản ghi vào `jobs` với `status=QUEUED` trước khi trả `jobId` cho client.
- **FR-2** Một worker nền (`JobWorker`) lấy job theo thứ tự `priority DESC, created_at ASC`, dùng `FOR UPDATE SKIP LOCKED`, rồi chuyển job sang `RUNNING` và ghi `locked_by` cùng `locked_at`.
- **FR-3** Trong lúc chạy, handler cập nhật `progress` (0–100) và `message`. Mỗi job ghi tối đa 1 lần/giây để tránh dội DB.
- **FR-4** Trong lúc chạy, worker gửi heartbeat (cập nhật `heartbeat_at`) mỗi 15 giây. Job `RUNNING` có `heartbeat_at` cũ hơn 2 phút bị coi là mồ côi và được đưa về `QUEUED`, đồng thời `attempts += 1`.
- **FR-5** Lỗi tạm thời (`RetryableJobException`: timeout ffmpeg, lỗi mạng R2, lỗi 429/5xx từ API AI) thì đặt lại `QUEUED` với `run_after = now() + 30s * 2^(attempts-1)`. Hết `max_attempts` (mặc định 3) thì chuyển sang `FAILED`.
- **FR-6** Lỗi vĩnh viễn (dữ liệu đầu vào sai, tệp không tồn tại) thì chuyển `FAILED` ngay, không thử lại.
- **FR-7** Huỷ job: job `QUEUED` chuyển `CANCELLED` ngay. Job `RUNNING` được đặt cờ `cancel_requested=true`; handler kiểm tra cờ này giữa các bước (ví dụ giữa hai clip) và `Process.destroy()` tiến trình ffmpeg/Python đang chạy.
- **FR-8** Giới hạn đồng thời cấu hình trong `application.properties`: `autocut.jobs.concurrency.CUT=2`, `TRANSCRIBE=1`, `ANALYZE=2`, cùng `autocut.jobs.per-user-running=2`.
- **FR-9** Kết quả job (danh sách clip, URL chapters, URL report) lưu ở cột `result` dạng JSONB, giữ nguyên định dạng `CutJobResponse` hiện tại để frontend không phải đổi.
- **FR-10** Job ở trạng thái kết thúc (`COMPLETED`, `FAILED`, `CANCELLED`) được giữ 30 ngày rồi tự xoá (job dọn dẹp thuộc F17).

## 5. Yêu cầu phi chức năng

- Độ trễ từ lúc tạo job tới lúc job bắt đầu chạy (khi còn slot trống) phải ≤ 3 giây. Worker hỏi DB mỗi 1 giây.
- Không mất job khi `kill -9` backend (kiểm chứng bằng test ở mục 8).
- Truy vấn lấy job phải dùng index; không quét toàn bảng.
- Client không gửi được `type` hay `payload` tuỳ ý; job chỉ được tạo qua các API nghiệp vụ.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`backend/src/main/resources/db/migration/V2__create_jobs.sql`:

```sql
CREATE TABLE jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             VARCHAR(30)  NOT NULL,              -- CUT | TRANSCRIBE | ANALYZE | ...
    status           VARCHAR(20)  NOT NULL DEFAULT 'QUEUED', -- QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED
    owner_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    video_id         BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    priority         SMALLINT     NOT NULL DEFAULT 0,
    payload          JSONB        NOT NULL,
    result           JSONB,
    progress         SMALLINT     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    message          VARCHAR(500),
    error_code       VARCHAR(50),
    error_message    TEXT,
    attempts         SMALLINT     NOT NULL DEFAULT 0,
    max_attempts     SMALLINT     NOT NULL DEFAULT 3,
    cancel_requested BOOLEAN      NOT NULL DEFAULT FALSE,
    run_after        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    locked_by        VARCHAR(100),
    locked_at        TIMESTAMPTZ,
    heartbeat_at     TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jobs_pick   ON jobs(status, run_after, priority DESC, created_at) WHERE status = 'QUEUED';
CREATE INDEX idx_jobs_owner  ON jobs(owner_id, created_at DESC);
CREATE INDEX idx_jobs_video  ON jobs(video_id);
CREATE INDEX idx_jobs_stale  ON jobs(heartbeat_at) WHERE status = 'RUNNING';
```

Câu truy vấn lấy job (trong `JobRepository`, viết bằng native query):

```sql
UPDATE jobs SET status='RUNNING', locked_by=:workerId, locked_at=now(), heartbeat_at=now(),
       started_at=COALESCE(started_at, now()), attempts=attempts+1, updated_at=now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status='QUEUED' AND run_after <= now() AND type = :type
  ORDER BY priority DESC, created_at
  FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

> Lưu ý: test đang chạy H2 (`DatabaseConfig` rơi về H2 khi thiếu `DATABASE_URL`). H2 không hỗ trợ `SKIP LOCKED`, nên integration test của F09 cần Postgres thật (Testcontainers, cần duyệt thư viện) hoặc một nhánh Neon dành riêng cho test. Xem câu hỏi mở.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/jobs/{id}` | Chủ job hoặc Admin | Trạng thái và kết quả job |
| GET | `/api/v1/jobs?status=RUNNING&type=CUT&page=0` | Đã đăng nhập | Job của tôi (Admin xem được tất cả) |
| POST | `/api/v1/jobs/{id}/cancel` | Chủ job hoặc Admin | Huỷ job |
| POST | `/api/v1/jobs/{id}/retry` | Chủ job hoặc Admin | Chạy lại job đang `FAILED` (đặt `attempts=0`) |

`GET /api/v1/jobs/{id}` trả về:

```json
{
  "id": "3f0c7a1e-...",
  "type": "CUT",
  "status": "RUNNING",
  "progress": 42,
  "message": "Đang cắt clip 3/7: Vòng lặp for",
  "attempts": 1,
  "maxAttempts": 3,
  "videoId": 12,
  "createdAt": "2026-11-17T08:00:00Z",
  "startedAt": "2026-11-17T08:00:02Z",
  "finishedAt": null,
  "result": null,
  "error": null
}
```

Mã lỗi: `JOB_NOT_FOUND` (404), `JOB_FORBIDDEN` (403), `JOB_NOT_CANCELLABLE` (409, job đã kết thúc), `JOB_NOT_RETRYABLE` (409).

**Tương thích ngược:** `POST /api/video/cut` và `GET /api/video/cut/status?jobId=` vẫn giữ trong 1 sprint, nhưng đọc và ghi qua `JobService`. Đánh dấu `@Deprecated` và log cảnh báo mỗi lần được gọi.

### 6.3 Backend (Spring Boot)

Tạo mới trong package `com.autocut.job`:

| Tệp | Vai trò |
|---|---|
| `JobEntity.java`, `JobRepository.java` | Entity và repository, kèm native query lấy job |
| `JobType.java`, `JobStatus.java` | Các enum |
| `JobHandler.java` | `interface JobHandler { JobType type(); JobResult handle(JobContext ctx) throws Exception; }`. Có ≥ 3 cài đặt (CUT, TRANSCRIBE, ANALYZE) nên đúng Rule of Three. |
| `JobContext.java` | `payload()`, `updateProgress(int, String)`, `isCancelRequested()`, `registerProcess(Process)` |
| `RetryableJobException.java` | Đánh dấu lỗi được phép thử lại |
| `JobService.java` | `enqueue(type, ownerId, videoId, payload)`, `get`, `cancel`, `retry`, `list` |
| `JobWorker.java` | `@Scheduled(fixedDelay=1000)`: với mỗi `JobType` còn slot thì lấy job và chạy trên `ThreadPoolTaskExecutor` riêng của loại đó |
| `JobReaper.java` | `@Scheduled(fixedDelay=60000)`: đưa job mồ côi về hàng đợi (FR-4) |
| `JobController.java` | Các API ở mục 6.2 |

Sửa:

- `BatchVideoCutService`: tách logic của `executeJob(state)` thành `CutJobHandler implements JobHandler`. Bỏ `jobStore` và `executor`. Thay việc gán `state.percent`, `state.message` bằng `ctx.updateProgress(...)`.
- `BackendApplication`: thêm `@EnableScheduling`.
- `application.properties`: thêm các khoá `autocut.jobs.*` ở FR-8, `autocut.jobs.worker-id=${HOSTNAME:local}`.

### 6.5 Frontend (Next.js)

- `frontend/src/lib/api.ts`: thêm `getJob(id)`, `cancelJob(id)`, `retryJob(id)` cùng kiểu `Job` trong `src/types/index.ts`.
- `ExportProgressModal.tsx`: thêm nút **"Huỷ tác vụ"** (khi job `QUEUED`/`RUNNING`) và **"Thử lại"** (khi `FAILED`). Hiện dòng "Lần thử 2/3" khi `attempts > 1`.
- Nếu người dùng tải lại trang giữa chừng: lưu `jobId` đang chạy vào `localStorage` (`autocut_active_jobs`), mở lại modal và tiếp tục theo dõi.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* một job CUT đang `RUNNING` ở clip 3/7, *When* `kill -9` backend rồi khởi động lại, *Then* trong ≤ 3 phút job quay về `RUNNING` (attempts=2) và cuối cùng `COMPLETED`, đủ 7 clip.
- **AC-2** — *Given* backend vừa khởi động lại, *When* gọi `GET /api/v1/jobs/{id}` của một job đã `COMPLETED` từ hôm qua, *Then* trả 200 với `result` đầy đủ.
- **AC-3** — *Given* R2 trả lỗi mạng ở lần chạy 1 và 2 rồi thành công ở lần 3, *When* job chạy, *Then* job `COMPLETED` với `attempts=3`, và khoảng cách giữa các lần thử ≥ 30 giây, rồi ≥ 60 giây.
- **AC-4** — *Given* `videoName` trỏ tới tệp không tồn tại, *When* job chạy, *Then* job `FAILED` ngay với `error_code=SOURCE_NOT_FOUND`, `attempts=1`.
- **AC-5** — *Given* một job CUT đang chạy ffmpeg, *When* gọi `POST /cancel`, *Then* trong ≤ 5 giây tiến trình ffmpeg bị dừng, job ở trạng thái `CANCELLED`, các clip đã cắt xong vẫn giữ nguyên.
- **AC-6** — *Given* `per-user-running=2` và user A đã gửi 5 job, *When* user B gửi 1 job, *Then* job của B được chạy trước khi A có job thứ 3 được chạy.
- **AC-7** — *Given* user B, *When* gọi `GET /api/v1/jobs/{id}` của job thuộc user A, *Then* nhận 403 `JOB_FORBIDDEN`.
- **AC-8** — Không còn trường `jobStore` hay `newFixedThreadPool` trong `BatchVideoCutService` (kiểm bằng grep trong review).

## 8. Kế hoạch kiểm thử (TDD)

Unit (Mockito, viết trước):

- `JobServiceTest.enqueue_persistsQueuedJob_andReturnsId`
- `JobServiceTest.cancel_queuedJob_becomesCancelledImmediately`
- `JobServiceTest.cancel_finishedJob_throwsNotCancellable`
- `JobWorkerTest.retryableException_requeuesWithExponentialBackoff`
- `JobWorkerTest.nonRetryableException_marksFailedWithoutRetry`
- `JobWorkerTest.maxAttemptsReached_marksFailed`
- `JobWorkerTest.respectsPerTypeConcurrencyLimit`
- `JobReaperTest.staleRunningJob_isRequeued`
- `CutJobHandlerTest.cancelRequested_stopsBetweenClips_andDestroysProcess`

Integration (cần Postgres thật):

- `JobQueueIntegrationTest.twoWorkers_neverPickSameJob` (2 luồng cùng lấy 100 job; mỗi job chỉ được chạy đúng 1 lần)
- `JobQueueIntegrationTest.jobSurvivesContextRestart` (đóng và mở lại `ApplicationContext`)
- `JobControllerTest.getJob_otherUser_returns403`

Giữ nguyên và sửa cho chạy qua: `BatchVideoCutServiceTest`, `VideoControllerTest` (theo CONSTRAINTS §1, không được xoá test).

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Neon free tier tự ngủ, worker hỏi DB mỗi giây làm Neon không ngủ được | Tốn compute-hour | Tăng `fixedDelay` lên 5 giây khi không có job nào trong 10 phút; chốt lại ở câu hỏi mở |
| Job bị chạy 2 lần (worker cũ chưa chết hẳn khi reaper đã đưa job về hàng đợi) | Clip bị ghi đè hai lần | Handler phải idempotent (chạy lại không gây hại): ghi ra tệp tạm rồi rename; `uq_topic_part` chặn trùng dữ liệu |
| Bảng `jobs` phình to | DB chậm | F17 dọn job cũ hơn 30 ngày |
| Ghi progress quá dày | Nghẽn connection pool | Mỗi job ghi tối đa 1 lần/giây (FR-3) |
| Tiến trình ffmpeg con vẫn sống khi JVM chết | Tiến trình mồ côi chiếm CPU | Dùng `ProcessHandle.descendants().forEach(destroyForcibly)` khi huỷ; khi Docker restart (F14) container sẽ dọn sạch |

## 10. Câu hỏi mở

- [ ] Có được thêm Testcontainers (test dependency) để chạy Postgres thật trong CI không? Nếu không thì dùng một nhánh Neon `test` riêng.
- [ ] Giữ job đã kết thúc 30 ngày có hợp lý không?
- [ ] Giới hạn đồng thời mặc định (CUT=2, TRANSCRIBE=1) phụ thuộc cấu hình máy chủ thật. Server dự kiến có bao nhiêu CPU/RAM? Có GPU cho Whisper không?
- [ ] Có cần mức ưu tiên (ví dụ Admin hoặc gói trả phí chạy trước) ngay từ bản này không?
