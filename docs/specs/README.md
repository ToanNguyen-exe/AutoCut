# Bộ đặc tả tính năng AutoCut (F00–F50)

Thư mục này chứa đặc tả (spec) cho 51 tính năng (F00–F50) giúp AutoCut đủ điều kiện chạy thật. Đề xuất F51–F103 nằm ở [DE-XUAT-TINH-NANG-BO-SUNG.md](DE-XUAT-TINH-NANG-BO-SUNG.md) (chờ duyệt).
Mỗi tính năng là một tệp riêng, viết theo cùng khuôn mẫu [_TEMPLATE.md](_TEMPLATE.md).

## Cách dùng

1. **Đọc spec trước khi code.** Mục 10 "Câu hỏi mở" phải được trưởng nhóm chốt trước (xem tổng hợp ở [CAU-HOI-CAN-CHOT.md](CAU-HOI-CAN-CHOT.md)), theo nguyên tắc
   Spec-Driven trong [CONSTRAINTS.md](../../CONSTRAINTS.md).
2. **Viết test ở mục 8 trước** (TDD), sau đó mới viết code cho test chạy qua.
3. **Thư viện mới** ghi ở bảng đầu mỗi spec phải được duyệt trước khi cài.
4. Mỗi spec làm trên một nhánh riêng `feature/F<NN>-<slug>`. PR phải dẫn link tới spec và tick đủ các AC.
5. Spec có chỗ sai so với code thực tế thì sửa spec trong cùng PR và ghi rõ lý do.

## Quy ước chung cho mọi spec

- **Người phụ trách gợi ý:** SV1 = Video Engine (FFmpeg) · SV2 = AI (Whisper & LLM) · SV3 = Core REST API & DB · SV4 = Web Studio & QA.
- **Migration DB:** sau F13, mọi thay đổi bảng đi qua Flyway `backend/src/main/resources/db/migration/`. Tên tệp theo dấu thời gian `V<yyyyMMddHHmm>__<ten>.sql` (xem F13 §6.1). Số `V2`, `V5`… ghi trong từng spec chỉ để minh hoạ. Không sửa trực tiếp `database/schema.sql`.
- **Bảng dùng chung, chỉ tạo một lần:** `edit_ranges` (F25 + F32), `jobs` (F09, dùng bởi F10/F23/F39/F45…), `ai_usage` (F15), `provider_secrets` (F07 + F48), `audit_logs` (F08), `share_links` (F40 + F41 + F47), `auth_tickets` (F01; dùng bởi F10/F12/F36/F39), `video_access` (F02 + F36 + F49). Spec nào merge sau thì dùng lại bảng đã có, không tạo bảng thứ hai.
- **Tiền đề bắt buộc:** F13 (migration), F00 (định danh ổn định), F01 + F02 (danh tính, quyền), F09 (job). Hầu hết spec khác đều giả định 5 spec này đã xong.
- **API mới:** đặt dưới `/api/v1/...`, trả lỗi theo định dạng chung:
  `{ "error": { "code": "VIDEO_NOT_FOUND", "message": "Không tìm thấy video", "details": {} } }`.
- **Xác thực:** sau F01, mọi API mới đều yêu cầu JWT, trừ khi spec ghi rõ là public.
- **Tách controller:** không thêm endpoint mới vào `VideoController.java` (đã gần 1.900 dòng). Mỗi miền nghiệp vụ dùng controller riêng.
- **Ước lượng:** S ≤ 2 ngày · M 3–5 ngày · L 1–2 tuần · XL > 2 tuần (1 người).

## Quyết định kiến trúc chung (AD)

Các quyết định dưới đây áp dụng cho **mọi spec**. Spec nào ghi khác thì làm theo mục này, và sửa lại spec đó.
Các quyết định được chốt ngày 18/11/2026 theo kết quả [REVIEW-HIEN-TRANG.md](REVIEW-HIEN-TRANG.md). Trưởng nhóm có thể đổi; khi đổi thì cập nhật ở đây trước, sau đó mới sửa các spec liên quan.

