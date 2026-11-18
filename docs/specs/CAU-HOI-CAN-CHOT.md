# Câu hỏi cần trưởng nhóm chốt

Tổng hợp tự động từ mục 10 của các spec F00–F50 (tạo lại ngày 18/11/2026, sau đợt sửa theo review). Chốt xong câu nào thì tick ở **spec gốc** (tệp này chỉ để xem nhanh, tạo lại khi spec đổi). Các câu đã được trả lời bằng quyết định kiến trúc (AD) trong [README.md](README.md) được ghi "Đã chốt theo AD-x" ở spec gốc.

## [F00 — Định danh ổn định & lưu dự án bằng upsert](00-tien-de/F00-dinh-danh-on-dinh-upsert.md)
- [ ] Section rỗng (không còn topic ACTIVE) có hiện trên giao diện không? Đề xuất: ẩn.
- [ ] Có cần job dọn topic DISCARDED quá 90 ngày không? Đề xuất: để F17 quyết định.

## [F01 — Đăng nhập thật (JWT + BCrypt)](01-bao-mat/F01-dang-nhap-jwt.md)
- [ ] Dùng `jjwt` hay `oauth2-resource-server` (Nimbus)?
- [ ] Access token 15 phút và refresh 14 ngày có hợp không? Có cần "Ghi nhớ đăng nhập" để chọn giữa phiên ngắn và dài không?
- [x] Dữ liệu `videos` hiện có `owner_id = NULL`: đã chốt là F02 mở rộng `BootstrapAdminRunner` để gán cho Admin (FR-9).
- [x] Video phát thế nào khi đã có JWT: đã chốt theo AD-4 (vé ngắn hạn) và AD-3 (presigned URL).
- [ ] Có cần trang "Quên mật khẩu" qua email ở MVP không? Đã đưa vào đề xuất F85 (chờ duyệt), phụ thuộc F48 (gửi email).

## [F02 — Phân quyền & sở hữu dữ liệu](01-bao-mat/F02-phan-quyen-so-huu.md)
- [x] Hai người upload cùng một tệp: đã chốt tạo bản riêng, `UNIQUE(owner_id, sha256_hash)`, dùng chung cache transcript (FR-9).
- [x] Vai trò duyệt riêng: đã chốt thêm `REVIEWER` theo AD-1. "Trợ giảng" dùng `EDITOR`.
- [ ] EDITOR có được chạy lại analyze (tốn chi phí AI của chủ video) không? Đề xuất: có, nhưng tính vào hạn mức của chủ video (AD-9).

## [F03 — Đăng nhập Google/Microsoft (SSO)](01-bao-mat/F03-sso-google-microsoft.md)
- [ ] Danh sách tên miền trường được phép là gì? Có cho Gmail cá nhân ở môi trường demo không?
- [ ] User SSO mới mặc định là INSTRUCTOR hay VIEWER, chờ Admin nâng quyền?
- [ ] Có cho user SSO đặt thêm mật khẩu để đăng nhập dự phòng không?

## [F04 — Vá lỗi lộ tệp khi tải clip/ZIP (Path Traversal)](01-bao-mat/F04-va-path-traversal.md)
- [ ] Có đổi **ngay** các khoá R2, Neon, LLM đang dùng không, phòng trường hợp đã bị lộ qua lỗi này? Đề xuất: **có**, vì backend từng được chạy với CORS mở.
- [x] TTL của presigned URL: đã chốt 15 phút theo AD-3. Presigned URL chỉ cần còn hạn **lúc bắt đầu** tải, nên video dài tải chậm vẫn tải xong.

## [F05 — Siết CORS theo môi trường](01-bao-mat/F05-siet-cors.md)
- [x] Proxy Next.js `rewrites` hay hai origin + CORS: đã chốt ở F01 FR-1. Mặc định dùng hai origin cùng site + CORS; chỉ dùng `rewrites` khi frontend và backend khác tên miền đăng ký. Upload lớn không đi qua Next.js vì F11 upload thẳng lên R2.
- [ ] Tên miền prod chính thức là gì?

## [F06 — Giới hạn tần suất gọi API (Rate limit)](01-bao-mat/F06-rate-limit.md)
- [ ] Con số giới hạn ở FR-1 đã hợp lý chưa? Cần SV2 ước chi phí 1 lần analyze cho video 1 giờ.
- [ ] Có cần cho Admin chỉnh giới hạn riêng cho từng user không? (Đề xuất: để F49.)
- [ ] Danh sách IP của các trường đối tác cho `ip-allowlist` (nếu có).

