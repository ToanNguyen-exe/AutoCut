# F41 — Trang khoá học cho học viên

| Mục | Giá trị |
|---|---|
| **Mã** | F41 |
| **Nhóm** | Xuất bản |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (API khoá học, tiến độ) · SV4 (giao diện học viên) |
| **Phụ thuộc** | F01, F02 (vai trò `VIEWER`), F39 (HLS), F40 (cơ chế truy cập bằng link), F22 (chapters; không bắt buộc) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Udemy course player, Coursera, Panopto folder view, YouTube playlist ("Xem tiếp") |

## 1. Bối cảnh & vấn đề

- Dữ liệu đã có sẵn cấu trúc hai cấp dùng làm khoá học: `sections` (Giới thiệu / Lý thuyết / Thực hành ví dụ…) → `topics` → `video_parts` ([schema.sql](../../../database/schema.sql)). `config.yaml` có `export_sections: [Lý thuyết, Thực hành ví dụ, Bài tập]` và `drop_labels`, nghĩa là đã xác định được phần nào nên cho học viên xem.
- Tuy vậy, giao diện hiện chỉ có **Studio cho người biên tập** ([page.tsx](../../../frontend/src/app/page.tsx), 1.698 dòng). Không có màn hình nào cho học viên.
- Clip xuất ra chỉ là danh sách tệp trong [ExportProgressModal.tsx:302-330](../../../frontend/src/components/ExportProgressModal.tsx#L302-L330). Học viên không biết thứ tự học, không biết mình đã xem tới đâu.
- Tài khoản `demo` ("Tester / Student") trong [users.json](../../../frontend/src/mock-data/users.json) cho thấy đã có ý định phục vụ học viên, nhưng chưa có luồng nào cho vai trò này.

## 2. Mục tiêu

- Một **khoá học** gồm nhiều **bài học**. Mỗi bài học tương ứng với một video gốc đã được cắt. Học viên xem các clip theo đúng thứ tự section và topic.
- Tự phát clip tiếp theo, nhớ vị trí đang xem, đánh dấu clip đã xem xong, hiện % hoàn thành.
- Hoạt động tốt trên điện thoại.

### Ngoài phạm vi
- Bán khoá học, thanh toán (F49).
- Bài kiểm tra (F29 sẽ gắn vào trang này sau).
- Diễn đàn, hỏi đáp.
- Thống kê nâng cao cho giảng viên (F47). Ở đây chỉ lưu dữ liệu tiến độ thô.

## 3. User stories

- Là **giảng viên**, tôi muốn gom 12 video bài giảng thành khoá "Lập trình Java cơ bản", sắp thứ tự bài và bấm "Xuất bản".
- Là **học viên**, tôi muốn mở khoá học, thấy danh sách bài và clip kèm thời lượng, bấm vào clip nào là xem clip đó.
- Là **học viên**, tôi muốn hôm sau mở lại thì phát tiếp đúng giây tôi đã dừng.
- Là **học viên**, tôi muốn thấy dấu ✓ ở các clip đã xem và thanh "Đã hoàn thành 45%".

## 4. Yêu cầu chức năng

- **FR-1** Giảng viên tạo khoá học gồm `title`, `slug`, `description`, `cover_image` (lấy từ F43 hoặc tự upload), rồi thêm bài học bằng cách chọn video đã cắt xong, kéo thả để sắp thứ tự.
- **FR-2** Mỗi bài học chỉ hiện các clip `COMPLETED` thuộc section nằm trong `export_sections` của preset (F28) hoặc của `config.yaml`. Giảng viên có thể ẩn hoặc hiện từng clip.
- **FR-3** Trạng thái khoá học: `DRAFT`, `PUBLISHED`, `ARCHIVED`. Học viên chỉ thấy khoá `PUBLISHED`.
- **FR-4** Quyền vào khoá học (`visibility`):
  - `PUBLIC`: ai cũng xem được, không cần đăng nhập. Tiến độ khi đó lưu vào `localStorage`.
  - `LINK`: dùng share link F40 với `target_type = COURSE` (mở rộng F40).
  - `ENROLLED`: chỉ tài khoản được giảng viên ghi danh (nhập danh sách email) mới xem được.
- **FR-5** Trang học (`/learn/{courseSlug}/{partId}`):
  - Bên trái là trình phát. Bên dưới trình phát là tiêu đề, tóm tắt (F21), chapters (F22).
  - Bên phải là mục lục dạng cây: Bài → Section → Clip, kèm thời lượng và ✓. Trên điện thoại, mục lục nằm dưới trình phát và gập lại được.
  - Nút "Clip trước / Clip tiếp".
- **FR-6** Hết clip thì đếm ngược 5 giây "Tiếp theo: <tên clip>" rồi tự phát clip kế; có nút "Huỷ".
- **FR-7** Ghi tiến độ: cứ 10 giây và khi tạm dừng hoặc đóng tab (`visibilitychange` / `pagehide` + `navigator.sendBeacon`), gửi `{partId, positionSec, watchedSec}` lên server.
- **FR-8** Clip được coi là **hoàn thành** khi `watchedSec ≥ 90% durationSec`, hoặc khi xem tới vị trí ≥ `durationSec − 5`.
- **FR-9** Trang tổng quan khoá học (`/learn/{courseSlug}`) có nút "Tiếp tục học" dẫn tới clip có `last_watched_at` gần nhất mà chưa hoàn thành.

## 5. Yêu cầu phi chức năng

- Trang học đạt Lighthouse Performance ≥ 80 trên chế độ mobile.
- API ghi tiến độ có thể nhận ≥ 200 request/giây (mỗi học viên 6 request/phút), xử lý bằng một câu UPSERT, không đọc trước khi ghi.
- Mọi chữ hiển thị bằng tiếng Việt có dấu.
- Nhập 500 email ghi danh trong một lần không quá 5 giây.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_courses.sql`:

```sql
CREATE TABLE IF NOT EXISTS courses (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id),
    slug VARCHAR(120) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cover_r2_key VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',      -- DRAFT | PUBLISHED | ARCHIVED
    visibility VARCHAR(20) NOT NULL DEFAULT 'ENROLLED', -- PUBLIC | LINK | ENROLLED
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

CREATE TABLE IF NOT EXISTS watch_progress (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_part_id BIGINT NOT NULL REFERENCES video_parts(id) ON DELETE CASCADE,
    position_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
    watched_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_part_id)
);
```

Ghi tiến độ bằng UPSERT:

```sql
INSERT INTO watch_progress (user_id, video_part_id, position_sec, watched_sec, completed, last_watched_at)
VALUES (:uid, :pid, :pos, :watched, :completed, NOW())
ON CONFLICT (user_id, video_part_id) DO UPDATE SET
  position_sec = EXCLUDED.position_sec,
  watched_sec = GREATEST(watch_progress.watched_sec, EXCLUDED.watched_sec),
  completed = watch_progress.completed OR EXCLUDED.completed,
  last_watched_at = NOW();
