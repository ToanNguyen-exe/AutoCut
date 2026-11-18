# F46 — Dashboard thống kê thật

| Mục | Giá trị |
|---|---|
| **Mã** | F46 |
| **Nhóm** | Vận hành |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API tổng hợp số liệu) · SV4 (giao diện) |
| **Phụ thuộc** | F00 (`video_parts` thật, `topics.origin`), F01, F02 (biết ai đang xem, lọc theo `owner_id`), F09 (bảng `jobs`), F13 (Flyway), F15 (đo chi phí AI), F16 (dung lượng). FR-5 cần thêm F33 (bản chụp `AI_ANALYZE`) và F35 (thời điểm duyệt) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không bắt buộc. Biểu đồ vẽ bằng SVG thuần + Tailwind. Nếu team muốn dùng `recharts` thì phải xin duyệt. |
| **Tham khảo** | Descript Workspace Usage, Panopto Admin Stats, Opus Clip Dashboard |

> **Cập nhật 18/11/2026:** bỏ role `MEMBER` (dùng role theo AD-1); lấy bản chụp kết quả AI từ `project_versions` (`source='AI_ANALYZE'`, F33) thay cho cột `videos.ai_snapshot_json`; mỗi video chỉ có một dòng `segment_edit_stats` (upsert khi duyệt); số clip đếm từ `video_parts` thật (F00); đổi tên migration theo dấu thời gian.

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
- **FR-1** Thẻ KPI cá nhân: `videos_total`, `hours_processed`, `clips_exported` (đếm `video_parts.status='COMPLETED'` theo F00, không đếm clip `STALE`/`FAILED`), `storage_used/limit` (theo F16; sau F49 là theo tổ chức, AD-9), `videos_failed`.
- **FR-2** Biểu đồ cột "giờ video đã xử lý theo ngày" trong khoảng thời gian đang chọn.
- **FR-3** Danh sách 10 video gần nhất kèm trạng thái và nút "Mở studio".
- **FR-4** (Admin) KPI hệ thống: số người dùng hoạt động, tổng giờ đã xử lý, tổng chi phí AI (USD), tỉ lệ job thất bại, thời gian xử lý trung bình trên 1 giờ video.
- **FR-5** (Admin) **Tỉ lệ sửa điểm cắt** = (số ranh giới bị dời quá 2 giây + bị xoá + được thêm) ÷ tổng số ranh giới AI đề xuất. Tính theo từng phiên bản prompt/model.
  - Ranh giới AI lấy từ phiên bản `project_versions` có `source='AI_ANALYZE'` **gần nhất** của video (F33). Ranh giới người dùng lấy từ các topic `ACTIVE` lúc video được duyệt (F35).
  - Chốt số liệu **một lần, khi video chuyển sang `APPROVED`**. Duyệt lại thì ghi đè dòng cũ (mỗi video đúng một dòng), không cộng dồn.
  - Video chưa có phiên bản `AI_ANALYZE` (dữ liệu cũ) thì bỏ qua, không tính.
- **FR-6** Bộ lọc khoảng thời gian, lưu lựa chọn vào `localStorage` (chỉ là tiện ích cho người xem).
- **FR-7** Mọi số liệu cá nhân chỉ tính video mà người đang đăng nhập là `OWNER` (cột `videos.owner_id`, F02). Video được chia sẻ với quyền `EDITOR`/`VIEWER` không tính vào KPI cá nhân.