| Mã | Chủ đề | Quyết định |
|---|---|---|
| **AD-1** | Mô hình quyền | **Role hệ thống** (cột `users.role`): `ADMIN`, `INSTRUCTOR`, `EDITOR`, `VIEWER`; mặc định là `INSTRUCTOR`. **Quyền trên từng video** chỉ lưu ở **một bảng `video_access`** (F02), với role `OWNER`, `EDITOR`, `REVIEWER`, `VIEWER`. F36 dùng lại bảng này, không tạo `video_members`. **Tổ chức** (F49): bảng `organization_members` chỉ cấp quyền quản trị tổ chức và tính hạn mức; `ORG_ADMIN` có quyền ngầm như `OWNER` trên mọi video thuộc tổ chức. Kiểm tra quyền chỉ qua một chỗ: `AccessService.require(user, videoId, Permission)` |
| **AD-2** | Mã lỗi quyền | Người **không có quyền xem** tài nguyên thì trả **404** (không để lộ tài nguyên có tồn tại hay không), áp dụng cho video, topic, part, job, upload, comment. Người **xem được nhưng không có quyền thao tác** (ví dụ VIEWER bấm sửa) thì trả **403** `FORBIDDEN_ACTION` |
| **AD-3** | Lưu trữ R2 | Bucket R2 **private**. Mọi truy cập tệp đi qua **presigned URL** (GET hết hạn sau 15 phút; tải về dùng 302 tới URL có `response-content-disposition`). DB chỉ lưu `r2_key`; cột `cloud_url` bỏ dần, không dùng trong code mới. HLS (F39) phát qua proxy viết lại playlist. **Ngoại lệ thời hạn:** URL proxy HLS hết hạn sau `min(thời lượng × 1,5 + 30 phút, 6 giờ)` (F39); `og:image` dùng presign 7 ngày (F43) vì Zalo/Facebook lưu ảnh xem trước |
| **AD-4** | Vé ngắn hạn | Thẻ `<video>`, `EventSource` và `<a download>` không gửi được header JWT, nên dùng chung **một** cơ chế do F01 định nghĩa: `POST /api/v1/auth/tickets { "purpose": "SSE" \| "STREAM" \| "DOWNLOAD", "resourceId": … }` trả về vé ngẫu nhiên 256 bit, lưu băm trong DB, gắn với user, purpose và resource. Vé `SSE` sống 60 giây và chỉ dùng **một lần**, để mở kết nối. Vé `STREAM` và `DOWNLOAD` sống **5 phút**, dùng nhiều lần trong hạn (Range request cần như vậy). Truyền vé qua `?ticket=`. Không đặt JWT vào cookie hay URL |
| **AD-5** | Tiền tố API | `/api/v1/**`: API nội bộ, xác thực bằng JWT. `/api/v1/auth/**`: đăng nhập, refresh, vé. `/api/v1/share/**`: người xem ẩn danh qua link chia sẻ (F40, F41, F47 beacon). `/api/v1/hooks/{provider}`: callback từ bên thứ ba (VNPay, Stripe, Telegram, Zalo; F48, F49), xác thực bằng chữ ký riêng của từng bên. `/api/v1/playback/hls/**`: playlist HLS, xác thực bằng chữ ký HMAC trong URL, không cần JWT (F39). `/api/v1/lti/**`: luồng LTI 1.3 (F42). `/api/v1/share/courses/**`: khoá học công khai (F41). Endpoint dùng token đã ký sẵn trong link email (ví dụ huỷ đăng ký F48) đặt trong miền nghiệp vụ của nó, ghi rõ "không cần JWT". `/api/ext/v1/**`: Public API cho đối tác, xác thực bằng API key (F50). **Không dùng `/api/public/**`** |
| **AD-6** | Định danh ổn định | Theo **F00**: `videos.id` có trong state frontend; topic có `client_id` (UUID) và `id` không bao giờ đổi; lưu bằng upsert, bỏ topic thì xoá mềm (`DISCARDED`); `video_parts` chỉ do job cắt ghi (`PENDING`, `RENDERING`, `COMPLETED`, `FAILED`, `STALE`). Bảng con gắn với topic dùng `ON DELETE CASCADE` cũng an toàn, vì topic không bao giờ bị xoá cứng khi lưu |
| **AD-7** | Database cho dev/test | **Bỏ H2.** Dev và test đều dùng Postgres 16: dev qua Docker Compose (F14); test qua **Testcontainers** (thư viện cần duyệt) hoặc biến `TEST_DATABASE_URL`. **Không bao giờ** chạy test trên `DATABASE_URL` của production. Thiếu `DATABASE_URL` khi chạy profile `prod` thì ứng dụng **dừng ngay khi khởi động**. Không tự thêm `sslmode=require` khi host là `localhost`/`postgres` |
| **AD-8** | Chống trùng | Chống trùng (idempotency, dedupe) bằng `INSERT … ON CONFLICT DO NOTHING/UPDATE … RETURNING`. **Không** bắt lỗi unique violation rồi bỏ qua, vì Postgres sẽ huỷ cả transaction. Khoá chống trùng có thời hạn thì đưa thời hạn vào khoá (ví dụ `…:2026-11-18`) hoặc dùng cột `expires_at` + job dọn |
| **AD-9** | Hạn mức | Trước F49: hạn mức **theo user** (F16). Sau F49: **theo tổ chức**; mỗi user tự có một tổ chức cá nhân, tạo khi đăng ký, nên F16 không phải viết lại. Video trong thùng rác (F17) **vẫn tính** dung lượng cho tới khi bị xoá hẳn. Phút xử lý AI được **giữ chỗ (reserve) ngay khi tạo job**, trả lại nếu job lỗi |
| **AD-10** | Job | Mọi việc chạy nền (analyze, cut, HLS, thumbnail, phụ đề, dịch, quiz, xuất dữ liệu…) đều là một dòng trong bảng `jobs` (F09), không tự tạo `ExecutorService` riêng. Tiến độ đẩy về qua SSE (F10) |
| **AD-11** | Thư viện | Thư viện mới (Testcontainers, Flyway, Actuator, Vitest, hls.js, jjwt…) phải được ghi trong ô "Thư viện mới cần duyệt" của spec dùng nó đầu tiên. Script tải từ ngoài (ví dụ Google Picker) cũng tính là thư viện mới |
| **AD-13** | Khoảng bị cắt (`edit_ranges`, F25 + F32) | Chỉ có **một** hàm thuần `video/KeepRanges.java`: `compute(start, end, List<EditRange> enabledRanges, double minKeep = 0.3)`. Với `SILENCE`, giữ lại `keep_seconds` (chia đều hai bên khoảng lặng). Mảnh giữ lại ngắn hơn `minKeep` thì **gộp vào khoảng bị cắt bên cạnh** (bỏ mảnh đó). Render bằng **một lệnh FFmpeg** `filter_complex` (`trim`/`atrim` + `concat`, có `afade` 10 ms ở mỗi mối nối) trong `VideoCutter`, không cắt nhiều tệp rồi ghép. Padding (`padding_start`/`padding_end`) áp vào **hai đầu topic** trước, sau đó mới trừ các khoảng bị cắt. API: `GET /api/v1/videos/{id}/edit-ranges`; `PUT …/edit-ranges` **chỉ thay các dòng `source='USER'`**; `PATCH …/edit-ranges` bật/tắt theo `ids` hoặc `kind`; các dòng `source='AUTO'` chỉ do job của F25 ghi |
| **AD-14** | Điểm tin cậy điểm cắt (F18 + F26) | `confidence = rawScore / maxScore`, trong đó `maxScore` là tổng điểm tối đa **của các tín hiệu đang bật** (`cut_points.max_score` tự tính trong `CutPointService`). Bật thêm tín hiệu slide (F26) thì tử số và mẫu số cùng tăng, nên ngưỡng của F18 không bị lệch |
| **AD-12** | Giao diện | Chỉ dùng token đang có trong `frontend/tailwind.config.ts` và các class Tailwind chuẩn. Không dùng token của dự án khác. Mọi chữ hiển thị cho người dùng phải là tiếng Việt có dấu |