## [F07 — Quản lý khoá API AI phía máy chủ](01-bao-mat/F07-quan-ly-khoa-ai.md)
- [x] Chatbox có stream không: đã kiểm, `route.ts` hiện **không** stream (trả `NextResponse.json`). Java trả JSON thường; stream để sau nếu cần.
- [ ] Có cho mỗi giảng viên dùng khoá riêng (BYOK) không? Đề xuất: không ở MVP.
- [ ] Giữ cả 4 provider hay chỉ 1–2 cho gọn?

## [F08 — Nhật ký thao tác (Audit log)](01-bao-mat/F08-audit-log.md)
- [ ] Thời gian giữ nhật ký: 365 ngày hay theo quy định của trường?
- [ ] Có ghi `CLIP_DOWNLOADED` cho người xem công khai (F40) không? Lượng ghi có thể rất lớn.
- [ ] IP có được coi là dữ liệu cá nhân cần che bớt (ví dụ chỉ lưu /24) không?

## [F09 — Hàng đợi job bền vững](02-ha-tang/F09-hang-doi-job-ben-vung.md)
- [x] Test dùng Postgres thật: **Đã chốt theo AD-7** (Testcontainers cần duyệt; nếu không được duyệt thì dùng `TEST_DATABASE_URL` trỏ tới một nhánh Neon `test` riêng).
- [ ] Giữ job đã kết thúc 30 ngày có hợp lý không?
- [ ] Giới hạn đồng thời mặc định (CUT=2, TRANSCRIBE=1) phụ thuộc cấu hình máy chủ thật. Server dự kiến có bao nhiêu CPU/RAM? Có GPU cho Whisper không?
- [ ] Có cần mức ưu tiên (ví dụ Admin hoặc gói trả phí chạy trước) ngay từ bản này không?

## [F10 — Analyze bất đồng bộ + tiến độ thời gian thực](02-ha-tang/F10-analyze-bat-dong-bo-sse.md)
- [x] Xác thực SSE: **Đã chốt theo AD-4** (vé `SSE` dùng một lần, do F01 cấp).
- [ ] Có tự chạy ANALYZE ngay sau TRANSCRIBE không, hay chờ giảng viên nhập outline (`videos.outline_text`) trước?
- [ ] Bỏ hẳn endpoint `/upload-sample` sau bao lâu?

## [F11 — Upload chia khúc, tiếp tục được, đi thẳng lên R2](02-ha-tang/F11-upload-chia-khuc.md)
- [ ] Giới hạn kích thước tối đa mỗi tệp: 10 GB có ổn không?
- [x] Môi trường dev dùng MinIO thay R2: **Đã chốt**, nằm trong Docker Compose của F14.
- [ ] Có cần hỗ trợ upload nhiều tệp cùng lúc (hàng đợi upload) ngay ở bản này không?
- [ ] Tên miền frontend chính thức là gì (để cấu hình CORS của R2 và F05)?

## [F12 — Xuất ZIP dạng luồng](02-ha-tang/F12-zip-streaming.md)
- [ ] Có đưa video gốc vào ZIP không? Mặc định là không.
- [ ] Ngưỡng nào thì chuyển sang phương án B (nén nền, gửi link)?
- [x] Người được chia sẻ link (F40) có được tải ZIP không? **Đã chốt theo AD-5:** không qua endpoint này; F40 có endpoint tải riêng (cờ `allow_download`).

## [F13 — Quản lý migration bằng Flyway](02-ha-tang/F13-flyway-migration.md)
- [ ] Duyệt thêm thư viện Flyway?
- [x] DB cho test: **Đã chốt theo AD-7** (Testcontainers, vẫn cần duyệt thư viện; dự phòng bằng `TEST_DATABASE_URL`).
- [ ] Ai có quyền deploy migration lên production? Có cần bước duyệt tay không?

## [F14 — Docker Compose + CI](02-ha-tang/F14-docker-ci.md)
- [ ] Repo trên GitHub là public hay private (ảnh hưởng hạn mức phút CI)?
- [ ] Máy chủ production là gì (VPS nào, bao nhiêu CPU/RAM, có GPU không)?
- [ ] Có dùng GHCR không, hay Docker Hub?
- [ ] Có tách AI Python thành service FastAPI riêng ngay bây giờ không? Đề xuất: chưa, để sau F10.