```

`watched_sec` được cộng dồn ở client: chỉ cộng khi video đang phát thật và `playbackRate ≤ 2`. Server dùng `GREATEST` để giá trị không bao giờ giảm.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/courses` | Giảng viên | Tạo khoá |
| PATCH | `/api/v1/courses/{id}` | Chủ khoá | Sửa thông tin, đổi `status` |
| PUT | `/api/v1/courses/{id}/lessons` | Chủ khoá | Ghi đè danh sách bài và thứ tự |
| POST | `/api/v1/courses/{id}/enrollments` | Chủ khoá | `{ "emails": [...] }`. Email chưa có tài khoản thì tạo lời mời (gửi email ở F48) |
| GET | `/api/v1/learn/{slug}` | Theo `visibility` | Mục lục + tiến độ của người đang xem |
| PUT | `/api/v1/learn/progress` | Đã đăng nhập | Ghi tiến độ |
| GET | `/api/v1/learn/{slug}/resume` | Đã đăng nhập | `{ "partId": 55, "positionSec": 312.4 }` |

`GET /api/v1/learn/java-co-ban`:

```json
{
  "course": { "title": "Lập trình Java cơ bản", "slug": "java-co-ban", "coverUrl": "..." },
  "progress": { "completedParts": 9, "totalParts": 20, "percent": 45 },
  "lessons": [
    {
      "lessonId": 3, "title": "Bài 05 – Vòng lặp",
      "sections": [
        { "label": "Lý thuyết", "parts": [
          { "partId": 55, "title": "Giới thiệu vòng lặp", "durationSec": 96.4, "completed": true, "positionSec": 96.4 },
          { "partId": 56, "title": "Cú pháp for", "durationSec": 210.0, "completed": false, "positionSec": 42.0 }
        ] }
      ]
    }
  ]
}
```

Nguồn phát của từng clip lấy qua `/api/v1/parts/{partId}/playback` (F39). Endpoint đó phải chấp nhận thêm điều kiện: "người xem đã ghi danh vào một khoá `PUBLISHED` chứa clip này".

### 6.3 Backend (Spring Boot)

- **Tạo** các entity và repository: `CourseEntity`, `CourseLessonEntity`, `CourseEnrollmentEntity`, `WatchProgressEntity`.
- **Tạo** `service/CourseService` (tạo, sắp xếp, xuất bản). Khi chuyển sang `PUBLISHED` phải kiểm tra mọi bài học có ít nhất 1 clip `COMPLETED`.
- **Tạo** `service/LearnService` để dựng mục lục. Truy vấn một lần bằng JOIN `course_lessons → videos → sections → topics → video_parts`, rồi `LEFT JOIN watch_progress`. Không để xảy ra N+1 query (dùng `@Query` native hoặc projection).
- **Tạo** `service/CourseAccessPolicy` với hàm `boolean canView(User, Course)`, dùng chung cho `LearnService` và `PlaybackController` (F39).
- **Tạo** `controller/CourseController` và `controller/LearnController`.

### 6.5 Frontend (Next.js)

- Route mới:
  - `app/courses/page.tsx`: giảng viên quản lý khoá học.
  - `app/courses/[id]/edit/page.tsx`: kéo thả bài học. Dùng HTML5 drag & drop thuần, không thêm thư viện.
  - `app/learn/[slug]/page.tsx`: trang tổng quan.
  - `app/learn/[slug]/[partId]/page.tsx`: trang học.
