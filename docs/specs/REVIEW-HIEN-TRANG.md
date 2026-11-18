# Review: hiện trạng code so với F01–F103 & chất lượng spec

> Ngày review: 18/11/2026 · Nhánh `main` (commit `9854c07`).
> Cách làm: dò mã nguồn (`backend/src`, `backend/ai`, `frontend/src`), sau đó mở từng chỗ khớp để xác nhận.
> Không chạy ứng dụng, nên một số mục giao diện được đánh giá theo code chứ chưa thử trên trình duyệt.

**Ký hiệu:** ✅ Đã có, dùng được · 🟡 Có một phần, hoặc chỉ là giao diện hay dữ liệu mẫu · ❌ Chưa có

## Phần 1 — Những gì dự án ĐÃ làm tốt (phần lõi)

- Upload video, chống tải trùng bằng mã SHA-256, đồng bộ lên Cloudflare R2.
- Bóc băng bằng Whisper và Gemini, có bước làm sạch và tách câu S0001…
- AI phân đoạn 2 cấp (Phần → Chủ đề).
- Chấm điểm điểm cắt theo âm thanh (`CutPointService`), dịch điểm cắt vào khoảng lặng (`SilenceSnapCut`).
- Cắt bằng FFmpeg: có lùi/tiến đệm âm thanh, `faststart`, hai chế độ `accurate`/`fast`. Ghép video có cách dự phòng khi lỗi (`VideoConcat`).
- Cắt hàng loạt chạy nền, tự xuất `chapters.txt` (mốc chương YouTube) và `report.json`.
- Lưu sections, topics, transcripts, video_parts vào Neon Postgres.
- Studio gồm timeline, panel transcript, bảng duyệt, chi tiết đoạn, trợ lý AI chat nhiều model, tải từng clip hoặc ZIP.
- Undo/Redo (tối đa 30 bước) và Ctrl+S.
- Có khoảng 16 lớp test JUnit cho backend và 1 tệp pytest.

Kết luận: **phần lõi AI và cắt video đã chạy được**. Phần còn thiếu chủ yếu là các thứ cần để người ngoài nhóm dùng thật: bảo mật, độ ổn định, xuất bản và tiện ích.

## Phần 2 — Bảng đối chiếu 103 tính năng

### Bảo mật & tài khoản (F01–F08)
| Mã | Tính năng | Hiện trạng | Bằng chứng |
|---|---|---|---|
| F01 | Đăng nhập JWT | 🟡 **Giả** | `lib/auth.ts` so khớp với `mock-data/users.json` (mật khẩu chữ thường), tự đăng nhập Admin |
| F02 | Phân quyền | ❌ | `role` chỉ là chữ hiển thị; backend không kiểm tra người gọi |
| F03 | SSO | ❌ | — |
| F04 | Vá lỗ hổng đọc/ghi tệp | ❌ **Đang có lỗ hổng** | `VideoController.java:1557` (`download-clip`), `:1600` (`download-zip`), `/concat` |
| F05 | Siết CORS | ❌ | `WebConfig.java`: `allowedOriginPatterns("*")` + `allowCredentials(true)` |
| F06 | Rate limit | ❌ | — |
| F07 | Khoá AI phía máy chủ | ❌ | `api/chat/route.ts` nhận `apiKey` từ trình duyệt |
| F08 | Audit log | ❌ | — |

### Hạ tầng (F09–F17)
| Mã | Tính năng | Hiện trạng | Bằng chứng |
|---|---|---|---|
| F09 | Hàng đợi job bền vững | 🟡 | Job cắt chạy nền nhưng chỉ lưu trong RAM (`BatchVideoCutService.java:48`), 2 luồng |
| F10 | Analyze bất đồng bộ + SSE | ❌ | Analyze gọi Python và chờ kết quả ngay trong request; thanh tiến độ phía giao diện là giả |
| F11 | Upload chia khúc | 🟡 | Có chống trùng SHA-256 và đồng bộ R2; upload 1 lần, không tiếp tục được khi đứt |
| F12 | ZIP dạng luồng | 🟡 | Có tải ZIP nhưng dựng toàn bộ trong RAM |
| F13 | Flyway | 🟡 | Có `schema.sql` nhưng chạy song song với `ddl-auto=update` |
| F14 | Docker + CI | ❌ | `.github/` chỉ có thư mục `modernize` |
| F15 | Giám sát & log | ❌ | — |
| F16 | Hạn mức dung lượng | 🟡 | Có cột `storage_limit_bytes`; `CloudflareR2Service` có kiểm tra quota sơ bộ |
| F17 | Dọn tệp & vòng đời | ❌ | Không có `@Scheduled` nào |

