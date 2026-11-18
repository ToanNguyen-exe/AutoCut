# F08 — Nhật ký thao tác (Audit log)

| Mục | Giá trị |
|---|---|
| **Mã** | F08 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (backend) · SV4 (trang xem nhật ký) |
| **Phụ thuộc** | F01, F02 |
| **Ước lượng** | M (3–4 ngày) |
| **Thư viện mới cần duyệt** | Không. Dùng Spring AOP (`spring-boot-starter-aop`, thuộc hệ sinh thái Spring Boot, vẫn cần trưởng nhóm gật đầu) hoặc gọi trực tiếp `AuditService` trong service, không cần thêm thư viện |
| **Tham khảo** | Kaltura Audit Trail, Google Workspace Admin audit log, GitHub audit log |

> **Cập nhật 18/11/2026:** Bỏ khoá ngoại `actor_user_id` (trigger chặn UPDATE xung đột với `ON DELETE SET NULL`, làm không xoá được user); tách `AuditService` (lấy actor/IP/UA ở luồng gọi) khỏi `AuditWriter` (`@Async`); AC-1 không còn phụ thuộc endpoint xoá video chưa có; test chạy trên Postgres theo AD-7; mã lỗi theo AD-2.

## 1. Bối cảnh & vấn đề
Hiện hệ thống không ghi lại **ai đã làm gì**. Khi một video hay phân đoạn bị xoá, hoặc clip bị xuất sai, không có cách nào tra ra người làm và thời điểm. Log ứng dụng (`log.info`) chỉ nằm trên console, mất khi khởi động lại, và không gắn với user (vì chưa có user thật trước F01). Bảng `topics` có xoá mềm (`status = 'DISCARDED'`, [schema.sql:96](../../../database/schema.sql#L96)) nhưng không lưu ai đã xoá.

## 2. Mục tiêu
- Ghi một bản ghi **không sửa được** cho mỗi thao tác quan trọng: ai làm, làm gì, trên đối tượng nào, lúc nào, từ IP nào, kết quả ra sao.
- Admin xem, lọc và xuất CSV nhật ký. Chủ video xem được nhật ký của video mình.
- Giữ nhật ký 365 ngày (cấu hình được).

### Ngoài phạm vi
- Ghi nhật ký thao tác **xem** (play, đọc). Phần thống kê người xem thuộc F47.
- Gửi nhật ký sang SIEM bên ngoài.
- Hoàn tác thao tác dựa trên nhật ký (xem F31/F33).

## 3. User stories
- Là Admin, tôi muốn biết ai đã xoá video "Bài 5 – OOP" hôm qua.
- Là giảng viên, tôi muốn xem lịch sử ai đã sửa phân đoạn trong video của tôi.
- Là người vận hành, tôi muốn thấy các lần đăng nhập thất bại liên tiếp để phát hiện dò mật khẩu.

## 4. Yêu cầu chức năng
- **FR-1** Danh sách hành động cần ghi (`action`):

| Nhóm | Action |
|---|---|
| Xác thực | `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`, `AUTH_PASSWORD_CHANGED`, `AUTH_TOKEN_REUSE_DETECTED` |
| User | `USER_CREATED`, `USER_ROLE_CHANGED`, `USER_DISABLED` |
| Video | `VIDEO_UPLOADED`, `VIDEO_ANALYZED`, `VIDEO_ACCESS_GRANTED`, `VIDEO_ACCESS_REVOKED`; `VIDEO_TRASHED`, `VIDEO_RESTORED`, `VIDEO_DELETED` (ghi khi F17 thêm chức năng xoá/thùng rác) |
| Biên tập | `SEGMENTS_SAVED`, `PROJECT_SAVED` |
| Xuất bản | `CUT_JOB_STARTED`, `CUT_JOB_FINISHED`, `CLIP_DOWNLOADED`, `ZIP_DOWNLOADED`, `CONCAT_CREATED` |
| Cấu hình | `AI_KEY_UPDATED`, `AI_KEY_DELETED` |

- **FR-2** Mỗi bản ghi gồm: `occurred_at`, `actor_user_id` (có thể NULL khi đăng nhập thất bại; **không** có khoá ngoại tới `users`, để xoá user không phải sửa nhật ký), `actor_email` (lưu kèm để còn đọc được khi user bị xoá), `action`, `target_type` (`VIDEO`, `USER`, `TOPIC`, `JOB`, `AI_KEY`), `target_id`, `ip`, `user_agent`, `outcome` (`SUCCESS` / `FAILURE`), `metadata` (JSONB, ví dụ `{ "segmentsCount": 12 }`).
- **FR-3** **Không ghi** mật khẩu, token, khoá API hay số điện thoại vào `metadata`. `AuditService` có danh sách khoá bị cấm và tự che giá trị của các khoá này.
- **FR-4** Bảng chỉ được INSERT. Không có API sửa hay xoá. Trigger DB chặn mọi `UPDATE`. `DELETE` chỉ do job dọn nội bộ thực hiện (FR-7).
- **FR-5** Ghi nhật ký **không được làm hỏng** thao tác chính: nếu ghi lỗi thì log ERROR và cho thao tác chính tiếp tục. Ghi bất đồng bộ với hàng đợi giới hạn, chia làm hai bước:
  1. **Ở luồng xử lý request** (đồng bộ): `AuditService.record(...)` đọc actor (`userId`, `email`) từ `SecurityContextHolder`, đọc IP và user-agent từ `RequestContextHolder`, che các khoá bị cấm, rồi tạo một đối tượng bất biến `AuditEvent`. Phải làm ở bước này vì `SecurityContext` và `RequestContextHolder` gắn với **luồng hiện tại**; sang luồng nền sẽ trả về null.
  2. **Ở luồng nền**: `AuditWriter.write(AuditEvent)` có `@Async("auditExecutor")` chỉ INSERT. `AuditWriter` phải là **bean riêng**, vì gọi một hàm `@Async` trong cùng lớp sẽ không đi qua proxy của Spring và chạy đồng bộ.
  - Sự kiện phát sinh **ngoài request** (job cắt xong, job dọn) thì truyền actor vào tường minh: `record(..., Actor.system())` hoặc `Actor.of(job.ownerId)`. `Actor.system()` ghi `actor_user_id = NULL`, `actor_email = 'system'` (ví dụ job dọn thùng rác của F17 ghi `VIDEO_DELETED`).
- **FR-6** `GET /api/v1/admin/audit-logs` có lọc theo `actorId`, `action`, `targetType`, `targetId`, `from`, `to`, phân trang (`page`, `size` ≤ 100), sắp xếp mới nhất trước.
- **FR-7** Job `@Scheduled` chạy hằng ngày lúc 03:00, xoá bản ghi cũ hơn `autocut.audit.retention-days` (mặc định 365).
- **FR-8** `GET /api/v1/admin/audit-logs/export.csv` xuất cùng bộ lọc, tối đa 100.000 dòng, trả dạng luồng.
- **FR-9** `GET /api/v1/videos/{id}/audit-logs` cho OWNER xem nhật ký của video đó.

## 5. Yêu cầu phi chức năng
- Ghi nhật ký thêm < 2 ms vào thời gian xử lý request (vì ghi bất đồng bộ).
- Truy vấn lọc theo `target` hoặc `actor` trong 30 ngày trả về < 300 ms với 1 triệu dòng.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__audit_logs.sql`:
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id BIGINT,          -- CỐ Ý không có FK: ON DELETE SET NULL là một UPDATE, sẽ bị trigger chặn
    actor_email VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(20),
    target_id VARCHAR(64),
    outcome VARCHAR(10) NOT NULL DEFAULT 'SUCCESS',
    ip VARCHAR(45),
    user_agent VARCHAR(255),
    metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id, occurred_at DESC);

-- Chặn UPDATE ở mức DB (append-only). DELETE vẫn được phép cho job dọn (FR-7)
CREATE OR REPLACE FUNCTION audit_logs_no_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs là append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_no_update();
```

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/admin/audit-logs` | ADMIN | Lọc + phân trang |
| GET | `/api/v1/admin/audit-logs/export.csv` | ADMIN | Xuất CSV |
| GET | `/api/v1/videos/{id}/audit-logs` | Quyền `MANAGE` (OWNER) | Nhật ký của 1 video. Không xem được video thì 404, xem được nhưng không phải OWNER thì 403 (AD-2) |

```json
// GET /api/v1/admin/audit-logs?action=VIDEO_DELETED&page=0&size=20 → 200
{ "items": [ { "id": 981, "occurredAt": "2026-11-16T09:12:44Z", "actor": { "id": 3, "email": "gv@x.vn" },
               "action": "VIDEO_DELETED", "target": { "type": "VIDEO", "id": "42" },
               "outcome": "SUCCESS", "ip": "203.0.113.5", "metadata": { "fileName": "bai5_oop.mp4" } } ],
  "page": 0, "size": 20, "total": 1 }
```

### 6.3 Backend
Tạo mới trong `com.autocut.audit`:
- `AuditLogEntity`, `AuditLogRepository` (dùng `JpaSpecificationExecutor` để lọc).
- `AuditAction` (enum theo FR-1).
- `AuditEvent` (record bất biến): actor, action, target, outcome, ip, userAgent, metadata đã che, occurredAt.
- `AuditService.record(AuditAction, String targetType, String targetId, Map<String,Object> metadata)` và bản có tham số `Actor`: **chạy đồng bộ** ở luồng gọi, tạo `AuditEvent` theo FR-5 bước 1, rồi gọi `auditWriter.write(event)`. Mọi lỗi đều bị bắt và log ERROR.
- `AuditWriter.write(AuditEvent)` (bean riêng, `@Async("auditExecutor")`): INSERT vào `audit_logs`.
- `AuditConfig`: `ThreadPoolTaskExecutor` 1–2 luồng, hàng đợi 1.000; khi đầy thì `CallerRunsPolicy`.
- `AuditRetentionJob` (`@Scheduled(cron = "0 0 3 * * *")`).
- `AuditController`.

Gọi `auditService.record(...)` **tường minh** tại: `AuthService` (F01), `AccessService` và API cấp quyền (F02), `AiKeyService` (F07), và trong `VideoController` ở upload, analyze, save, segments POST, cut, download-clip, download-zip, concat. Với job cắt, gọi trong `BatchVideoCutService` khi job xong (`CUT_JOB_FINISHED` kèm số clip thành công/thất bại).

Chọn gọi tường minh thay vì AOP để code dễ đọc và không cần thêm dependency (YAGNI theo CONSTRAINTS §3).

### 6.5 Frontend
- Trang `frontend/src/app/admin/audit/page.tsx` (chỉ ADMIN): bảng có các cột Thời gian (giờ Việt Nam), Người làm, Hành động (nhãn tiếng Việt, ví dụ `VIDEO_DELETED` → "Xoá video"), Đối tượng, Kết quả, IP. Có bộ lọc và nút "Xuất CSV".
- Tab "Lịch sử" trong chi tiết video, chỉ OWNER thấy.
- Trạng thái rỗng: "Chưa có hoạt động nào trong khoảng thời gian này".

## 7. Tiêu chí chấp nhận
- **AC-1** — *When* user A cấp quyền EDITOR trên video 42 cho B (F02) *Then* có đúng 1 bản ghi `VIDEO_ACCESS_GRANTED`, `actor_user_id=A`, `actor_email` của A, `target_id='42'`, `ip` khác null (tức là actor và IP đã được lấy đúng dù ghi bất đồng bộ).
- **AC-2** — *When* đăng nhập sai với email `x@y.vn` *Then* có bản ghi `AUTH_LOGIN_FAILED`, `actor_user_id` NULL, `actor_email='x@y.vn'`, và `metadata` không chứa mật khẩu.
- **AC-3** — *When* chạy `UPDATE audit_logs SET action='X'` *Then* Postgres báo lỗi.
- **AC-4** — *Given* bảng `audit_logs` bị lỗi ghi (giả lập) *When* user lưu phân đoạn *Then* thao tác lưu vẫn trả 200.
- **AC-5** — *Given* user không phải ADMIN *When* gọi `/admin/audit-logs` *Then* nhận 403 `FORBIDDEN_ACTION`.
- **AC-6** — *Given* bản ghi 400 ngày tuổi *When* job dọn chạy *Then* bản ghi đó bị xoá, bản ghi 10 ngày tuổi vẫn còn.
- **AC-7** — *When* `AI_KEY_UPDATED` được ghi *Then* `metadata` chỉ có `provider` và `keyHint`, không có khoá gốc.
- **AC-8** — *Given* user C có 5 bản ghi nhật ký *When* xoá user C khỏi bảng `users` *Then* lệnh xoá thành công, 5 bản ghi vẫn còn nguyên `actor_user_id` và `actor_email`.
- **AC-9** — *Given* job cắt của user A chạy xong ở luồng nền *Then* bản ghi `CUT_JOB_FINISHED` có `actor_user_id=A` (không null).

## 8. Kế hoạch kiểm thử (TDD)
- `AuditServiceTest`: `record_capturesActorAndIpOnCallingThread` (giả lập `AuditWriter` chạy ở luồng khác, sự kiện vẫn có actor và IP), `record_masksForbiddenKeys` (password, token, apiKey, phone), `record_failure_doesNotPropagate`, `record_withExplicitActor_outsideRequest`.
- `AuditRetentionJobTest`: AC-6, dùng `Clock` giả.
- `AuditControllerIT`: lọc theo action và khoảng thời gian, phân trang, AC-5.
- `AuditIntegrationIT`: AC-1, AC-2 (chạy luồng thật qua MockMvc, dùng `Awaitility` hoặc vòng chờ đơn giản cho `@Async`. Nếu cần Awaitility thì phải xin duyệt; nếu không thì cấu hình executor đồng bộ trong profile test).
- `AuditMigrationIT` (Postgres theo AD-7, **không** chạy trên DB production): AC-3, AC-8.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Quên gọi `record()` ở endpoint mới | Lỗ hổng trong nhật ký | Checklist trong mẫu PR: "Endpoint ghi dữ liệu này đã ghi audit chưa?" |
| Bảng phình to | Truy vấn chậm, tốn dung lượng Neon | Đã có index và job dọn; về sau có thể partition theo tháng |
| Ghi bất đồng bộ bị mất khi tắt máy đột ngột | Thiếu vài bản ghi | Chấp nhận ở MVP; graceful shutdown chờ executor xong (`setWaitForTasksToCompleteOnShutdown(true)`) |

## 10. Câu hỏi mở
- [ ] Thời gian giữ nhật ký: 365 ngày hay theo quy định của trường?
- [ ] Có ghi `CLIP_DOWNLOADED` cho người xem công khai (F40) không? Lượng ghi có thể rất lớn.
- [ ] IP có được coi là dữ liệu cá nhân cần che bớt (ví dụ chỉ lưu /24) không?