## [F15 — Giám sát, log & đo chi phí AI](02-ha-tang/F15-giam-sat-log.md)
- [ ] Duyệt Actuator? Duyệt Sentry (dữ liệu lỗi gửi ra dịch vụ bên ngoài)?
- [ ] Ngân sách AI mỗi ngày bao nhiêu? Ngân sách theo từng người dùng hay chung toàn hệ thống?
- [ ] Gửi cảnh báo tới ai và qua kênh nào trước khi F48 xong?

## [F16 — Hạn mức dung lượng](02-ha-tang/F16-han-muc-dung-luong.md)
- [x] Video trong thùng rác có tính dung lượng không? **Đã chốt theo AD-9:** có, cho tới khi xoá hẳn.
- [x] Hạn mức theo user hay theo tổ chức? **Đã chốt theo AD-9:** theo user trước F49, theo tổ chức sau F49.
- [ ] Hạn mức mặc định cho mỗi vai trò: Giảng viên 2 GB, Admin không giới hạn?
- [ ] Clip đã cắt có tính vào hạn mức không, hay chỉ tính video gốc?
- [ ] Khi vượt hạn mức do Admin hạ giới hạn xuống, có khoá upload ngay không hay cho một khoảng ân hạn?

## [F17 — Dọn tệp tạm & vòng đời lưu trữ](02-ha-tang/F17-don-tep-vong-doi.md)
- [ ] Thời gian giữ trong thùng rác: 30 ngày có hợp lý không?
- [ ] Có giữ video gốc trên R2 vĩnh viễn không, hay chỉ giữ clip sau N tháng?
- [ ] Hạn mức cache `sources` 20 GB: ổ cứng máy chủ bao nhiêu?
- [ ] Ai được bật tắt `dry-run` ở production?

## [F18 — Độ tin cậy điểm cắt](03-ai/F18-do-tin-cay-diem-cat.md)
- [ ] Ngưỡng 0.5 có hợp lý không, hay cho mỗi giảng viên tự chỉnh?
- [ ] Ai chuẩn bị 5 video "chuẩn vàng" (đã duyệt tay) cho AC-5, và lấy từ khoá học nào?
- [ ] Có hiện điểm % cho người dùng cuối không, hay chỉ hiện 3 mức Cao / Trung bình / Thấp?

## [F19 — Từ điển thuật ngữ riêng](03-ai/F19-tu-dien-thuat-ngu.md)
- Đã chốt: không hỗ trợ regex ở bản này (xem Ngoài phạm vi).
- [ ] Có cần từ điển cấp tổ chức (đi cùng F49) ngay bây giờ không? Đề xuất: chưa (AD-9 chỉ nói về hạn mức).
- [ ] Groq Whisper API có trường `prompt` với giới hạn khác faster-whisper không? Nếu khác, cần kiểm tra lại giới hạn 420 ký tự cho cả hai engine.

## [F20 — Nhận diện người nói (Speaker Diarization)](03-ai/F20-nhan-dien-nguoi-noi.md)
- [ ] Chọn phương án A (pyannote, tự chạy) hay B (API trả phí)? Máy chủ có GPU không?
- [ ] Có bật mặc định cho preset "hội thảo / tọa đàm" (F28) không?
- [ ] Có cần nút "cắt bỏ mọi đoạn của người nói X" (kết hợp F25) không?

## [F21 — AI sinh tiêu đề, tóm tắt, từ khoá cho từng clip](03-ai/F21-ai-tieu-de-tom-tat.md)
- [ ] Có sinh luôn mô tả cho **cả video** (dùng cho trang khoá học F41) không?
- [ ] Danh sách giọng văn đã đủ chưa? Có cần chọn ngôn ngữ đầu ra (đi cùng F24) không?
- [ ] Từ khoá có cần thêm dạng hashtag (`#vonglapfor`) cho mạng xã hội không?

## [F22 — Xuất chapters YouTube / WebVTT / JSON](03-ai/F22-xuat-chapters.md)
- [ ] Giữ tiền tố "Phần N" như tuỳ chọn hay bỏ hẳn?
- [ ] Khi dưới 3 chương, có tự tách chương dài cho đủ 3 không, hay chỉ cảnh báo?

