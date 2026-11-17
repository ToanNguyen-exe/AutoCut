# F36 — Làm việc nhóm

| Mục | Giá trị |
|---|---|
| **Mã** | F36 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (API, presence) + SV4 (giao diện) |
| **Phụ thuộc** | F01, F02 (người dùng thật, phân quyền), F33 (chống ghi đè), F10 (hạ tầng SSE — dùng chung cách đẩy sự kiện), F48 (gửi email mời, nếu có) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. Dùng `SseEmitter` có sẵn của Spring MVC và `EventSource` có sẵn của trình duyệt. |
| **Tham khảo** | Figma (avatar người đang xem), Google Docs (chia sẻ theo vai trò), Frame.io (mời người duyệt), Descript (Drive sharing) |

## 1. Bối cảnh & vấn đề

- Danh sách người dùng là tệp tĩnh [users.json](../../../frontend/src/mock-data/users.json) có 6 tài khoản (admin, sv1–sv4, demo). Quyền chỉ là chuỗi `role` để hiển thị. Không có khái niệm "video này được chia sẻ cho ai".
- Bảng `videos` có `owner_id` ([schema.sql](../../../database/schema.sql)) nhưng không có bảng thành viên. F02 sẽ giới hạn mỗi người chỉ thấy video của mình. Spec này mở rộng để **chia sẻ** video cho người khác.
- Dữ liệu dự án đang lưu theo thư mục người dùng `output/users/<user>/<lesson>` ([VideoController.java:1145-1160](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1145-L1160)), nên hai người không nhìn thấy cùng một dự án.
- Không ai biết đồng nghiệp đang mở cùng video, nên dễ ghi đè nhau. F33 chặn được ở bước lưu, nhưng tốt hơn là cảnh báo từ sớm.

## 2. Mục tiêu
- **Chia sẻ video** cho thành viên với 3 vai trò: **Người xem** (xem, bình luận), **Biên tập** (sửa, gửi duyệt), **Người duyệt** (Biên tập + duyệt). Chủ sở hữu có toàn quyền và là người duy nhất được xoá video hoặc đổi chủ.
- **Mời qua email.** Nếu email chưa có tài khoản thì tạo lời mời chờ, có link dùng một lần, hạn 7 ngày.
- **Hiện diện (presence):** hiện avatar những người đang mở video. Hiện "Minh đang sửa" khi người đó vừa thao tác trong 30 giây gần nhất.
- **Khoá mềm:** khi có người khác đang sửa, người vào sau thấy banner gợi ý mở ở chế độ chỉ xem. Vẫn cho phép sửa nếu chọn tiếp tục.

### Ngoài phạm vi
- Sửa đồng thời theo thời gian thực có trộn thay đổi (CRDT). Người sửa sau vẫn phải theo luồng xung đột của F33.
- Hiện con trỏ hoặc playhead của người khác trên timeline.
- Nhóm và thư mục cấp tổ chức (F49).

## 3. User stories
- Là giảng viên, tôi mời trợ giảng (email) làm Biên tập cho 10 video bài giảng môn Java.
- Là trợ giảng, mở video thì tôi thấy avatar "T" của thầy đang xem, biết thầy đang duyệt nên tôi chưa sửa.
- Là chủ video, tôi gỡ quyền một bạn đã nghỉ dự án.

## 4. Yêu cầu chức năng
- **FR-1 Bảng quyền:**

| Hành động | Người xem | Biên tập | Người duyệt | Chủ sở hữu |
|---|:-:|:-:|:-:|:-:|
| Xem video, transcript, segments | ✓ | ✓ | ✓ | ✓ |
| Bình luận (F35) | ✓ | ✓ | ✓ | ✓ |
| Sửa segments / transcript, lưu, render nháp | | ✓ | ✓ | ✓ |
| Gửi duyệt | | ✓ | ✓ | ✓ |
| Duyệt / Yêu cầu sửa / Xuất bản | | | ✓ | ✓ |
| Mời / gỡ thành viên, đổi vai trò | | | | ✓ |
| Xoá video, chuyển chủ sở hữu | | | | ✓ |

- **FR-2 Mời.** Nhập email và chọn vai trò.
  - Email đã có tài khoản thì thêm thẳng vào `video_members` và gửi thông báo.
  - Chưa có tài khoản thì tạo `video_invitations` với token ngẫu nhiên 32 byte. Database chỉ lưu SHA-256 của token. Link có dạng `/invite/<token>`, hạn 7 ngày, chỉ dùng được một lần.
- **FR-3 Mời hàng loạt.** Chọn nhiều video trong thư viện rồi bấm "Chia sẻ" để mời cùng một người với cùng vai trò.
- **FR-4 Gỡ hoặc đổi vai trò** có hiệu lực ngay. Phiên SSE đang mở của người bị gỡ nhận sự kiện `access_revoked`, frontend đưa họ về thư viện.
- **FR-5 Thư viện có 2 tab:** "Của tôi" và "Được chia sẻ với tôi".
- **FR-6 Presence:**
  - Khi mở studio, client mở `EventSource` tới `/presence/stream` và gửi heartbeat `POST /presence` mỗi 15 giây, kèm `{ sessionId, state: "viewing" | "editing" }`.
  - `state = "editing"` nếu trong 30 giây có ít nhất một `commit()` (F31).
  - Máy chủ bỏ phiên không gửi heartbeat sau 45 giây.
  - Máy chủ phát `presence_changed` cho mọi người đang xem cùng video.