## Lộ trình

| Giai đoạn | Tính năng | Mục tiêu |
|---|---|---|
| Tuần 1–2 | F13, F00, F01, F02, F04, F05, F07, F09, F10, F12 | Đủ an toàn để cho người thật dùng thử |
| Tuần 3–4 | F11, F14, F15, F18, F21, F22, F23, F31, F34 | Dùng được hằng ngày |
| Tháng 2 | F19, F25, F30, F32, F35, F39, F40, F41 | Cạnh tranh được |
| Sau đó | Phần còn lại | Mở rộng, thương mại hoá |

## Mục lục

### 0. Tiền đề — [00-tien-de/](00-tien-de/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F00 | [Định danh ổn định & lưu dự án bằng upsert](00-tien-de/F00-dinh-danh-on-dinh-upsert.md) | P0 |

### 1. Bảo mật & tài khoản — [01-bao-mat/](01-bao-mat/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F01 | [Đăng nhập thật (JWT + BCrypt)](01-bao-mat/F01-dang-nhap-jwt.md) | P0 |
| F02 | [Phân quyền & sở hữu dữ liệu](01-bao-mat/F02-phan-quyen-so-huu.md) | P0 |
| F03 | [Đăng nhập Google/Microsoft (SSO)](01-bao-mat/F03-sso-google-microsoft.md) | P1 |
| F04 | [Vá lỗi lộ tệp khi tải clip/ZIP](01-bao-mat/F04-va-path-traversal.md) | P0 |
| F05 | [Siết CORS theo môi trường](01-bao-mat/F05-siet-cors.md) | P0 |
| F06 | [Giới hạn tần suất gọi API](01-bao-mat/F06-rate-limit.md) | P0 |
| F07 | [Quản lý khoá API AI phía máy chủ](01-bao-mat/F07-quan-ly-khoa-ai.md) | P0 |
| F08 | [Nhật ký thao tác (audit log)](01-bao-mat/F08-audit-log.md) | P1 |