### AI (F18–F30)
| Mã | Tính năng | Hiện trạng | Bằng chứng |
|---|---|---|---|
| F18 | Độ tin cậy điểm cắt | 🟡 | `CutPointService` đã chấm điểm nhưng giao diện không hiển thị |
| F19 | Từ điển thuật ngữ | 🟡 | Từ điển viết cứng (CNTT/Web3) trong `post_processor.py`, `prompt_builder.py`; người dùng không sửa được |
| F20 | Nhận diện người nói | 🟡 | Có cột `speaker` nhưng luôn là `spk_0` |
| F21 | Tiêu đề/tóm tắt | 🟡 | LLM đặt tiêu đề topic; tóm tắt chỉ có qua chat |
| F22 | Chapters | 🟡 | Đã xuất `chapters.txt` dạng YouTube; chưa có WebVTT, chưa có nút tải riêng |
| F23 | Phụ đề SRT/VTT | ❌ | Nút "Phụ đề & Chapters" ở `StudioSidebar.tsx:108` **chưa gắn chức năng** |
| F24 | Dịch phụ đề | ❌ | — |
| F25 | Cắt từ đệm/khoảng lặng | ❌ | `SilenceSnapCut` chỉ dịch điểm cắt, không cắt bỏ |
| F26 | Nhận diện slide/OCR | ❌ | "Slide" trong giao diện chỉ là hình minh hoạ |
| F27 | AI học từ chỉnh sửa | ❌ | — |
| F28 | Preset | 🟡 | `config.yaml` có `preset: lecture_programming` nhưng không code nào đọc |
| F29 | Câu hỏi trắc nghiệm | ❌ | — |
| F30 | Tìm kiếm nội dung | 🟡 | Tìm theo tiêu đề video phía trình duyệt (`VideoLibraryDrawer.tsx:42`) và tìm trong transcript drawer; chưa tìm toàn thư viện |

### Biên tập (F31–F38)
| Mã | Tính năng | Hiện trạng | Bằng chứng |
|---|---|---|---|
| F31 | Undo/Redo & phím tắt | 🟡 | Có Undo/Redo 30 bước, **nhưng Ctrl+Z được xử lý 2 lần** (`page.tsx:569` và `StudioTimeline.tsx:134`) |
| F32 | Sửa transcript là sửa video | ❌ | — |
| F33 | Lịch sử phiên bản | 🟡 | Có cột `version` nhưng chưa dùng; mỗi lần lưu là xoá rồi tạo lại |
| F34 | Tự động lưu | 🟡 | Chỉ lưu phiên vào `localStorage` (`page.tsx:494`), không lưu lên máy chủ |
| F35 | Quy trình duyệt | 🟡 | Chỉ có cờ `reviewed` đúng/sai |
| F36 | Làm việc nhóm | ❌ | — |
| F37 | Thao tác hàng loạt | 🟡 | Gộp/tách từng đoạn; chưa chọn được nhiều đoạn cùng lúc |
| F38 | Sóng âm & thumbnail | 🟡 **Giả** | Sóng âm vẽ bằng hàm `sin` (`StudioTimeline.tsx:281`), ảnh thumbnail là khối màu chuyển sắc |

### Xuất bản (F39–F45)
| Mã | Tính năng | Hiện trạng | Bằng chứng |
|---|---|---|---|
| F39 | HLS | ❌ | Phát nguyên tệp MP4 qua `/stream/{hash}` |
| F40 | Link chia sẻ | ❌ | — |
| F41 | Trang khoá học | ❌ | — |
| F42 | YouTube/LMS | ❌ | — |
| F43 | Ảnh bìa | ❌ | Chỉ là khối màu giữ chỗ |
| F44 | Logo/intro/outro | ❌ | — |
| F45 | Nhiều định dạng xuất | 🟡 | Nút 16:9 ↔ 9:16 (`VideoCanvasViewport.tsx:222`) chỉ đổi khung **xem trước**, không xuất được |

