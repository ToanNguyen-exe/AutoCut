# F09 — Hàng đợi job bền vững

| Mục | Giá trị |
|---|---|
| **Mã** | F09 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (chính), SV1 (đánh giá phần cắt video) |
| **Phụ thuộc** | F13 (Flyway), F00 (job CUT ghi `video_parts` theo F00 FR-7). Nên có F01/F02 để gắn `owner_id` và kiểm quyền; có thể làm trước với `owner_id` cho phép NULL. |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | **Testcontainers** (chỉ dùng cho test, để chạy Postgres thật, theo AD-7). Hàng đợi dùng Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`) và `@Scheduled` có sẵn của Spring. Không dùng Redis hay RabbitMQ. |
| **Tham khảo** | Mux/Vimeo transcoding jobs, thư viện db-scheduler/JobRunr (chỉ tham khảo thiết kế), bài "Postgres SKIP LOCKED queue" |

> **Cập nhật 18/11/2026:** Câu lấy job giới hạn số job RUNNING của mỗi user; `attempts` chỉ tăng ở một chỗ (lúc lấy job); mọi lệnh ghi của worker có điều kiện fencing (`locked_by` + `attempts`); không có quyền thì trả 404 theo AD-2; test dùng Postgres theo AD-7; tên migration theo quy ước dấu thời gian.

## 1. Bối cảnh & vấn đề

- Job cắt video hiện chỉ lưu trong RAM: `private final Map<String, JobState> jobStore = new ConcurrentHashMap<>();` ([BatchVideoCutService.java:48](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L48)). Khởi động lại backend (deploy, sập máy) là mất toàn bộ trạng thái. Client gọi `/cut/status?jobId=...` sẽ nhận 404 ([VideoController.java:1587-1597](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1587)).
- Bộ chạy job là `Executors.newFixedThreadPool(2)` ([BatchVideoCutService.java:70](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L70)), dùng chung cho mọi người dùng. Hàng đợi không giới hạn, không có ưu tiên, không tự thử lại, không huỷ được.
- `jobStore` không bao giờ được dọn, nên bộ nhớ tăng mãi theo thời gian chạy.
- Các tác vụ nặng khác (bóc băng Whisper khi upload ở [VideoController.java:382-470](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L382), analyze ở [:713](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L713)) hoàn toàn không đi qua hàng đợi. F10 sẽ chuyển chúng sang hàng đợi này.

## 2. Mục tiêu

- Một bảng `jobs` duy nhất làm hàng đợi cho mọi loại tác vụ chạy nền (AD-10): `CUT`, `TRANSCRIBE`, `ANALYZE` (F10), và về sau `HLS` (F39), `EXPORT` (F45), `THUMBNAIL` (F43), `SUBTITLE` (F23)… Không spec nào được tự tạo `ExecutorService` riêng.
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
- **FR-2** Một worker nền (`JobWorker`) lấy job theo thứ tự `priority DESC, created_at ASC`, dùng `FOR UPDATE SKIP LOCKED`, rồi chuyển job sang `RUNNING`, ghi `locked_by` và `locked_at`, và **tăng `attempts` thêm 1**. Đây là **chỗ duy nhất** tăng `attempts`. Câu lấy job **bỏ qua** job của user đang có từ `per-user-running` job `RUNNING` trở lên (FR-8, xem câu SQL ở 6.1).
- **FR-3** Trong lúc chạy, handler cập nhật `progress` (0–100) và `message`. Mỗi job ghi tối đa 1 lần/giây để tránh dội DB.
- **FR-4** Trong lúc chạy, worker gửi heartbeat (cập nhật `heartbeat_at`) mỗi 15 giây. Job `RUNNING` có `heartbeat_at` cũ hơn 2 phút bị coi là mồ côi: reaper đưa job về `QUEUED`, xoá `locked_by`, **không tăng `attempts`**. Lần lấy kế tiếp sẽ tăng (FR-2). Nếu `attempts >= max_attempts` thì reaper chuyển thẳng sang `FAILED` (`error_code=WORKER_LOST`).
- **FR-4b (fencing)** Mọi lệnh ghi của worker vào một job đang chạy (progress, heartbeat, kết quả cuối) đều phải có điều kiện `WHERE id=:id AND status='RUNNING' AND locked_by=:workerId AND attempts=:attempt`. Lệnh trả về 0 dòng nghĩa là job đã bị reaper lấy lại hoặc đã bị huỷ: worker cũ ghi log `WARN`, bỏ kết quả và dừng tiến trình con. Nhờ vậy worker cũ không ghi đè kết quả của lần chạy mới.
- **FR-5** Lỗi tạm thời (`RetryableJobException`: timeout ffmpeg, lỗi mạng R2, lỗi 429/5xx từ API AI) thì đặt lại `QUEUED` với `run_after = now() + 30s * 2^(attempts-1)`. Hết `max_attempts` (mặc định 3) thì chuyển sang `FAILED`.
- **FR-6** Lỗi vĩnh viễn (dữ liệu đầu vào sai, tệp không tồn tại) thì chuyển `FAILED` ngay, không thử lại.
- **FR-7** Huỷ job: job `QUEUED` chuyển `CANCELLED` ngay. Job `RUNNING` được đặt cờ `cancel_requested=true`; handler kiểm tra cờ này giữa các bước (ví dụ giữa hai clip) và `Process.destroy()` tiến trình ffmpeg/Python đang chạy.
- **FR-7b** `JobType` là enum, mở rộng dần theo các spec. Danh sách đã biết:

  | JobType | Spec | `autocut.jobs.concurrency.<TYPE>` mặc định |
  |---|---|---|
  | `TRANSCRIBE` | F10 | 1 |
  | `ANALYZE` | F10 | 2 |
  | `CUT` | F09 (hiện có) | 2 |
  | `MEDIA_PREVIEW` | F38 | 1 |
  | `HLS` | F39 | 1 |
  | `THUMBNAIL` | F43 | 2 |
  | `SUBTITLE_BURN` | F23 | 1 |
  | `TRANSLATE` | F24 | 2 |
  | `QUIZ` | F29 | 2 |
  | `CLEANUP_DETECT` | F25 | 1 |
  | `DATA_EXPORT` | F91/F12 phương án B | 1 |
  | `AGGREGATE_VIEWS` | F47 | 1 |

  Spec nào thêm loại mới thì thêm giá trị enum, một `JobHandler` và một khoá cấu hình concurrency. Thiếu khoá thì mặc định là 1.
- **FR-8** Giới hạn đồng thời cấu hình trong `application.properties` theo bảng ở FR-7b (`autocut.jobs.concurrency.<TYPE>`), cùng `autocut.jobs.per-user-running=2`. Giới hạn theo loại do worker kiểm (số slot còn trống của executor từng loại). Giới hạn theo user nằm **trong câu lấy job** (6.1).
- **FR-9** Kết quả job (danh sách clip, key chapters, key report trên R2) lưu ở cột `result` dạng JSONB, giữ nguyên định dạng `CutJobResponse` hiện tại để frontend không phải đổi. Với job `CUT`, handler còn upsert `video_parts` theo F00 FR-7. Link tải không lưu sẵn trong `result`; khi client cần tải thì mới sinh presigned URL theo AD-3.
- **FR-9b (giữ chỗ hạn mức, AD-9)** `JobService.enqueue` gọi `QuotaService.reserveForJob(ownerId, jobType, estimatedMinutes)` **trong cùng transaction** với lệnh INSERT job. Giữ chỗ thất bại (vượt hạn mức) thì rollback cả hai và trả `QUOTA_EXCEEDED`. Khi job kết thúc, worker gọi `QuotaService.commit(jobId)` nếu `COMPLETED`, hoặc `release(jobId)` nếu `FAILED`/`CANCELLED`; lời gọi này nằm trong cùng transaction với lệnh kết thúc có fencing (FR-4b). Trước khi có F16/F49, `QuotaService` là bản no-op, nên F09 không phụ thuộc hai spec này.
- **FR-10** Job ở trạng thái kết thúc (`COMPLETED`, `FAILED`, `CANCELLED`) được giữ 30 ngày rồi tự xoá (job dọn dẹp thuộc F17).

## 5. Yêu cầu phi chức năng

- Độ trễ từ lúc tạo job tới lúc job bắt đầu chạy (khi còn slot trống) phải ≤ 3 giây. Worker hỏi DB mỗi 1 giây.
- Không mất job khi `kill -9` backend (kiểm chứng bằng test ở mục 8).
- Truy vấn lấy job phải dùng index; không quét toàn bảng.
- Client không gửi được `type` hay `payload` tuỳ ý; job chỉ được tạo qua các API nghiệp vụ.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`backend/src/main/resources/db/migration/V<yyyyMMddHHmm>__create_jobs.sql` (ví dụ `V202611201430__create_jobs.sql`, theo quy ước ở F13):

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
CREATE INDEX idx_jobs_owner_running ON jobs(owner_id) WHERE status = 'RUNNING';
```

