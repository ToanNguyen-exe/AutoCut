# F35 — Quy trình duyệt + bình luận theo mốc giờ

| Mục | Giá trị |
|---|---|
| **Mã** | F35 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API, máy trạng thái) + SV4 (giao diện) |
| **Phụ thuộc** | F00 (`topics.id` ổn định, `videoId`), F01, F02 (`video_access.permission` = `OWNER`/`EDITOR`/`REVIEWER`/`VIEWER` và enum `Permission` của `AccessService`, AD-1), F13, F33 (version để tự quay về DRAFT), F09 (job cắt có tham số `renderKind`). Thông báo: F48 (nếu có). Nhật ký: F08. |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Frame.io (time-coded comments), Vimeo Review, Wistia, GitHub PR review (Approve / Request changes) |

> **Cập nhật 18/11/2026:** quyền dựa trên ma trận `Permission` của F02 (`EDIT` để gửi duyệt, `REVIEW` để duyệt, `COMMENT` để bình luận; AD-1); cấu hình tự duyệt chuyển sang cấu hình hệ thống (không phụ thuộc F49); định nghĩa render "phát hành"/"nháp" bằng tham số `renderKind` của job cắt; `review_events.actor_id` cho phép NULL (hệ thống) và migration ghi sự kiện `legacy_import`; mã lỗi theo AD-2.

## 1. Bối cảnh & vấn đề

