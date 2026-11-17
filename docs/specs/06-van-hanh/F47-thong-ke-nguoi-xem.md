# F47 — Thống kê người xem

| Mục | Giá trị |
|---|---|
| **Mã** | F47 |
| **Nhóm** | Vận hành |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV3 (API thu sự kiện, tổng hợp) · SV4 (trình phát + biểu đồ) |
| **Phụ thuộc** | F13, F39 (trình phát HLS), F40 (link chia sẻ), F41 (trang khoá học), F46 (khung dashboard) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. Gửi sự kiện bằng `navigator.sendBeacon`, vẽ biểu đồ bằng SVG. |
| **Tham khảo** | YouTube Studio Audience Retention, Vimeo Analytics, Panopto Viewer Analytics |

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
- **FR-2** Mỗi phiên xem có `sessionId`. Gửi các sự kiện: `start`, `heartbeat` (mỗi 10s, kèm danh sách ô 5 giây đã xem), `seek`, `end`, `leave` (`visibilitychange`/`pagehide`, gửi bằng `sendBeacon`).
- **FR-3** Một "lượt xem" chỉ được tính khi người xem đã xem ít nhất 5 giây hoặc 30% clip ngắn (dưới 15s).
- **FR-4** Tổng hợp mỗi giờ thành bảng `clip_view_stats_daily` và `clip_retention_buckets`.
- **FR-5** Trang `/videos/{id}/analytics`: bảng các clip (lượt xem, thời gian xem TB, % xem hết), click vào clip thì hiện biểu đồ retention cùng heatmap tua lại.
- **FR-6** Có thể tắt thu thập theo từng link chia sẻ (cờ `analytics_enabled` trong F40).

