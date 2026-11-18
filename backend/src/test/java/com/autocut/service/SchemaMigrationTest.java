package com.autocut.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * F13 — Schema phải do Flyway dựng, không do schema.sql chạy tay.
 *
 * <p>Trước đây test này đọc {@code database/schema.sql} rồi {@code stmt.execute(sql)}
 * lên DataSource. Cách đó có ba vấn đề:
 * <ul>
 *   <li>Chạy vào đâu cũng được — kể cả Neon production, vì không có gì chặn;</li>
 *   <li>schema.sql đã lệch DB thật (khai NOT NULL sai ở file_size/r2_key/cloud_url);</li>
 *   <li>Chạy lại nhiều lần tích luỹ thay đổi, không có lịch sử.</li>
 * </ul>
 *
 * <p>Nay Flyway là thẩm quyền duy nhất. Test kiểm tra đúng điều đó: schema tồn tại
 * là do migration, và lịch sử migration ghi nhận rõ ràng.
 */
@SpringBootTest
class SchemaMigrationTest {

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("Schema do Flyway dựng, có lịch sử migration đầy đủ")
    void schemaIsManagedByFlyway() throws Exception {
        Assertions.assertNotNull(dataSource, "DataSource không được null");

        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            // 1. Đủ 6 bảng nghiệp vụ
            List<String> tables = new ArrayList<>();
            try (ResultSet rs = stmt.executeQuery(
                    "SELECT table_name FROM information_schema.tables "
                            + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")) {
                while (rs.next()) tables.add(rs.getString("table_name").toLowerCase());
            }

            for (String expected : List.of("users", "videos", "transcripts", "sections", "topics", "video_parts")) {
                Assertions.assertTrue(tables.contains(expected), "Thiếu bảng: " + expected + " — có: " + tables);
            }

            // 2. Có lịch sử Flyway, tức schema được dựng có kiểm soát
            Assertions.assertTrue(tables.contains("flyway_schema_history"),
                    "Thiếu flyway_schema_history: schema không do Flyway quản lý");

            try (ResultSet rs = stmt.executeQuery(
                    "SELECT version, type, success FROM flyway_schema_history "
                            + "WHERE version IS NOT NULL ORDER BY installed_rank")) {
                Assertions.assertTrue(rs.next(), "Lịch sử Flyway rỗng: chưa migration nào chạy");
                Assertions.assertEquals("1", rs.getString("version"));
                Assertions.assertTrue(rs.getBoolean("success"), "Migration V1 phải thành công");
            }
        }
    }

    @Test
    @DisplayName("Hibernate validate khớp schema: nếu lệch, context đã không khởi động được")
    void hibernateMappingMatchesSchema() {
        // Test này không cần thân hàm: nếu entity khai kiểu cột khác DB thì
        // ddl-auto=validate đã ném SchemaManagementException lúc dựng context,
        // và test sẽ đỏ ngay ở bước nạp ApplicationContext.
        //
        // Giá trị của nó là chốt chặn: đổi kiểu cột trong entity mà quên viết
        // migration thì test này đỏ trước khi lên production.
        Assertions.assertTrue(true, "Context khởi động được nghĩa là validate đã qua");
    }
}