### Vận hành (F46–F50)
| Mã | Tính năng | Hiện trạng | Bằng chứng |
|---|---|---|---|
| F46 | Dashboard | 🟡 | Có `StatsCards`, chỉ thống kê video đang mở |
| F47 | Thống kê người xem | ❌ | — |
| F48 | Thông báo | ❌ | — |
| F49 | Đa tổ chức & gói cước | ❌ | — |
| F50 | Public API & webhook | ❌ | — |

### Tính năng phụ trợ (F51–F103)
| Mã | Tính năng | Hiện trạng | Ghi chú |
|---|---|---|---|
| F51 | Dự án mẫu + checklist | ❌ | Có endpoint `upload-sample` nhưng chỉ để thử khi phát triển |
| F52 | Màn hình trống có hướng dẫn | 🟡 | Panel transcript và chi tiết đoạn có câu nhắc; thư viện thì chưa |
| F53–F57 | Tour, trợ giúp, hỗ trợ Zalo, Có gì mới, Trang trạng thái | ❌ | — |
| F58 | Ctrl+K | ❌ | — |
| F59 | Thư mục/thẻ/màu | ❌ | "folder" trong code là thư mục xuất clip, không phải thư mục thư viện |
| F60 | Lọc/sắp xếp | 🟡 | Lọc theo trạng thái + ô tìm trong `VideoLibraryDrawer` |
| F61–F64 | Gần đây, giao diện thùng rác, nhân bản, thay video gốc | ❌ | — |
| F65 | Trường tuỳ chỉnh | 🟡 | Có một trường `category` trong dữ liệu thư viện mẫu |
| F66 | Kéo-thả, nhiều tệp | 🟡 | Kéo-thả 1 tệp vào khung video (`VideoCanvasViewport.tsx:151`) |
| F67–F70 | Nhập từ Drive, ước tính, báo trên tab, vị trí hàng đợi | ❌ | — |
| F71 | Tìm & thay thế | 🟡 | Có tìm trong `TranscriptDrawer`, chưa có thay thế |
| F72 | Gạch chân từ đáng ngờ | ❌ | — |
| F73 | Điều khiển phát | 🟡 | Có toàn màn hình; chưa có đổi tốc độ, PiP, phím ←/→ |
| F74–F77 | Đánh dấu, xem trước không render, so sánh trước/sau, kiểu phụ đề | ❌ | — |
| F78 | Chế độ tối | ❌ | — |
| F79 | Dùng trên điện thoại | 🟡 | Có dùng class responsive của Tailwind, chưa thiết kế riêng cho điện thoại |
| F80 | WCAG | ❌ | Chưa kiểm định |
| F81 | Song ngữ | ❌ | — |
| F82 | Định dạng Việt Nam | ❌ | Chưa có hàm định dạng dùng chung |
| F83 | Phản hồi tức thì | 🟡 | Có toast (`page.tsx`); chưa có skeleton, chưa có toast kèm "Hoàn tác" |
| F84 | Trang lỗi | ❌ | Không có `not-found.tsx` / `error.tsx` |
| F85–F89 | Quên mật khẩu, 2FA, thiết bị, tuỳ chọn, đăng nhập Zalo | ❌ | Đổi mật khẩu ở `AccountModal` chỉ ghi vào `localStorage` |
| F90–F93 | Điều khoản/đồng ý, xuất & xoá dữ liệu, minh bạch dữ liệu ra nước ngoài, chống tải lậu | ❌ | — |
| F94–F97 | VietQR, hoá đơn, dùng thử, gói trường | ❌ | — |
| F98–F100 | Quản trị người dùng, cài đặt hệ thống, báo cáo Excel | ❌ | Nút ⚙️ "Cấu hình hệ thống" ở `StudioSidebar.tsx:119` chưa gắn chức năng |
| F101–F103 | 👍/👎 AI, thống kê sử dụng, PWA | ❌ | — |

