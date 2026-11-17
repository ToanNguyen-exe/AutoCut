# F02 — Phân quyền & sở hữu dữ liệu

| Mục | Giá trị |
|---|---|
| **Mã** | F02 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (chính) · SV4 (ẩn/hiện nút theo quyền) |
| **Phụ thuộc** | F01 |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không. Dùng `spring-boot-starter-security` đã duyệt ở F01 (`@PreAuthorize`) |
| **Tham khảo** | Kaltura (Owner, Co-editor, Viewer), Google Drive (chia sẻ theo người) |

## 1. Bối cảnh & vấn đề
- [VideoController.java:347-354](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L347-L354): `GET /list` trả `videoRepository.findAll()`, nghĩa là **mọi người thấy video của mọi người**.
- [VideoController.java:358-363](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L358-L363): `GET /{id}` không kiểm tra chủ sở hữu, đoán ID là xem được video của người khác (lỗi IDOR).
- `VideoEntity.ownerId` đã có ([VideoEntity.java:17-18](../../../backend/src/main/java/com/autocut/entity/VideoEntity.java#L17-L18)) nhưng khi upload không ai gán giá trị.
- [BatchVideoCutService.java:137](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java#L137) lấy tên `user` **từ body request** (`req.user()`), nên client có thể ghi clip vào thư mục của người khác. `download-zip?user=` cũng vậy ([VideoController.java:1601-1610](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1601-L1610)).
- Vai trò hiện chỉ là chuỗi mô tả trong `users.json` (ví dụ `"Giảng viên / Trưởng nhóm"`), không dùng để kiểm tra quyền.

## 2. Mục tiêu
- Bốn vai trò hệ thống: `ADMIN`, `INSTRUCTOR` (giảng viên), `EDITOR` (biên tập viên), `VIEWER` (người xem).
- Mỗi video có chủ sở hữu. Chủ sở hữu có thể cấp quyền `EDITOR` hoặc `VIEWER` trên **từng video** cho người khác.
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

- **FR-2** Ma trận quyền trên **một video** (`video_access.permission`):

| Hành động | OWNER | EDITOR | VIEWER |
|---|---|---|---|
| Xem, phát, đọc transcript | ✔ | ✔ | ✔ |
| Tải clip, tải ZIP | ✔ | ✔ | ✔ |
| Analyze, sửa phân đoạn, save, cut, render | ✔ | ✔ | ✘ |
| Xoá video, cấp quyền | ✔ | ✘ | ✘ |

- **FR-3** Khi upload, gán `owner_id` bằng user hiện tại và tạo dòng `video_access(OWNER)`.
- **FR-4** `GET /list` chỉ trả các video user có quyền. ADMIN thấy tất cả.
- **FR-5** Truy cập video không có quyền thì trả **404** `VIDEO_NOT_FOUND`, không trả 403, để không lộ việc video có tồn tại.
- **FR-6** Có quyền xem nhưng không có quyền sửa thì trả 403 `FORBIDDEN`.
- **FR-7** Thư mục output và key R2 dùng `userId` số lấy từ JWT: `users/{ownerId}/{lesson}/...`. Bỏ tham số `user` khỏi `CutRequestDTO` và `download-zip`.
- **FR-8** Video cũ có `owner_id IS NULL`: migration gán cho Admin bootstrap.

## 5. Yêu cầu phi chức năng
- Kiểm tra quyền xong trong < 5 ms (1 truy vấn có index).
- Logic kiểm tra quyền đặt ở **một chỗ duy nhất** (`VideoAccessService`), không rải ở từng controller.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V3__rbac.sql`:
```sql
UPDATE users SET role = 'INSTRUCTOR' WHERE role = 'MEMBER';
ALTER TABLE users ADD CONSTRAINT chk_user_role
  CHECK (role IN ('ADMIN','INSTRUCTOR','EDITOR','VIEWER'));

CREATE TABLE IF NOT EXISTS video_access (
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(10) NOT NULL CHECK (permission IN ('OWNER','EDITOR','VIEWER')),
    granted_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (video_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_video_access_user ON video_access(user_id);

-- Gán video mồ côi cho admin đầu tiên
UPDATE videos SET owner_id = (SELECT id FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1)
 WHERE owner_id IS NULL;
INSERT INTO video_access(video_id, user_id, permission)
SELECT id, owner_id, 'OWNER' FROM videos WHERE owner_id IS NOT NULL
ON CONFLICT DO NOTHING;
```

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
- Tạo `VideoAccessService`:
  - `requireView(Long videoId, AuthPrincipal p)`
  - `requireEdit(...)`
  - `requireOwner(...)`
  - `List<Long> visibleVideoIds(p)`

  Ném `VideoNotFoundException` (→ 404) hoặc `ForbiddenException` (→ 403).
- Tạo `CurrentUser` để lấy `AuthPrincipal` từ `SecurityContextHolder`.
- Sửa các endpoint trong `VideoController`. Danh sách endpoint và quyền (V = view, E = edit, O = owner):
  - `/list`: lọc theo quyền.
  - `/{id}`, `/{id}/segments` (GET), `/{id}/transcripts`, `/{id}/db-project`, `/stream/{hash}`, `/download-clip`, `/download-zip`: **V**.
  - `/analyze`, `/save`, `/{id}/segments` (POST), `/render`, `/cut`, `/concat`, `/cut-points`: **E**.
  - `/upload-sample`: vai trò ADMIN hoặc INSTRUCTOR.
- Endpoint đang nhận `hash`, `videoName` hoặc `lesson` thay vì `id`: tra `VideoEntity` theo `sha256_hash` hoặc `file_name` rồi mới kiểm tra quyền.
- `BatchVideoCutService.submit`: nhận thêm `ownerId` từ controller, không đọc `req.user()` nữa.
- `/cut/status?jobId=`: lưu `ownerId` vào `JobState`; người gọi khác chủ job thì trả 404.

### 6.5 Frontend
- Thêm `role` vào context user hiện tại (từ `/auth/me`).
- Ẩn nút "Thêm video" khi role là EDITOR hoặc VIEWER. Ẩn nút sửa, cắt, lưu khi quyền trên video là VIEWER (API `/videos/{id}` trả thêm `myPermission`).
- Bỏ `user` khỏi `downloadZip()` trong [api.ts:236](../../../frontend/src/lib/api.ts#L236).

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* A upload video V, B không được chia sẻ *When* B gọi `GET /api/video/{V}` *Then* nhận 404.
- **AC-2** — *Given* A và B mỗi người có 2 video *When* A gọi `/list` *Then* nhận đúng 2 video của A.
- **AC-3** — *Given* A cấp cho B quyền VIEWER trên V *When* B gọi `POST /api/video/save` cho V *Then* nhận 403; còn `GET /{V}/segments` nhận 200.
- **AC-4** — *Given* B là EDITOR trên V *When* B gọi `DELETE /videos/V/access/A` (A là OWNER) *Then* nhận 403.
- **AC-5** — *Given* B gửi `POST /cut` với body `"user":"A"` *When* job chạy *Then* clip nằm ở `users/{B.id}/...`, không phải của A.
- **AC-6** — *Given* ADMIN *When* gọi `/list` *Then* thấy video của mọi người.
- **AC-7** — Sau migration, `SELECT COUNT(*) FROM videos WHERE owner_id IS NULL` trả 0.

## 8. Kế hoạch kiểm thử (TDD)
- `VideoAccessServiceTest`: `owner_canEdit`, `viewer_cannotEdit_throwsForbidden`, `stranger_view_throwsNotFound`, `admin_canViewAll`.
- `VideoAccessControllerIT`: các AC 1, 3, 4, 6.
- `BatchVideoCutServiceTest` thêm `submit_ignoresBodyUser_usesPrincipalId` (AC-5).
- `SchemaMigrationTest` thêm kiểm tra AC-7.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Sót một endpoint chưa gắn kiểm tra quyền | Rò rỉ dữ liệu | Viết test quét mọi `@RequestMapping`: gọi bằng user lạ phải nhận 401, 403 hoặc 404 (`EndpointAuthorizationCoverageIT`) |
| Trùng `sha256_hash` khi 2 người upload cùng 1 tệp: cột này đang `UNIQUE` toàn cục | Người thứ 2 bị chặn hoặc "mượn" video của người 1 | Chốt ở câu hỏi mở: đổi ràng buộc thành `UNIQUE(owner_id, sha256_hash)` |
| Đường dẫn output cũ dùng tên user dạng chữ | Clip cũ không tải được | Script chuyển thư mục một lần, hoặc chấp nhận chỉ áp dụng cho dữ liệu mới |

## 10. Câu hỏi mở
- [ ] Hai người upload cùng một tệp thì dùng chung video hay tạo bản riêng? Đề xuất: tạo bản riêng, đổi `UNIQUE` thành `(owner_id, sha256_hash)` nhưng vẫn dùng chung cache transcript theo hash.
- [ ] EDITOR có được chạy lại analyze (tốn chi phí AI của chủ video) không?
- [ ] Có cần vai trò "Trợ giảng" riêng hay gộp vào EDITOR?