## [F23 — Phụ đề SRT/VTT và ghi cứng phụ đề](03-ai/F23-phu-de.md)
- Đã chốt: thuật toán chia cue đặt ở Java (`CueBuilder`), Python chỉ cung cấp `words`.
- [ ] Font chính thức dùng gì? Cần trưởng nhóm duyệt nguồn và giấy phép.
- [ ] Có cho người dùng sửa từng cue không, hay chỉ sửa qua transcript (F32)?

## [F24 — Dịch phụ đề và metadata sang ngôn ngữ khác](03-ai/F24-dich-phu-de.md)
- [ ] Danh sách ngôn ngữ cho bản đầu tiên: chỉ `en` hay thêm `ja`, `ko`?
- [ ] Có cần người duyệt bản dịch (F35) trước khi công khai không?

## [F25 — Cắt từ đệm, khoảng lặng dài và câu nói lặp](03-ai/F25-cat-tu-dem-khoang-lang.md)
- [ ] Danh sách từ đệm mặc định đã đủ chưa? Có khác nhau theo vùng miền không?
- [ ] Có áp dụng xoá cho bản xem trên trang khoá học (F41) mà không render lại không (phát nhảy qua)?
- [ ] Mặc định tắt hay bật `REPEAT`?

## [F26 — Nhận diện đổi slide và OCR nội dung slide](03-ai/F26-nhan-dien-slide-ocr.md)
- [ ] Chọn OCR Gemini Vision hay PaddleOCR (chạy offline)? Nếu chọn Gemini Vision thì ảnh slide được gửi ra máy chủ nước ngoài, cần ghi vào phần minh bạch dữ liệu (đề xuất F92).
- [ ] Có lưu toàn văn OCR lên DB không, hay chỉ tiêu đề + chỉ mục tìm kiếm (vì dữ liệu nặng)?

## [F27 — AI học từ chỉnh sửa của người dùng](03-ai/F27-ai-hoc-tu-chinh-sua.md)
- [ ] Có cho học ở cấp tổ chức (khi đã có F49) không, và cần những đồng ý gì từ người dùng?
- [ ] Ai chịu trách nhiệm tăng `PROMPT_VERSION` (quy trình review prompt)?

## [F28 — Preset (bộ cấu hình mẫu) theo loại bài giảng](03-ai/F28-preset-bai-giang.md)
- [ ] Danh sách 5 preset và nhãn section cụ thể: giảng viên các bộ môn cần duyệt.
- [ ] Có làm "tự đoán preset" bằng LLM từ 2 phút đầu transcript không?
- [ ] `outline.strict = true` xử lý thế nào khi giảng viên dạy khác thứ tự trong đề cương?

## [F29 — Tự tạo câu hỏi trắc nghiệm cho từng clip](03-ai/F29-tao-cau-hoi-trac-nghiem.md)
- [ ] Có cần lưu kết quả làm bài của học viên ngay trong bản đầu không (chạm F41/F47)?
- [ ] Định dạng xuất nào ưu tiên nhất: Moodle hay Google Forms?
- [ ] Số câu mặc định cho mỗi topic: 3 hay 5?

## [F30 — Tìm kiếm trong video và toàn thư viện](03-ai/F30-tim-kiem-noi-dung.md)
- [ ] Dùng model embedding nào cho giai đoạn 2? Đề xuất `gemini-embedding-001` (768 chiều qua `output_dimensionality`), **cần xác minh**; hoặc model mã nguồn mở. Đổi model thì số chiều đổi theo.
- Đã chốt theo AD-7: test tích hợp dùng Postgres thật (Testcontainers hoặc `TEST_DATABASE_URL`), không dùng H2 hay DB production.
- [ ] Có nối kết quả tìm kiếm vào chatbox AI (RAG có trích dẫn mốc giờ) ở bản sau không?

## [F31 — Undo/Redo & phím tắt](04-bien-tap/F31-undo-redo-phim-tat.md)
- [ ] Có duyệt thêm Vitest vào devDependencies không? (Bắt buộc phải chốt theo AD-11.)
- [x] Phím `Delete` xoá hẳn hay đánh dấu? **Đã chốt theo AD-6/F00:** phía frontend bỏ đoạn khỏi danh sách đang hoạt động; khi lưu, backend xoá mềm (`DISCARDED`). Khôi phục đoạn đã lưu là việc của F37 (qua `includeDiscarded`).
- [ ] Có cần lưu lịch sử Undo qua F5 không? Đề xuất: không, để đơn giản.