### 2. Hạ tầng & độ ổn định — [02-ha-tang/](02-ha-tang/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F09 | [Hàng đợi job bền vững](02-ha-tang/F09-hang-doi-job-ben-vung.md) | P0 |
| F10 | [Analyze bất đồng bộ + tiến độ thời gian thực](02-ha-tang/F10-analyze-bat-dong-bo-sse.md) | P0 |
| F11 | [Upload chia khúc, tiếp tục được, thẳng lên R2](02-ha-tang/F11-upload-chia-khuc.md) | P0 |
| F12 | [Xuất ZIP dạng luồng](02-ha-tang/F12-zip-streaming.md) | P0 |
| F13 | [Quản lý migration bằng Flyway](02-ha-tang/F13-flyway-migration.md) | P0 |
| F14 | [Docker Compose + CI](02-ha-tang/F14-docker-ci.md) | P0 |
| F15 | [Giám sát, log & đo chi phí AI](02-ha-tang/F15-giam-sat-log.md) | P1 |
| F16 | [Hạn mức dung lượng](02-ha-tang/F16-han-muc-dung-luong.md) | P1 |
| F17 | [Dọn tệp tạm & vòng đời lưu trữ](02-ha-tang/F17-don-tep-vong-doi.md) | P1 |

### 3. AI phân đoạn & bóc băng — [03-ai/](03-ai/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F18 | [Độ tin cậy điểm cắt](03-ai/F18-do-tin-cay-diem-cat.md) | P1 |
| F19 | [Từ điển thuật ngữ riêng](03-ai/F19-tu-dien-thuat-ngu.md) | P1 |
| F20 | [Nhận diện người nói](03-ai/F20-nhan-dien-nguoi-noi.md) | P2 |
| F21 | [AI sinh tiêu đề, tóm tắt, từ khoá](03-ai/F21-ai-tieu-de-tom-tat.md) | P1 |
| F22 | [Xuất chapters YouTube/WebVTT](03-ai/F22-xuat-chapters.md) | P1 |
| F23 | [Phụ đề SRT/VTT & ghi cứng](03-ai/F23-phu-de.md) | P1 |
| F24 | [Dịch phụ đề](03-ai/F24-dich-phu-de.md) | P2 |
| F25 | [Cắt từ đệm, khoảng lặng, câu lặp](03-ai/F25-cat-tu-dem-khoang-lang.md) | P1 |
| F26 | [Nhận diện đổi slide + OCR](03-ai/F26-nhan-dien-slide-ocr.md) | P2 |
| F27 | [AI học từ chỉnh sửa người dùng](03-ai/F27-ai-hoc-tu-chinh-sua.md) | P2 |
| F28 | [Preset theo loại bài giảng](03-ai/F28-preset-bai-giang.md) | P1 |
| F29 | [Tự tạo câu hỏi trắc nghiệm](03-ai/F29-tao-cau-hoi-trac-nghiem.md) | P2 |
| F30 | [Tìm kiếm trong video & thư viện](03-ai/F30-tim-kiem-noi-dung.md) | P1 |