Câu lấy job (native query trong `JobRepository`). Đây là chỗ duy nhất tăng `attempts`, và là chỗ áp giới hạn theo user:

```sql
UPDATE jobs SET status='RUNNING', locked_by=:workerId, locked_at=now(), heartbeat_at=now(),
       started_at=COALESCE(started_at, now()), attempts=attempts+1, updated_at=now()
WHERE id = (
  SELECT j.id FROM jobs j
  WHERE j.status='QUEUED' AND j.run_after <= now() AND j.type = :type
    AND (j.owner_id IS NULL OR
         (SELECT count(*) FROM jobs r
           WHERE r.owner_id = j.owner_id AND r.status='RUNNING') < :perUserRunning)
  ORDER BY j.priority DESC, j.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

> `JobWorker` lấy job **tuần tự trong một luồng** (`@Scheduled`), nên với 1 instance thì phép đếm ở trên không bị tranh chấp. Nếu sau này chạy nhiều instance, mỗi user có thể vượt giới hạn tối đa (số instance − 1) job; mức này chấp nhận được và đã ghi ở "Ngoài phạm vi".

Lệnh kết thúc job (fencing, FR-4b):

```sql
UPDATE jobs SET status=:finalStatus, result=:result, error_code=:code, error_message=:msg,
       progress=CASE WHEN :finalStatus='COMPLETED' THEN 100 ELSE progress END,
       finished_at=now(), locked_by=NULL, updated_at=now()
