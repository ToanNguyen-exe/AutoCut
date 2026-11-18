# Đề xuất tính năng bổ sung (F51–F103) — BẢN NHÁP CHỜ DUYỆT

> **Trạng thái:** chờ trưởng nhóm duyệt. **Chưa viết spec.**
> Cách duyệt: ở cột **Duyệt**, ghi `✅` (làm), `❌` (bỏ) hoặc `⏸` (để sau), có thể ghi chú thêm.
> Sau khi duyệt, mỗi dòng `✅` sẽ được viết thành spec đầy đủ theo [_TEMPLATE.md](_TEMPLATE.md).

## Phạm vi

Đây là các tính năng "phụ trợ": không phải lõi AI cắt video, nhưng làm sản phẩm trông chuyên nghiệp
và dễ dùng hằng ngày. Danh sách đã loại các tính năng trùng với F01–F50. Một số việc nhỏ đã nằm sẵn
trong spec cũ nên không đưa vào đây:

- Ảnh xem trước khi dán link vào Zalo/Facebook (Open Graph): đã có ở F40.
- Phím tắt không xung đột với bộ gõ tiếng Việt (Telex/Unikey): đã có ở F31.
- Phần backend của thùng rác 30 ngày: đã có ở F17. Ở đây chỉ bổ sung phần giao diện (F62).

**Ưu tiên:** P0 = cần trước khi mở cho người ngoài dùng · P1 = nên có ở bản chính thức · P2 = làm khi có thời gian.
**Cỡ:** S ≤ 2 ngày · M 3–5 ngày · L 1–2 tuần (1 người).

---

## A. Lần đầu sử dụng & trợ giúp

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F51 | Dự án mẫu + danh sách việc cần làm khi bắt đầu | Tài khoản mới có sẵn 1 bài giảng mẫu đã phân đoạn, kèm danh sách 4 bước có thanh tiến độ: tải video, chạy AI, duyệt, xuất | Descript (dự án mẫu), Linear | P1 | S | |
| F52 | Màn hình trống có hướng dẫn | Thư viện hoặc kết quả tìm kiếm trống thì hiện giải thích, hình minh hoạ và một nút hành động chính, không để trang trắng | Notion, Linear | P1 | S | |
| F53 | Tour giới thiệu Studio | Lần đầu vào Studio có 5–6 bong bóng chỉ dẫn từng vùng (timeline, transcript, trợ lý AI). Bỏ qua được, xem lại được | Canva, Userpilot | P2 | S | |
| F54 | Trung tâm trợ giúp trong ứng dụng | Nút "?" mở bài hướng dẫn đúng màn hình đang dùng, có video hướng dẫn tiếng Việt ngắn và ô tìm câu hỏi thường gặp | Intercom, Descript Help | P1 | M | |
| F55 | Hỗ trợ qua Zalo + báo lỗi một chạm | Nút "Cần giúp?" mở Zalo OA của đội. Form "Báo lỗi" tự đính kèm ảnh chụp màn hình, trình duyệt và mã lỗi `requestId` (F15) | Thói quen người dùng Việt Nam, Intercom | P1 | S | |
| F56 | "Có gì mới" trong ứng dụng | Chấm đỏ trên biểu tượng 🎁, mở danh sách tính năng mới kèm ảnh GIF | Vimeo Product Updates, Linear Changelog | P2 | S | |
| F57 | Trang trạng thái hệ thống + báo bảo trì | Trang `/status` cho biết AI, lưu trữ và xử lý video có đang chạy bình thường không. Có banner báo trước lịch bảo trì | Status page của các SaaS lớn | P2 | S | |