## [F32 — Sửa transcript là sửa video](04-bien-tap/F32-sua-transcript-sua-video.md)
- [x] Khoảng bị bỏ gắn theo video hay topic? **Đã chốt theo AD-13:** theo video.
- [ ] Khi topic chỉ còn dưới `duration.min_duration` (30 giây) sau khi bỏ, có cảnh báo hay chặn render?
- [ ] Sửa chữ có cần đẩy lại lên `transcripts/*.json` trong R2 không, hay chỉ cần lưu DB?

## [F33 — Lịch sử phiên bản & chống ghi đè](04-bien-tap/F33-lich-su-phien-ban.md)
- [ ] Có giữ thư mục `output/users/<user>/<lesson>/project.json` và đồng bộ R2 ở `/save` không, hay DB là nguồn sự thật duy nhất? Đề xuất: DB là nguồn sự thật. R2 chỉ để sao lưu, chạy nền.
- [x] Ai được phép "Ghi đè" khi xung đột? **Đã chốt theo AD-1:** chỉ `OWNER` của video (hoặc `ORG_ADMIN`).
- [ ] Giới hạn 50 bản AUTOSAVE có phù hợp không?

## [F34 — Tự động lưu](04-bien-tap/F34-tu-dong-luu.md)
- [ ] Debounce 3 giây và max wait 30 giây có hợp lý với tải máy chủ hiện tại (Neon gói free) không?
- [ ] Có cho tắt tự lưu không, hay luôn bật? Đề xuất: cho tắt nhưng mặc định bật.
- [ ] Có duyệt thêm `fake-indexeddb` (chỉ dùng trong devDependencies) để test không? (Bắt buộc phải chốt theo AD-11.)

## [F35 — Quy trình duyệt + bình luận theo mốc giờ](04-bien-tap/F35-quy-trinh-duyet-binh-luan.md)
- [ ] Có bật tự duyệt (FR-11) cho môi trường hiện tại không? Mặc định tắt.
- [ ] Dữ liệu cũ `reviewed=true` chuyển thành APPROVED hay DRAFT?
- [x] `VIEWER` có được bình luận không? **Đã chốt theo AD-1/F02 FR-2:** không (chỉ người có `COMMENT`).
- [ ] Render bản nháp có cần đóng watermark "BẢN NHÁP" không (liên quan F44)?

## [F36 — Làm việc nhóm](04-bien-tap/F36-lam-viec-nhom.md)
- [x] Khi chấp nhận lời mời, có bắt buộc email tài khoản phải khớp email được mời không? **Có** (đã đưa vào test `accept_emailMismatch_rejected`).
- [x] Biên tập có được mời thêm người không? **Đã chốt theo AD-1/F02:** chỉ người có `MANAGE` (OWNER).
- [ ] Dự kiến chạy 1 hay nhiều instance backend? Nếu nhiều thì cần duyệt thêm Redis.
- [ ] Chia sẻ theo **từng video** hay theo **khoá học/thư mục**? Spec này làm theo video. Theo thư mục để F41/F49.

## [F37 — Thao tác hàng loạt](04-bien-tap/F37-thao-tac-hang-loat.md)
- [ ] Tên đoạn sau khi gộp: giữ tên đoạn đầu (đề xuất) hay nối "A & B" như hiện tại?
- [x] Cách đặt tên thư mục section chuẩn: **`02_LyThuyet`**, theo `PathSlugifier.toSectionFolderName` ở backend (nơi thật sự ghi tệp). Frontend chỉ làm theo.
- [x] "Render đã chọn" có cần qua bước duyệt của F35 không? **Không** với bản nháp (`renderKind=DRAFT`); bản phát hành theo F35 FR-10.

## [F38 — Sóng âm & ảnh xem trước trên timeline](04-bien-tap/F38-song-am-thumbnail-timeline.md)
- [ ] Khoảng cách giữa các ảnh: 5 giây (đề xuất) hay 2 giây (nét hơn nhưng nặng gấp 2,5 lần)?
- [ ] Sau khi có tính năng này, có backfill toàn bộ video cũ không?
- [ ] Có dùng chung dữ liệu peaks với F25 (phát hiện khoảng lặng) và F26 (phát hiện đổi slide từ sprite) để tránh chạy ffmpeg hai lần không? Đề xuất: có. F25/F26 đọc từ cache của spec này.