- **FR-7 Header** hiện tối đa 4 avatar, phần còn lại hiện "+N". Người đang sửa có viền màu và tooltip "Đang sửa".
- **FR-8 Khoá mềm.** Khi mở video mà đang có người khác ở trạng thái `editing`, hiện banner "Trần Quang Minh đang sửa video này. [Chỉ xem] [Vẫn sửa]". Chọn "Chỉ xem" thì tắt mọi thao tác sửa và tắt tự lưu (F34).
- **FR-9 Cập nhật sau khi người khác lưu.** Khi người khác lưu thành công (F33 tạo version mới), máy chủ phát `version_saved {version, by}`.
  - Nếu client không có thay đổi chưa lưu: hiện toast "Minh vừa lưu — [Tải bản mới]".
  - Nếu client đang có thay đổi chưa lưu: báo trước "Sắp xung đột".

## 5. Yêu cầu phi chức năng
- Presence lưu **trong bộ nhớ** (`ConcurrentHashMap`), đủ cho một máy chủ. Nếu sau này chạy nhiều máy chủ thì cần Redis pub/sub. Phần này ghi vào câu hỏi mở, không làm bây giờ (theo YAGNI).
- Mỗi máy chủ chịu được 500 kết nối SSE đồng thời. Cấu hình timeout `SseEmitter` là 0 và gửi comment `:ping` mỗi 20 giây để proxy không cắt kết nối.
- Token mời không được ghi ra log.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<n>__video_members_invitations.sql`
```sql
CREATE TABLE IF NOT EXISTS video_members (
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,          -- VIEWER | EDITOR | REVIEWER
    added_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (video_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_video_members_user ON video_members(user_id);

CREATE TABLE IF NOT EXISTS video_invitations (
    id BIGSERIAL PRIMARY KEY,
    video_ids BIGINT[] NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    invited_by BIGINT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON video_invitations(lower(email));
```

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/members` | Xem | Danh sách thành viên + lời mời đang chờ |
| POST | `/api/v1/videos/members/invite` | Chủ sở hữu của **mọi** video trong danh sách | `{ videoIds[], email, role }` |
| PATCH | `/api/v1/videos/{id}/members/{userId}` | Chủ sở hữu | `{ role }` |
| DELETE | `/api/v1/videos/{id}/members/{userId}` | Chủ sở hữu, hoặc chính người đó tự rời | Gỡ |
| DELETE | `/api/v1/invitations/{invitationId}` | Người mời | Huỷ lời mời |
| POST | `/api/v1/invitations/accept` | Đã đăng nhập | `{ token }` |
| POST | `/api/v1/videos/{id}/presence` | Xem | Heartbeat |
| GET | `/api/v1/videos/{id}/presence/stream` | Xem | SSE: `presence_changed`, `version_saved`, `access_revoked` |

```json
// POST /api/v1/videos/members/invite
{ "videoIds": [42, 43], "email": "minh.tq@truong.edu.vn", "role": "EDITOR" }
// 200
{ "added": [ { "videoId": 42, "userId": 2 }, { "videoId": 43, "userId": 2 } ], "invited": [] }

// SSE event
event: presence_changed
data: { "videoId": 42, "users": [ { "userId": 1, "name": "Nguyễn Văn Toàn", "avatar": "T", "state": "viewing" },
                                  { "userId": 2, "name": "Trần Quang Minh", "avatar": "M", "state": "editing" } ] }
```

### 6.3 Backend
- **Mới** `entity/VideoMemberEntity.java`, `entity/VideoInvitationEntity.java` cùng các repository tương ứng.
- **Mới** `service/AccessService.java` với hàm `Role effectiveRole(userId, videoId)` (chủ sở hữu, hoặc role trong `video_members`, hoặc không có quyền). Đây là **điểm kiểm tra quyền duy nhất**, dùng chung cho F02, F33, F35. Nếu F02 đã tạo lớp tương đương thì mở rộng lớp đó, không tạo lớp thứ hai.
- **Mới** `service/MembershipService.java` (mời, chấp nhận, gỡ) và `service/PresenceService.java` (map `videoId → Map<sessionId, PresenceEntry>`, `@Scheduled` mỗi 15 giây để dọn phiên hết hạn và phát sự kiện).
- **Mới** `controller/MembershipController.java`, `controller/PresenceController.java`.
- **Sửa** truy vấn danh sách video (`GET /list`, [VideoController.java:347](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L347)): trả video mà `owner_id = me` **hoặc** có dòng trong `video_members`, kèm `myRole`.
- `ProjectVersionService.save` (F33) phát `version_saved` thông qua `PresenceService.broadcast(videoId, ...)`.

### 6.5 Frontend
- **Mới** `components/ShareDialog.tsx`: ô email, chọn vai trò, danh sách thành viên kèm dropdown đổi vai trò và nút gỡ, danh sách lời mời chờ.
- **Mới** `components/PresenceAvatars.tsx` đặt trong `StudioHeader`.
- **Mới** `components/SoftLockBanner.tsx`.
- **Mới** `hooks/usePresence.ts`: mở `EventSource`, gửi heartbeat, tự kết nối lại theo backoff, đóng khi unmount hoặc đổi video.
- **Mới** trang `app/invite/[token]/page.tsx`: nếu chưa đăng nhập thì chuyển tới đăng nhập/đăng ký rồi quay lại, sau đó gọi `accept`.
- `page.tsx`: lưu `myRole` trong state và truyền `readOnly = myRole === "VIEWER" || chọnChỉXem` xuống các component biên tập (`StudioTimeline`, `TranscriptScenesPanel`, `ReviewTable`) để ẩn hoặc tắt thao tác sửa.
- Bỏ phụ thuộc vào `mock-data/users.json` cho danh sách thành viên.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* A là chủ video 42, *When* A mời `b@x.vn` (đã có tài khoản) với vai trò EDITOR, *Then* B thấy video 42 trong tab "Được chia sẻ với tôi" và sửa, lưu được.
- **AC-2** — *Given* B là VIEWER, *When* B gọi `PUT /segments`, *Then* nhận 403. Trên giao diện, nút Tách/Gộp bị tắt.
- **AC-3** — *Given* email chưa có tài khoản, *When* mời, *Then* bảng `video_invitations` có `token_hash` (64 ký tự hex), **không** chứa token gốc. Link hết hạn sau 7 ngày thì trả 410.
- **AC-4** — *Given* A và B cùng mở video 42, *Then* trong vòng 3 giây mỗi người thấy avatar của người kia. B đóng tab thì avatar của B biến mất khỏi màn hình A trong vòng 60 giây.
- **AC-5** — *Given* B đang sửa (`editing`), *When* C mở video, *Then* C thấy banner khoá mềm. Chọn "Chỉ xem" thì không có request lưu nào được gửi.
- **AC-6** — *When* A gỡ B trong lúc B đang mở video, *Then* B được đưa về thư viện kèm thông báo "Bạn không còn quyền truy cập video này".
- **AC-7** — *When* B lưu xong, *Then* A (không có thay đổi chưa lưu) thấy toast "B vừa lưu — Tải bản mới".

## 8. Kế hoạch kiểm thử (TDD)
- `AccessServiceTest`:
  - `owner_hasOwnerRole`
  - `member_hasMemberRole`
  - `stranger_hasNoAccess`
  - `permissionMatrix_matchesTable` (kiểm tra tham số hoá theo bảng FR-1)
- `MembershipServiceTest`:
  - `invite_existingUser_addsMember`
  - `invite_newEmail_createsHashedInvitation`
  - `invite_notOwnerOfAllVideos_forbidden`
  - `accept_expiredToken_gone`
  - `accept_usedToken_gone`
  - `remove_publishesAccessRevoked`
- `PresenceServiceTest` (dùng đồng hồ giả `Clock`):
  - `heartbeat_addsSession`
  - `noHeartbeat45s_evictsAndBroadcasts`
  - `editingState_expiresAfter30sWithoutCommit`
- `MembershipControllerTest` (MockMvc): `list_returnsMyRole`, `patchRole_byEditor_forbidden`.
- Frontend: `usePresence` dùng `EventSource` giả, gồm `reconnects_withBackoff`, `closes_onUnmount`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Proxy hoặc CDN đóng kết nối SSE sau 60 giây | Presence chập chờn | Gửi `:ping` mỗi 20 giây, client tự kết nối lại |
| Chạy nhiều instance backend | Presence không thấy nhau | Ghi rõ giới hạn chỉ chạy 1 instance. Câu hỏi mở về Redis |
| Lộ link mời | Người lạ vào được | Token dùng một lần, hạn 7 ngày. Khi chấp nhận, email của tài khoản phải khớp email được mời |
| Quên kiểm tra quyền ở một endpoint cũ | Rò dữ liệu | Thêm test liệt kê mọi `@RequestMapping` và gọi thử khi không có quyền, mong nhận 403 (dùng chung với F02) |

## 10. Câu hỏi mở
- [ ] Khi chấp nhận lời mời, có bắt buộc email tài khoản phải khớp email được mời không? Đề xuất: có.
- [ ] Có cho Biên tập mời thêm Người xem không, hay chỉ Chủ sở hữu được mời?
- [ ] Dự kiến chạy 1 hay nhiều instance backend? Nếu nhiều thì cần duyệt thêm Redis.
- [ ] Chia sẻ theo **từng video** hay theo **khoá học/thư mục**? Spec này làm theo video. Theo thư mục để F41/F49.