## B. Thư viện & điều hướng

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F58 | Bảng lệnh nhanh Ctrl+K | Bấm Ctrl+K, gõ "xuất", "video Java" hay "cài đặt" để nhảy tới trang hoặc chạy lệnh ngay. Tìm được cả khi gõ không dấu | Linear, Figma, VS Code | P1 | M | |
| F59 | Thư mục, thẻ, màu, ghim | Sắp video theo thư mục lồng nhau (Môn → Học kỳ → Lớp), gắn thẻ, đặt màu cho thư mục, ghim video hay dùng | Vimeo (thư mục màu, 06/2026), Loom | P1 | M | |
| F60 | Lọc, sắp xếp, đổi kiểu xem | Lọc theo trạng thái, ngày, người tạo. Xem dạng lưới hoặc danh sách. Lưu bộ lọc hay dùng | Google Drive, Vimeo | P1 | S | |
| F61 | Gần đây & làm tiếp | Trang chủ có mục "Mở gần đây" và "Đang làm dở", ví dụ "đã duyệt 7/12 đoạn" | Figma, Canva | P2 | S | |
| F62 | Giao diện thùng rác | Xem video đã xoá, khôi phục, hoặc xoá vĩnh viễn (phải gõ tên video để xác nhận). Hiện số ngày còn lại trước khi tự xoá | Google Drive (backend đã có ở F17) | P1 | S | |
| F63 | Nhân bản / lưu làm mẫu | Nhân bản một dự án, hoặc lưu cấu hình và cách đặt tên của nó làm mẫu cho bài giảng sau | Notion Templates | P2 | S | |
| F64 | Thay video gốc, giữ nguyên link | Quay lại bài giảng thì tải bản mới lên thay. Link chia sẻ và mã nhúng vẫn giữ nguyên | Vimeo Replace | P2 | M | |
| F65 | Trường thông tin tuỳ chỉnh | Gắn thông tin Môn học, Mã lớp, Học kỳ, Giảng viên cho video, rồi lọc và tìm theo các trường đó | Vimeo (custom metadata, 05/2026), Panopto | P1 | M | |

## C. Tải lên & xử lý

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F66 | Kéo-thả ở mọi nơi, tải nhiều tệp | Thả tệp vào bất kỳ đâu trên trang để tải lên. Tải nhiều tệp cùng lúc. Sai định dạng hoặc quá dung lượng thì báo ngay, trước khi bắt đầu tải | VEED, Kapwing | P1 | S | |
| F67 | Nhập từ Google Drive / OneDrive | Dán link Drive hoặc OneDrive, hoặc chọn tệp qua cửa sổ chọn của Google, thay vì tải về máy rồi tải lên lại | Kapwing, VEED | P2 | M | |
| F68 | Ước tính trước khi chạy | Trước khi bấm "Phân tích" hiện "~12 phút xử lý, trừ 90 phút hạn mức, còn lại 410 phút" | Opus Clip (hiện số credit) | P1 | S | |
| F69 | Báo xong khi đang ở tab khác | Tiêu đề tab hiện `[45%] AutoCut`. Xong thì có thông báo của trình duyệt, bấm vào là mở đúng video | Descript, Riverside | P1 | S | |
| F70 | Hiện vị trí trong hàng đợi | "Bạn đang xếp thứ 3, dự kiến bắt đầu sau 4 phút". Có nút huỷ | Opus Clip | P2 | S | |

## D. Biên tập tiện lợi

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F71 | Tìm & thay thế trong transcript | Ctrl+F / Ctrl+H trong transcript, thay một chỗ hoặc thay tất cả, có tuỳ chọn khớp nguyên từ hoặc bỏ dấu | Descript, Word | P1 | S | |
| F72 | Gạch chân từ đáng ngờ | Những từ AI nghe không chắc (độ tin cậy thấp) được gạch chân. Rê chuột vào là thấy gợi ý từ đúng | Descript, Otter.ai | P2 | M | |
| F73 | Điều khiển phát đầy đủ | Tốc độ 0.5–2x, lặp lại một đoạn, toàn màn hình, xem nổi khi chuyển tab (Picture-in-Picture), phím ←/→ để lùi/tiến 5 giây | YouTube, Panopto | P1 | S | |
| F74 | Đánh dấu & ghi chú riêng | Bấm M để đặt mốc ở giây hiện tại, kèm ghi chú riêng. Khác bình luận chung ở F35 | Frame.io, Panopto Bookmarks | P2 | S | |
| F75 | Xem trước clip không cần render | Bấm "Xem thử" là phát liền mạch các đoạn của một clip, tự nhảy qua phần bị cắt, không phải đợi FFmpeg | Descript | P1 | M | |
| F76 | So sánh trước/sau | Nút bật/tắt để nghe bản gốc và bản đã cắt từ đệm / khoảng lặng (F25) | Descript Studio Sound | P2 | S | |
| F77 | Kiểu phụ đề làm sẵn | Chọn kiểu phụ đề có sẵn (font có đủ dấu tiếng Việt, màu, viền, vị trí), xem trước ngay trên video | CapCut, Opus Clip | P2 | M | |