## [F39 — Phát video HLS](05-xuat-ban/F39-phat-hls.md)
- [x] ~~Có dùng domain CDN riêng không?~~ Đã chốt theo AD-3: bucket private, dùng presigned URL trên endpoint S3 API của R2.
- [x] ~~Video gốc có cần HLS không?~~ Đã chốt: có, chỉ 2 bậc 360p/720p (FR-3).
- [ ] Clip có cần bậc 1080p không? Hiện để mặc định `hls.max_rendition_part=1080p`. Nếu phần lớn bài giảng là quay màn hình thì 720p thường đã đủ đọc chữ.
- [ ] Có giữ MP4 sau khi HLS sẵn sàng không? Đề xuất: giữ, vì cần cho tải về (F40), F42 và F45.

## [F40 — Link chia sẻ & mã nhúng](05-xuat-ban/F40-link-chia-se-nhung.md)
- [x] ~~Có chuyển bucket R2 sang private ngay trong F40 không?~~ Đã chốt theo AD-3: có.
- [ ] Link `LESSON` có tự cập nhật khi thêm clip mới không? Spec giả định **có**, vì luôn đọc dữ liệu mới nhất.
- [ ] Có cần chế độ "Chỉ thành viên tổ chức đã đăng nhập" (dùng F03 SSO) không?
- [ ] Domain frontend chính thức là gì? Cần biết để sinh `url` và `embedCode`.

## [F41 — Trang khoá học cho học viên](05-xuat-ban/F41-trang-khoa-hoc.md)
- [ ] Một video có được nằm trong **nhiều khoá học** không? Spec hiện tại cho phép.
- [ ] Học viên dùng tài khoản do trường cấp (F03 SSO) hay giảng viên tự tạo? Spec hỗ trợ cả hai qua lời mời bằng email.
- [ ] Có cần **bắt buộc học tuần tự** (khoá clip sau khi chưa xong clip trước) không? Mặc định là không.
- [ ] Có cần cấp chứng nhận hoàn thành khoá học không? Nếu có thì tách spec riêng (cần chống gian lận tiến độ).
- [x] ~~`sendBeacon` không gửi được header~~ Đã chốt: dùng `fetch(keepalive)`.

## [F42 — Đẩy lên YouTube / Google Drive / LMS (LTI 1.3)](05-xuat-ban/F42-tich-hop-youtube-lms.md)
- [ ] Dùng **một Google Cloud project chung** của AutoCut (phải qua verification và audit) hay cho mỗi trường tự cấu hình project? Ảnh hưởng lớn tới quota.
- [ ] Trường mục tiêu dùng LMS nào: Moodle, Canvas hay Google Classroom? Google Classroom **không** dùng LTI mà có API riêng.
- [x] ~~Học viên đi vào từ LTI có cần tài khoản AutoCut đầy đủ không?~~ Đã chốt: tạo user `VIEWER` với `auth_source='LTI'`, không cần email (FR-11).
- [ ] Có cần đồng bộ ngược (sửa tiêu đề trong AutoCut thì tự cập nhật lên YouTube) không? Spec hiện chỉ cập nhật khi người dùng bấm "Đẩy lại".

## [F43 — Tự tạo ảnh bìa (thumbnail)](05-xuat-ban/F43-anh-bia-tu-dong.md)
- [ ] Duyệt font **Be Vietnam Pro** (OFL), hay trường có font thương hiệu riêng?
- [ ] Ảnh bìa mặc định nên là ảnh **có chữ** hay **khung gợi ý không chữ**? YouTube thường dùng ảnh có chữ, còn trang khoá học (F41) có thể đẹp hơn khi không chữ.
- [ ] Màu dải gradient và vị trí chữ có cần chỉnh theo tổ chức không? Nếu có thì đưa vào cấu hình thương hiệu của F44.

## [F44 — Logo, watermark, intro/outro (bộ nhận diện thương hiệu)](05-xuat-ban/F44-thuong-hieu-intro-outro.md)
- [x] ~~Brand Kit thuộc người dùng hay tổ chức?~~ Đã chốt theo AD-1/AD-9: trước F49 gắn với `owner_id` (user); sau F49 thêm `org_id` và `ORG_ADMIN` quản lý kit của tổ chức.
- [ ] Có cho áp thương hiệu **lên video đã xuất trước đó** không? Việc này phải cắt lại toàn bộ.
- [ ] Độ phân giải chuẩn của intro là 1080p hay theo độ phân giải video gốc? (Liên quan F45.)
- [ ] Có cần mặc định ẩn logo trong khoảng 3 giây đầu và cuối khi đã có intro/outro (vì intro đã có logo) không?

