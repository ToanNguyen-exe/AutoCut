# F46 — Dashboard thống kê thật

| Mục | Giá trị |
|---|---|
| **Mã** | F46 |
| **Nhóm** | Vận hành |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API tổng hợp số liệu) · SV4 (giao diện) |
| **Phụ thuộc** | F01, F02 (biết ai đang xem, lọc theo `owner_id`), F09 (bảng `jobs`), F13 (Flyway), F15 (đo chi phí AI) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không bắt buộc. Biểu đồ vẽ bằng SVG thuần + Tailwind. Nếu team muốn dùng `recharts` thì phải xin duyệt. |
| **Tham khảo** | Descript Workspace Usage, Panopto Admin Stats, Opus Clip Dashboard |

## 1. Bối cảnh & vấn đề

- [StatsCards.tsx:13-16](../../../frontend/src/components/StatsCards.tsx#L13-L16) chỉ tính số liệu của **một video đang mở**: tổng thời lượng, số clip con, số đoạn dài. Số liệu lấy từ `SegmentsData` trong bộ nhớ trình duyệt, chưa có số liệu tổng hợp của người dùng hay của hệ thống.
- [page.tsx:1559](../../../frontend/src/app/page.tsx#L1559) gắn `StatsCards` vào studio. Hiện chưa có trang tổng quan riêng.
- Bảng `videos` ([schema.sql](../../../database/schema.sql)) đã có `status`, `duration`, `file_size` và `owner_id`. Bảng `users` có `storage_used_bytes`. Như vậy đã đủ dữ liệu gốc cho phần lớn chỉ số, chỉ còn thiếu nơi tổng hợp.
- Chưa có cách đo **AI sai bao nhiêu**: không biết người dùng đã sửa tay bao nhiêu điểm cắt so với kết quả AI ban đầu. Đây là chỉ số quan trọng nhất để cải thiện F18/F27.

## 2. Mục tiêu
- Trang `/dashboard` cho mỗi người dùng: số video, tổng giờ đã xử lý, số clip đã xuất, dung lượng đã dùng, trạng thái video (đang xử lý/lỗi).
- Trang `/admin/dashboard` cho Admin: số liệu toàn hệ thống, chi phí AI theo ngày, tỉ lệ job lỗi, **tỉ lệ điểm cắt bị sửa tay**.
- Chọn được khoảng thời gian (7 ngày, 30 ngày, 90 ngày, tuỳ chọn).

### Ngoài phạm vi
- Thống kê lượt xem của học viên (thuộc F47).
- Xuất báo cáo PDF và gửi báo cáo định kỳ qua email.
- Báo cáo tài chính/hoá đơn (thuộc F49).

## 3. User stories
- Là **giảng viên**, tôi muốn thấy tháng này mình đã xử lý bao nhiêu giờ bài giảng và còn bao nhiêu dung lượng.
- Là **giảng viên**, tôi muốn thấy ngay video nào đang lỗi để xử lý lại.
- Là **admin**, tôi muốn biết chi phí AI mỗi ngày để không vượt ngân sách.
- Là **trưởng nhóm AI (SV2)**, tôi muốn biết bao nhiêu % điểm cắt AI bị người dùng sửa, để đo xem bản prompt mới có tốt hơn không.

## 4. Yêu cầu chức năng
- **FR-1** Thẻ KPI cá nhân: `videos_total`, `hours_processed`, `clips_exported`, `storage_used/limit`, `videos_failed`.
- **FR-2** Biểu đồ cột "giờ video đã xử lý theo ngày" trong khoảng thời gian đang chọn.
- **FR-3** Danh sách 10 video gần nhất kèm trạng thái và nút "Mở studio".
- **FR-4** (Admin) KPI hệ thống: số người dùng hoạt động, tổng giờ đã xử lý, tổng chi phí AI (USD), tỉ lệ job thất bại, thời gian xử lý trung bình trên 1 giờ video.
- **FR-5** (Admin) **Tỉ lệ sửa điểm cắt** = số ranh giới topic bị dời quá 2 giây hoặc bị xoá/thêm ÷ tổng số ranh giới AI đề xuất. Tính theo từng phiên bản prompt/model.
- **FR-6** Bộ lọc khoảng thời gian, lưu lựa chọn vào `localStorage` (chỉ là tiện ích cho người xem).
- **FR-7** Mọi số liệu cá nhân chỉ tính dữ liệu có `owner_id` bằng người đang đăng nhập (F02).

## 5. Yêu cầu phi chức năng
- API dashboard phản hồi dưới 500 ms (p95) với 10.000 video. Có thể cache 60 giây trong bộ nhớ (Spring `@Cacheable` với cache mặc định, không cần thêm thư viện).
- Không truy vấn toàn bộ bảng `transcripts`. Chỉ tổng hợp từ `videos`, `jobs`, `ai_usage`, `segment_edit_stats`.
- Không có dữ liệu thì hiện trạng thái rỗng thân thiện, không hiện số 0 kèm biểu đồ trống.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V46__dashboard_stats.sql`:
```sql
-- Lưu snapshot kết quả AI ban đầu để so với bản người dùng sửa
CREATE TABLE IF NOT EXISTS segment_edit_stats (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    owner_id BIGINT REFERENCES users(id),
    model_name VARCHAR(100),
    prompt_version VARCHAR(50),
    ai_boundaries INT NOT NULL,       -- số ranh giới AI đề xuất
    moved_boundaries INT NOT NULL,    -- dời > 2s
    added_boundaries INT NOT NULL,
    removed_boundaries INT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edit_stats_owner_time ON segment_edit_stats(owner_id, computed_at);

-- Phục vụ biểu đồ theo ngày
CREATE INDEX IF NOT EXISTS idx_videos_owner_created ON videos(owner_id, created_at);
```
Bảng `ai_usage` (chi phí AI) do F15 tạo. Bảng `jobs` do F09 tạo. F46 chỉ đọc hai bảng này.

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/dashboard/me?from=2026-11-01&to=2026-11-30` | Đã đăng nhập | KPI cá nhân + chuỗi theo ngày |
| GET | `/api/v1/admin/dashboard?from=&to=` | ADMIN | KPI hệ thống |

Phản hồi mẫu `/dashboard/me`:
```json
{
  "range": { "from": "2026-11-01", "to": "2026-11-30" },
  "kpi": {
    "videosTotal": 12,
    "videosFailed": 1,
    "hoursProcessed": 18.4,
    "clipsExported": 143,
    "storageUsedBytes": 1288490188,
    "storageLimitBytes": 2147483648
  },
  "daily": [ { "date": "2026-11-01", "hoursProcessed": 1.5, "videos": 1 } ],
  "recentVideos": [ { "id": 41, "fileName": "OOP_Buoi3.mp4", "status": "ANALYZED", "updatedAt": "2026-11-16T09:12:00Z" } ]
}
```
Phản hồi mẫu `/admin/dashboard` có thêm:
```json
{
  "activeUsers": 37,
  "aiCostUsd": 12.84,
  "jobFailureRate": 0.031,
  "avgProcessingSecondsPerVideoHour": 412,
  "editRateByPrompt": [ { "promptVersion": "v3", "model": "gemini-3.5-flash", "editRate": 0.22, "samples": 58 } ]
}
```
Lỗi: `400 INVALID_DATE_RANGE` khi `from > to` hoặc khoảng dài quá 366 ngày. `403 FORBIDDEN` khi người không phải admin gọi `/admin/*`.

### 6.3 Backend (Spring Boot)
- Tạo `controller/DashboardController.java` và `controller/AdminDashboardController.java`.
- Tạo `service/DashboardService.java`: truy vấn tổng hợp bằng `@Query` native trong `VideoRepository` (thêm hàm `sumDurationByOwnerAndRange`, `countByOwnerAndStatus`, `dailyHoursByOwner`).
- Tạo `entity/SegmentEditStatsEntity.java` + `repository/SegmentEditStatsRepository.java`.
- Tạo `service/EditStatsService.java`, có hàm `compute(videoId)`:
  - Khi analyze xong: lưu snapshot ranh giới AI vào `videos.ai_snapshot_json` (cột JSONB mới, thêm cùng migration) hoặc vào bảng phiên bản ở F33 nếu đã có.
  - Khi người dùng chuyển video sang "Đã duyệt" (F35) hoặc lưu lần cuối: so snapshot với topic hiện tại rồi ghi một dòng `segment_edit_stats`.
  - Thuật toán: ghép mỗi ranh giới AI với ranh giới người dùng gần nhất. Nếu |Δ| > 2s thì tính là `moved`. Ranh giới không ghép được ở phía AI là `removed`, ở phía người dùng là `added`.
- Không thêm endpoint vào `VideoController.java` (theo quy ước trong README).

### 6.5 Frontend (Next.js)
- `frontend/src/app/dashboard/page.tsx`: thẻ KPI (tái dùng style của `StatsCards`), biểu đồ cột SVG, bảng video gần đây.
- `frontend/src/app/admin/dashboard/page.tsx`: thêm thẻ chi phí AI và bảng `editRateByPrompt`.
- `frontend/src/components/dashboard/KpiCard.tsx`, `BarChartDaily.tsx` (SVG thuần), `DateRangePicker.tsx`.
- `frontend/src/lib/api.ts`: thêm `getMyDashboard(from, to)` và `getAdminDashboard(from, to)`.
- Thêm link "Tổng quan" vào `Header.tsx`/`StudioHeader.tsx`.
- Có đủ các trạng thái: đang tải (skeleton), lỗi ("Không tải được số liệu, thử lại"), rỗng ("Bạn chưa có video nào — Tải video đầu tiên").

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* người dùng A có 3 video (60, 90, 30 phút), người dùng B có 1 video. *When* A gọi `/dashboard/me`. *Then* `videosTotal = 3` và `hoursProcessed = 3.0`, không tính video của B.
- **AC-2** — *Given* tài khoản MEMBER. *When* gọi `/admin/dashboard`. *Then* nhận 403.
- **AC-3** — *Given* AI đề xuất 10 ranh giới, người dùng dời 2 ranh giới đi 5s và xoá 1. *When* video được duyệt. *Then* dòng `segment_edit_stats` có `moved = 2`, `removed = 1` và `editRate = 0.3`.
- **AC-4** — *Given* `from = 2026-12-01` và `to = 2026-11-01`. *Then* nhận 400 `INVALID_DATE_RANGE`.
- **AC-5** — *Given* 10.000 video trong DB test. *Then* `/dashboard/me` có p95 dưới 500 ms (đo bằng test hiệu năng đơn giản).
- **AC-6** — *Given* người dùng chưa có video. *Then* trang hiển thị trạng thái rỗng kèm nút "Tải video".

## 8. Kế hoạch kiểm thử (TDD)
Viết trước:
- `DashboardServiceTest.shouldOnlyCountVideosOfCurrentOwner`
- `DashboardServiceTest.shouldGroupHoursByDayInRange`
- `DashboardServiceTest.shouldRejectInvalidRange`
- `EditStatsServiceTest.shouldCountMovedBoundaryOverTwoSeconds`
- `EditStatsServiceTest.shouldCountAddedAndRemovedBoundaries`
- `EditStatsServiceTest.shouldIgnoreShiftUnderTwoSeconds`
- `AdminDashboardControllerTest.memberGets403`
- Frontend: kiểm tra tay hoặc e2e Playwright `dashboard.spec.ts` (hiện KPI, trạng thái rỗng).

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Truy vấn tổng hợp chậm khi dữ liệu lớn | Trang treo | Index `(owner_id, created_at)`, cache 60s, giới hạn khoảng 366 ngày |
| `duration` null với video cũ | Số giờ sai | Dùng `COALESCE(duration,0)` và hiện ghi chú "x video chưa có thời lượng" |
| Định nghĩa "sửa điểm cắt" gây tranh cãi | Chỉ số vô nghĩa | Chốt ngưỡng 2s ở mục 10, ghi rõ trên giao diện |
| Lệch múi giờ khi gom theo ngày | Biểu đồ lệch 1 ngày | Gom theo `Asia/Ho_Chi_Minh` |

## 10. Câu hỏi mở
- [ ] Ngưỡng tính "dời điểm cắt" là 2 giây hay theo % độ dài topic?
- [ ] Lúc chốt số liệu sửa tay: khi duyệt (F35) hay ở mỗi lần lưu?
- [ ] Giảng viên có được xem chi phí AI của chính mình không, hay chỉ admin?
- [ ] Có cần dashboard theo tổ chức (F49) ngay từ đầu không?
