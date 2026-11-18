# F47 — Thống kê người xem

| Mục | Giá trị |
|---|---|
| **Mã** | F47 |
| **Nhóm** | Vận hành |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (API thu sự kiện, tổng hợp) · SV4 (trình phát + biểu đồ) |
| **Phụ thuộc** | F13, F00 (`video_parts.id` ổn định), F02 (quyền xem số liệu), F06 (rate limit), F09 (job gom số liệu), F39 (trình phát HLS), F40 (link chia sẻ), F41 (trang khoá học), F46 (khung dashboard) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. Gửi sự kiện bằng `navigator.sendBeacon`, vẽ biểu đồ bằng SVG. |
| **Tham khảo** | YouTube Studio Audience Retention, Vimeo Analytics, Panopto Viewer Analytics |

> **Cập nhật 18/11/2026:** gom số liệu theo **ngày** bằng cách tính lại cả ngày từ dữ liệu thô (sửa lỗi đếm trùng `unique_viewers`), thêm bảng `aggregation_runs` vào migration, F47 tự thêm cột `analytics_enabled` vào `share_links` và `courses`, ghi nhận người xem trang khoá học F41 không cần `shareToken`, đổi endpoint sang `/api/v1/share/view-events` (AD-5), bộ gom chạy như job của F09 (AD-10).