### Tổng hợp
| | ✅ Có | 🟡 Một phần | ❌ Chưa có |
|---|---|---|---|
| F01–F50 (lõi) | 0 | 21 | 29 |
| F51–F103 (phụ trợ) | 0 | 8 | 45 |
| **Tổng 103** | **0** | **29** | **74** |

Không tính năng nào trong danh sách đạt ✅. Lý do: danh sách này được lập ra để lấp chỗ còn thiếu, còn phần đã làm tốt nằm ở lõi AI và cắt video (Phần 1). Nhiều mục 🟡 là **giả** (đăng nhập, sóng âm, ảnh bìa, khung 9:16) hoặc **nút chưa gắn chức năng** (Phụ đề, Cấu hình), nên dễ khiến người dùng hiểu nhầm là đã có.

## ✅ Trạng thái sau review (cập nhật 18/11/2026)

**Mọi vấn đề trong Phần 3 đã được sửa vào spec.** Bảng điểm và danh sách lỗi bên dưới giữ nguyên để tra cứu lịch sử.
- Thêm spec tiền đề **F00** (định danh ổn định, upsert, `video_parts` thật).
- Thêm 14 **quyết định kiến trúc chung (AD-1…AD-14)** vào [README.md](README.md). Các vấn đề gốc 3, 4, 5, 6, 9, 10, 11, 12 ở mục 3.2 được giải quyết bằng các AD này.
- 50 spec F01–F50 đã được sửa; mỗi spec có dòng "Cập nhật 18/11/2026" tóm tắt thay đổi.
- Rà lại cả thư mục: không còn `/api/public/`, `ai_provider_keys`, `cut_ranges`, `charcoal`, `JOB_FORBIDDEN`, `buildCutCommand`, cũng không còn tên migration kiểu số thứ tự.
- [CAU-HOI-CAN-CHOT.md](CAU-HOI-CAN-CHOT.md) đã được tạo lại: còn 135 câu hỏi mở, 33 câu đã chốt theo AD.

## Phần 3 — Review chất lượng 50 spec (F01–F50)

3 reviewer đọc độc lập, mỗi người một nhóm spec. Họ mở code thật để đối chiếu, không tin lời spec. Các phát hiện quan trọng nhất đã được kiểm lại lần hai.
**Nhận xét chung:** các chỗ dẫn tệp:dòng trong spec phần lớn **đúng** (chỉ một vài chỗ lệch 1–2 dòng). Vấn đề chủ yếu nằm ở **thiết kế chưa ăn khớp giữa các spec** và **giả định sai về code hiện tại**.

### 3.1 Bảng điểm

| Điểm | Số spec | Mã |
|---|---|---|
| ✅ Tốt | 5 | F05, F31, F43, F45, F46 |
| 🟡 Cần sửa nhỏ | 29 | F01, F03, F04, F06, F07, F10, F11, F14, F15, F16, F17, F19, F20, F22, F26, F27, F28, F30, F33, F34, F35, F37, F38, F39, F41, F42, F44, F47, F48 |
| 🔴 Cần sửa lớn | 16 | F02, F08, F09, F12, F13, F18, F21, F23, F24, F25, F29, F32, F36, F40, F49, F50 |

### 3.2 Nguyên nhân gốc: sửa 1 chỗ, gỡ được nhiều spec