- Component mới (mỗi component một tệp):
  - `CourseOutline.tsx`: cây mục lục.
  - `LessonPlayer.tsx`: bọc `HlsVideo` (F39) và xử lý ghi tiến độ.
  - `UpNextOverlay.tsx`: lớp phủ đếm ngược 5 giây.
  - `CourseProgressBar.tsx`: thanh % hoàn thành.
- Hook `useWatchProgress(partId, durationSec)`: gom tiến độ rồi gửi mỗi 10 giây; khi `pagehide` thì dùng `sendBeacon`. Với khoá `PUBLIC` chưa đăng nhập thì lưu `localStorage` (bọc `try/catch` và log cảnh báo).
- Thanh điều hướng của Studio thêm mục "Khoá học". Học viên đăng nhập thì vào thẳng `/learn`, không vào Studio.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* khoá học có 2 bài, mỗi bài 5 clip, *When* học viên mở `/learn/{slug}`, *Then* thấy mục lục đúng thứ tự section → topic như trong Studio.
- **AC-2** — *Given* học viên đã xem clip 56 tới giây 42 rồi đóng tab, *When* mở lại "Tiếp tục học", *Then* phát clip 56 từ giây 40–44.
- **AC-3** — *Given* clip dài 100 giây, *When* học viên tua thẳng tới giây 96, *Then* clip **được** đánh dấu hoàn thành theo điều kiện `≥ duration − 5`. Ngược lại, *Given* học viên chỉ xem từ giây 0 tới 50 rồi tua tới giây 80, *Then* **chưa** hoàn thành.
- **AC-4** — *Given* hết clip cuối của section, *When* hết đếm ngược 5 giây, *Then* tự chuyển sang clip đầu của section kế tiếp.
- **AC-5** — *Given* khoá `ENROLLED`, *When* tài khoản chưa ghi danh mở link, *Then* thấy "Bạn chưa được ghi danh vào khoá học này", và API trả `403`.
- **AC-6** — *Given* khoá `DRAFT`, *When* học viên truy cập, *Then* nhận `404`, không phải `403`, để không lộ là khoá tồn tại.
- **AC-7** — Trên iPhone kích thước 375px: không có thanh cuộn ngang, mục lục gập lại được, và nút phát lớn tối thiểu 44×44px.
- **AC-8** — `GET /api/v1/learn/{slug}` với 20 bài × 10 clip chạy tối đa **3 query SQL** (kiểm tra bằng Hibernate statistics trong test).

## 8. Kế hoạch kiểm thử (TDD)

| Test | Loại |
|---|---|
| `CourseAccessPolicyTest` (4 trường hợp: PUBLIC, LINK, ENROLLED đã/chưa ghi danh, DRAFT) | unit |
| `CompletionRuleTest.watched90Percent_completed` / `nearEnd_completed` / `skippedMiddle_notCompleted` | unit |
| `WatchProgressRepositoryTest.upsert_neverDecreasesWatchedSec` | integration (H2 chế độ PostgreSQL, hoặc Testcontainers nếu F14 có) |
| `LearnServiceTest.outline_respectsExportSectionsAndHiddenParts` | unit |
| `LearnControllerTest.outline_queryCountAtMost3` | integration |
| `CourseServiceTest.publish_lessonWithoutCompletedParts_throws` | unit |
| `useWatchProgress` – kiểm tra tay: tắt mạng, xem 30 giây, bật mạng lại → tiến độ vẫn được gửi | manual |

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Giảng viên cắt lại video sau khi đã xuất bản, khiến `video_parts` bị xoá và tạo mới | Mất tiến độ học viên (`ON DELETE CASCADE`) | Khi cắt lại, giữ nguyên `video_parts.id` nếu topic không đổi (ghi lại vào chính bản ghi cũ). Nếu bắt buộc phải xoá thì cảnh báo giảng viên "X học viên sẽ mất tiến độ" |
| Học viên mở nhiều tab | Tiến độ ghi đè lẫn nhau | `GREATEST` cho `watched_sec`; `position_sec` lấy theo request mới nhất, chấp nhận được |
| Ghi tiến độ quá dày làm Neon tốn compute | Tốn chi phí | 10 giây/lần; bỏ qua request nếu `position` đổi < 2 giây |
| `sendBeacon` không gửi được header `Authorization` | Request bị 401 | Endpoint beacon dùng cookie phiên, hoặc đặt token ngắn hạn trong body. Chốt cách làm cùng F01 |

## 10. Câu hỏi mở

- [ ] Một video có được nằm trong **nhiều khoá học** không? Spec hiện tại cho phép.
- [ ] Học viên có tài khoản riêng do trường cấp (dùng F03 SSO), hay giảng viên tự tạo?
- [ ] Cần **bắt buộc học tuần tự** (khoá clip sau khi chưa xong clip trước) không? Mặc định là không.
- [ ] Có cần cấp chứng nhận hoàn thành khoá học không? Nếu có thì tách thành spec riêng.