## 5. Yêu cầu phi chức năng
- API dashboard phản hồi dưới 500 ms (p95) với 10.000 video. Có thể cache 60 giây trong bộ nhớ (Spring `@Cacheable` với cache mặc định, không cần thêm thư viện).
- Không truy vấn toàn bộ bảng `transcripts`. Chỉ tổng hợp từ `videos`, `video_parts`, `jobs`, `ai_usage`, `segment_edit_stats`.
- Không có dữ liệu thì hiện trạng thái rỗng thân thiện, không hiện số 0 kèm biểu đồ trống.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__dashboard_stats.sql`:
```sql
-- Kết quả so sánh bản AI (F33, source='AI_ANALYZE') với bản người dùng đã duyệt (F35)
CREATE TABLE IF NOT EXISTS segment_edit_stats (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE, -- mỗi video 1 dòng
    ai_version_id BIGINT REFERENCES project_versions(id) ON DELETE SET NULL, -- bản chụp AI_ANALYZE đã dùng (F33)
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
Bảng `ai_usage` (chi phí AI) do F15 tạo, bảng `jobs` do F09 tạo, bảng `project_versions` do F33 tạo. F46 chỉ đọc các bảng này, không thêm cột nào vào `videos`.
Ghi dòng thống kê bằng `INSERT … ON CONFLICT (video_id) DO UPDATE SET …` (AD-8).

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/dashboard/me?from=2026-11-01&to=2026-11-30` | Đã đăng nhập | KPI cá nhân + chuỗi theo ngày |
| GET | `/api/v1/admin/dashboard?from=&to=` | Role hệ thống `ADMIN` (AD-1) | KPI hệ thống |

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
Lỗi: `400 INVALID_DATE_RANGE` khi `from > to` hoặc khoảng dài quá 366 ngày. `403 FORBIDDEN_ACTION` khi người không có role `ADMIN` gọi `/admin/*` (AD-2: đường dẫn này không lộ tài nguyên riêng nào nên trả 403).

### 6.3 Backend (Spring Boot)
- Tạo `controller/DashboardController.java` và `controller/AdminDashboardController.java`.
- Tạo `service/DashboardService.java`: truy vấn tổng hợp bằng `@Query` native trong `VideoRepository` (thêm hàm `sumDurationByOwnerAndRange`, `countByOwnerAndStatus`, `dailyHoursByOwner`).
- Tạo `entity/SegmentEditStatsEntity.java` + `repository/SegmentEditStatsRepository.java`.
- Tạo `service/EditStatsService.java`, có hàm `compute(videoId)`:
  - Bản chụp AI: đọc phiên bản `project_versions` mới nhất có `source='AI_ANALYZE'` (F33 tự tạo sau mỗi lần analyze). F46 **không** tự lưu bản chụp riêng.
  - Lắng nghe sự kiện video chuyển sang `APPROVED` (F35, `ApplicationEvent`): so bản chụp AI với các topic `ACTIVE` rồi upsert dòng `segment_edit_stats` của video đó.
  - Thiếu bản chụp AI (dữ liệu cũ, hoặc F33 chưa merge) thì ghi log `INFO` và bỏ qua.
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
- **AC-2** — *Given* tài khoản role `INSTRUCTOR`. *When* gọi `/admin/dashboard`. *Then* nhận 403 `FORBIDDEN_ACTION`.
- **AC-3** — *Given* AI đề xuất 10 ranh giới, người dùng dời 2 ranh giới đi 5s và xoá 1. *When* video được duyệt. *Then* dòng `segment_edit_stats` có `moved = 2`, `removed = 1` và `editRate = 0.3`.
- **AC-3b** — *Given* video ở AC-3 bị trả về rồi duyệt lại sau khi dời thêm 1 ranh giới. *Then* vẫn chỉ có **một** dòng `segment_edit_stats` cho video đó, với `moved = 3`.
- **AC-3c** — *Given* video có 4 `video_parts` trong đó 1 `STALE`. *Then* `clipsExported` chỉ tính 3.
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
- `EditStatsServiceTest.reApprovalOverwritesSingleRow` (AC-3b)
- `EditStatsServiceTest.skipsWhenNoAiSnapshot`
- `DashboardServiceTest.clipsExportedCountsOnlyCompletedParts` (AC-3c)
- `AdminDashboardControllerTest.instructorGets403`
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
- [x] Lúc chốt số liệu sửa tay: **khi duyệt** (F35), mỗi video một dòng (FR-5).
- [ ] Giảng viên có được xem chi phí AI của chính mình không, hay chỉ admin?
- [x] Dashboard theo tổ chức: làm sau F49. Đã chốt theo AD-9 (hạn mức chuyển sang theo tổ chức khi có F49); bản này chỉ làm theo user.
