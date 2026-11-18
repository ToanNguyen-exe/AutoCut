# F41 — Trang khoá học cho học viên

| Mục | Giá trị |
|---|---|
| **Mã** | F41 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API khoá học, tiến độ) · SV4 (giao diện học viên) |
| **Phụ thuộc** | F00 (`video_parts.id` ổn định), F35 (`render_kind`), F01, F02 (`AccessService`, role `VIEWER`), F39 (HLS + proxy có chữ ký), F40 (link `COURSE`), F22 (chapters; không bắt buộc), F48 (gửi email mời; không bắt buộc) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. Test tích hợp dùng Postgres theo AD-7 (Testcontainers đã được xin duyệt ở F13/F14). |
| **Tham khảo** | Udemy course player, Coursera, Panopto folder view, YouTube playlist ("Xem tiếp") |

> **Cập nhật 18/11/2026:** Theo review: tiến độ xem chuyển sang **bitmap ô 5 giây** do server hợp nhất (mở lại trang hay xem lại một đoạn đều không làm sai). Khoá `PUBLIC` phát qua `/api/v1/share/courses/**` mà không cần JWT. Thêm bảng `course_invitations` cho email chưa có tài khoản. Dùng `fetch(keepalive)` thay `sendBeacon` để gửi được JWT. Lỗi quyền theo AD-2. Test dùng Postgres theo AD-7.

## 1. Bối cảnh & vấn đề