## E. Giao diện & khả năng tiếp cận

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F78 | Chế độ sáng / tối | Tự theo cài đặt máy, hoặc tự chọn và được nhớ lại | Hầu hết SaaS | P2 | S | |
| F79 | Dùng được trên điện thoại | Trên điện thoại xem video, duyệt, bình luận và phê duyệt được. Việc biên tập vẫn cần máy tính | Frame.io, Loom | P1 | M | |
| F80 | Hỗ trợ người khuyết tật (WCAG 2.1 AA) | Dùng được hoàn toàn bằng bàn phím, đọc được bằng trình đọc màn hình, đủ độ tương phản, trình phát có phụ đề | Panopto (công bố đạt WCAG 2.1 AA) | P1 | M | |
| F81 | Song ngữ Việt / Anh | Đổi ngôn ngữ giao diện, phục vụ giảng viên nước ngoài và chương trình liên kết quốc tế | Panopto, Kaltura | P2 | M | |
| F82 | Định dạng kiểu Việt Nam | Ngày `18/11/2026`, giờ 24h, số `1.234,5`, múi giờ Việt Nam, "3 phút trước" | — | P1 | S | |
| F83 | Phản hồi tức thì & chống lỡ tay | Khung xám trong lúc tải (skeleton); thông báo kèm nút "Hoàn tác" sau khi xoá; hộp xác nhận cho thao tác nguy hiểm | Gmail ("Hoàn tác"), Linear | P1 | S | |
| F84 | Trang lỗi thân thiện + báo mất mạng | Trang 404/500/bảo trì bằng tiếng Việt, có nút quay lại. Mất mạng thì hiện banner "Đang mất kết nối, thay đổi sẽ được lưu khi có mạng" | — | P1 | S | |

## F. Tài khoản & bảo mật cá nhân

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F85 | Quên mật khẩu, xác minh email | Đặt lại mật khẩu qua email; tài khoản mới phải xác minh email; đổi email phải xác nhận cả hai địa chỉ. F01 còn để ngỏ mục này | Chuẩn chung | **P0** | S | |
| F86 | Xác thực 2 lớp | Bật xác thực 2 lớp bằng app Google Authenticator, có 10 mã dự phòng. Admin có thể bắt buộc bật. F01 đã để mục này ngoài phạm vi | Chuẩn chung | P1 | M | |
| F87 | Quản lý thiết bị đăng nhập | Xem danh sách thiết bị đang đăng nhập, đăng xuất từ xa. Có email cảnh báo khi đăng nhập từ thiết bị lạ | Google, Facebook | P1 | S | |
| F88 | Tuỳ chọn cá nhân | Lưu bộ cấu hình mặc định, định dạng xuất, ngôn ngữ phụ đề, tự phát clip kế tiếp | Descript | P2 | S | |
| F89 | Đăng nhập bằng Zalo | Thêm nút "Đăng nhập bằng Zalo" bên cạnh Google/Microsoft (F03) | Phổ biến ở web Việt Nam | P2 | M | |

## G. Pháp lý & niềm tin (theo luật Việt Nam)

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F90 | Điều khoản, chính sách & ghi nhận đồng ý | Có trang Điều khoản và Chính sách quyền riêng tư. Khi đăng ký phải tick đồng ý; hệ thống lưu lại ai đồng ý phiên bản nào, lúc nào. Khi chính sách đổi thì hỏi lại | Luật BVDLCN 91/2025/QH15 và NĐ 356/2025 (hiệu lực 01/01/2026) | **P0** | M | |
| F91 | Tự tải dữ liệu & tự xoá tài khoản | Một nút tải toàn bộ dữ liệu của mình (ZIP gồm JSON và video). Một nút xoá tài khoản, có 7 ngày để đổi ý | Luật BVDLCN (quyền xoá dữ liệu), GDPR | P1 | M | |
| F92 | Minh bạch dữ liệu gửi ra nước ngoài | Ghi rõ giọng nói và transcript được gửi tới máy chủ AI nước ngoài nào (Groq, Gemini…). Admin chọn nhà cung cấp được phép dùng. Đi kèm hồ sơ đánh giá tác động khi chuyển dữ liệu ra nước ngoài | Luật BVDLCN (đánh giá tác động chuyển dữ liệu ra nước ngoài) | **P0** | S | |
| F93 | Chống tải lậu bài giảng | Tuỳ chọn chặn tải về, gắn watermark mờ ghi email người đang xem, chỉ cho nhúng ở tên miền của trường | Vimeo, Kaltura | P2 | M | |

