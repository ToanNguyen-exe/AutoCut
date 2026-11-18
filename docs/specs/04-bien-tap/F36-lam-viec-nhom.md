# F36 — Làm việc nhóm

| Mục | Giá trị |
|---|---|
| **Mã** | F36 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (API, presence) + SV4 (giao diện) |
| **Phụ thuộc** | F00 (`videoId`), F01 (người dùng thật, vé ngắn hạn AD-4), **F02** (bảng `video_access`, `AccessService`, ma trận `Permission`), F33 (chống ghi đè, sự kiện lưu), F10 (hạ tầng SSE), F48 (gửi email mời, nếu có) |
| **Ước lượng** | L (1–2 tuần), chia 2 PR: (1) chia sẻ + lời mời (M); (2) presence + khoá mềm (M) |
| **Thư viện mới cần duyệt** | Không. Dùng `SseEmitter` có sẵn của Spring MVC và `EventSource` có sẵn của trình duyệt. |
| **Tham khảo** | Figma (avatar người đang xem), Google Docs (chia sẻ theo vai trò), Frame.io (mời người duyệt), Descript (Drive sharing) |

> **Cập nhật 18/11/2026:** bỏ bảng `video_members`, dùng `video_access` và ma trận quyền của F02 (AD-1); presence SSE mở bằng vé ngắn hạn (AD-4); mã lỗi 404/403 theo AD-2; tách ước lượng thành 2 PR.

## 1. Bối cảnh & vấn đề

- Danh sách người dùng là tệp tĩnh [users.json](../../../frontend/src/mock-data/users.json) có 6 tài khoản (admin, sv1–sv4, demo). Quyền chỉ là chuỗi `role` để hiển thị.
- F02 tạo bảng `video_access(video_id, user_id, permission)` với 4 mức `OWNER`/`EDITOR`/`REVIEWER`/`VIEWER`, và `AccessService` là chỗ duy nhất kiểm tra quyền. Nhưng F02 **chưa có cách nào để chủ video chia sẻ** cho người khác (chỉ tạo dòng OWNER khi upload). Spec này bổ sung việc chia sẻ.
- Dữ liệu dự án đang lưu theo thư mục người dùng `output/users/<user>/<lesson>` ([VideoController.java:1145-1160](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1145-L1160)), nên hai người không nhìn thấy cùng một dự án. Sau F00/F33, DB là nguồn sự thật, nên chia sẻ theo `videoId` là đủ.
- Không ai biết đồng nghiệp đang mở cùng video, nên dễ ghi đè nhau. F33 chặn được ở bước lưu, nhưng tốt hơn là cảnh báo từ sớm.
- `EventSource` của trình duyệt **không gửi được header `Authorization`**, nên không dùng JWT trực tiếp cho kết nối presence. Phải dùng vé ngắn hạn của F01 (AD-4).

## 2. Mục tiêu
- **Chia sẻ video** cho người khác với một trong ba mức `EDITOR`, `REVIEWER`, `VIEWER` (quyền chi tiết theo ma trận F02 FR-2). `OWNER` là người duy nhất được chia sẻ, xoá video hoặc đổi chủ (`Permission.MANAGE`).
- **Mời qua email.** Nếu email chưa có tài khoản thì tạo lời mời chờ, có link dùng một lần, hạn 7 ngày.
- **Hiện diện (presence):** hiện avatar những người đang mở video. Hiện "Minh đang sửa" khi người đó vừa thao tác trong 30 giây gần nhất.
- **Khoá mềm:** khi có người khác đang sửa, người vào sau thấy banner gợi ý mở ở chế độ chỉ xem. Vẫn cho phép sửa nếu chọn tiếp tục.

### Ngoài phạm vi
- Ma trận quyền và việc kiểm tra quyền: thuộc F02 (spec này chỉ dùng lại).
- Sửa đồng thời theo thời gian thực có trộn thay đổi (CRDT). Người sửa sau vẫn phải theo luồng xung đột của F33.
- Hiện con trỏ hoặc playhead của người khác trên timeline.
- Nhóm và thư mục cấp tổ chức (F49).

