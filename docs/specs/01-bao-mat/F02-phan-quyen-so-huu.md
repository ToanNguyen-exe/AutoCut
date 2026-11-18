# F02 — Phân quyền & sở hữu dữ liệu

| Mục | Giá trị |
|---|---|
| **Mã** | F02 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (chính) · SV4 (ẩn/hiện nút theo quyền) |
| **Phụ thuộc** | F13, F01. F00 nên xong trước để kiểm quyền theo `videoId` thay vì tên tệp |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Dùng `spring-boot-starter-security` đã duyệt ở F01 (`@PreAuthorize`) |
| **Tham khảo** | Kaltura (Owner, Co-editor, Viewer), Google Drive (chia sẻ theo người) |

> **Cập nhật 18/11/2026:** Sửa migration role (DEFAULT `INSTRUCTOR`, chuẩn hoá mọi giá trị lạ trước khi thêm CHECK); thêm quyền `REVIEWER` và đổi tên dịch vụ thành `AccessService` (AD-1); gán video mồ côi trong `BootstrapAdminRunner` thay vì migration; liệt kê đủ mọi endpoint cũ cần kiểm tra quyền; đổi `sha256_hash` thành `UNIQUE(owner_id, sha256_hash)`; mã lỗi theo AD-2.

## 1. Bối cảnh & vấn đề
- [VideoController.java:347-354](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L347-L354): `GET /list` trả `videoRepository.findAll()`, nghĩa là **mọi người thấy video của mọi người**.
- [VideoController.java:358-363](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L358-L363): `GET /{id}` không kiểm tra chủ sở hữu, đoán ID là xem được video của người khác (lỗi IDOR).
- `VideoEntity.ownerId` đã có ([VideoEntity.java:17-18](../../../backend/src/main/java/com/autocut/entity/VideoEntity.java#L17-L18)) nhưng khi upload không ai gán giá trị.
- [BatchVideoCutService.java:137](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L137) lấy tên `user` **từ body request** (`req.user()`), nên client có thể ghi clip vào thư mục của người khác. `download-zip?user=` cũng vậy ([VideoController.java:1601-1610](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1601-L1610)).
- Vai trò hiện chỉ là chuỗi mô tả trong `users.json` (ví dụ `"Giảng viên / Trưởng nhóm"`), không dùng để kiểm tra quyền.

## 2. Mục tiêu
- Bốn vai trò hệ thống: `ADMIN`, `INSTRUCTOR` (giảng viên), `EDITOR` (biên tập viên), `VIEWER` (người xem).
- Mỗi video có chủ sở hữu. Chủ sở hữu có thể cấp quyền `EDITOR`, `REVIEWER` hoặc `VIEWER` trên **từng video** cho người khác. Đây là **bảng quyền duy nhất** trên video của toàn hệ thống (AD-1); F35, F36, F49 dùng lại, không tạo bảng khác.
- Danh tính người gọi **luôn lấy từ JWT**, không bao giờ lấy từ body hay query.

### Ngoài phạm vi
- Phân quyền theo tổ chức (xem F49).
- Link chia sẻ công khai (xem F40).
- Giao diện mời nhóm đầy đủ (xem F36). F02 chỉ cung cấp API cấp quyền.

## 3. User stories
- Là giảng viên, tôi chỉ thấy video tôi upload và video người khác chia sẻ cho tôi.
- Là giảng viên, tôi muốn cho trợ giảng quyền biên tập một video mà không cho xoá video đó.
- Là Admin, tôi muốn xem mọi video để hỗ trợ khi có sự cố.
- Là người xem, tôi chỉ xem và tải clip, không sửa được phân đoạn.

## 4. Yêu cầu chức năng
- **FR-1** Ma trận quyền ở cấp hệ thống:

| Hành động | ADMIN | INSTRUCTOR | EDITOR | VIEWER |
|---|---|---|---|---|
| Upload video mới | ✔ | ✔ | ✘ | ✘ |
| Quản lý user | ✔ | ✘ | ✘ | ✘ |
| Xem mọi video | ✔ | ✘ | ✘ | ✘ |

- **FR-2** Ma trận quyền trên **một video** (`video_access.permission`). Mỗi ô ✔ tương ứng một giá trị của enum `Permission` dùng trong `AccessService.require(...)`:

| Hành động (`Permission`) | OWNER | EDITOR | REVIEWER | VIEWER |
|---|---|---|---|---|
| Xem, phát, đọc transcript (`VIEW`) | ✔ | ✔ | ✔ | ✔ |
| Tải clip, tải ZIP (`DOWNLOAD`) | ✔ | ✔ | ✔ | ✔ |
| Bình luận theo mốc giờ (`COMMENT`, F35) | ✔ | ✔ | ✔ | ✘ |
| Duyệt / yêu cầu sửa (`REVIEW`, F35) | ✔ | ✘ | ✔ | ✘ |
| Analyze, sửa phân đoạn, save, cut, render (`EDIT`) | ✔ | ✔ | ✘ | ✘ |
| Xoá video, cấp quyền (`MANAGE`) | ✔ | ✘ | ✘ | ✘ |

  ADMIN hệ thống có mọi quyền trên mọi video. Sau F49, `ORG_ADMIN` của tổ chức sở hữu video có quyền như OWNER (AD-1); phần này do F49 thêm vào `AccessService`.

- **FR-3** Khi upload, gán `owner_id` bằng user hiện tại và tạo dòng `video_access(OWNER)`.
- **FR-4** `GET /list` chỉ trả các video user có quyền. ADMIN thấy tất cả.
- **FR-5** (AD-2) Người **không có quyền `VIEW`** trên video thì mọi request tới video đó và tài nguyên con (topic, part, job, transcript, comment…) đều trả **404** với mã tương ứng (`VIDEO_NOT_FOUND`, `JOB_NOT_FOUND`…), không trả 403, để không lộ việc tài nguyên có tồn tại.
- **FR-6** (AD-2) Có quyền `VIEW` nhưng thiếu quyền cho hành động thì trả **403** `FORBIDDEN_ACTION`.
- **FR-7** Thư mục output và key R2 dùng `userId` số lấy từ JWT: `users/{ownerId}/{lesson}/...`. Bỏ tham số `user` khỏi `CutRequestDTO` và `download-zip` (hàm frontend `getDownloadZipUrl`).
- **FR-8** Video cũ có `owner_id IS NULL`: **`BootstrapAdminRunner` của F01** gán cho Admin có `id` nhỏ nhất, rồi tạo dòng `video_access(OWNER)`. Không làm việc này trong migration, vì Flyway chạy **trước** runner nên lúc migration chạy có thể chưa có Admin nào. Runner chạy lại mỗi lần khởi động, không gây hại vì chỉ đụng tới video `owner_id IS NULL`.
- **FR-9** Hai người upload cùng một tệp thì mỗi người có **bản video riêng**: đổi ràng buộc thành `UNIQUE(owner_id, sha256_hash)`. Cache transcript vẫn dùng chung theo hash (cache là dữ liệu dẫn xuất, không chứa thông tin của người dùng khác). Upload trùng của **cùng một người** thì trả lại video đã có, như hiện nay.

## 5. Yêu cầu phi chức năng
- Kiểm tra quyền xong trong < 5 ms (1 truy vấn có index).
- Logic kiểm tra quyền đặt ở **một chỗ duy nhất** (`AccessService`), không rải ở từng controller.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__rbac.sql`:
```sql
-- 1. Chuẩn hoá role: mọi giá trị ngoài danh sách (kể cả 'MEMBER', NULL, chữ thường) → INSTRUCTOR
UPDATE users SET role = UPPER(TRIM(role)) WHERE role IS NOT NULL;
UPDATE users SET role = 'INSTRUCTOR'
 WHERE role IS NULL OR role NOT IN ('ADMIN','INSTRUCTOR','EDITOR','VIEWER');
-- 2. Đổi DEFAULT trước khi thêm CHECK, nếu không mọi INSERT không ghi role sẽ lỗi
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'INSTRUCTOR';
ALTER TABLE users ADD CONSTRAINT chk_user_role
  CHECK (role IN ('ADMIN','INSTRUCTOR','EDITOR','VIEWER'));

-- 3. Bảng quyền duy nhất trên video (AD-1)
CREATE TABLE IF NOT EXISTS video_access (
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(10) NOT NULL CHECK (permission IN ('OWNER','EDITOR','REVIEWER','VIEWER')),
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (video_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_video_access_user ON video_access(user_id);

-- 4. Video đã có chủ thì tạo dòng OWNER. Video mồ côi do BootstrapAdminRunner xử lý (FR-8)
INSERT INTO video_access(video_id, user_id, permission)
SELECT id, owner_id, 'OWNER' FROM videos WHERE owner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. Mỗi người một bản video (FR-9). Migration riêng `V<ts>__video_hash_per_owner.sql`, do F02 sở hữu.
--    Viết IF EXISTS / IF NOT EXISTS để nếu F11 merge trước và đã tạo thì không lỗi.
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_sha256_hash_key;
ALTER TABLE videos ALTER COLUMN sha256_hash DROP NOT NULL;  -- upload multipart (F11) chỉ có hash sau khi job TRANSCRIBE tính xong
CREATE UNIQUE INDEX IF NOT EXISTS uq_videos_owner_sha ON videos(owner_id, sha256_hash) WHERE sha256_hash IS NOT NULL;
```
> Tên ràng buộc `videos_sha256_hash_key` là tên Postgres tự đặt cho `UNIQUE` trong `schema.sql:28`. Trước khi chạy, kiểm tra lại bằng `\d videos` trên Neon. Lưu ý: `UNIQUE(owner_id, sha256_hash)` cho phép nhiều dòng `owner_id IS NULL` trùng hash; điều này chấp nhận được vì runner FR-8 sẽ gán chủ ngay sau đó.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/access` | OWNER | Danh sách người có quyền |
| PUT | `/api/v1/videos/{id}/access/{userId}` | OWNER | Cấp hoặc đổi quyền `{ "permission": "EDITOR" }` |
| DELETE | `/api/v1/videos/{id}/access/{userId}` | OWNER | Thu hồi quyền (không thu hồi được OWNER) |
| PATCH | `/api/v1/admin/users/{id}/role` | ADMIN | Đổi vai trò hệ thống |

Các endpoint `/api/video/**` cũ được gắn kiểm tra quyền theo bảng FR-2.

```json
// GET /api/v1/videos/12/access → 200
[ { "userId": 1, "email": "gv@x.vn", "fullName": "Nguyễn Văn A", "permission": "OWNER" },
  { "userId": 5, "email": "tg@x.vn", "fullName": "Trần B", "permission": "EDITOR" } ]
```

### 6.3 Backend
- Tạo `com.autocut.auth.VideoAccessEntity`, `VideoAccessRepository`.
- Tạo `AccessService` (AD-1), chỗ **duy nhất** kiểm tra quyền trên video:
  - `void require(AuthPrincipal p, Long videoId, Permission perm)`: không có `VIEW` thì ném `NotFoundException("VIDEO_NOT_FOUND")` (→ 404); có `VIEW` nhưng thiếu `perm` thì ném `ForbiddenActionException` (→ 403 `FORBIDDEN_ACTION`).
  - `Permission`: `VIEW`, `DOWNLOAD`, `COMMENT`, `REVIEW`, `EDIT`, `MANAGE` (bảng FR-2).
  - `Set<Permission> permissionsOf(p, videoId)`: frontend dùng để ẩn/hiện nút.
  - `List<Long> visibleVideoIds(p)`.
  - **Điểm mở rộng cho F49:** mọi quyết định đi qua một hàm private `effectivePermissions(p, video)`, gồm: ADMIN hệ thống → mọi quyền; dòng `video_access` của user → quyền theo FR-2; **nhánh tổ chức (F49 thêm vào đây, không viết chỗ khác):** nếu `video.org_id` khác null và user là `ORG_OWNER`/`ORG_ADMIN` của tổ chức đó thì có quyền như `OWNER`. Kết quả là hợp (union) của các nhánh. `visibleVideoIds` cũng phải thêm nhánh tổ chức tương ứng.
    - **Nhánh khoá học (F41 thêm vào đây):** user có dòng `course_enrollments` trong một khoá học `PUBLISHED` thì có quyền `VIEW` (chỉ `VIEW`, không có `DOWNLOAD` trừ khi khoá học cho phép) trên các **part ở trạng thái RELEASE** thuộc khoá học đó. Nhánh này cấp quyền theo **part**, nên `AccessService` có thêm `requirePart(p, partId, Permission)`. Nhánh này không mở quyền xem toàn bộ video gốc hay transcript của giảng viên.
- Tạo `CurrentUser` để lấy `AuthPrincipal` từ `SecurityContextHolder`.
- Mở rộng `BootstrapAdminRunner` (F01) cho FR-8.
- Sửa **mọi** endpoint trong `VideoController` (đã đối chiếu đủ 24 mapping, [VideoController.java:164-1725](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L164-L1725)):

  | Endpoint | Quyền |
  |---|---|
  | `POST /upload-sample` | Role ADMIN hoặc INSTRUCTOR; người gọi thành OWNER |
  | `GET /list` | Lọc theo `visibleVideoIds` |
  | `GET /latest` | Chỉ trả video mới nhất **trong số video người gọi xem được** |
  | `GET /{id}`, `GET /{id}/segments`, `GET /{id}/transcripts`, `GET /{id}/db-project` | `VIEW` |
  | `GET /project`, `GET /load` (theo `videoName`/`lesson`) | Tra video theo tên trong số video người gọi xem được, rồi `VIEW` |
  | `GET /stream/{hash}` | Tra theo `(owner_id, sha256_hash)` trong số video xem được, rồi `VIEW`. Xác thực bằng vé `STREAM` (F01 FR-10) |
  | `GET /cache/{hash}` | Chỉ trả `true` khi người gọi có một video với hash này (không cho dò hash của người khác) |
  | `GET /download-clip`, `GET /download-zip` | `DOWNLOAD` (sau F04: tải theo `clipId`) |
  | `GET /cut/status` | Người gọi phải có `VIEW` trên video của job, nếu không trả 404 |
  | `POST /analyze`, `POST /save`, `POST /{id}/segments`, `POST /render`, `POST /cut`, `POST /concat`, `POST /cut-points` | `EDIT` |
  | `GET /cut-points` | `VIEW` trên video tương ứng. Hiện endpoint đọc `cut_points.json` chung ở gốc repo, nên phải đổi sang đọc theo `videoId` (F00) |
  | `GET /config` | Đã đăng nhập; **không** trả khoá API hay đường dẫn máy chủ |
  | `GET /mock-segments`, `GET /mock-transcript` | Chỉ bật ở profile `dev` (`@Profile("dev")`); ở `prod` trả 404 |
  | `GET /` (`HomeController`) | Public |

- Endpoint đang nhận `hash`, `videoName` hoặc `lesson` thay vì `id`: tra `VideoEntity` **trong phạm vi video người gọi xem được**, rồi mới kiểm tra quyền.
- `BatchVideoCutService.submit`: nhận thêm `ownerId` và `videoId` từ controller, không đọc `req.user()` nữa. Sau F09, quyền xem job đi theo quyền xem video của job.

### 6.5 Frontend
- Thêm `role` vào context user hiện tại (từ `/auth/me`).
- Ẩn nút "Thêm video" khi role là EDITOR hoặc VIEWER. Ẩn nút sửa, cắt, lưu khi người dùng không có quyền `EDIT` (API `/videos/{id}` trả thêm `myPermissions: ["VIEW","DOWNLOAD",…]`).
- Bỏ tham số `user` khỏi `getDownloadZipUrl()` trong [api.ts:235-236](../../../frontend/src/lib/api.ts#L235-L236).

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* A upload video V, B không được chia sẻ *When* B gọi `GET /api/video/{V}` *Then* nhận 404.
- **AC-2** — *Given* A và B mỗi người có 2 video *When* A gọi `/list` *Then* nhận đúng 2 video của A.
- **AC-3** — *Given* A cấp cho B quyền VIEWER trên V *When* B gọi `POST /api/video/save` cho V *Then* nhận 403 `FORBIDDEN_ACTION`; còn `GET /{V}/segments` nhận 200.
- **AC-4** — *Given* B là EDITOR trên V *When* B gọi `DELETE /videos/V/access/A` (A là OWNER) *Then* nhận 403.
- **AC-5** — *Given* B gửi `POST /cut` với body `"user":"A"` *When* job chạy *Then* clip nằm ở `users/{B.id}/...`, không phải của A.
- **AC-6** — *Given* ADMIN *When* gọi `/list` *Then* thấy video của mọi người.
- **AC-7** — *Given* DB có video `owner_id IS NULL` *When* khởi động backend (migration rồi `BootstrapAdminRunner`) *Then* `SELECT COUNT(*) FROM videos WHERE owner_id IS NULL` trả 0, và mỗi video có đúng một dòng `video_access` `OWNER`.
- **AC-8** — *Given* migration đã chạy *When* `INSERT INTO users(email, password_hash) VALUES (…)` không ghi role *Then* thành công với `role='INSTRUCTOR'`. *Given* DB cũ có user `role='Giảng viên'` *Then* sau migration thành `INSTRUCTOR`.
- **AC-9** — *Given* A và B cùng upload một tệp *Then* có 2 dòng `videos` khác `id`, cùng `sha256_hash`; B không thấy video của A. *Given* B gọi `GET /cache/{hash}` với hash chỉ A có *Then* nhận `false`.
- **AC-10** — *Given* profile `prod` *When* gọi `/api/video/mock-segments` *Then* nhận 404.
- **AC-11** — *Given* B là REVIEWER trên V *When* B gọi `POST /api/video/cut` cho V *Then* nhận 403; *When* B mở `GET /{V}/segments` *Then* 200.

## 8. Kế hoạch kiểm thử (TDD)
- `AccessServiceTest`: `owner_canEdit`, `viewer_cannotEdit_throwsForbiddenAction`, `reviewer_canReview_cannotEdit`, `stranger_view_throwsNotFound`, `admin_canViewAll`.
- `VideoAccessControllerIT`: các AC 1, 3, 4, 6, 11.
- `BatchVideoCutServiceTest` thêm `submit_ignoresBodyUser_usesPrincipalId` (AC-5).
- `BootstrapAdminRunnerTest`: `assignsOrphanVideosToFirstAdmin`, `idempotentOnSecondRun` (AC-7).
- `RbacMigrationIT` (Postgres theo AD-7): AC-8, AC-9 (phần ràng buộc unique).
- `EndpointAuthorizationCoverageIT`: duyệt mọi `@RequestMapping` bằng `RequestMappingHandlerMapping`; gọi bằng user lạ phải nhận 401, 403 hoặc 404; gọi `/mock-*` ở profile `prod` phải nhận 404 (AC-10). `SchemaMigrationTest` hiện có **không** được chạy trên `DATABASE_URL` production (AD-7).

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Sót một endpoint chưa gắn kiểm tra quyền | Rò rỉ dữ liệu | Viết test quét mọi `@RequestMapping`: gọi bằng user lạ phải nhận 401, 403 hoặc 404 (`EndpointAuthorizationCoverageIT`) |
| Trùng `sha256_hash` khi 2 người upload cùng 1 tệp: cột này đang `UNIQUE` toàn cục | Người thứ 2 bị chặn hoặc "mượn" video của người 1 | Đổi thành `UNIQUE(owner_id, sha256_hash)` (FR-9) |
| Tên ràng buộc unique cũ trên Neon khác `videos_sha256_hash_key` | Migration không xoá được ràng buộc cũ, upload trùng vẫn lỗi | Kiểm `\d videos` trước; nếu khác thì sửa tên trong migration |
| Đường dẫn output cũ dùng tên user dạng chữ | Clip cũ không tải được | Script chuyển thư mục một lần, hoặc chấp nhận chỉ áp dụng cho dữ liệu mới |

## 10. Câu hỏi mở
- [x] Hai người upload cùng một tệp: đã chốt tạo bản riêng, `UNIQUE(owner_id, sha256_hash)`, dùng chung cache transcript (FR-9).
- [x] Vai trò duyệt riêng: đã chốt thêm `REVIEWER` theo AD-1. "Trợ giảng" dùng `EDITOR`.
- [ ] EDITOR có được chạy lại analyze (tốn chi phí AI của chủ video) không? Đề xuất: có, nhưng tính vào hạn mức của chủ video (AD-9).