- Dữ liệu đã có sẵn cấu trúc hai cấp dùng làm khoá học: `sections` → `topics` → `video_parts` ([schema.sql](../../../database/schema.sql)). `config.yaml` có `export_sections: [Lý thuyết, Thực hành ví dụ, Bài tập]` và `drop_labels`, nghĩa là đã xác định được phần nào nên cho học viên xem.
- Giao diện hiện chỉ có **Studio cho người biên tập** ([page.tsx](../../../frontend/src/app/page.tsx), 1.698 dòng). Không có màn hình nào cho học viên.
- Clip xuất ra chỉ là danh sách tệp trong [ExportProgressModal.tsx:302-330](../../../frontend/src/components/ExportProgressModal.tsx#L302-L330). Học viên không biết thứ tự học, không biết mình đã xem tới đâu.
- Tài khoản `demo` ("Tester / Student") trong [users.json](../../../frontend/src/mock-data/users.json) cho thấy đã có ý định phục vụ học viên, nhưng chưa có luồng nào cho vai trò này.

## 2. Mục tiêu

- Một **khoá học** gồm nhiều **bài học**; mỗi bài học tương ứng một video gốc đã được cắt. Học viên xem clip theo đúng thứ tự section → topic.
- Tự phát clip tiếp theo, nhớ vị trí đang xem, đánh dấu clip đã xem xong, hiện % hoàn thành. Tiến độ phải **đúng**: không tính phần bị tua qua, không tính trùng phần xem lại.
- Chạy tốt trên điện thoại.

### Ngoài phạm vi
- Bán khoá học, thanh toán (F49).
- Bài kiểm tra (F29 sẽ gắn vào trang này sau).
- Diễn đàn, hỏi đáp.
- Thống kê nâng cao cho giảng viên (F47). Ở đây chỉ lưu dữ liệu tiến độ.

## 3. User stories

- Là **giảng viên**, tôi muốn gom 12 video bài giảng thành khoá "Lập trình Java cơ bản", sắp thứ tự bài và bấm "Xuất bản".
- Là **học viên**, tôi muốn mở khoá học, thấy danh sách bài và clip kèm thời lượng, bấm vào clip nào là xem clip đó.
- Là **học viên**, tôi muốn hôm sau mở lại thì phát tiếp đúng giây tôi đã dừng.
- Là **học viên**, tôi muốn thấy dấu ✓ ở các clip đã xem và thanh "Đã hoàn thành 45%".
- Là **giảng viên**, tôi muốn ghi danh cả những học viên chưa có tài khoản; khi họ đăng ký bằng đúng email đó thì tự vào được khoá.

## 4. Yêu cầu chức năng

- **FR-1** Giảng viên tạo khoá học gồm `title`, `slug`, `description`, ảnh bìa (lấy từ F43 hoặc tự upload, lưu `cover_r2_key`). Sau đó thêm bài học bằng cách chọn video đã cắt xong và kéo thả để sắp thứ tự.
- **FR-2** Mỗi bài học chỉ hiện các clip thoả cả 3 điều kiện:
  - `video_parts.status = COMPLETED` **và `render_kind = 'RELEASE'`** (F35);
  - topic `ACTIVE`;
  - thuộc section nằm trong `export_sections` của preset (F28) hoặc của `config.yaml`.

  Giảng viên có thể ẩn hoặc hiện từng clip.
- **FR-3** Trạng thái khoá: `DRAFT`, `PUBLISHED`, `ARCHIVED`. Học viên chỉ thấy khoá `PUBLISHED`.
- **FR-4** Quyền vào khoá học (`visibility`):
  - `PUBLIC`: ai cũng xem được, không cần đăng nhập. Mục lục và nguồn phát lấy qua `/api/v1/share/courses/{slug}/**` (AD-5). Người chưa đăng nhập thì tiến độ lưu `localStorage`; đã đăng nhập thì lưu server.
  - `LINK`: dùng link F40 với `target_type = COURSE`. Trang `/s/{token}` của F40 chuyển hướng sang `/learn/{slug}?share={token}`. Mọi request lúc đó đi qua `/api/v1/share/{token}/**`.
  - `ENROLLED`: chỉ tài khoản đã ghi danh mới xem được nội dung.
- **FR-5 — Quyền và mã lỗi (AD-2):**
  - Khoá `DRAFT`/`ARCHIVED`, hoặc slug không tồn tại: `404 COURSE_NOT_FOUND`. Ngoại lệ là chủ khoá và `ADMIN`.
  - Khoá `PUBLISHED` + `ENROLLED`: người dùng đã đăng nhập xem được **thông tin giới thiệu** (tiêu đề, mô tả, ảnh bìa, số bài). Nếu chưa ghi danh thì mục lục chi tiết và nguồn phát trả `403 NOT_ENROLLED`.
- **FR-6 — Trang học** (`/learn/{courseSlug}/{partId}`):
  - Bên trái là trình phát; bên dưới là tiêu đề, tóm tắt (F21), chapters (F22).
  - Bên phải là mục lục dạng cây Bài → Section → Clip, kèm thời lượng và ✓. Trên điện thoại, mục lục nằm dưới trình phát và gập lại được.
  - Có nút "Clip trước / Clip tiếp".
- **FR-7** Hết clip thì đếm ngược 5 giây "Tiếp theo: <tên clip>" rồi tự phát clip kế; có nút "Huỷ".
- **FR-8 — Ghi tiến độ bằng ô 5 giây.**
  - Mỗi clip chia thành `n = ceil(durationSec / 5)` ô. Trong lúc phát thật (không tạm dừng, `playbackRate ≤ 2`), client đánh dấu ô chứa `currentTime`.
  - Cứ 10 giây, và khi `visibilitychange`/`pagehide`, client gửi `{ partId, positionSec, cells: [i, j, …] }` (chỉ các ô mới kể từ lần gửi trước).
  - Server **hợp nhất** (OR bit) vào bitmap đã lưu. Mở lại trang, xem trên nhiều tab, hay xem lại một đoạn đều không làm sai kết quả.
- **FR-9 — Điều kiện hoàn thành:** số ô đã xem ≥ 90% `n`. **Không** có quy tắc "tua tới gần cuối là xong". Nếu thiếu 1 ô cuối do sự kiện `timeupdate` không bắn kịp, thì sự kiện `ended` đánh dấu nốt ô cuối.
- **FR-10** Trang tổng quan khoá học (`/learn/{courseSlug}`) có nút "Tiếp tục học", dẫn tới clip chưa hoàn thành có `last_watched_at` gần nhất.
- **FR-11 — Ghi danh bằng email.** `POST /enrollments { emails }`:
  - Email đã có tài khoản thì thêm `course_enrollments` (`ON CONFLICT DO NOTHING`, AD-8).
  - Email chưa có tài khoản thì tạo `course_invitations`. Khi người đó đăng ký hoặc đăng nhập bằng **email đã xác minh** trùng địa chỉ mời, mọi lời mời còn hiệu lực tự chuyển thành ghi danh.
  - Có F48 thì gửi email mời. Chưa có F48 thì hộp thoại hiện link mời để giảng viên tự gửi.

## 5. Yêu cầu phi chức năng

- Trang học đạt Lighthouse Performance ≥ 80 ở chế độ mobile.
- API ghi tiến độ nhận ≥ 200 request/giây (mỗi học viên 6 request/phút). Mỗi request là **một** câu UPSERT, không đọc trước khi ghi.
- Mọi chữ hiển thị bằng tiếng Việt có dấu.
- Nhập 500 email ghi danh trong một lần không quá 5 giây (dùng batch insert).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_courses.sql`:

```sql
CREATE TABLE IF NOT EXISTS courses (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id),
    slug VARCHAR(120) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cover_r2_key VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
    visibility VARCHAR(20) NOT NULL DEFAULT 'ENROLLED'
        CHECK (visibility IN ('PUBLIC','LINK','ENROLLED')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_lessons (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    title_override VARCHAR(255),
    hidden_part_ids BIGINT[] NOT NULL DEFAULT '{}',
    CONSTRAINT uq_course_video UNIQUE (course_id, video_id)
);

CREATE TABLE IF NOT EXISTS course_enrollments (
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS course_invitations (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,      -- SHA-256 của token trong link mời
    invited_by BIGINT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,          -- mặc định +30 ngày
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_invite_email ON course_invitations(course_id, lower(email));

CREATE TABLE IF NOT EXISTS watch_progress (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    cell_count INTEGER NOT NULL,                       -- n = ceil(duration/5) lúc ghi
    watched_cells BIT VARYING(4320) NOT NULL,          -- tối đa 6 giờ
    position_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_part_id)
);
```

Ghi tiến độ bằng **một** câu UPSERT. Server dựng `:bits` dài đúng `:n` bit từ danh sách `cells`:

```sql
INSERT INTO watch_progress AS w (user_id, video_part_id, cell_count, watched_cells, position_sec, completed, last_watched_at)
VALUES (:uid, :pid, :n, :bits, :pos, FALSE, NOW())
ON CONFLICT (user_id, video_part_id) DO UPDATE SET
  -- clip render lại khác độ dài (cell_count đổi) thì làm lại bitmap, giữ cờ completed
  watched_cells = CASE WHEN w.cell_count = EXCLUDED.cell_count
                       THEN w.watched_cells | EXCLUDED.watched_cells
                       ELSE EXCLUDED.watched_cells END,
  cell_count    = EXCLUDED.cell_count,
  position_sec  = EXCLUDED.position_sec,
  last_watched_at = NOW()
RETURNING watched_cells, cell_count, completed;
```

Sau khi UPSERT, nếu `bit_count(watched_cells) >= 0.9 * cell_count` và `completed = false`, chạy `UPDATE … SET completed = true`. Hàm `bit_count(bit)` có từ Postgres 14; dự án dùng Postgres 16 (AD-7).

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/courses` | JWT, role `INSTRUCTOR`/`ADMIN` | Tạo khoá |
| PATCH | `/api/v1/courses/{id}` | Chủ khoá | Sửa thông tin, đổi `status` |
| PUT | `/api/v1/courses/{id}/lessons` | Chủ khoá | Ghi đè danh sách bài và thứ tự |
| POST | `/api/v1/courses/{id}/enrollments` | Chủ khoá | `{ "emails": [...] }`, trả `{ enrolled, invited, invalid }` (FR-11) |
| POST | `/api/v1/invitations/{token}/accept` | JWT | Nhận lời mời bằng link (email tài khoản phải khớp, đã xác minh) |
| GET | `/api/v1/learn/{slug}` | JWT; theo FR-5 | Mục lục + tiến độ |
| GET | `/api/v1/learn/{slug}/resume` | JWT | `{ "partId": 55, "positionSec": 312.4 }` |
| PUT | `/api/v1/learn/progress` | JWT | Ghi tiến độ (FR-8) |
| GET | `/api/v1/share/courses/{slug}` | Ẩn danh, chỉ khoá `PUBLIC` + `PUBLISHED` | Mục lục, không có tiến độ |
| GET | `/api/v1/share/courses/{slug}/parts/{partId}/playback` | Ẩn danh, như trên | Nguồn phát (URL có chữ ký của F39) |

Nguồn phát cho khoá `ENROLLED` dùng `GET /api/v1/parts/{partId}/playback` (F39). `AccessService` của F02 được mở rộng thêm quy tắc: "người dùng đã ghi danh vào một khoá `PUBLISHED` có chứa part này (không bị ẩn) thì được xem part".

Request ghi tiến độ:
```json
{ "partId": 56, "positionSec": 47.2, "cells": [8, 9] }
```
Response `200`: `{ "completed": false, "watchedPercent": 22 }`.

`GET /api/v1/learn/java-co-ban`:

```json
{
  "course": { "title": "Lập trình Java cơ bản", "slug": "java-co-ban", "coverUrl": "https://…presigned…" },
  "progress": { "completedParts": 9, "totalParts": 20, "percent": 45 },
  "lessons": [
    {
      "lessonId": 3, "title": "Bài 05 – Vòng lặp",
      "sections": [
        { "label": "Lý thuyết", "parts": [
          { "partId": 55, "title": "Giới thiệu vòng lặp", "durationSec": 96.4, "completed": true,  "positionSec": 96.4, "watchedPercent": 100 },
          { "partId": 56, "title": "Cú pháp for",         "durationSec": 210.0, "completed": false, "positionSec": 42.0, "watchedPercent": 20 }
        ] }
      ]
    }
  ]
}
```

Mã lỗi:
- `404 COURSE_NOT_FOUND`
- `403 NOT_ENROLLED`
- `404 PART_NOT_FOUND`: part không thuộc khoá, hoặc đã bị ẩn.
- `422 PROGRESS_INVALID`: chỉ số ô vượt `n`.

### 6.3 Backend (Spring Boot)

- **Tạo** entity và repository: `CourseEntity`, `CourseLessonEntity`, `CourseEnrollmentEntity`, `CourseInvitationEntity`, `WatchProgressEntity`.
- **Tạo** `service/CourseService` (tạo, sắp xếp, xuất bản). Khi chuyển sang `PUBLISHED` phải kiểm tra mọi bài học có ít nhất 1 clip hiển thị được (FR-2).
- **Tạo** `service/LearnService` để dựng mục lục: truy vấn một lần bằng JOIN `course_lessons → videos → sections → topics (ACTIVE) → video_parts (COMPLETED, render_kind='RELEASE')`, rồi `LEFT JOIN watch_progress`. Dùng `@Query` native hoặc projection, tránh N+1.
- **Tạo** `service/CourseAccessPolicy`:
  - `CourseAccess check(User nullable, Course, Optional<ShareLink>)` trả `NOT_FOUND | INTRO_ONLY | FULL`.
  - `AccessService` (F02) gọi hàm này khi kiểm quyền part. **F47 dùng lại** hàm này để kiểm beacon `/api/v1/share/view-events` của người xem khoá `PUBLIC`/`ENROLLED`. Cột `courses.analytics_enabled` do migration của F47 thêm, F41 không tạo.
- **Tạo** `service/ProgressService.record(userId, partId, positionSec, cells)`: tạo bitmap và chạy UPSERT ở §6.1. Phần dựng bitmap là hàm thuần `CellBitmap.of(n, cells)`.
- **Sửa** luồng đăng ký/đăng nhập của F01: sau khi email đã được xác minh, gọi `InvitationService.acceptPendingFor(user)`.
- **Tạo** `controller/v1/CourseController`, `controller/v1/LearnController`, `controller/v1/ShareCourseController` (tiền tố `/api/v1/share/courses`).

### 6.5 Frontend (Next.js)

- Route mới:
  - `app/courses/page.tsx`: giảng viên quản lý khoá học.
  - `app/courses/[id]/edit/page.tsx`: kéo thả bài học, dùng HTML5 drag & drop thuần.
  - `app/learn/[slug]/page.tsx`: trang tổng quan.
  - `app/learn/[slug]/[partId]/page.tsx`: trang học.
  - `app/invite/[token]/page.tsx`: nhận lời mời.
- Component mới (mỗi component một tệp):
  - `CourseOutline.tsx`: cây mục lục.
  - `LessonPlayer.tsx`: bọc `HlsVideo` (F39) và gắn hook tiến độ.
  - `UpNextOverlay.tsx`: lớp phủ đếm ngược.
  - `CourseProgressBar.tsx`: thanh % hoàn thành.
- Hook `useWatchProgress(partId, durationSec)`:
  - Giữ `Set<number>` các ô chưa gửi; mỗi 10 giây gửi một lần.
  - Khi `pagehide` dùng `fetch(url, { method: "PUT", keepalive: true, headers: { Authorization } })`. **Không** dùng `sendBeacon` vì nó không gửi được header JWT.
  - Khoá `PUBLIC` chưa đăng nhập: lưu bitmap vào `localStorage` (bọc `try/catch`, log cảnh báo khi lỗi).
- Thanh điều hướng của Studio thêm mục "Khoá học". Tài khoản `VIEWER` đăng nhập thì vào thẳng `/learn`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* khoá có 2 bài, mỗi bài 5 clip, *When* học viên mở `/learn/{slug}`, *Then* mục lục đúng thứ tự section → topic như trong Studio, không có topic `DISCARDED`, clip `STALE` hay clip `DRAFT` (F35).
- **AC-2** — *Given* học viên xem clip 56 tới giây 42 rồi đóng tab, *When* mở lại "Tiếp tục học", *Then* phát clip 56 từ giây 40–44.
- **AC-3** — *Given* clip dài 100 giây (20 ô):
  - *When* tua thẳng tới giây 96 và xem tới hết, *Then* **chưa** hoàn thành (chỉ có 1 ô).
  - *When* xem liên tục 0–100 giây, *Then* hoàn thành.
  - *When* xem 0–50 giây hai lần, *Then* `watchedPercent = 50`, không phải 100.
- **AC-4** — *Given* học viên xem 0–45 giây, đóng tab, rồi hôm sau mở lại và xem 45–95 giây, *Then* clip hoàn thành, vì server hợp nhất bitmap qua nhiều phiên.
- **AC-5** — *Given* hết clip cuối của section, *When* hết đếm ngược 5 giây, *Then* tự chuyển sang clip đầu của section kế tiếp.
- **AC-6** — *Given* khoá `ENROLLED` đã `PUBLISHED`, *When* tài khoản chưa ghi danh mở link, *Then* thấy trang giới thiệu kèm dòng "Bạn chưa được ghi danh vào khoá học này", và API mục lục/nguồn phát trả `403 NOT_ENROLLED`.
- **AC-7** — *Given* khoá `DRAFT`, *When* học viên truy cập, *Then* nhận `404 COURSE_NOT_FOUND`.
- **AC-8** — *Given* khoá `PUBLIC`, *When* mở trong cửa sổ ẩn danh, *Then* xem được video (nguồn từ `/api/v1/share/courses/...`), và tiến độ lưu trong `localStorage`.
- **AC-9** — *Given* giảng viên ghi danh `sv.moi@truong.edu.vn` (chưa có tài khoản), *When* người đó đăng ký và xác minh email này, *Then* tự thấy khoá trong danh sách, không cần thao tác thêm.
- **AC-10** — Trên iPhone rộng 375px: không có thanh cuộn ngang, mục lục gập lại được, nút phát tối thiểu 44×44px.
- **AC-11** — `GET /api/v1/learn/{slug}` với 20 bài × 10 clip chạy tối đa **3 query SQL** (đếm bằng Hibernate statistics trong test).

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `CourseAccessPolicyTest`: PUBLIC ẩn danh, LINK đúng/sai token, ENROLLED đã/chưa ghi danh → `FULL`/`INTRO_ONLY`, DRAFT → `NOT_FOUND`, chủ khoá xem DRAFT | unit |
| `CellBitmapTest.of_setsBits_rejectsOutOfRange` | unit |
| `CompletionRuleTest.seekToEnd_notCompleted` / `fullWatch_completed` / `rewatchSameHalf_counts50` | unit (AC-3) |
| `WatchProgressRepositoryTest.upsert_mergesAcrossSessions` / `durationChanged_resetsBitmapKeepsCompleted` | integration Postgres (AC-4) |
| `InvitationServiceTest.acceptPendingFor_verifiedEmail_enrolls_unverified_doesNot` | integration (AC-9) |
| `LearnServiceTest.outline_respectsExportSections_hiddenParts_activeTopics` | unit (AC-1) |
| `LearnControllerTest.outline_queryCountAtMost3` | integration (AC-11) |
| `LearnControllerTest.notEnrolled_returns403_draft_returns404` | MockMvc (AC-6, AC-7) |
| `ShareCourseControllerTest.publicCourse_noJwt_returnsSignedPlayback` | MockMvc (AC-8) |
| `CourseServiceTest.publish_lessonWithoutVisibleParts_throws` | unit |
| `useWatchProgress`, kiểm tra tay: tắt mạng, xem 30 giây, bật mạng lại → tiến độ vẫn được gửi | manual |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Giảng viên sửa topic sau khi xuất bản | Clip `STALE`, phải render lại | F00 giữ nguyên `video_parts.id` theo `(topic_id, part_no)`, nên tiến độ không mất. Độ dài đổi thì bitmap làm lại nhưng giữ cờ `completed` |
| Học viên mở nhiều tab | Ghi chồng | Phép OR bit có tính giao hoán, nên thứ tự request không quan trọng; `position_sec` lấy theo request mới nhất |
| Ghi tiến độ quá dày làm Neon tốn compute | Tốn chi phí | 10 giây/lần; không gửi nếu không có ô mới và `position` đổi < 2 giây |
| Gian lận tiến độ bằng cách tự gửi `cells` | Tiến độ ảo | Chấp nhận được, vì tiến độ ở đây không dùng để cấp chứng chỉ. Nếu sau này cấp chứng nhận thì cần spec riêng |
| Lời mời gửi nhầm email | Người lạ vào khoá | Chỉ nhận lời mời khi **email đã xác minh** khớp; lời mời hết hạn sau 30 ngày; giảng viên huỷ được |

## 10. Câu hỏi mở

- [ ] Một video có được nằm trong **nhiều khoá học** không? Spec hiện tại cho phép.
- [ ] Học viên dùng tài khoản do trường cấp (F03 SSO) hay giảng viên tự tạo? Spec hỗ trợ cả hai qua lời mời bằng email.
- [ ] Có cần **bắt buộc học tuần tự** (khoá clip sau khi chưa xong clip trước) không? Mặc định là không.
- [ ] Có cần cấp chứng nhận hoàn thành khoá học không? Nếu có thì tách spec riêng (cần chống gian lận tiến độ).
- [x] ~~`sendBeacon` không gửi được header~~ Đã chốt: dùng `fetch(keepalive)`.
