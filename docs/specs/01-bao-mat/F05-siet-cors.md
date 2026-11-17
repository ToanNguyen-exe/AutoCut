# F05 — Siết CORS theo môi trường

| Mục | Giá trị |
|---|---|
| **Mã** | F05 |
| **Nhóm** | Bảo mật |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 |
| **Phụ thuộc** | Không. Nên xong trước hoặc cùng F01 vì refresh cookie cần `allowCredentials` với origin cụ thể |
| **Ước lượng** | S (≤ 1 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | MDN "CORS"; tài liệu Spring "CORS with Spring Security" |

## 1. Bối cảnh & vấn đề
*CORS* là cơ chế trình duyệt dùng để quyết định trang web ở tên miền A có được gọi API ở tên miền B hay không.

[WebConfig.java:12-16](../../../backend/src/main/java/com/autocut/config/WebConfig.java#L12-L16) đang để:
```java
.allowedOriginPatterns("*")
.allowCredentials(true)
```
Tổ hợp này nghĩa là **bất kỳ trang web nào** người dùng đang mở cũng gọi được API AutoCut **kèm cookie đăng nhập** và đọc được kết quả. Khi F01 dùng cookie refresh token, một trang độc hại có thể lấy access token của nạn nhân. Commit `e883169` ("allow wildcard cors origins") cho thấy thiết lập này được thêm để chữa cháy lúc dev.

## 2. Mục tiêu
- Danh sách origin được phép đọc từ cấu hình `AUTOCUT_CORS_ALLOWED_ORIGINS`, cách nhau bằng dấu phẩy.
- Dev mặc định chỉ cho `http://localhost:3000` (Next.js dev).
- Môi trường prod bắt buộc khai báo; không có giá trị mặc định là `*`.
- Cấu hình CORS đặt **trong Spring Security** (sau F01) để preflight `OPTIONS` không bị chặn bởi xác thực.

### Ngoài phạm vi
- CSP và các header bảo mật khác (có thể làm chung PR nhưng không bắt buộc).
- Cho phép nhúng iframe công khai (xem F40, sẽ có cấu hình riêng cho `/embed/**`).

## 3. User stories
- Là người vận hành, tôi muốn chỉ frontend chính thức (`https://autocut.truong.edu.vn`) gọi được API.
- Là dev, tôi chạy `npm run dev` và `mvnw spring-boot:run` trên máy mà không phải cấu hình gì thêm.

## 4. Yêu cầu chức năng
- **FR-1** Đọc `AUTOCUT_CORS_ALLOWED_ORIGINS` qua `ConfigService.getEnv`. Mặc định ở profile `dev` là `http://localhost:3000,http://127.0.0.1:3000`.
- **FR-2** Ở profile `prod`, giá trị trống hoặc chứa `*` thì **không khởi động** và log lỗi rõ ràng.
- **FR-3** Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Headers cho phép: `Authorization, Content-Type, X-Requested-With, Idempotency-Key`. Exposed headers: `Content-Disposition` (để frontend đọc tên tệp tải về), `X-Request-Id`.
- **FR-4** `allowCredentials(true)` chỉ đi kèm danh sách origin cụ thể, không dùng pattern.
- **FR-5** `maxAge = 3600` giây để giảm số lần gọi preflight.
- **FR-6** Request từ origin lạ: không trả header `Access-Control-Allow-Origin`. Trình duyệt tự chặn; máy chủ không cần trả lỗi riêng.

## 5. Yêu cầu phi chức năng
- Đổi danh sách origin chỉ cần sửa biến môi trường và khởi động lại, không cần build lại.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không đổi.

### 6.2 API
Không có endpoint mới. Header phản hồi mẫu cho origin hợp lệ:
```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Credentials: true
Vary: Origin
```

### 6.3 Backend
- **Trước F01:** sửa `WebConfig.addCorsMappings` để dùng `allowedOrigins(list)` lấy từ cấu hình.
- **Sau F01:** xoá `WebConfig.addCorsMappings` và tạo bean `CorsConfigurationSource` trong `SecurityConfig`, gắn bằng `http.cors(Customizer.withDefaults())`. Chỉ giữ **một** nơi cấu hình để tránh hai lớp CORS chồng nhau.
- Tạo `CorsProperties` (record) có hàm `static CorsProperties from(ConfigService, Environment)` để kiểm tra FR-2.
- Thêm vào `.env.example`:
  ```
  # Danh sách origin frontend, cách nhau dấu phẩy. KHÔNG dùng *
  AUTOCUT_CORS_ALLOWED_ORIGINS=http://localhost:3000
  ```

### 6.5 Frontend
- Không đổi code. Lưu ý trong README frontend: nếu đổi cổng dev thì cập nhật biến môi trường backend.
- Phương án thay thế (câu hỏi mở): dùng `rewrites` trong [next.config.mjs](../../../frontend/next.config.mjs) để proxy `/api/*` sang backend. Khi đó cùng origin và gần như không cần CORS.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* `ALLOWED=http://localhost:3000` *When* gửi preflight `OPTIONS /api/video/list` với `Origin: http://localhost:3000` *Then* nhận 200 có `Access-Control-Allow-Origin: http://localhost:3000`.
- **AC-2** — *When* cùng request đó với `Origin: https://evil.com` *Then* response **không** có header `Access-Control-Allow-Origin`.
- **AC-3** — *Given* profile `prod` và `ALLOWED=*` *When* khởi động *Then* ứng dụng dừng, log có `AUTOCUT_CORS_ALLOWED_ORIGINS không được chứa '*'`.
- **AC-4** — *Given* profile `dev` không đặt biến *When* chạy frontend ở cổng 3000 *Then* Studio hoạt động bình thường.
- **AC-5** — Preflight không cần JWT (không bị 401).

## 8. Kế hoạch kiểm thử (TDD)
- `CorsPropertiesTest`: `prod_wildcard_throws`, `prod_empty_throws`, `dev_default_localhost3000`, `parsesCommaSeparatedAndTrims`.
- `CorsIT` (MockMvc): AC 1, 2, 5.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Quên thêm tên miền prod | Frontend không gọi được API, trắng màn hình | Healthcheck lúc deploy gọi API thật từ tên miền frontend |
| Còn sót `@CrossOrigin("*")` ở controller | Vượt qua cấu hình chung | `grep -rn "@CrossOrigin" backend/src` phải không ra kết quả |
| Dev mở bằng IP LAN để test trên điện thoại | Bị chặn | Thêm IP vào biến môi trường lúc dev; ghi chú trong README |

## 10. Câu hỏi mở
- [ ] Dùng proxy Next.js `rewrites` (cùng origin) hay giữ hai origin và CORS? Proxy đơn giản hơn cho cookie nhưng upload 5 GB qua Next.js server là không nên.
- [ ] Tên miền prod chính thức là gì?