- Trạng thái duyệt hiện chỉ là một cờ đúng/sai, `reviewed: boolean` ([types/index.ts](../../../frontend/src/types/index.ts), cột `videos.reviewed`). Có ba cách cờ này bị đổi mà không qua kiểm soát:
  - Ai cũng bấm được để đảo cờ trên `StatsCards` ([page.tsx:1562](../../../frontend/src/app/page.tsx#L1562), [StatsCards.tsx:85-100](../../../frontend/src/components/StatsCards.tsx#L85-L100)).
  - Bấm Render thì frontend gửi `reviewed: true` ([page.tsx:753](../../../frontend/src/app/page.tsx#L753)).
  - Mỗi lần lưu, backend tự đặt `reviewed=true` ([SegmentPersistenceService.java:152](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L152)).
- Không biết ai duyệt, duyệt lúc nào, và vì sao bị trả về.
- Thư viện có nhãn `edited | pending | added` ([types/index.ts](../../../frontend/src/types/index.ts) `VideoLibraryItem.status`) nhưng nhãn này không gắn với dữ liệu trên máy chủ.
- Góp ý giữa giảng viên và trợ giảng đang trao đổi ngoài hệ thống (Zalo), kiểu "phút 12:30 cắt hụt chữ". Ghi chú không gắn vào video.

## 2. Mục tiêu
- Dùng **máy trạng thái duyệt** rõ ràng: `DRAFT → IN_REVIEW → CHANGES_REQUESTED ↔ IN_REVIEW → APPROVED → PUBLISHED`.
- Thêm **bình luận theo mốc thời gian** (có thể gắn vào một topic). Bình luận có trả lời theo luồng, @nhắc tên, và đánh dấu "Đã xử lý".
- Chỉ video ở trạng thái `APPROVED` mới được render bản phát hành và xuất bản (F40, F41, F42).

### Ngoài phạm vi
- Vẽ chú thích lên khung hình (annotation) như Frame.io.
- Duyệt nhiều cấp (Trưởng bộ môn rồi tới Khoa).
- Thông báo email/Zalo: F48 lắng nghe sự kiện của spec này.

## 3. User stories
- Là trợ giảng, sửa xong tôi bấm "Gửi duyệt" và chọn thầy phụ trách.
- Là giảng viên, tôi xem video, bấm vào timeline ở 12:30 và ghi "Cắt hụt chữ 'vòng lặp'", rồi bấm "Yêu cầu sửa".
- Là trợ giảng, tôi thấy danh sách góp ý, bấm vào một góp ý để nhảy tới 12:30, sửa xong thì đánh dấu "Đã xử lý".
- Là trưởng nhóm, tôi lọc thư viện theo "Chờ duyệt" để biết việc còn tồn.

## 4. Yêu cầu chức năng
- **FR-1 Trạng thái** lưu ở cột mới `videos.review_status`. Bảng chuyển trạng thái:

Quyền lấy theo ma trận F02 FR-2: gửi duyệt cần `EDIT` (OWNER, EDITOR); "Người duyệt" là người có `REVIEW` (OWNER, REVIEWER; ADMIN và `ORG_ADMIN` có mọi quyền).

| Từ | Hành động | Sang | Ai được làm |
|---|---|---|---|
| DRAFT | `submit` | IN_REVIEW | Có `EDIT` |
| IN_REVIEW | `approve` | APPROVED | Người duyệt, **không** phải người vừa gửi duyệt (trừ khi bật FR-11) |
| IN_REVIEW | `request_changes` (bắt buộc ít nhất 1 bình luận mở hoặc có lời nhắn) | CHANGES_REQUESTED | Người duyệt |
| CHANGES_REQUESTED | `submit` | IN_REVIEW | Có `EDIT` |
| IN_REVIEW | `withdraw` | DRAFT | Người đã gửi duyệt |
| APPROVED | `publish` | PUBLISHED | Người duyệt |
| APPROVED, PUBLISHED | `reopen` | DRAFT | Người duyệt |

Khi `submit`, có thể chọn `reviewerId`. Người được chọn phải có quyền duyệt trên video, nếu không thì trả 422 `REVIEWER_NOT_ELIGIBLE`.

- **FR-2 Tự động quay lại.** Ở trạng thái `APPROVED`, nếu lần lưu qua F33 làm tăng `videos.version` thì video tự về `DRAFT`, ghi sự kiện `auto_reopen` (actor là người vừa lưu) với lý do "Có chỉnh sửa sau khi duyệt". Thay đổi `edit_ranges` (F32) cũng tính. Ở `IN_REVIEW`, chỉnh sửa vẫn được nhưng hiện cảnh báo "Video đang chờ duyệt".
- **FR-3 Mỗi lần chuyển trạng thái** ghi vào `review_events` gồm: ai làm, từ trạng thái nào, sang trạng thái nào, lời nhắn, và `version_no` tại thời điểm đó.
- **FR-4 Cột `videos.reviewed` cũ** được suy ra: `reviewed = review_status IN ('APPROVED','PUBLISHED')`. Bỏ hai chỗ tự đặt cờ ở frontend đã nêu ở §1 (chỗ thứ ba ở backend đã được F00 FR-5 bỏ).
- **FR-5 Bình luận:** gồm `time_sec` (bắt buộc), `topic_id` (tuỳ chọn, tự gán theo topic chứa `time_sec`), nội dung (1–2.000 ký tự), `parent_id` (trả lời), trạng thái `OPEN | RESOLVED`.
- **FR-6 @nhắc tên** những người có quyền trên video. Lưu danh sách `mentions` để F48 gửi thông báo.
- **FR-7 Giao diện bình luận:**
  - Timeline hiện chấm tròn tại mỗi `time_sec`. Rê chuột vào chấm thì xem trước nội dung.
  - Panel "Góp ý" có bộ lọc Tất cả / Chưa xử lý / Của tôi. Bấm vào một góp ý để nhảy tới mốc giờ.
  - Nhấn phím `C` (bổ sung vào keymap của F31) để mở ô bình luận tại playhead hiện tại. Video tự tạm dừng khi bắt đầu gõ.
- **FR-8** Không xoá bình luận đã có trả lời. Chỉ người viết được sửa hoặc xoá bình luận của mình trong vòng 15 phút. Admin được xoá mọi bình luận.
- **FR-9 Thư viện** ([VideoLibraryColumn.tsx](../../../frontend/src/components/VideoLibraryColumn.tsx), [VideoLibraryDrawer.tsx](../../../frontend/src/components/VideoLibraryDrawer.tsx)): hiện huy hiệu trạng thái duyệt và số góp ý chưa xử lý. Có bộ lọc theo trạng thái.
- **FR-10 Render phát hành và nháp.** Job cắt (`POST /cut`, `CutRequestDTO`) có thêm tham số `renderKind`:
  - `DRAFT` (mặc định): render ở mọi trạng thái. Thư mục xuất có hậu tố `_nhap`, `video_parts` được ghi bình thường. Clip nháp **không** dùng được cho F40, F41, F42.
  - `RELEASE`: chỉ chạy khi `review_status IN ('APPROVED','PUBLISHED')`, nếu không thì trả 409 `NOT_APPROVED`. Thư mục xuất không có hậu tố. Thêm cột `video_parts.render_kind` để các spec xuất bản lọc theo.

  `POST /render` cũ không có khái niệm này và được bỏ dần (F00 FR-8, F32).
- **FR-12 Sự kiện "đã duyệt".** Khi video chuyển sang `APPROVED` (do `approve`, kể cả tự duyệt), `ReviewService` phát Spring `ApplicationEvent` `VideoApprovedEvent(videoId, approverId, approvedAt)`. Phía nghe dùng `@TransactionalEventListener(phase = AFTER_COMMIT)`, nên chỉ nhận sự kiện khi transaction duyệt đã commit. F46 dùng sự kiện này để tính `segment_edit_stats` (so bản `AI_ANALYZE` mới nhất của F33 với bản được duyệt).
- **FR-11 Tự duyệt.** Cấu hình hệ thống `autocut.review.allow-self-approval` trong `application.properties` (biến môi trường `REVIEW_ALLOW_SELF_APPROVAL`), mặc định `false`. Khi bật, người gửi duyệt được tự `approve`, và sự kiện ghi `message = "Tự duyệt"`. Khi F49 có tổ chức, tổ chức có thể ghi đè giá trị này; phần đó thuộc F49, spec này không phụ thuộc.

## 5. Yêu cầu phi chức năng
- Tải 500 bình luận của một video trong dưới 300 ms. Phân trang theo `time_sec`.
- Kiểm tra quyền chuyển trạng thái **ở máy chủ**. Frontend chỉ ẩn nút, không phải lớp bảo vệ.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__review_workflow_comments.sql`
```sql
ALTER TABLE videos ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (review_status IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED','PUBLISHED'));
ALTER TABLE videos ADD COLUMN IF NOT EXISTS reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_videos_review_status ON videos(review_status);

ALTER TABLE video_parts ADD COLUMN IF NOT EXISTS render_kind VARCHAR(10) NOT NULL DEFAULT 'DRAFT'
    CHECK (render_kind IN ('DRAFT','RELEASE'));

CREATE TABLE IF NOT EXISTS review_events (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- NULL = hệ thống (legacy_import)
    action VARCHAR(30) NOT NULL,
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    message TEXT,
    version_no BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_events_video ON review_events(video_id, created_at DESC);

-- Dữ liệu cũ (xem câu hỏi mở 2): mặc định đưa về APPROVED và ghi vết để truy lại
UPDATE videos SET review_status = 'APPROVED' WHERE reviewed = TRUE;
INSERT INTO review_events (video_id, actor_id, action, from_status, to_status, message, version_no)
SELECT id, NULL, 'legacy_import', 'DRAFT', 'APPROVED', 'Chuyển từ cờ reviewed=true cũ', version
FROM videos WHERE reviewed = TRUE;

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,
    parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    time_sec DOUBLE PRECISION NOT NULL CHECK (time_sec >= 0),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    mentions BIGINT[] NOT NULL DEFAULT '{}',
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
    resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_video_time ON comments(video_id, time_sec);
CREATE INDEX IF NOT EXISTS idx_comments_open ON comments(video_id) WHERE status = 'OPEN';
```

### 6.2 API
**`ReviewController`** — `/api/v1/videos/{videoId}/review`
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `` | Xem | `{ status, reviewer, events[] }` |
| POST | `/actions` | Theo bảng FR-1 | `{ action, message?, reviewerId? }` |

Theo AD-2: không có quyền xem video thì trả 404; có quyền xem nhưng hành động không được phép với role của mình thì trả 403 `FORBIDDEN_ACTION`; tự duyệt khi FR-11 tắt thì trả 403 `SELF_APPROVAL_FORBIDDEN`.

```json
// POST /api/v1/videos/42/review/actions
{ "action": "request_changes", "message": "Còn 3 chỗ cắt hụt, xem góp ý" }
// 200
{ "status": "CHANGES_REQUESTED", "eventId": 88 }
// 409 chuyển trạng thái không hợp lệ
{ "error": { "code": "INVALID_TRANSITION", "message": "Không thể duyệt video đang ở trạng thái Bản nháp",
  "details": { "from": "DRAFT", "action": "approve" } } }
// 403 người gửi tự duyệt
{ "error": { "code": "SELF_APPROVAL_FORBIDDEN", "message": "Bạn không thể tự duyệt video mình gửi" } }
```

**`CommentController`** — `/api/v1/videos/{videoId}/comments`
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `?status=OPEN&from=0&to=600` | Xem | Danh sách, có trả lời lồng 1 cấp |
| POST | `` | Có `COMMENT` (OWNER, EDITOR, REVIEWER) | Tạo bình luận `{ timeSec, body, parentId?, mentions? }` |
| PATCH | `/{commentId}` | Tác giả (≤ 15 phút) | Sửa nội dung |
| POST | `/{commentId}/resolve` · `/reopen` | Có `COMMENT` | Đổi trạng thái |
| DELETE | `/{commentId}` | Tác giả (≤ 15 phút) / Admin | Xoá |

```json
// POST /api/v1/videos/42/comments
{ "timeSec": 750.4, "body": "Cắt hụt chữ 'vòng lặp' @minh", "mentions": [2] }
// 201
{ "id": 501, "timeSec": 750.4, "topicId": 1012, "author": { "id": 1, "name": "Nguyễn Văn Toàn" },
  "status": "OPEN", "createdAt": "2026-11-17T09:00:00Z", "replies": [] }
```

### 6.3 Backend
- **Mới** `review/ReviewStatus.java` (enum), `review/ReviewAction.java` (enum), `review/ReviewStateMachine.java`. Lớp này là hàm thuần `ReviewStatus next(ReviewStatus from, ReviewAction a)`, ném `InvalidTransitionException` khi không hợp lệ.
- **Mới** `service/ReviewService.java`: kiểm tra quyền, tự duyệt, điều kiện `request_changes`, ghi `review_events`, phát `ApplicationEvent` (`ReviewStatusChangedEvent`) cho F48 và F08.
- **Mới** `service/CommentService.java`: tự gán `topic_id` bằng truy vấn topic ACTIVE có `start_time <= t < end_time` (dùng `topics.video_id` của F00); kiểm tra người được @nhắc có dòng `video_access` trên video. Kiểm tra quyền qua `AccessService.require` (AD-1).
- **Sửa** `ProjectVersionService.save` (F33) và `EditRangeService.replaceUserRanges` (F32): nếu version tăng và trạng thái là `APPROVED` thì gọi `reviewService.autoReopen(videoId, version, actorId)` để chuyển về `DRAFT` (FR-2).
- **Sửa** `CutRequestDTO` thêm `renderKind`; `BatchVideoCutService` kiểm tra FR-10, ghi `video_parts.render_kind`.
- **Mới** `review/VideoApprovedEvent.java` (record `videoId, approverId, approvedAt`), phát trong `ReviewService` khi `to_status = APPROVED` (FR-12). `ReviewStatusChangedEvent` vẫn phát cho mọi lần chuyển trạng thái.
- **Mới** `config/ReviewProperties.java` (`@ConfigurationProperties("autocut.review")`) với `allowSelfApproval`.

### 6.5 Frontend
- **Mới** `components/ReviewStatusBadge.tsx`. Nhãn tiếng Việt: Bản nháp / Chờ duyệt / Cần sửa / Đã duyệt / Đã xuất bản.
- **Mới** `components/ReviewActionBar.tsx` đặt trong `StudioHeader`: hiện các nút theo trạng thái và vai trò, kèm hộp thoại nhập lời nhắn.
- **Mới** `components/CommentsPanel.tsx` (tab mới cạnh Trợ lý AI), `components/CommentComposer.tsx` (gợi ý @nhắc tên), `components/TimelineCommentMarkers.tsx` (lớp phủ trên `StudioTimeline`).
- **Sửa** `StatsCards.tsx`: thay nút đảo cờ `reviewed` bằng `ReviewStatusBadge` chỉ để xem. Xoá trình xử lý ở [page.tsx:1562](../../../frontend/src/app/page.tsx#L1562).
- **Sửa** [page.tsx:753](../../../frontend/src/app/page.tsx#L753): không ép `reviewed: true` nữa.
- `lib/api.ts`: `getReview`, `postReviewAction`, `listComments`, `createComment`, `resolveComment`, ...

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* video ở DRAFT, *When* gọi `approve`, *Then* nhận 409 `INVALID_TRANSITION`.
- **AC-2** — *Given* SV1 gửi duyệt, *When* SV1 gọi `approve`, *Then* nhận 403 `SELF_APPROVAL_FORBIDDEN`.
- **AC-3** — *Given* video APPROVED, *When* biên tập viên lưu một thay đổi, *Then* `review_status` thành DRAFT và có `review_events` với `action='auto_reopen'`.
- **AC-4** — *When* tạo bình luận ở 750,4 giây, *Then* `topic_id` là topic có `start ≤ 750,4 < end`, và trên timeline có chấm tròn đúng vị trí (sai lệch dưới 2 px).
- **AC-5** — *When* bấm vào bình luận trong panel, *Then* `currentTime` = 750,4 và video tạm dừng.
- **AC-6** — *Given* video có 3 bình luận OPEN, *Then* thẻ trong thư viện hiện "3 góp ý".
- **AC-7** — *Given* đang ở `request_changes` mà không có bình luận mở và không có lời nhắn, *Then* nhận 422.
- **AC-8** — Bấm vào `StatsCards` không còn đổi được trạng thái duyệt.
- **AC-9** — *Given* video ở DRAFT, *When* tạo job cắt với `renderKind=RELEASE`, *Then* nhận 409 `NOT_APPROVED`. *When* `renderKind=DRAFT`, *Then* job chạy, thư mục xuất có hậu tố `_nhap` và `video_parts.render_kind='DRAFT'`.
- **AC-10** — *Given* `REVIEW_ALLOW_SELF_APPROVAL=true`, *When* người gửi tự `approve`, *Then* thành công và sự kiện có `message='Tự duyệt'`.
- **AC-11** — *Given* DB có 3 video `reviewed=true` trước migration, *Then* sau migration có 3 dòng `review_events` với `action='legacy_import'` và `actor_id IS NULL`.
- **AC-12** — *Given* user `VIEWER` hoặc `EDITOR`, *When* gọi `approve`, *Then* nhận 403 `FORBIDDEN_ACTION`. *Given* user không có quyền gì, *Then* nhận 404.

## 8. Kế hoạch kiểm thử (TDD)
- `ReviewStateMachineTest` (tham số hoá, đủ mọi cặp trạng thái × hành động):
  - `allowedTransitions_matchTable`
  - `disallowedTransitions_throw`
- `ReviewServiceTest`:
  - `approve_bySubmitter_forbidden`
  - `requestChanges_withoutCommentOrMessage_rejected`
  - `transition_writesEventWithVersionNo`
  - `transition_publishesApplicationEvent`
  - `autoReopen_onlyFromApproved`
  - `approve_byViewer_forbiddenAction`
  - `approve_selfWhenAllowed_succeeds`
  - `submit_withIneligibleReviewer_rejected`
  - `approve_publishesVideoApprovedEvent_afterCommitOnly` (listener `@TransactionalEventListener` nhận đúng 1 sự kiện khi commit, 0 sự kiện khi transaction rollback)
- `BatchVideoCutServiceTest`: `releaseRender_notApproved_throwsNotApproved`, `draftRender_addsSuffixAndRenderKind`
- `ReviewMigrationTest`: `legacyReviewed_becomesApprovedWithEvent` (Postgres, AD-7)
- `CommentServiceTest`:
  - `create_assignsTopicContainingTime`
  - `create_timeOutsideAnyTopic_topicNull`
  - `edit_after15min_forbidden`
  - `delete_withReplies_forbidden`
  - `mention_userWithoutAccess_rejected`
- `CommentControllerTest` (MockMvc): `list_filterOpen`, `create_bodyTooLong_returns422`.
- Frontend: `reviewPermissions.test.ts`, kiểm tra hàm `availableActions(status, role, isSubmitter)`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Dữ liệu cũ đang `reviewed=true` | Bị gán APPROVED hàng loạt mà không ai duyệt thật | Migration ghi `review_events` loại `legacy_import` (actor NULL) để truy vết. Nếu trưởng nhóm muốn đưa về DRAFT thì chỉ cần đổi `UPDATE` trong migration |
| Bình luận lệch mốc sau khi F32 bỏ bớt đoạn | `time_sec` trỏ sai nội dung | `time_sec` luôn là thời gian của **video gốc**, không phải clip đã cắt. Ghi rõ trong UI |
| Topic bị DISCARDED | Bình luận mất ngữ cảnh | Topic không bị xoá cứng (F00), nên `topic_id` vẫn trỏ đúng; giao diện hiện "(đoạn đã bị bỏ)" khi `topics.status='DISCARDED'` |
| Nhóm nhỏ, chỉ có một người | Không tự duyệt được | Bật cấu hình hệ thống `autocut.review.allow-self-approval` (FR-11) |

## 10. Câu hỏi mở
- [ ] Có bật tự duyệt (FR-11) cho môi trường hiện tại không? Mặc định tắt.
- [ ] Dữ liệu cũ `reviewed=true` chuyển thành APPROVED hay DRAFT?
- [x] `VIEWER` có được bình luận không? **Đã chốt theo AD-1/F02 FR-2:** không (chỉ người có `COMMENT`).
- [ ] Render bản nháp có cần đóng watermark "BẢN NHÁP" không (liên quan F44)?