## 1. Bối cảnh & vấn đề
- Hiện chỉ có trình phát trong studio ([VideoCanvasViewport.tsx:268-274](../../../frontend/src/components/VideoCanvasViewport.tsx#L268-L274)) dành cho người biên tập. Chưa có nơi nào cho học viên xem, nên chưa có số liệu người xem.
- Sau khi có F40/F41, giảng viên cần biết clip nào bị bỏ ngang, đoạn nào bị tua lại nhiều. Đoạn bị tua lại nhiều thường là đoạn khó, cần giảng lại; đoạn bị bỏ ngang thường là đoạn quá dài hoặc dư thừa.
- Không có bảng nào trong [schema.sql](../../../database/schema.sql) lưu lượt xem.

## 2. Mục tiêu
- Thu sự kiện xem ẩn danh từ trình phát công khai: bắt đầu, tiến độ theo từng ô 5 giây, tua, kết thúc.
- Mỗi clip có: lượt xem, người xem duy nhất (ẩn danh), thời gian xem trung bình, tỉ lệ xem hết, **đường cong giữ chân (retention curve)**.
- Có heatmap "đoạn bị xem lại nhiều" vẽ chồng lên timeline clip.

### Ngoài phạm vi
- Theo dõi danh tính học viên cụ thể (cần đồng ý của học viên và chính sách riêng; để ở phiên bản sau, gắn với LMS F42).
- Thống kê vị trí địa lý hay thiết bị chi tiết.
- Mã theo dõi bên thứ ba (Google Analytics, Facebook Pixel). **Cấm.**

## 3. User stories
- Là **giảng viên**, tôi muốn biết học viên thường bỏ dở ở phút nào để rút gọn đoạn đó.
- Là **giảng viên**, tôi muốn thấy đoạn bị xem lại nhiều nhất để làm thêm tài liệu cho phần khó.
- Là **học viên**, tôi muốn xem video mà không phải cho phép cookie theo dõi.

## 4. Yêu cầu chức năng
- **FR-1** Trình phát công khai sinh `viewerId` ngẫu nhiên (UUID v4) lưu trong `localStorage`, không gắn thông tin cá nhân. Nếu `localStorage` lỗi thì mỗi phiên dùng một id mới.
- **FR-2** Mỗi phiên xem có `sessionId`. Một phiên thuộc về **ngày của sự kiện `start`** (giờ Việt Nam), kể cả khi kéo dài qua nửa đêm. Gửi các sự kiện: `start`, `heartbeat` (mỗi 10s, kèm danh sách ô 5 giây đã xem), `seek`, `end`, `leave` (`visibilitychange`/`pagehide`, gửi bằng `sendBeacon`).
- **FR-3** Một "lượt xem" chỉ được tính khi người xem đã xem ít nhất 5 giây hoặc 30% clip ngắn (dưới 15s).
- **FR-4** Mỗi giờ, bộ gom **tính lại toàn bộ ngày hôm nay** (và ngày hôm qua nếu đang trong 1 giờ đầu ngày) từ `view_events` rồi ghi đè vào `clip_view_stats_daily` và `clip_retention_daily`. Vì luôn tính lại cả ngày nên không bao giờ cộng dồn trùng; chạy lại bao nhiêu lần cũng ra cùng kết quả.
  - `views` = số phiên đạt điều kiện FR-3; `unique_viewers` = `COUNT(DISTINCT viewer_id)` trong ngày; `total_watch_sec` = tổng số ô 5 giây **khác nhau** mỗi phiên đã xem × 5.
  - Retention: `viewers` của một ô = số phiên trong ngày có xem ô đó; `rewatches` = số lần ô được xem lại trong cùng phiên.
- **FR-4b** Khi hỏi số liệu cho một khoảng ngày: `views`, `total_watch_sec`, `completions` và retention được cộng từ các dòng theo ngày. `unique_viewers` của cả khoảng thì **đếm lại từ `view_events`** nếu khoảng nằm trong 90 ngày lưu dữ liệu thô; ngoài 90 ngày thì trả `null` và giao diện ghi "Không còn dữ liệu chi tiết".
- **FR-5** Trang `/videos/{id}/analytics`: bảng các clip (lượt xem, thời gian xem TB, % xem hết), click vào clip thì hiện biểu đồ retention cùng heatmap tua lại.
- **FR-6** Có thể tắt thu thập theo từng link chia sẻ và từng khoá học: F47 thêm cột `analytics_enabled` (mặc định `TRUE`) vào bảng `share_links` (F40) và `courses` (F41) trong migration của mình. Cờ tắt thì endpoint vẫn trả 204 nhưng không ghi gì.
- **FR-7** Hai nguồn xem được ghi nhận:
  - **Link chia sẻ (F40):** request có `shareToken`; `partId` phải thuộc đối tượng của link (`VIDEO`, `PART`, `LESSON`, `COURSE`).
  - **Trang khoá học (F41):** request có `courseId` thay cho `shareToken`; `partId` phải thuộc một bài trong khoá. Khoá `PUBLIC` không cần đăng nhập. Khoá `ENROLLED`/`LINK` kiểm tra quyền xem như F41 (JWT hoặc share link). Dù người xem đã đăng nhập, sự kiện vẫn **chỉ lưu `viewer_id` ẩn danh**, không lưu `user_id`.

## 5. Yêu cầu phi chức năng
- Endpoint nhận sự kiện chịu được 200 req/s trên một instance; trả `204` trong dưới 50 ms (chỉ ghi DB, không tổng hợp ngay).
- Rate limit theo IP + `viewerId` (dùng F06): tối đa 60 sự kiện/phút.
- Không lưu IP thô. Chỉ lưu `ip_hash = SHA-256(ip + salt_theo_ngày)` phục vụ chống gian lận; salt mỗi ngày sinh ngẫu nhiên, giữ trong bộ nhớ và **không ghi ra đĩa**, nên sau khi đổi ngày không thể dò ngược IP. Cột `ip_hash` bị đặt NULL sau 30 ngày.
- Bảng sự kiện thô chỉ giữ 90 ngày (F17 dọn).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__viewer_analytics.sql`:
```sql
CREATE TABLE IF NOT EXISTS view_events (
    id BIGSERIAL PRIMARY KEY,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    source VARCHAR(8) NOT NULL,               -- SHARE | COURSE
    share_link_id BIGINT REFERENCES share_links(id) ON DELETE SET NULL,
    course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
    session_id UUID NOT NULL,
    viewer_id UUID NOT NULL,
    event_type VARCHAR(16) NOT NULL,          -- start|heartbeat|seek|end|leave
    position_sec DOUBLE PRECISION,
    watched_buckets INT[],                    -- chỉ số ô 5s đã xem trong lần heartbeat
    seek_from_sec DOUBLE PRECISION,
    ip_hash CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_view_events_part_time ON view_events(video_part_id, created_at);
CREATE INDEX IF NOT EXISTS idx_view_events_time ON view_events(created_at);

CREATE TABLE IF NOT EXISTS clip_view_stats_daily (
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    views INT NOT NULL DEFAULT 0,
    unique_viewers INT NOT NULL DEFAULT 0,
    total_watch_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
    completions INT NOT NULL DEFAULT 0,
    PRIMARY KEY (video_part_id, day)
);

CREATE TABLE IF NOT EXISTS clip_retention_daily (
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    bucket_index INT NOT NULL,                -- ô 5 giây
    viewers INT NOT NULL DEFAULT 0,           -- số phiên trong ngày có xem ô này
    rewatches INT NOT NULL DEFAULT 0,         -- số lần ô này được xem lại trong cùng phiên
    PRIMARY KEY (video_part_id, day, bucket_index)
);

-- Đánh dấu ngày đã gom (phục vụ theo dõi; tính đúng nhờ tính lại cả ngày, không nhờ bảng này)
CREATE TABLE IF NOT EXISTS aggregation_runs (
    day DATE PRIMARY KEY,
    last_run_at TIMESTAMPTZ NOT NULL,
    events_processed BIGINT NOT NULL DEFAULT 0
);

-- Cờ tắt thu thập (FR-6). F47 sở hữu hai cột này.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE courses     ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```
Ghi đè một ngày: trong **một transaction**, `DELETE FROM clip_view_stats_daily WHERE day = :d` (tương tự với `clip_retention_daily`), rồi `INSERT … SELECT … FROM view_events WHERE <phiên bắt đầu trong ngày :d>`, sau đó `INSERT INTO aggregation_runs … ON CONFLICT (day) DO UPDATE`.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/share/view-events` | Ẩn danh, cần `shareToken` **hoặc** `courseId` hợp lệ (AD-5) | Nhận lô sự kiện |
| GET | `/api/v1/videos/{id}/analytics?from=&to=` | `OWNER`/`EDITOR` của video (AD-1) | Bảng tổng hợp theo clip |
| GET | `/api/v1/parts/{partId}/retention?from=&to=` | `OWNER`/`EDITOR` của video chứa clip | Đường cong giữ chân + heatmap |

Request mẫu (có thể gom nhiều sự kiện, tối đa 20):
```json
{
  "shareToken": "sh_8f2a...",          // hoặc "courseId": 17 (F41)
  "viewerId": "9b1c...-uuid",
  "sessionId": "1d7e...-uuid",
  "events": [
    { "type": "heartbeat", "partId": 812, "position": 42.3, "buckets": [6,7,8] },
    { "type": "seek", "partId": 812, "from": 42.3, "position": 20.0 }
  ]
}
```
Response: `204 No Content`. Lỗi:
- `400 INVALID_EVENT`: sai định dạng, quá 20 sự kiện, hoặc có cả `shareToken` lẫn `courseId`.
- `404 SHARE_NOT_FOUND`: token không tồn tại, `courseId` không xem được, hoặc `partId` không thuộc đối tượng (AD-2).
- `410 SHARE_EXPIRED`: link đã hết hạn hoặc bị thu hồi (cùng mã với F40).
- `429 RATE_LIMITED`.

GET analytics/retention: người không có quyền xem video nhận `404 VIDEO_NOT_FOUND`; người chỉ có quyền `VIEWER`/`REVIEWER` nhận `403 FORBIDDEN_ACTION` (AD-2).

Response `/retention`:
```json
{ "partId": 812, "bucketSec": 5, "durationSec": 318,
  "retention": [1.0, 0.97, 0.95, 0.81],
  "rewatchHeat": [0, 0, 3, 12] }
```

### 6.3 Backend
- `controller/v1/ShareViewEventController.java`: kiểm tra `shareToken` (F40, dùng lại `ShareLinkService.resolve`) **hoặc** `courseId` (F41, dùng lại `CourseAccessPolicy`), kiểm tra `partId` thuộc đối tượng đó, kiểm tra cờ `analytics_enabled`, rồi ghi lô sự kiện bằng một lệnh batch insert.
- `service/ViewAnalyticsAggregator.java`: một `@Scheduled(cron = "0 5 * * * *")` chỉ làm một việc là **tạo job** `VIEW_AGGREGATE` trong bảng `jobs` (F09, AD-10) với khoá chống trùng `view-agg:<yyyy-MM-dd-HH>` (`ON CONFLICT DO NOTHING`, AD-8). Worker của job gọi `recomputeDay(day)` theo FR-4.
- `service/ViewAnalyticsQueryService.java` cho các GET (cộng theo ngày, `unique_viewers` theo FR-4b).
- `service/ViewAnalyticsQueryService.java` cho các GET.

### 6.5 Frontend
- `frontend/src/lib/viewTracker.ts`: lớp `ViewTracker(partId, { shareToken } | { courseId })` gắn vào `<video>` qua `timeupdate`, `seeking`, `ended`, `pagehide`. Gom sự kiện, gửi mỗi 10s, khi rời trang dùng `navigator.sendBeacon`.
- Trình phát công khai (F40/F41) gọi `ViewTracker`. Trình phát studio **không** gọi.
- `frontend/src/app/videos/[id]/analytics/page.tsx` + `components/analytics/RetentionChart.tsx` (SVG), `RewatchHeatmap.tsx`.
- Chú thích dưới trình phát công khai: "Hệ thống ghi nhận ẩn danh thời lượng xem để giảng viên cải thiện bài giảng."

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* một người xem 30s đầu của clip 60s rồi đóng tab. *When* bộ gom chạy. *Then* `views = 1`, các ô 0–5 có `viewers = 1`, các ô 6–11 có `viewers = 0`, `completions = 0`.
- **AC-2** — *Given* người xem tua từ 40s về 20s rồi xem tiếp tới 40s. *Then* các ô 4–7 có `rewatches = 1`.
- **AC-3** — *Given* người xem chỉ xem 3s của clip 60s. *Then* không tính vào `views`.
- **AC-4** — *Given* `shareToken` đã hết hạn. *Then* POST trả 410 `SHARE_EXPIRED` và không ghi sự kiện nào. *Given* `partId` không thuộc link, *Then* trả 404.
- **AC-5** — *Given* bộ gom chạy 2 lần cho cùng một ngày. *Then* số liệu không bị nhân đôi.
- **AC-5b** — *Given* cùng một `viewerId` xem clip lúc 09:10 và 14:20 trong một ngày, *When* bộ gom chạy sau mỗi giờ. *Then* `unique_viewers` của ngày đó là 1 (không phải 2) và `views` là 2.
- **AC-5c** — *Given* phiên bắt đầu 23:58 và heartbeat tới 00:03 hôm sau. *Then* phiên chỉ được tính cho ngày bắt đầu.
- **AC-5d** — *Given* học viên xem bài trong khoá học `PUBLIC` (F41) không có `shareToken`. *Then* sự kiện được ghi với `source='COURSE'` và không có `user_id`.
- **AC-5e** — *Given* link có `analytics_enabled = false`. *Then* POST trả 204 và `view_events` không có dòng mới.
- **AC-6** — *Given* 1 viewerId gửi 100 sự kiện/phút. *Then* các sự kiện sau mốc 60 nhận 429.
- **AC-7** — Không có cột nào trong DB lưu IP thô (kiểm tra schema bằng test).

## 8. Kế hoạch kiểm thử (TDD)
- `ViewAnalyticsAggregatorTest.shouldBuildRetentionFromBuckets`
- `ViewAnalyticsAggregatorTest.shouldCountRewatchOnBackwardSeek`
- `ViewAnalyticsAggregatorTest.shouldNotCountViewUnderFiveSeconds`
- `ViewAnalyticsAggregatorTest.rerunSameDayIsIdempotent` (AC-5)
- `ViewAnalyticsAggregatorTest.uniqueViewersNotDoubleCountedAcrossHours` (AC-5b)
- `ViewAnalyticsAggregatorTest.sessionCountedOnStartDay` (AC-5c)
- `ViewAnalyticsQueryServiceTest.uniqueViewersForRangeRecountedFromRaw`
- `ShareViewEventControllerTest.rejectsExpiredShareTokenWith410`
- `ShareViewEventControllerTest.rejectsPartNotInSharedTargetWith404`
- `ShareViewEventControllerTest.rejectsBatchOver20Events`
- `ShareViewEventControllerTest.acceptsPublicCourseWithoutShareToken` (AC-5d)
- `ShareViewEventControllerTest.skipsWhenAnalyticsDisabled` (AC-5e)
- Frontend: unit test `viewTracker` (giả lập `timeupdate`) nếu team có Jest; nếu chưa thì kiểm tra tay bằng DevTools → Network.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bảng `view_events` phình rất nhanh | DB Neon tốn tiền | Heartbeat 10s, gom lô, giữ 90 ngày, cân nhắc partition theo tháng |
| Bot hoặc người cố tình gửi sự kiện giả | Số liệu sai | Bắt buộc shareToken, rate limit, bỏ session có >1 heartbeat/giây |
| `sendBeacon` bị chặn trên một số trình duyệt | Mất sự kiện cuối | Chấp nhận sai số; heartbeat đã ghi phần lớn |
| Vấn đề quyền riêng tư (Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 và NĐ 356/2025, hiệu lực 01/01/2026) | Pháp lý | Ẩn danh, không IP thô, có thông báo, có cờ tắt. `viewer_id` cố định trong `localStorage` vẫn là định danh giả danh, nên nêu rõ trong Chính sách quyền riêng tư (đề xuất F90) |
| Clip được render lại (F00: cùng `video_parts.id`, nội dung đổi) | Retention cũ không khớp nội dung mới | Giao diện hiện mốc "Clip render lại ngày …" từ `rendered_at`; mặc định chỉ lấy số liệu sau lần render gần nhất |
| Tính lại cả ngày tốn tài nguyên khi lượt xem lớn | Job chạy lâu | Index `view_events(created_at)`; nếu một ngày > 1 triệu sự kiện thì cân nhắc partition theo tháng (chưa làm ở bản này) |

## 10. Câu hỏi mở
- [ ] Kích thước ô 5 giây có hợp lý với clip dài 30 phút không, hay nên dùng 1% độ dài clip?
- [x] Thống kê theo học viên đã đăng nhập: **không** ở bản này. Người xem từ F41 vẫn ghi ẩn danh (FR-7); tiến độ theo tài khoản đã có ở `watch_progress` của F41.
- [x] Dùng cron trong Spring hay job queue F09? **Đã chốt theo AD-10:** cron chỉ tạo job, job F09 thực hiện gom.
- [ ] Thời gian lưu sự kiện thô: 90 ngày có đủ không?