### 4. Trình biên tập & duyệt — [04-bien-tap/](04-bien-tap/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F31 | [Undo/Redo & phím tắt](04-bien-tap/F31-undo-redo-phim-tat.md) | P1 |
| F32 | [Sửa transcript là sửa video](04-bien-tap/F32-sua-transcript-sua-video.md) | P1 |
| F33 | [Lịch sử phiên bản & chống ghi đè](04-bien-tap/F33-lich-su-phien-ban.md) | P1 |
| F34 | [Tự động lưu](04-bien-tap/F34-tu-dong-luu.md) | P1 |
| F35 | [Quy trình duyệt + bình luận theo mốc giờ](04-bien-tap/F35-quy-trinh-duyet-binh-luan.md) | P1 |
| F36 | [Làm việc nhóm](04-bien-tap/F36-lam-viec-nhom.md) | P2 |
| F37 | [Thao tác hàng loạt](04-bien-tap/F37-thao-tac-hang-loat.md) | P1 |
| F38 | [Sóng âm & ảnh xem trước trên timeline](04-bien-tap/F38-song-am-thumbnail-timeline.md) | P1 |

### 5. Xuất bản & phân phối — [05-xuat-ban/](05-xuat-ban/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F39 | [Phát video HLS](05-xuat-ban/F39-phat-hls.md) | P1 |
| F40 | [Link chia sẻ & mã nhúng](05-xuat-ban/F40-link-chia-se-nhung.md) | P1 |
| F41 | [Trang khoá học cho học viên](05-xuat-ban/F41-trang-khoa-hoc.md) | P1 |
| F42 | [Đẩy lên YouTube/Drive/LMS](05-xuat-ban/F42-tich-hop-youtube-lms.md) | P2 |
| F43 | [Tự tạo ảnh bìa](05-xuat-ban/F43-anh-bia-tu-dong.md) | P2 |
| F44 | [Logo, watermark, intro/outro](05-xuat-ban/F44-thuong-hieu-intro-outro.md) | P2 |
| F45 | [Nhiều định dạng xuất (9:16, 720p, MP3)](05-xuat-ban/F45-nhieu-dinh-dang-xuat.md) | P2 |

### 6. Vận hành & kinh doanh — [06-van-hanh/](06-van-hanh/)
| Mã | Tính năng | Ưu tiên |
|---|---|---|
| F46 | [Dashboard thống kê thật](06-van-hanh/F46-dashboard-thong-ke.md) | P1 |
| F47 | [Thống kê người xem](06-van-hanh/F47-thong-ke-nguoi-xem.md) | P2 |
| F48 | [Thông báo email/Zalo/Telegram](06-van-hanh/F48-thong-bao.md) | P1 |
| F49 | [Đa tổ chức & gói cước](06-van-hanh/F49-da-to-chuc-goi-cuoc.md) | P2 |
| F50 | [Public API & webhook](06-van-hanh/F50-public-api-webhook.md) | P2 |
