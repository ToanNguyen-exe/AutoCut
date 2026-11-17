# F35 — Quy trình duyệt + bình luận theo mốc giờ

| Mục | Giá trị |
|---|---|
| **Mã** | F35 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API, máy trạng thái) + SV4 (giao diện) |
| **Phụ thuộc** | F01, F02 (vai trò Giảng viên/Biên tập/Người duyệt), F13, F33 (`topics.id` ổn định để gắn bình luận). Thông báo: F48 (nếu có). Nhật ký: F08. |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Frame.io (time-coded comments), Vimeo Review, Wistia, GitHub PR review (Approve / Request changes) |

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

| Từ | Hành động | Sang | Ai được làm |
|---|---|---|---|
| DRAFT | `submit` | IN_REVIEW | Chủ video, Biên tập viên |
| IN_REVIEW | `approve` | APPROVED | Người duyệt (Giảng viên/Admin), **không** phải người vừa gửi duyệt |
| IN_REVIEW | `request_changes` (bắt buộc ít nhất 1 bình luận mở hoặc có lời nhắn) | CHANGES_REQUESTED | Người duyệt |
| CHANGES_REQUESTED | `submit` | IN_REVIEW | Chủ video, Biên tập viên |
| IN_REVIEW | `withdraw` | DRAFT | Người đã gửi duyệt |
| APPROVED | `publish` | PUBLISHED | Người duyệt, Admin |
| APPROVED, PUBLISHED | `reopen` | DRAFT | Người duyệt, Admin |

- **FR-2 Tự động quay lại.** Ở trạng thái `APPROVED`, nếu segments thay đổi (lưu qua F33 tạo version mới) thì tự về `DRAFT` và ghi lý do "Có chỉnh sửa sau khi duyệt". Ở `IN_REVIEW`, chỉnh sửa vẫn được nhưng hiện cảnh báo "Video đang chờ duyệt".
- **FR-3 Mỗi lần chuyển trạng thái** ghi vào `review_events` gồm: ai làm, từ trạng thái nào, sang trạng thái nào, lời nhắn, và `version_no` tại thời điểm đó.
- **FR-4 Cột `videos.reviewed` cũ** được suy ra: `reviewed = review_status IN ('APPROVED','PUBLISHED')`. Bỏ ba chỗ tự đặt cờ đã nêu ở §1.
- **FR-5 Bình luận:** gồm `time_sec` (bắt buộc), `topic_id` (tuỳ chọn, tự gán theo topic chứa `time_sec`), nội dung (1–2.000 ký tự), `parent_id` (trả lời), trạng thái `OPEN | RESOLVED`.
- **FR-6 @nhắc tên** những người có quyền trên video. Lưu danh sách `mentions` để F48 gửi thông báo.
- **FR-7 Giao diện bình luận:**
  - Timeline hiện chấm tròn tại mỗi `time_sec`. Rê chuột vào chấm thì xem trước nội dung.
  - Panel "Góp ý" có bộ lọc Tất cả / Chưa xử lý / Của tôi. Bấm vào một góp ý để nhảy tới mốc giờ.
  - Nhấn phím `C` (bổ sung vào keymap của F31) để mở ô bình luận tại playhead hiện tại. Video tự tạm dừng khi bắt đầu gõ.
- **FR-8** Không xoá bình luận đã có trả lời. Chỉ người viết được sửa hoặc xoá bình luận của mình trong vòng 15 phút. Admin được xoá mọi bình luận.
- **FR-9 Thư viện** ([VideoLibraryColumn.tsx](../../../frontend/src/components/VideoLibraryColumn.tsx), [VideoLibraryDrawer.tsx](../../../frontend/src/components/VideoLibraryDrawer.tsx)): hiện huy hiệu trạng thái duyệt và số góp ý chưa xử lý. Có bộ lọc theo trạng thái.
- **FR-10 Chặn render bản phát hành** khi chưa `APPROVED`. Render bản nháp vẫn được nhưng tên thư mục xuất có hậu tố `_nhap`.

## 5. Yêu cầu phi chức năng
- Tải 500 bình luận của một video trong dưới 300 ms. Phân trang theo `time_sec`.
- Kiểm tra quyền chuyển trạng thái **ở máy chủ**. Frontend chỉ ẩn nút, không phải lớp bảo vệ.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<n>__review_workflow_comments.sql`
```sql
ALTER TABLE videos ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS reviewer_id BIGINT REFERENCES users(id);
UPDATE videos SET review_status = 'APPROVED' WHERE reviewed = TRUE;
CREATE INDEX IF NOT EXISTS idx_videos_review_status ON videos(review_status);

CREATE TABLE IF NOT EXISTS review_events (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES users(id),
    action VARCHAR(30) NOT NULL,
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    message TEXT,
    version_no BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_events_video ON review_events(video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,
    parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES users(id),
    time_sec DOUBLE PRECISION NOT NULL CHECK (time_sec >= 0),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    mentions BIGINT[] NOT NULL DEFAULT '{}',
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN',   -- OPEN | RESOLVED
    resolved_by BIGINT REFERENCES users(id),
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
| POST | `` | Xem trở lên | Tạo bình luận `{ timeSec, body, parentId?, mentions? }` |
| PATCH | `/{commentId}` | Tác giả (≤ 15 phút) | Sửa nội dung |
| POST | `/{commentId}/resolve` · `/reopen` | Biên tập trở lên | Đổi trạng thái |
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
- **Mới** `service/CommentService.java`: tự gán `topic_id` bằng truy vấn topic ACTIVE có `start_time <= t < end_time`; kiểm tra người được @nhắc có quyền trên video.
- **Sửa** `ProjectVersionService.save` (F33): nếu trạng thái là `APPROVED` thì gọi `reviewService.autoReopen(videoId, version)` để chuyển về `DRAFT` (FR-2).
- **Sửa** `SegmentPersistenceService`: xoá dòng `video.setReviewed(true)`.
- **Sửa** luồng render (`/render`, `/cut`): đọc `review_status` để quyết định có hậu tố `_nhap` hay không (FR-10).

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
| Dữ liệu cũ đang `reviewed=true` | Bị gán APPROVED hàng loạt mà không ai duyệt thật | Migration ghi `review_events` loại `legacy_import` để truy vết. Hỏi trưởng nhóm có muốn đưa hết về DRAFT không |
| Bình luận lệch mốc sau khi F32 bỏ bớt đoạn | `time_sec` trỏ sai nội dung | `time_sec` luôn là thời gian của **video gốc**, không phải clip đã cắt. Ghi rõ trong UI |
| Topic bị DISCARDED | Bình luận mất ngữ cảnh | Dùng `ON DELETE SET NULL` và hiện "(đoạn đã bị bỏ)" |
| Nhóm nhỏ, chỉ có một người | Không tự duyệt được | Cấu hình `review.allowSelfApproval` theo tổ chức (F49), mặc định `false` |

## 10. Câu hỏi mở
- [ ] Có cho phép tự duyệt khi nhóm chỉ có 1 giảng viên không?
- [ ] Dữ liệu cũ `reviewed=true` chuyển thành APPROVED hay DRAFT?
- [ ] Người xem/học viên (role Người xem) có được bình luận không, hay chỉ người trong nhóm biên tập?
- [ ] Render bản nháp có cần đóng watermark "BẢN NHÁP" không (liên quan F44)?
