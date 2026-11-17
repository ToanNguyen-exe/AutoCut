# Bộ đặc tả tính năng AutoCut (50 tính năng)

Thư mục này chứa đặc tả (spec) cho 50 tính năng giúp AutoCut đủ điều kiện chạy thật.
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
- **Bảng dùng chung, chỉ tạo một lần:** `edit_ranges` (F25 + F32), `jobs` (F09, dùng bởi F10/F23/F39/F45…), `ai_usage` (F15), `ai_provider_keys` (F07), `audit_logs` (F08), `share_links` (F40 + F41). Spec nào merge sau thì dùng lại bảng đã có, không tạo bảng thứ hai.
- **Tiền đề bắt buộc:** F01 + F02 (danh tính, quyền), F09 (job), F13 (migration). Hầu hết spec khác đều giả định 4 spec này đã xong.
- **API mới:** đặt dưới `/api/v1/...`, trả lỗi theo định dạng chung:
  `{ "error": { "code": "VIDEO_NOT_FOUND", "message": "Không tìm thấy video", "details": {} } }`.
- **Xác thực:** sau F01, mọi API mới đều yêu cầu JWT, trừ khi spec ghi rõ là public.
- **Tách controller:** không thêm endpoint mới vào `VideoController.java` (đã gần 1.900 dòng). Mỗi miền nghiệp vụ dùng controller riêng.
- **Ước lượng:** S ≤ 2 ngày · M 3–5 ngày · L 1–2 tuần · XL > 2 tuần (1 người).

## Lộ trình

| Giai đoạn | Tính năng | Mục tiêu |
|---|---|---|
| Tuần 1–2 | F01, F02, F04, F05, F07, F09, F10, F12, F13 | Đủ an toàn để cho người thật dùng thử |
| Tuần 3–4 | F11, F14, F15, F18, F21, F22, F23, F31, F34 | Dùng được hằng ngày |
| Tháng 2 | F19, F25, F30, F32, F35, F39, F40, F41 | Cạnh tranh được |
| Sau đó | Phần còn lại | Mở rộng, thương mại hoá |

## Mục lục

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
