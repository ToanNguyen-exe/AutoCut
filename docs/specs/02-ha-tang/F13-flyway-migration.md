# F13 — Quản lý migration bằng Flyway

| Mục | Giá trị |
|---|---|
| **Mã** | F13 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0. **Làm đầu tiên**, vì mọi spec có thay đổi bảng đều dựa vào nó. |
| **Người phụ trách gợi ý** | SV3 |
| **Phụ thuộc** | Không |
| **Ước lượng** | S (≤ 2 ngày) |
| **Thư viện mới cần duyệt** | **Có**: `org.flywaydb:flyway-core` và `org.flywaydb:flyway-database-postgresql` (Spring Boot 4 tách Flyway thành starter riêng `spring-boot-starter-flyway`, dùng starter này thì phiên bản do Boot quản lý). Lý do: chuẩn công nghiệp, tích hợp sẵn với Spring Boot, lưu lịch sử migration trong DB. Phương án thay thế là Liquibase (dài dòng hơn vì dùng XML/YAML). |
| **Tham khảo** | Flyway docs, Spring Boot "Database Initialization", GitLab/Rails migrations |

## 1. Bối cảnh & vấn đề

- Đang có **hai nguồn định nghĩa bảng** cùng lúc:
  1. Hibernate tự sửa bảng: `spring.jpa.hibernate.ddl-auto=update` ([application.properties:13](../../../backend/src/main/resources/application.properties#L13)).
  2. Tệp SQL viết tay [database/schema.sql](../../../database/schema.sql), có cả đoạn "migration" chắp vá bằng `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
  Hai nguồn này có thể lệch nhau. Ví dụ `schema.sql` khai báo `CHECK (end_time > start_time)` cho `topics`, nhưng Hibernate `update` không bao giờ thêm CHECK. `update` cũng **không bao giờ** xoá cột, đổi kiểu hay đổi ràng buộc, nên các cột cũ vẫn tồn tại trong DB.
- [SchemaMigrationTest.java:25-40](../../../backend/src/test/java/com/autocut/service/SchemaMigrationTest.java#L25) đọc `schema.sql` rồi **chạy thẳng lên DB lấy từ `DATABASE_URL`**. Nếu `.env` trên máy lập trình viên trỏ tới Neon production, mỗi lần chạy `mvn test` sẽ chạy DDL lên DB thật. Đây là rủi ro nghiêm trọng.
- [DatabaseConfig.java:30-37](../../../backend/src/main/java/com/autocut/config/DatabaseConfig.java#L30) tự động rơi về H2 in-memory khi thiếu `DATABASE_URL`. Ở production, nếu `.env` bị thiếu, ứng dụng vẫn khởi động và **ghi dữ liệu vào RAM**, khởi động lại là mất sạch mà không ai biết.
- Không có lịch sử: không biết DB production đang ở phiên bản schema nào.
- Hơn 10 spec khác (F09, F10, F11, F16…) cần thêm bảng hoặc cột mới.

## 2. Mục tiêu

- Flyway là **nguồn duy nhất** thay đổi schema. Hibernate chỉ kiểm tra khớp (`ddl-auto=validate`).
- Migration đánh số, chỉ thêm mới, được review như code.
- Test không bao giờ chạm vào DB production.
- Production thiếu `DATABASE_URL` thì ứng dụng **không khởi động** (fail fast, báo lỗi ngay).

### Ngoài phạm vi

- Migration dữ liệu lớn (backfill hàng triệu dòng). Spec nào cần thì tự mô tả.
- Rollback tự động (Flyway bản Community không có `undo`; muốn lùi thì viết migration mới).

## 3. User stories

- Là lập trình viên, tôi muốn kéo code về, chạy backend là DB tự lên đúng phiên bản schema.
- Là trưởng nhóm, tôi muốn xem trong PR chính xác bảng nào bị đổi.
- Là trưởng nhóm, tôi muốn chắc chắn `mvn test` không bao giờ đụng vào DB thật.

## 4. Yêu cầu chức năng

- **FR-1** Thư mục `backend/src/main/resources/db/migration/`. Đặt tên `V<n>__<mo_ta_snake_case>.sql`, `n` tăng dần và không bao giờ dùng lại.
- **FR-2** `V1__baseline.sql` = nội dung `schema.sql` hiện tại, đã dọn sạch: bỏ các đoạn `ALTER ... IF NOT EXISTS`, gộp cột vào `CREATE TABLE`, thêm đúng các index và ràng buộc hiện có.
- **FR-3** Với DB đã có dữ liệu (Neon hiện tại): cấu hình `spring.flyway.baseline-on-migrate=true`, `baseline-version=1`, để Flyway đánh dấu V1 là "đã chạy" mà không chạy lại.
- **FR-4** Đổi `spring.jpa.hibernate.ddl-auto=validate`. Entity lệch với DB thì ứng dụng không khởi động.
- **FR-5** `database/schema.sql` thay bằng một dòng chú thích trỏ tới `db/migration/`. Không giữ hai nguồn.
- **FR-6** Bỏ fallback H2 trong `DatabaseConfig` khi chạy profile `prod`. Profile `dev` vẫn cho dùng H2 nhưng log ở mức WARN, kèm banner rõ ràng.
- **FR-7** Viết lại `SchemaMigrationTest` (không xoá, theo CONSTRAINTS §1): chạy Flyway trên một DB test riêng (biến `TEST_DATABASE_URL`, hoặc Testcontainers nếu được duyệt), rồi kiểm đủ bảng **và** chạy `validate` của Hibernate. Nếu `TEST_DATABASE_URL` trỏ tới host trùng với `DATABASE_URL` thì test **thất bại có chủ đích**, với thông báo rõ ràng.
- **FR-8** Quy tắc trong `CONVENTIONS.md`: không sửa migration đã merge vào `main`; muốn đổi thì viết migration mới. Flyway tự kiểm checksum, nên sửa tệp cũ sẽ làm ứng dụng không khởi động.
- **FR-9** Thay đổi phá vỡ tương thích (đổi tên hoặc xoá cột) phải làm theo 2 bước qua 2 lần release: thêm cột mới → code dùng cột mới → migration sau mới xoá cột cũ.

## 5. Yêu cầu phi chức năng

- Migration chạy lúc khởi động mất ≤ 10 giây khi không có gì mới.
- Migration phải chạy được trên Postgres 15+ (Neon). Không dùng cú pháp riêng của H2.
- Mỗi migration chạy trong 1 transaction (mặc định của Postgres).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V1__baseline.sql` (rút gọn; viết đầy đủ từ `schema.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- cho gen_random_uuid() (F09, F11)

CREATE TABLE users ( ... );            -- như schema.sql
CREATE TABLE videos (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    file_size BIGINT NOT NULL,
    duration DOUBLE PRECISION,
    sha256_hash VARCHAR(64) UNIQUE NOT NULL,
    r2_key VARCHAR(500) NOT NULL,
    cloud_url VARCHAR(500) NOT NULL,
    outline_text TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'UPLOADED',
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- transcripts, sections, topics, video_parts: như schema.sql
-- các index: như schema.sql
```

Trước khi chốt V1 cần chạy lệnh sau trên Neon để so sánh với schema thật (Hibernate có thể đã tạo thêm cột):

```bash
pg_dump --schema-only --no-owner "$DATABASE_URL_UNPOOLED" > /tmp/neon_schema_actual.sql
```

Chỗ nào lệch thì viết `V2__reconcile_existing.sql` để đưa DB thật về đúng V1.

Bảng `flyway_schema_history` do Flyway tự tạo.

**Quy tắc đặt số migration (tránh hai nhánh cùng lấy một số):**

| Phiên bản | Dùng cho |
|---|---|
| `V1__baseline.sql` | F13. Ảnh chụp schema hiện tại |
| `V2__reconcile_existing.sql` | F13, chỉ khi DB thật lệch với V1 |
| `V<yyyyMMddHHmm>__<ten>.sql` | **Mọi spec khác.** Lấy giờ lúc tạo tệp, ví dụ `V202611201430__create_jobs.sql` |

Flyway so sánh số phiên bản theo giá trị số. Số theo dấu thời gian luôn lớn hơn 1 và 2, nên các migration mới chạy sau baseline. Cách này giúp các nhánh làm song song gần như không bao giờ trùng số.

> Trong các spec khác, những tên như `V2__auth.sql` hay `V46__dashboard_stats.sql` **chỉ là tên minh hoạ**. Khi code, đổi sang dạng dấu thời gian.
> Nếu một nhánh merge sau mà có migration mang số nhỏ hơn migration đã chạy trên DB, Flyway sẽ báo lỗi. Khi đó người merge sau đổi lại dấu thời gian (giữ `spring.flyway.out-of-order=false`).

### 6.2 API

Không có API mới. Actuator (F15) sẽ mở `/actuator/flyway` cho Admin.

### 6.3 Backend

- `pom.xml`: thêm `spring-boot-starter-flyway` và `flyway-database-postgresql` (sau khi được duyệt).
- `application.properties`:
  ```properties
  spring.jpa.hibernate.ddl-auto=validate
  spring.flyway.enabled=true
  spring.flyway.locations=classpath:db/migration
  spring.flyway.baseline-on-migrate=true
  spring.flyway.baseline-version=1
  spring.flyway.validate-on-migrate=true
  ```
- Tạo `application-dev.properties` và `application-prod.properties`. Profile `prod` thì `DatabaseConfig` ném `IllegalStateException("Thiếu DATABASE_URL ở môi trường production")`.
- `DatabaseConfig.dataSource()`: tách nhánh H2 thành bean riêng `@Profile("dev")`.
- `SchemaMigrationTest`: viết lại theo FR-7.
- Sửa các entity để khớp đúng với V1 (ví dụ `VideoEntity.reviewed` nullable hay không). Chạy ứng dụng với `validate` sẽ thấy lỗi lệch cụ thể.

### 6.5 Frontend

Không có thay đổi.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* một Postgres rỗng, *When* khởi động backend, *Then* `flyway_schema_history` có dòng V1 `success=true` và đủ 6 bảng.
- **AC-2** — *Given* DB Neon hiện có dữ liệu, *When* khởi động backend lần đầu sau khi merge F13, *Then* Flyway đánh dấu baseline V1, không mất dòng dữ liệu nào (đếm `videos` và `topics` trước và sau bằng nhau).
- **AC-3** — *Given* sửa một trường entity (ví dụ đổi `length` của `file_name`) mà không có migration, *When* khởi động, *Then* ứng dụng dừng với lỗi `Schema-validation`.
- **AC-4** — *Given* `.env` của lập trình viên có `DATABASE_URL` production, *When* chạy `./mvnw test`, *Then* không có câu lệnh nào chạy lên host production (kiểm bằng cách đặt `DATABASE_URL` thành một host không tồn tại: test vẫn qua hoặc bị skip có chủ đích, không bị treo).
- **AC-5** — *Given* profile `prod` và thiếu `DATABASE_URL`, *When* khởi động, *Then* ứng dụng thoát với mã khác 0 và thông báo rõ ràng.
- **AC-6** — *Given* ai đó sửa nội dung `V1__baseline.sql` sau khi đã merge, *When* khởi động, *Then* Flyway báo lỗi checksum.
- **AC-7** — `database/schema.sql` không còn chứa DDL; `CONVENTIONS.md` có mục "Migration".

## 8. Kế hoạch kiểm thử (TDD)

- `SchemaMigrationTest.flywayMigratesEmptyDatabase_toLatest` (viết lại từ test cũ)
- `SchemaMigrationTest.hibernateValidate_passesAfterMigration`
- `SchemaMigrationTest.refusesToRun_whenTestDbEqualsProductionHost`
- `DatabaseConfigTest.prodProfile_missingUrl_failsFast`
- `DatabaseConfigTest.devProfile_missingUrl_usesH2WithWarning`
- Kiểm thủ công trước khi merge: chạy trên **một nhánh Neon copy từ production** (Neon cho tạo branch miễn phí), so sánh số dòng các bảng trước và sau.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| V1 khác với DB thật | `validate` thất bại khi deploy | So sánh `pg_dump` trước; thêm `V2__reconcile_existing.sql` |
| Hai PR cùng dùng một số phiên bản | Flyway báo lỗi trùng phiên bản | Đặt số theo dấu thời gian (6.1); CI kiểm số trùng |
| Migration khoá bảng lớn quá lâu | Ứng dụng đứng khi deploy | Index tạo bằng `CREATE INDEX CONCURRENTLY` trong migration riêng, kèm `-- flyway:executeInTransaction=false` |
| Bỏ H2 làm khó cho lập trình viên mới | Khó chạy thử trên máy | Docker Compose có Postgres (F14) |

## 10. Câu hỏi mở

- [ ] Duyệt thêm thư viện Flyway?
- [ ] Duyệt Testcontainers cho test (cần Docker trên máy dev và CI)? Nếu không thì cần tạo nhánh Neon `test` và biến `TEST_DATABASE_URL`.
- [ ] Ai có quyền deploy migration lên production? Có cần bước duyệt tay không?