WHERE id=:id AND status='RUNNING' AND locked_by=:workerId AND attempts=:attempt;
-- 0 dòng => job đã bị reaper lấy lại / bị huỷ: bỏ kết quả, log WARN
```

> Theo AD-7: H2 bị bỏ. H2 cũng không hỗ trợ `SKIP LOCKED`. Integration test của F09 chạy trên Postgres 16 qua Testcontainers, hoặc qua `TEST_DATABASE_URL` khi chạy CI.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/jobs/{id}` | Xem được job | Trạng thái và kết quả job |
| GET | `/api/v1/jobs?status=RUNNING&type=CUT&page=0` | Đã đăng nhập | Job của tôi (Admin xem được tất cả) |
| POST | `/api/v1/jobs/{id}/cancel` | Thao tác được job | Huỷ job |
| POST | `/api/v1/jobs/{id}/retry` | Thao tác được job | Chạy lại job đang `FAILED` (đặt `attempts=0`, `status=QUEUED`, `run_after=now()`) |

Quyền (AD-1, AD-2):
- **Xem được job:** chủ job, Admin, hoặc người có quyền xem video của job (`AccessService.require(user, videoId, VIEW)`).
- **Thao tác được job:** chủ job, Admin, hoặc người có quyền `EDIT` trên video.
- Không xem được thì trả **404** `JOB_NOT_FOUND` (không để lộ job có tồn tại). Xem được nhưng không thao tác được thì trả **403** `FORBIDDEN_ACTION`.

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

Mã lỗi: `JOB_NOT_FOUND` (404, gồm cả trường hợp không có quyền xem), `FORBIDDEN_ACTION` (403), `JOB_NOT_CANCELLABLE` (409, job đã kết thúc), `JOB_NOT_RETRYABLE` (409).

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
| `JobReaper.java` | `@Scheduled(fixedDelay=60000)`: đưa job mồ côi về hàng đợi, không tăng `attempts` (FR-4) |
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
- **AC-7** — *Given* user B không có quyền gì trên video của job thuộc user A, *When* B gọi `GET /api/v1/jobs/{id}`, *Then* nhận 404 `JOB_NOT_FOUND`. *Given* B là `VIEWER` của video đó, *When* B gọi `POST /cancel`, *Then* nhận 403 `FORBIDDEN_ACTION`.
- **AC-8** — Không còn trường `jobStore` hay `newFixedThreadPool` trong `BatchVideoCutService` (kiểm bằng grep trong review).
- **AC-9** — *Given* worker W1 chạy job J (attempts=1) bị treo quá 2 phút và reaper đã đưa J về hàng đợi, W2 lấy J (attempts=2), *When* W1 tỉnh lại và ghi kết quả, *Then* lệnh ghi của W1 cập nhật 0 dòng; kết quả cuối của J là của W2.
- **AC-10** — *Given* job CUT hoàn tất 3 clip, *Then* có 3 dòng `video_parts` `COMPLETED` với `file_size > 0` (F00 FR-7).
- **AC-11** — *Given* `QuotaService` thật (sau F16/F49) và user còn 10 phút hạn mức, *When* tạo đồng thời 2 job ANALYZE ước tính 8 phút mỗi job, *Then* chỉ 1 job được tạo, job kia nhận `QUOTA_EXCEEDED`. *When* job đã tạo bị `FAILED`, *Then* 8 phút được trả lại (`release`).