## 5. Yêu cầu phi chức năng
- Endpoint nhận sự kiện chịu được 200 req/s trên một instance; trả `204` trong dưới 50 ms (chỉ ghi DB, không tổng hợp ngay).
- Rate limit theo IP + `viewerId` (dùng F06): tối đa 60 sự kiện/phút.
- Không lưu IP thô. Chỉ lưu `ip_hash = SHA-256(ip + salt_theo_ngày)` phục vụ chống gian lận, xoá sau 30 ngày.
- Bảng sự kiện thô chỉ giữ 90 ngày (F17 dọn).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V47__viewer_analytics.sql`:
```sql
CREATE TABLE IF NOT EXISTS view_events (
    id BIGSERIAL PRIMARY KEY,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS clip_view_stats_daily (
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    views INT NOT NULL DEFAULT 0,
    unique_viewers INT NOT NULL DEFAULT 0,
    total_watch_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
    completions INT NOT NULL DEFAULT 0,
    PRIMARY KEY (video_part_id, day)
);

CREATE TABLE IF NOT EXISTS clip_retention_buckets (
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    bucket_index INT NOT NULL,                -- ô 5 giây
    viewers INT NOT NULL DEFAULT 0,           -- số session có xem ô này
    rewatches INT NOT NULL DEFAULT 0,         -- số lần ô này được xem lại trong cùng session
    PRIMARY KEY (video_part_id, bucket_index)
);
```

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/public/view-events` | Public (có token chia sẻ) | Nhận lô sự kiện |
| GET | `/api/v1/videos/{id}/analytics?from=&to=` | Chủ video | Bảng tổng hợp theo clip |
| GET | `/api/v1/parts/{partId}/retention` | Chủ video | Đường cong giữ chân + heatmap |

Request mẫu (có thể gom nhiều sự kiện, tối đa 20):
```json
{
  "shareToken": "sh_8f2a...",
  "viewerId": "9b1c...-uuid",
  "sessionId": "1d7e...-uuid",
  "events": [
    { "type": "heartbeat", "partId": 812, "position": 42.3, "buckets": [6,7,8] },
    { "type": "seek", "partId": 812, "from": 42.3, "position": 20.0 }
  ]
}
```
Response: `204 No Content`. Lỗi: `400 INVALID_EVENT`, `403 SHARE_TOKEN_INVALID`, `429 RATE_LIMITED`.

Response `/retention`:
```json
{ "partId": 812, "bucketSec": 5, "durationSec": 318,
  "retention": [1.0, 0.97, 0.95, 0.81],
  "rewatchHeat": [0, 0, 3, 12] }
```

### 6.3 Backend
- `controller/PublicViewEventController.java`: kiểm tra `shareToken` (F40), kiểm tra `partId` thuộc video được chia sẻ, rồi ghi lô sự kiện bằng `saveAll`.
- `service/ViewAnalyticsAggregator.java`: `@Scheduled(cron = "0 5 * * * *")` gom sự kiện của giờ trước vào hai bảng tổng hợp bằng SQL `INSERT ... ON CONFLICT DO UPDATE`. Chạy lại không làm sai số (idempotent): mỗi giờ chỉ xử lý sự kiện có `created_at` trong khoảng giờ đó, kèm bảng `aggregation_runs(hour)` để đánh dấu giờ đã gom.
- `service/ViewAnalyticsQueryService.java` cho các GET.

### 6.5 Frontend
- `frontend/src/lib/viewTracker.ts`: lớp `ViewTracker(partId, shareToken)` gắn vào `<video>` qua `timeupdate`, `seeking`, `ended`, `pagehide`. Gom sự kiện, gửi mỗi 10s, khi rời trang dùng `navigator.sendBeacon`.
- Trình phát công khai (F40/F41) gọi `ViewTracker`. Trình phát studio **không** gọi.
- `frontend/src/app/videos/[id]/analytics/page.tsx` + `components/analytics/RetentionChart.tsx` (SVG), `RewatchHeatmap.tsx`.
- Chú thích dưới trình phát công khai: "Hệ thống ghi nhận ẩn danh thời lượng xem để giảng viên cải thiện bài giảng."

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* một người xem 30s đầu của clip 60s rồi đóng tab. *When* bộ gom chạy. *Then* `views = 1`, các ô 0–5 có `viewers = 1`, các ô 6–11 có `viewers = 0`, `completions = 0`.
- **AC-2** — *Given* người xem tua từ 40s về 20s rồi xem tiếp tới 40s. *Then* các ô 4–7 có `rewatches = 1`.
- **AC-3** — *Given* người xem chỉ xem 3s của clip 60s. *Then* không tính vào `views`.
- **AC-4** — *Given* `shareToken` đã hết hạn. *Then* POST trả 403 và không ghi sự kiện nào.
- **AC-5** — *Given* bộ gom chạy 2 lần cho cùng một giờ. *Then* số liệu không bị nhân đôi.
- **AC-6** — *Given* 1 viewerId gửi 100 sự kiện/phút. *Then* các sự kiện sau mốc 60 nhận 429.
- **AC-7** — Không có cột nào trong DB lưu IP thô (kiểm tra schema bằng test).

## 8. Kế hoạch kiểm thử (TDD)
- `ViewAnalyticsAggregatorTest.shouldBuildRetentionFromBuckets`
- `ViewAnalyticsAggregatorTest.shouldCountRewatchOnBackwardSeek`
- `ViewAnalyticsAggregatorTest.shouldNotCountViewUnderFiveSeconds`
- `ViewAnalyticsAggregatorTest.rerunSameHourIsIdempotent`
- `PublicViewEventControllerTest.rejectsExpiredShareToken`
- `PublicViewEventControllerTest.rejectsPartNotInSharedVideo`
- `PublicViewEventControllerTest.rejectsBatchOver20Events`
- Frontend: unit test `viewTracker` (giả lập `timeupdate`) nếu team có Jest; nếu chưa thì kiểm tra tay bằng DevTools → Network.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bảng `view_events` phình rất nhanh | DB Neon tốn tiền | Heartbeat 10s, gom lô, giữ 90 ngày, cân nhắc partition theo tháng |
| Bot hoặc người cố tình gửi sự kiện giả | Số liệu sai | Bắt buộc shareToken, rate limit, bỏ session có >1 heartbeat/giây |
| `sendBeacon` bị chặn trên một số trình duyệt | Mất sự kiện cuối | Chấp nhận sai số; heartbeat đã ghi phần lớn |
| Vấn đề quyền riêng tư (Nghị định 13/2023 về dữ liệu cá nhân) | Pháp lý | Ẩn danh, không IP thô, có thông báo, có cờ tắt |

## 10. Câu hỏi mở
- [ ] Kích thước ô 5 giây có hợp lý với clip dài 30 phút không, hay nên dùng 1% độ dài clip?
- [ ] Có cần thống kê theo học viên đã đăng nhập (khi tích hợp LMS) ở phiên bản này không?
- [ ] Dùng cron trong Spring hay chạy gom bằng job queue F09?
- [ ] Thời gian lưu sự kiện thô: 90 ngày có đủ không?