## [F45 — Nhiều định dạng xuất (1080p/720p, khung dọc 9:16, MP3)](05-xuat-ban/F45-nhieu-dinh-dang-xuat.md)
- [ ] Có cần profile **`MP4_480`** cho học viên vùng mạng yếu không? Nếu đã có HLS (F39) thì có lẽ không cần.
- [ ] Khung dọc có cần **ghi cứng phụ đề** mặc định không? (TikTok xem không tiếng chiếm đa số.) Nếu có thì chờ F23.
- [ ] Bản MP3 có cần **gộp cả bài học thành 1 tệp** (podcast dài) ngoài tệp từng clip không?
- [ ] Profile mặc định nên là chỉ `SOURCE` hay `SOURCE + MP4_720`?

## [F46 — Dashboard thống kê thật](06-van-hanh/F46-dashboard-thong-ke.md)
- [ ] Ngưỡng tính "dời điểm cắt" là 2 giây hay theo % độ dài topic?
- [x] Lúc chốt số liệu sửa tay: **khi duyệt** (F35), mỗi video một dòng (FR-5).
- [ ] Giảng viên có được xem chi phí AI của chính mình không, hay chỉ admin?
- [x] Dashboard theo tổ chức: làm sau F49. Đã chốt theo AD-9 (hạn mức chuyển sang theo tổ chức khi có F49); bản này chỉ làm theo user.

## [F47 — Thống kê người xem](06-van-hanh/F47-thong-ke-nguoi-xem.md)
- [ ] Kích thước ô 5 giây có hợp lý với clip dài 30 phút không, hay nên dùng 1% độ dài clip?
- [x] Thống kê theo học viên đã đăng nhập: **không** ở bản này. Người xem từ F41 vẫn ghi ẩn danh (FR-7); tiến độ theo tài khoản đã có ở `watch_progress` của F41.
- [x] Dùng cron trong Spring hay job queue F09? **Đã chốt theo AD-10:** cron chỉ tạo job, job F09 thực hiện gom.
- [ ] Thời gian lưu sự kiện thô: 90 ngày có đủ không?

## [F48 — Thông báo email / Zalo / Telegram](06-van-hanh/F48-thong-bao.md)
- [ ] Nhóm có OA Zalo đã xác thực chưa? Nếu chưa, có làm Zalo ở bản này không, hay chỉ làm Email + Telegram trước?
- [ ] Dùng nhà cung cấp SMTP nào (SES, SendGrid, Gmail Workspace)? Gửi từ tên miền nào?
- [ ] Giờ yên tĩnh mặc định 22:00–07:00 có hợp lý không?
- [ ] Có cần gửi thông báo cho cả người được mời cộng tác (F36), hay chỉ chủ video?

## [F49 — Đa tổ chức & gói cước](06-van-hanh/F49-da-to-chuc-goi-cuoc.md)
- [ ] Giá và hạn mức từng gói là bao nhiêu? Đơn vị tính là phút video gốc hay phút clip xuất ra?
- [ ] Có pháp nhân để đăng ký merchant VNPay chưa? Có cần Stripe ở bản đầu không?
- [ ] VNPay chỉ trả trước (không tự gia hạn), vậy gửi nhắc gia hạn trước bao nhiêu ngày (dùng F48)?
- [ ] Khi hạ cấp mà dung lượng vượt hạn mức Free: chỉ chặn upload, hay sau 30 ngày xoá bớt video gốc?
- [x] Hạn mức theo user hay theo tổ chức? **Đã chốt theo AD-9:** theo tổ chức sau F49; mỗi user có tổ chức cá nhân.
- [ ] Gói Free có bắt watermark (F44) không?

## [F50 — Public API & webhook](06-van-hanh/F50-public-api-webhook.md)
- [ ] Bản đầu có cho tạo video từ `sourceUrl`, hay chỉ cho upload qua URL ký sẵn (an toàn hơn)?
- [ ] Gói nào được dùng Public API: chỉ Enterprise, hay cả Team (xem F49)?
- [ ] Hạn mức mặc định 60 req/phút và 10 analyze/giờ có đủ cho trường học không?
- [ ] Có cần môi trường `ak_test_` riêng (dữ liệu giả, không tính phí) ngay từ đầu không?
- [ ] Domain public API là gì (ví dụ `api.autocut.vn`)?