| # | Vấn đề gốc | Spec bị ảnh hưởng | Hướng sửa |
|---|---|---|---|
| 1 | **Topic không có ID ổn định.** Mỗi lần Lưu, `SegmentPersistenceService.java:90` xoá hết sections, kéo theo topics và các bảng con. Câu hỏi trắc nghiệm, bản dịch, metadata AI, `video_parts` đều bị xoá theo | F18, F21, F24, F27, F29, F37, F39, F41 | Tách phần "lưu bằng upsert, giữ nguyên ID topic" của F33 thành spec tiền đề **P0**, làm trước tất cả các spec trên |
| 2 | **Frontend không có `videoId` dạng số.** API mới đều có dạng `/videos/{videoId}` nhưng `page.tsx` và `api.ts` chưa có id này | F32, F33, F34 và nhiều spec khác | Bổ sung vào spec tiền đề ở mục 1 |
| 3 | **Ba bảng quyền chồng nhau:** `video_access` (F02), `video_members` (F36), `organization_members` (F49). Thêm nữa, F02 quy định không có quyền thì trả **404**, nhưng F09, F11, F12, F36, F39, F40 lại trả **403** | F02, F35, F36, F49 + 6 spec | Chỉ giữ `video_access` (thêm vai trò REVIEWER), định nghĩa quyền khi có tổ chức, thống nhất trả 404 |
| 4 | **Xác thực cho `<video>`, `EventSource`, link tải** (không gửi được header JWT) mỗi spec làm một kiểu: F01 `?t=` 5 phút, F10 `sse-ticket` 60 giây, F12 "như F10", F36 chưa nói gì | F01, F10, F12, F36, F39, F41 | Đưa vào F01 một cơ chế "vé ngắn hạn" dùng chung |
| 5 | **Bảng `edit_ranges` dùng chung nhưng logic khác nhau.** F25 render bằng `filter_complex`, F32 cắt từng mảnh rồi ghép. `PUT` của F32 thay toàn bộ nên xoá luôn các khoảng AUTO của F25. Chưa xét `keep_seconds` | F25, F32 | Chốt một cách render; `PUT` chỉ thay các dòng `source=USER` |
| 6 | **Dev/test dùng H2 nhưng migration Flyway viết cho Postgres.** `DatabaseConfig` còn tự thêm `sslmode=require` nên không kết nối được Postgres trong Docker | F13, F14 | Bỏ H2, test dùng `TEST_DATABASE_URL` hoặc Testcontainers |
| 7 | **Job cắt không ghi bảng `video_parts`.** Hiện bảng này chỉ được ghi với `r2_key` giả và status cứng `COMPLETED` | F04, F12, F39, F45 | Thêm yêu cầu job cắt phải cập nhật `video_parts` |
| 8 | **Giả định sai về pipeline:** bước Gemini refine làm mất mốc thời gian từng từ và xoá từ đệm; DTO Java bỏ qua trường lạ (`ignoreUnknown`); Java chưa đọc `cut_mode` | F18, F23, F25, F32, F44 | Thêm FR riêng cho bước refine và cho DTO; bỏ các câu "cut_mode hiện có" |
| 9 | **Bucket R2 public hay private:** F39 và F43 trả URL công khai, F40 đề xuất bucket private | F39, F40, F43 | Chốt một hướng (đề xuất: private + presigned URL) |
| 10 | **Hạn mức tính theo user (F16) hay theo tổ chức (F49).** Xoá video: F16 trừ dung lượng ngay, còn F17 giữ trong thùng rác 30 ngày | F16, F17, F49 | Chốt một mô hình |
| 11 | **Trùng tiền tố `/api/public/**`:** filter API key của F50 sẽ chặn cả link chia sẻ ẩn danh của F40 | F40, F47, F48, F50 | Đổi F50 sang tiền tố riêng, ví dụ `/api/ext/v1` |
| 12 | **Chống trùng bằng cách bắt lỗi UNIQUE:** Postgres huỷ cả transaction khi gặp lỗi này | F48, F49 | Dùng `INSERT … ON CONFLICT DO NOTHING` |
| 13 | **Lẫn quy tắc của dự án khác:** token màu `charcoal` (của dự án thiệp cưới) xuất hiện ở F22:106 và F25:119 | F22, F25 | Xoá. Lỗi do mình viết |

### 3.3 Lỗi bảo mật & logic nghiêm trọng trong spec (phải sửa trước khi code)