## 3. User stories
- Là giảng viên, tôi mời trợ giảng (email) làm Biên tập cho 10 video bài giảng môn Java.
- Là trợ giảng, mở video thì tôi thấy avatar "T" của thầy đang xem, biết thầy đang duyệt nên tôi chưa sửa.
- Là chủ video, tôi gỡ quyền một bạn đã nghỉ dự án.

## 4. Yêu cầu chức năng
- **FR-1 Quyền.** Dùng đúng ma trận `Permission` của F02 FR-2. Nhắc lại cho tiện đọc (nếu khác nhau thì F02 đúng):

| Hành động | VIEWER | REVIEWER | EDITOR | OWNER |
|---|:-:|:-:|:-:|:-:|
| Xem, phát, tải (`VIEW`, `DOWNLOAD`) | ✓ | ✓ | ✓ | ✓ |
| Bình luận (`COMMENT`, F35) | | ✓ | ✓ | ✓ |
| Duyệt / Yêu cầu sửa / Xuất bản (`REVIEW`, F35) | | ✓ | | ✓ |
| Sửa segments / transcript, lưu, render (`EDIT`) | | | ✓ | ✓ |
| Chia sẻ, gỡ, đổi mức quyền, xoá video, chuyển chủ (`MANAGE`) | | | | ✓ |

- **FR-2 Mời.** Nhập email và chọn mức quyền (`EDITOR`, `REVIEWER`, `VIEWER`; không mời được `OWNER`).
  - Email đã có tài khoản thì thêm thẳng dòng `video_access` (`granted_by` = người mời) và gửi thông báo.
  - Chưa có tài khoản thì tạo `video_invitations` với token ngẫu nhiên 32 byte. Database chỉ lưu SHA-256 của token. Link có dạng `/invite/<token>`, hạn 7 ngày, chỉ dùng được một lần.
  - Người đã có dòng `video_access` thì cập nhật mức quyền theo lời mời mới, **trừ** khi họ là OWNER (giữ nguyên). Dùng `INSERT … ON CONFLICT (video_id, user_id) DO UPDATE … WHERE video_access.permission <> 'OWNER'` (AD-8).
- **FR-3 Mời hàng loạt.** Chọn nhiều video trong thư viện rồi bấm "Chia sẻ" để mời cùng một người với cùng mức quyền. Người mời phải có `MANAGE` trên **mọi** video trong danh sách; nếu thiếu một video thì cả yêu cầu bị từ chối và không ghi gì.
- **FR-4 Gỡ hoặc đổi mức quyền** có hiệu lực ngay. Phiên SSE đang mở của người bị gỡ nhận sự kiện `access_revoked`, frontend đưa họ về thư viện. Không gỡ được dòng `OWNER` (muốn đổi chủ thì dùng "Chuyển chủ sở hữu").
- **FR-5 Chuyển chủ sở hữu.** OWNER chọn một thành viên đang có quyền làm chủ mới. Trong một transaction: `videos.owner_id` = người mới, dòng của người mới thành `OWNER`, dòng của chủ cũ thành `EDITOR`.
- **FR-6 Thư viện có 2 tab:** "Của tôi" (`permission='OWNER'`) và "Được chia sẻ với tôi" (các mức còn lại). Danh sách lấy từ `GET /list` đã lọc theo quyền ở F02 FR-4, kèm `myPermission`.
- **FR-7 Presence:**
  - Khi mở studio, client gọi `POST /api/v1/auth/tickets { "purpose": "SSE", "resourceId": videoId }` (F01, AD-4) rồi mở `EventSource('/api/v1/videos/{id}/presence/stream?ticket=…')`. Vé SSE sống 60 giây và chỉ dùng một lần; mỗi lần kết nối lại phải xin vé mới.
  - Client gửi heartbeat `POST /presence` (có JWT) mỗi 15 giây, kèm `{ sessionId, state: "viewing" | "editing" }`.
  - `state = "editing"` nếu trong 30 giây có ít nhất một `commit()` (F31).
  - Máy chủ bỏ phiên không gửi heartbeat sau 45 giây.
  - Máy chủ phát `presence_changed` cho mọi người đang xem cùng video.
