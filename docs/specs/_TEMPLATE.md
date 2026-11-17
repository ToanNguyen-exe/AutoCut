# F<NN> — <Tên tính năng>

| Mục | Giá trị |
|---|---|
| **Mã** | F<NN> |
| **Nhóm** | <Bảo mật / Hạ tầng / AI / Biên tập / Xuất bản / Vận hành> |
| **Ưu tiên** | P0 / P1 / P2 |
| **Người phụ trách gợi ý** | SV1 (Video/FFmpeg) · SV2 (AI) · SV3 (Core API/DB) · SV4 (Web Studio & QA) |
| **Phụ thuộc** | F.., F.. (phải xong trước) |
| **Ước lượng** | S (≤2 ngày) / M (3–5 ngày) / L (1–2 tuần) / XL (>2 tuần) |
| **Thư viện mới cần duyệt** | Không / <tên + lý do> (theo CONSTRAINTS.md §3, phải trưởng nhóm duyệt trước khi cài) |
| **Tham khảo** | <Hệ thống tham khảo, ví dụ Descript, Panopto> |

## 1. Bối cảnh & vấn đề
Hiện trạng trong code (dẫn tệp:dòng), vì sao cần làm.

## 2. Mục tiêu
- ...

### Ngoài phạm vi
- ...

## 3. User stories
- Là <vai trò>, tôi muốn <hành động> để <lợi ích>.

## 4. Yêu cầu chức năng
- **FR-1** ...
- **FR-2** ...

## 5. Yêu cầu phi chức năng
Hiệu năng, bảo mật, giới hạn, khả năng chịu lỗi.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Migration SQL (Flyway `V<n>__<ten>.sql`, xem F13).

### 6.2 API
| Method | Path | Quyền | Mô tả |
|---|---|---|---|

Request/response mẫu (JSON), mã lỗi.

### 6.3 Backend (Spring Boot)
Lớp/tệp cần tạo hoặc sửa.

### 6.4 AI pipeline (Python) — nếu có
### 6.5 Frontend (Next.js) — nếu có
Màn hình, component, trạng thái loading/lỗi/rỗng. Mọi chữ hiển thị bằng tiếng Việt có dấu.

## 7. Tiêu chí chấp nhận (Acceptance Criteria)
- **AC-1** — *Given* ... *When* ... *Then* ...

## 8. Kế hoạch kiểm thử (TDD)
Danh sách test phải viết **trước** (Red), tên lớp/hàm test gợi ý, loại test (unit / integration / e2e).

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|

## 10. Câu hỏi mở (cần chốt trước khi code)
- [ ] ...
