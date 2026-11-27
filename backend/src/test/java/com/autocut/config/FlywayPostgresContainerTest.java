package com.autocut.config;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * F13 để lại một lỗ hổng, F14 vá lại: V1__baseline.sql chỉ mới được chứng minh
 * trên H2.
 *
 * <p>H2 không phải Postgres. Chính vì H2 không hiểu {@code TIMESTAMPTZ} mà V1
 * phải viết {@code TIMESTAMP WITH TIME ZONE} — tức là file migration đang bị
 * ràng buộc bởi công cụ test, chứ không phải bởi database thật. Nếu V1 hỏng trên
 * Postgres (sai kiểu, sai thứ tự khoá ngoại, thiếu extension) thì CI cũ vẫn xanh.
 *
 * <p>Test này chạy V1 trên Postgres 16 thật trong container rồi kiểm tra schema
 * bằng truy vấn hệ thống của Postgres, không qua Hibernate.
 *
 * <p>Gắn {@code @Tag("docker")}: cần Docker, mặc định bị loại khỏi {@code mvn test}.
 */
@Tag("docker")
@Testcontainers(disabledWithoutDocker = true)
class FlywayPostgresContainerTest {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("autocut_test")
                    .withUsername("autocut")
                    .withPassword("autocut");

    @Test
    @DisplayName("V1 chạy được trên Postgres thật và tạo đủ 6 bảng")
    void baselineMigrationCreatesSchema() throws Exception {
        MigrateResult result = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

        // V1__baseline.sql + V202611251030__auth.sql (F01)
        Assertions.assertEquals(2, result.migrationsExecuted,
                "Migration phải áp đủ 2 migration (V1 + V2 auth) trên schema rỗng");

        try (Connection conn = connect()) {
            List<String> tables = listTables(conn);
            for (String expected : List.of("videos", "topics", "sections",
                    "video_parts", "transcripts", "users", "refresh_tokens", "auth_tickets")) {
                Assertions.assertTrue(tables.contains(expected),
                        "Thiếu bảng " + expected + " — danh sách thật: " + tables);
            }
        }
    }

    @Test
    @DisplayName("Cột thời gian là timestamptz, không phải timestamp")
    void timestampColumnsAreTimezoneAware() throws Exception {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

        try (Connection conn = connect();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT column_name, data_type FROM information_schema.columns "
                             + "WHERE table_name = 'videos' "
                             + "AND column_name IN ('created_at', 'updated_at')")) {

            List<String> found = new ArrayList<>();
            while (rs.next()) {
                found.add(rs.getString("column_name") + "=" + rs.getString("data_type"));
            }

            Assertions.assertEquals(2, found.size(), "Phải có cả created_at và updated_at");
            for (String pair : found) {
                Assertions.assertTrue(pair.endsWith("with time zone"),
                        "Cột thời gian phải là timestamptz, nhận được: " + pair);
            }
        }
    }

    @Test
    @DisplayName("sha256_hash vẫn là UNIQUE trên Postgres thật")
    void sha256HashStaysUnique() throws Exception {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

        try (Connection conn = connect()) {
            Assertions.assertTrue(insertTwiceBlocksDuplicate(conn),
                    "Chèn hai video cùng sha256_hash phải bị chặn bởi ràng buộc UNIQUE");
        }
    }

    // --------------------------------------------------------------- tiện ích

    private static Connection connect() throws Exception {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static List<String> listTables(Connection conn) throws Exception {
        List<String> tables = new ArrayList<>();
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT table_name FROM information_schema.tables "
                             + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")) {
            while (rs.next()) {
                tables.add(rs.getString("table_name"));
            }
        }
        return tables;
    }

    /**
     * Chèn 2 dòng trùng sha256_hash.
     *
     * @return true nếu lần chèn thứ hai bị database chặn
     */
    private static boolean insertTwiceBlocksDuplicate(Connection conn) throws Exception {
        // Cột theo đúng V1__baseline.sql: file_name, file_size, sha256_hash, r2_key.
        String sql = "INSERT INTO videos (file_name, file_size, sha256_hash, r2_key) "
                + "VALUES (?, 1, ?, ?)";

        try (var ps = conn.prepareStatement(sql)) {
            ps.setString(1, "a.mp4");
            ps.setString(2, "deadbeef");
            ps.setString(3, "autocut/a.mp4");
            ps.executeUpdate();
        }

        try (var ps = conn.prepareStatement(sql)) {
            ps.setString(1, "b.mp4");
            ps.setString(2, "deadbeef");
            ps.setString(3, "autocut/b.mp4");
            ps.executeUpdate();
            return false;
        } catch (java.sql.SQLException e) {
            return true;
        }
    }
}