## H. Thanh toán Việt Nam (bổ sung cho F49)

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F94 | Thanh toán bằng mã VietQR | Quét mã VietQR bằng app ngân hàng bất kỳ; gói được kích hoạt tự động khi tiền về, không cần chuyển khoản rồi chụp màn hình gửi admin | NAPAS VietQR, các cổng thanh toán Việt Nam | P1 | M | |
| F95 | Hoá đơn điện tử & lịch sử thanh toán | Sau khi thanh toán tự xuất hoá đơn VAT điện tử về email. Có trang lịch sử thanh toán để tải lại hoá đơn | Yêu cầu của bộ phận kế toán ở trường và doanh nghiệp | P1 | M | |
| F96 | Dùng thử, mã giảm giá, giới thiệu bạn | 14 ngày dùng thử, mã giảm giá cho đợt khuyến mãi, giới thiệu đồng nghiệp thì được thêm phút xử lý | Opus Clip, Descript | P2 | S | |
| F97 | Gói cho trường / khoa | Mua theo số tài khoản, thanh toán theo hợp đồng, một hoá đơn cho cả đơn vị, admin trường tự phân tài khoản | Panopto, Kaltura (bán theo trường) | P2 | M | |

## I. Quản trị

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F98 | Quản lý người dùng | Admin mời hàng loạt bằng tệp CSV, khoá/mở tài khoản, gửi link đặt lại mật khẩu, đăng nhập hộ người dùng để hỗ trợ (có ghi nhật ký F08) | Google Workspace Admin | P1 | M | |
| F99 | Cài đặt hệ thống trên giao diện | Bật/tắt tính năng, chọn model AI mặc định, gửi thông báo toàn hệ thống, không cần sửa `config.yaml` rồi khởi động lại | Kaltura Admin | P2 | M | |
| F100 | Báo cáo Excel cho khoa / trường | Xuất báo cáo số bài giảng và số giờ đã xử lý theo giảng viên, theo tháng, đúng mẫu báo cáo | — | P2 | S | |

## J. Lắng nghe người dùng

| Mã | Tính năng | Người dùng thấy gì | Tham khảo | Ưu tiên | Cỡ | Duyệt |
|---|---|---|---|---|---|---|
| F101 | Chấm điểm kết quả AI | Nút 👍/👎 cho từng lần AI phân đoạn hoặc đặt tiêu đề, kèm lý do. Có khảo sát 1 câu sau lần xuất thứ 3 | ChatGPT, Descript | P1 | S | |
| F102 | Thống kê sử dụng ẩn danh | Đội phát triển biết tính năng nào được dùng, người dùng hay bỏ dở ở bước nào. Dữ liệu tự lưu trữ, không gửi bên thứ ba, người dùng tắt được | PostHog tự lưu trữ, Plausible | P2 | M | |
| F103 | Cài như ứng dụng (PWA) | "Thêm vào màn hình chính" trên máy tính hoặc điện thoại; mở như một app riêng, có biểu tượng và nhận thông báo | Figma, Canva | P2 | S | |

---

## Gợi ý chọn nhanh

**Bắt buộc (P0, 3 mục):** F85, F90, F92. Thiếu ba mục này thì không nên mở cho người ngoài nhóm dùng: luật bảo vệ dữ liệu cá nhân đã có hiệu lực từ 01/01/2026, và AutoCut đang gửi giọng nói của giảng viên tới máy chủ AI ở nước ngoài.

**Làm nhanh, hiệu quả cao (cỡ S, P1, 13 mục, khoảng 3–4 tuần cho 1 người):**
F51, F52, F55, F60, F62, F66, F68, F69, F71, F73, F82, F83, F84.

**Cần làm cùng tính năng khác:**
- F94 và F95 phụ thuộc F49.
- F62 phụ thuộc F17.
- F98 phụ thuộc F01, F02 và F08.
- F75 nên làm cùng F32.