## 8. Kế hoạch kiểm thử (TDD)

Unit (Mockito, viết trước):

- `JobServiceTest.enqueue_persistsQueuedJob_andReturnsId`
- `JobServiceTest.cancel_queuedJob_becomesCancelledImmediately`
- `JobServiceTest.cancel_finishedJob_throwsNotCancellable`
- `JobServiceTest.enqueue_quotaReserveFails_rollsBackJobInsert`
- `JobWorkerTest.completed_commitsQuota_failedOrCancelled_releasesQuota`
- `JobWorkerTest.retryableException_requeuesWithExponentialBackoff`
- `JobWorkerTest.nonRetryableException_marksFailedWithoutRetry`
- `JobWorkerTest.maxAttemptsReached_marksFailed`
- `JobWorkerTest.respectsPerTypeConcurrencyLimit`
- `JobReaperTest.staleRunningJob_isRequeued_withoutIncrementingAttempts`
- `JobReaperTest.staleRunningJob_atMaxAttempts_isFailedWorkerLost`
- `CutJobHandlerTest.cancelRequested_stopsBetweenClips_andDestroysProcess`
- `CutJobHandlerTest.completedClip_upsertsVideoPartWithRealSize`

Integration (Postgres thật qua Testcontainers hoặc `TEST_DATABASE_URL`, theo AD-7):

- `JobQueueIntegrationTest.twoWorkers_neverPickSameJob` (2 luồng cùng lấy 100 job; mỗi job chỉ được chạy đúng 1 lần)
- `JobQueueIntegrationTest.pick_skipsOwnerAtPerUserLimit` (AC-6)
- `JobQueueIntegrationTest.crashAndRequeue_attemptsIsTwo` (AC-1)
- `JobQueueIntegrationTest.staleWorker_cannotOverwriteResult` (AC-9)
- `JobQueueIntegrationTest.jobSurvivesContextRestart` (đóng và mở lại `ApplicationContext`)
- `JobControllerTest.getJob_noAccess_returns404`
- `JobControllerTest.cancel_viewerOnly_returns403`

Giữ nguyên và sửa cho chạy qua: `BatchVideoCutServiceTest`, `VideoControllerTest` (theo CONSTRAINTS §1, không được xoá test).

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Neon free tier tự ngủ, worker hỏi DB mỗi giây làm Neon không ngủ được | Tốn compute-hour | Tăng `fixedDelay` lên 5 giây khi không có job nào trong 10 phút; chốt lại ở câu hỏi mở |
| Job bị chạy 2 lần (worker cũ chưa chết hẳn khi reaper đã đưa job về hàng đợi) | Clip bị ghi đè hai lần | Fencing (FR-4b) chặn worker cũ ghi kết quả; handler idempotent: ghi ra tệp tạm rồi rename, upsert `video_parts` theo `uq_topic_part` |
| Bảng `jobs` phình to | DB chậm | F17 dọn job cũ hơn 30 ngày |
| Ghi progress quá dày | Nghẽn connection pool | Mỗi job ghi tối đa 1 lần/giây (FR-3) |
| Tiến trình ffmpeg con vẫn sống khi JVM chết | Tiến trình mồ côi chiếm CPU | Dùng `ProcessHandle.descendants().forEach(destroyForcibly)` khi huỷ; khi Docker restart (F14) container sẽ dọn sạch |

## 10. Câu hỏi mở

- [x] Test dùng Postgres thật: **Đã chốt theo AD-7** (Testcontainers cần duyệt; nếu không được duyệt thì dùng `TEST_DATABASE_URL` trỏ tới một nhánh Neon `test` riêng).
- [ ] Giữ job đã kết thúc 30 ngày có hợp lý không?
- [ ] Giới hạn đồng thời mặc định (CUT=2, TRANSCRIBE=1) phụ thuộc cấu hình máy chủ thật. Server dự kiến có bao nhiêu CPU/RAM? Có GPU cho Whisper không?
- [ ] Có cần mức ưu tiên (ví dụ Admin hoặc gói trả phí chạy trước) ngay từ bản này không?
