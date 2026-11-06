# AutoCut Engineering Rules & Customizations

Tất cả các hành động lập trình và thay đổi code trong dự án **AutoCut** bắt buộc phải tuân thủ nghiêm ngặt các nguyên tắc sau:

## 1. Constraint-Driven Development (CDD)
- Luôn đọc và tuân thủ [CONSTRAINTS.md](file:///e:/học/học%20java/AutoCut/CONSTRAINTS.md).
- **Cấm tự ý xóa/skip test**: Không được phép xóa, comment, hoặc gắn `@Disabled` / `.skip` để vượt qua lỗi test.
- **Cấm hạ chuẩn**: Không bypass linter/compiler (không dùng `any`, `@SuppressWarnings("all")`, `// @ts-ignore`).
- **Cấm viết quá phạm vi**: Không refactor lan man sang các file ngoài phạm vi yêu cầu hiện tại.

## 2. Ponytail (YAGNI & Tối giản)
- **Ép YAGNI**: Chỉ code đúng những gì cần thiết cho yêu cầu hiện tại.
- **Chặn cài thư viện thừa**: Tận dụng thư viện có sẵn và thư viện chuẩn, không tự ý thêm dependency mới.
- **Cấm dựng abstraction thừa**: Không tạo interface, wrapper, pattern khi chỉ có 1 trường hợp sử dụng duy nhất.
- **Ưu tiên diff ngắn nhất**: Chọn giải pháp can thiệp tối thiểu, sạch sẽ và an toàn nhất.

## 3. Spec-Driven Development (SDD)
- Phải làm rõ yêu cầu/spec và tiêu chí chấp nhận (acceptance criteria) trước khi viết code.
- Tuyệt đối không đoán mò hành vi logic hoặc hợp đồng dữ liệu.

## 4. Incremental Implementation
- Chia nhỏ các thay đổi thành từng bước độc lập, kiểm chứng được.
- Cấm đập đi viết lại nhiều file cùng lúc. Đảm bảo dự án luôn biên dịch và test được sau mỗi bước nhỏ.

## 5. Test-Driven Development (TDD)
- Viết test thất bại (Red) trước khi viết logic thực thi.
- Chỉ viết vừa đủ code để pass test (Green), sau đó mới refactor.
- Chặn mọi đoạn code thừa hoặc không có test kiểm chứng.

## 6. Code Simplification
- Sau khi code đã chạy đúng và pass test, thực hiện rà soát để gọt bỏ code phức tạp, làm phẳng các nhánh lồng nhau (guard clauses), xóa code thừa.

## 7. Doubt-Driven Development
- Luôn đặt câu hỏi phản biện: "Có cách nào đơn giản hơn không?", "Điểm gãy vỡ / failure mode ở đâu?", "Có rủi ro gì khi chạy thực tế?" trước khi bắt tay vào triển khai giải pháp lớn.