| Spec | Lỗi | Hậu quả nếu code y như spec |
|---|---|---|
| F49 | Callback thanh toán VNPay (IPN) không kiểm tra `vnp_ResponseCode`/`vnp_TransactionStatus == "00"` | **Giao dịch bị huỷ vẫn kích hoạt gói trả phí** |
| F49 | Hạn mức chỉ bị trừ khi analyze xong | Hai request chạy song song cùng vượt hạn mức |
| F49 | Stripe: cả `checkout.session.completed` và `invoice.paid` đều gia hạn | Kỳ đầu bị cộng 2 lần |
| F40 | Không kiểm tra `partId` có thuộc link chia sẻ không | Người có link A tải được clip B (lỗi IDOR) |
| F40 | Proxy HLS không viết lại master playlist và `init.mp4` | Link chia sẻ không phát được video |
| F50 | Chặn SSRF chỉ kiểm tra DNS một lần, thiếu một số dải IP | Có thể bị tấn công DNS rebinding vào mạng nội bộ |
| F08 | Trigger chặn UPDATE trong khi khoá ngoại dùng `ON DELETE SET NULL` | **Không xoá được user nào** |
| F08 | `@Async` đọc SecurityContext ở luồng nền | Nhật ký ghi người thực hiện là null |
| F02 | Thêm CHECK role trong khi `DEFAULT 'MEMBER'` vẫn còn | Mọi lệnh tạo user không ghi rõ role đều lỗi |
| F02 | Gán video cũ cho admin chạy trước khi có admin | Video cũ không có chủ |
| F09 | Câu lấy job không đếm số job đang chạy của từng user; `attempts` bị cộng 2 lần | Giới hạn theo user không có tác dụng; job hết lượt thử sớm |
| F21 | Sinh metadata ngay sau analyze, khi topic chưa có trong DB | Tính năng không có dữ liệu để chạy |
| F24 | Bảng `subtitle_cues` thiếu cột trạng thái và liên kết tới câu | Không đạt được AC-3 và AC-5 |
| F26 ↔ F18 | F26 nâng trần điểm từ 7 lên 10 | Mọi điểm tin cậy của F18 bị hạ, kể cả khi tắt nhận diện slide |
| F29 | Câu hỏi trắc nghiệm có khoá ngoại tới topic với `ON DELETE CASCADE` | **Câu hỏi đã duyệt bị mất sau mỗi lần Lưu** |
| F32 | AC-1 tính thiếu padding 0,3 + 0,5 giây | Test luôn thất bại |

### 3.4 Lỗi nhỏ đáng chú ý
- F03: token của Microsoft thường không có `email_verified`, nên FR-2 sẽ chặn mọi lần đăng nhập Microsoft.
- F17: `@SQLRestriction` lọc ở mọi truy vấn JPQL, nên repository thùng rác không thấy video đã xoá.
- F30: `similarity()` so cả câu dài với từ khoá ngắn nên gần như không bao giờ khớp. Nên dùng `word_similarity`.
- F37: tên tệp đánh số theo vị trí trong request, nên render đoạn 12–14 ra `01_`, `02_`, `03_`.
- F41: cách tính `watched_sec` sai; khoá học PUBLIC không phát được vì luồng phát của F39 cần JWT.
- F42: thao tác `videos.update` của YouTube cần scope `youtube.force-ssl`; user tạo qua LTI vướng ràng buộc `email NOT NULL`.
- F44, F45: hàm thật tên là `buildCommand` (`VideoCutter.java:337`), không phải `buildCutCommand`.
- F48: chống trùng bằng UNIQUE thì có tác dụng vĩnh viễn, không phải "trong 24 giờ" như spec; link huỷ đăng ký bằng GET sẽ bị trình quét email tự bấm.
- F28: ước lượng M quá thấp, nên là L. Phần map-reduce có thể thừa (YAGNI) vì Gemini xử lý được ngữ cảnh lớn.
- Nhiều spec vẫn ghi tên migration kiểu `V2__`, `V46__`, chưa theo quy ước dấu thời gian. Testcontainers và Google Picker chưa được ghi vào mục thư viện cần duyệt.

### 3.5 Đề xuất thứ tự sửa spec
1. **Viết thêm spec tiền đề F00 "Lưu dự án bằng upsert + định danh video/topic"** (gỡ vấn đề gốc 1 và 2). Mục này P0, làm trước F21, F24, F29, F32–F34.
2. **Chốt 5 quyết định kiến trúc** (vấn đề gốc 3, 4, 9, 10, 11), ghi vào README phần "Quy ước chung".
3. **Sửa 16 spec cần sửa lớn**, bắt đầu từ các lỗi bảo mật ở mục 3.3.
4. **Sửa 29 spec cần sửa nhỏ**, có thể sửa ngay trong PR khi code tính năng đó.