- **FR-8 Header** hiện tối đa 4 avatar, phần còn lại hiện "+N". Người đang sửa có viền màu và tooltip "Đang sửa".
- **FR-9 Khoá mềm.** Khi mở video mà đang có người khác ở trạng thái `editing`, hiện banner "Trần Quang Minh đang sửa video này. [Chỉ xem] [Vẫn sửa]". Chọn "Chỉ xem" thì tắt mọi thao tác sửa và tắt tự lưu (F34). Người không có `EDIT` luôn ở chế độ chỉ xem, không thấy banner.
- **FR-10 Cập nhật sau khi người khác lưu.** Khi người khác lưu thành công (F33 tạo version mới), máy chủ phát `version_saved {version, by}`.
  - Nếu client không có thay đổi chưa lưu: hiện toast "Minh vừa lưu — [Tải bản mới]".
  - Nếu client đang có thay đổi chưa lưu: báo trước "Sắp xung đột".

## 5. Yêu cầu phi chức năng
- Presence lưu **trong bộ nhớ** (`ConcurrentHashMap`), đủ cho một máy chủ. Nếu sau này chạy nhiều máy chủ thì cần Redis pub/sub. Phần này ghi vào câu hỏi mở, không làm bây giờ (YAGNI).
- Mỗi máy chủ chịu được 500 kết nối SSE đồng thời. Cấu hình timeout `SseEmitter` là 0 và gửi comment `:ping` mỗi 20 giây để proxy không cắt kết nối.
- Token mời và vé SSE không được ghi ra log (kể cả query string trong access log).

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Dùng bảng `video_access` của F02, **không** tạo bảng thành viên riêng. Chỉ thêm bảng lời mời:

`V<yyyyMMddHHmm>__video_invitations.sql`
```sql
CREATE TABLE IF NOT EXISTS video_invitations (
    id BIGSERIAL PRIMARY KEY,
    video_ids BIGINT[] NOT NULL,
    email VARCHAR(255) NOT NULL,
    permission VARCHAR(10) NOT NULL CHECK (permission IN ('EDITOR','REVIEWER','VIEWER')),
    token_hash CHAR(64) NOT NULL UNIQUE,
    invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON video_invitations(lower(email));
```

### 6.2 API
| Method | Path | Quyền (F02 `Permission`) | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/members` | `VIEW` | Danh sách người có quyền + lời mời đang chờ (lời mời chỉ hiện cho người có `MANAGE`) |
| POST | `/api/v1/videos/members/invite` | `MANAGE` trên **mọi** video trong danh sách | `{ videoIds[], email, permission }` |
| PATCH | `/api/v1/videos/{id}/members/{userId}` | `MANAGE` | `{ permission }` |
| DELETE | `/api/v1/videos/{id}/members/{userId}` | `MANAGE`, hoặc chính người đó tự rời (trừ OWNER) | Gỡ |
| POST | `/api/v1/videos/{id}/owner` | `MANAGE` | `{ userId }` chuyển chủ sở hữu (FR-5) |
| DELETE | `/api/v1/invitations/{invitationId}` | Người mời hoặc `MANAGE` | Huỷ lời mời |
| POST | `/api/v1/invitations/accept` | Đã đăng nhập | `{ token }` |
| POST | `/api/v1/videos/{id}/presence` | `VIEW` | Heartbeat (JWT) |
| GET | `/api/v1/videos/{id}/presence/stream?ticket=` | Vé SSE hợp lệ cho video này (AD-4) | SSE: `presence_changed`, `version_saved`, `access_revoked` |

Mã lỗi theo AD-2:
- Không có `VIEW` trên video thì trả 404 `VIDEO_NOT_FOUND`. Với invite hàng loạt, chỉ cần một video không có `VIEW` là cả yêu cầu trả 404.
- Có `VIEW` nhưng thiếu `MANAGE` thì trả 403 `FORBIDDEN_ACTION`.
- Vé SSE sai, hết hạn hoặc đã dùng thì trả 401 `TICKET_INVALID`.
- Link mời hết hạn hoặc đã dùng thì trả 410 `INVITATION_GONE`.

```json
// POST /api/v1/videos/members/invite
{ "videoIds": [42, 43], "email": "minh.tq@truong.edu.vn", "permission": "EDITOR" }
// 200
{ "added": [ { "videoId": 42, "userId": 2 }, { "videoId": 43, "userId": 2 } ], "invited": [] }

// SSE event
event: presence_changed
data: { "videoId": 42, "users": [ { "userId": 1, "name": "Nguyễn Văn Toàn", "avatar": "T", "state": "viewing" },
                                  { "userId": 2, "name": "Trần Quang Minh", "avatar": "M", "state": "editing" } ] }
```

### 6.3 Backend
- Dùng lại `AccessService` của F02 (`require(p, videoId, Permission)`, `permissionsOf`). **Không** tạo lớp kiểm tra quyền thứ hai.
- **Mới** `entity/VideoInvitationEntity.java` + repository.
- **Mới** `service/MembershipService.java`: mời, chấp nhận, gỡ, đổi mức quyền, chuyển chủ. Ghi `video_access` bằng `ON CONFLICT` (AD-8). Phát `AccessRevokedEvent` khi gỡ hoặc hạ quyền.
- **Mới** `service/PresenceService.java`: map `videoId → Map<sessionId, PresenceEntry>`. Dọn phiên hết hạn theo lịch mỗi 15 giây, rồi phát sự kiện. Đây là tác vụ bộ nhớ ngắn hạn, không phải job nghiệp vụ, nên dùng `@Scheduled` thay vì bảng `jobs` (ngoại lệ hợp lý của AD-10).
- **Mới** `controller/MembershipController.java`, `controller/PresenceController.java`. Kết nối SSE kiểm tra vé bằng `TicketService.consume(ticket, "SSE", videoId)` của F01.
- `ProjectVersionService.save` (F33) phát `version_saved` thông qua `PresenceService.broadcast(videoId, ...)`.

### 6.5 Frontend
- **Mới** `components/ShareDialog.tsx`: ô email, chọn mức quyền, danh sách thành viên kèm dropdown đổi quyền và nút gỡ, danh sách lời mời chờ, nút "Chuyển chủ sở hữu".
- **Mới** `components/PresenceAvatars.tsx` đặt trong `StudioHeader`.
- **Mới** `components/SoftLockBanner.tsx`.
- **Mới** `hooks/usePresence.ts`: xin vé → mở `EventSource` → gửi heartbeat → khi lỗi thì xin vé mới và kết nối lại theo backoff; đóng khi unmount hoặc đổi video.
- **Mới** trang `app/invite/[token]/page.tsx`: nếu chưa đăng nhập thì chuyển tới đăng nhập/đăng ký rồi quay lại, sau đó gọi `accept`.
- `page.tsx`: lưu `myPermissions` (F02 trả về) trong state và truyền `readOnly = !myPermissions.includes("EDIT") || chọnChỉXem` xuống các component biên tập (`StudioTimeline`, `TranscriptScenesPanel`, `ReviewTable`) để ẩn hoặc tắt thao tác sửa.
- Bỏ phụ thuộc vào `mock-data/users.json` cho danh sách thành viên.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* A là OWNER video 42, *When* A mời `b@x.vn` (đã có tài khoản) với mức EDITOR, *Then* có dòng `video_access(42, B, 'EDITOR')`, B thấy video 42 trong tab "Được chia sẻ với tôi" và sửa, lưu được.
- **AC-2** — *Given* B là VIEWER video 42, *When* B gọi `PUT /segments`, *Then* nhận 403 `FORBIDDEN_ACTION`. Trên giao diện, nút Tách/Gộp bị tắt.
- **AC-3** — *Given* C không có quyền gì trên video 42, *When* C gọi `GET /videos/42/members`, *Then* nhận 404.
- **AC-4** — *Given* email chưa có tài khoản, *When* mời, *Then* bảng `video_invitations` có `token_hash` (64 ký tự hex), **không** chứa token gốc. Link hết hạn sau 7 ngày thì trả 410.
- **AC-5** — *Given* A và B cùng mở video 42, *Then* trong vòng 3 giây mỗi người thấy avatar của người kia. B đóng tab thì avatar của B biến mất khỏi màn hình A trong vòng 60 giây.
- **AC-6** — *When* mở `presence/stream` không có vé, hoặc dùng lại vé đã dùng, *Then* nhận 401 `TICKET_INVALID`.
- **AC-7** — *Given* B đang sửa (`editing`), *When* C (EDITOR) mở video, *Then* C thấy banner khoá mềm. Chọn "Chỉ xem" thì không có request lưu nào được gửi.
- **AC-8** — *When* A gỡ B trong lúc B đang mở video, *Then* B được đưa về thư viện kèm thông báo "Bạn không còn quyền truy cập video này".
- **AC-9** — *When* B lưu xong, *Then* A (không có thay đổi chưa lưu) thấy toast "B vừa lưu — Tải bản mới".
- **AC-10** — *Given* A mời B vào video 42 (A là OWNER) và 99 (A chỉ là EDITOR), *Then* nhận 403 và không có dòng `video_access` mới nào.
- **AC-11** — *When* A chuyển chủ video 42 cho B, *Then* `videos.owner_id = B`, B là OWNER, A là EDITOR.

## 8. Kế hoạch kiểm thử (TDD)
- `MembershipServiceTest` (Postgres, AD-7):
  - `invite_existingUser_insertsVideoAccess`
  - `invite_existingOwner_permissionUnchanged`
  - `invite_newEmail_createsHashedInvitation`
  - `invite_missingManageOnOneVideo_rejectsAll`
  - `accept_expiredToken_gone`
  - `accept_usedToken_gone`
  - `accept_emailMismatch_rejected`
  - `remove_owner_rejected`
  - `remove_publishesAccessRevoked`
  - `transferOwnership_swapsRolesAtomically`
- `PresenceServiceTest` (dùng đồng hồ giả `Clock`):
  - `heartbeat_addsSession`
  - `noHeartbeat45s_evictsAndBroadcasts`
  - `editingState_expiresAfter30sWithoutCommit`
- `PresenceControllerTest`: `stream_withoutTicket_401`, `stream_reusedTicket_401`, `stream_ticketForOtherVideo_401`.
- `MembershipControllerTest` (MockMvc): `list_returnsMyPermission`, `patch_byEditor_403`, `list_noAccess_404`.
- Frontend: `usePresence` dùng `EventSource` giả, gồm `requestsNewTicketOnReconnect`, `reconnects_withBackoff`, `closes_onUnmount`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Proxy hoặc CDN đóng kết nối SSE sau 60 giây | Presence chập chờn | Gửi `:ping` mỗi 20 giây, client tự xin vé mới và kết nối lại |
| Chạy nhiều instance backend | Presence không thấy nhau | Ghi rõ giới hạn chỉ chạy 1 instance. Câu hỏi mở về Redis |
| Lộ link mời | Người lạ vào được | Token dùng một lần, hạn 7 ngày. Khi chấp nhận, email của tài khoản phải khớp email được mời |
| Vé SSE lọt vào log của proxy | Kẻ khác dùng lại | Vé dùng một lần và sống 60 giây; tắt ghi query string trong access log |

## 10. Câu hỏi mở
- [x] Khi chấp nhận lời mời, có bắt buộc email tài khoản phải khớp email được mời không? **Có** (đã đưa vào test `accept_emailMismatch_rejected`).
- [x] Biên tập có được mời thêm người không? **Đã chốt theo AD-1/F02:** chỉ người có `MANAGE` (OWNER).
- [ ] Dự kiến chạy 1 hay nhiều instance backend? Nếu nhiều thì cần duyệt thêm Redis.
- [ ] Chia sẻ theo **từng video** hay theo **khoá học/thư mục**? Spec này làm theo video. Theo thư mục để F41/F49.
