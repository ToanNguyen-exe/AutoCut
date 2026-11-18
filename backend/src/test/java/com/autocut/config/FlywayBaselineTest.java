package com.autocut.config;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * F13 — Chứng minh chuỗi migration tự dựng được schema từ số 0.
 *
 * <p>Đây là điều quan trọng nhất của F13: một người mới clone repo, không có
 * database nào, chạy ứng dụng lên là có schema đúng. Không cần ai gửi file
 * dump, không cần hỏi "bảng này tạo thế nào".
 *
 * <p>Test dùng H2 in-memory chứ không phải Neon — và tự tạo DataSource riêng,
 * không lấy từ Spring context. Nhờ vậy nó chạy được trên máy không có Docker
 * và tuyệt đối không đụng database thật.
 */
class FlywayBaselineTest {

    private static DataSource freshDb(String name) {
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName("org.h2.Driver");
        ds.setUrl("jdbc:h2:mem:" + name + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE");
        ds.setUsername("sa");
        ds.setPassword("");
        return ds;
    }

    private static Flyway flyway(DataSource ds) {
        return Flyway.configure()
                .dataSource(ds)
                .locations("classpath:db/migration")
                .baselineOnMigrate(false)
                .cleanDisabled(true)
                .load();
    }

    @Test
    @DisplayName("DB rỗng: V1 chạy thật và tạo đủ 6 bảng")
    void baselineCreatesAllTables() throws Exception {
        DataSource ds = freshDb("f13_baseline");

        MigrateResult result = flyway(ds).migrate();

        Assertions.assertTrue(result.success, "Migration phải thành công");
        Assertions.assertEquals(1, result.migrationsExecuted,
                "DB rỗng phải chạy đúng 1 migration (V1), không phải baseline");

        List<String> tables = new ArrayList<>();
        try (Connection c = ds.getConnection(); Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                     "SELECT table_name FROM information_schema.tables "
                             + "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")) {
            while (rs.next()) tables.add(rs.getString(1).toLowerCase());
        }

        for (String expected : List.of("users", "videos", "transcripts", "sections", "topics", "video_parts")) {
            Assertions.assertTrue(tables.contains(expected), "Thiếu bảng: " + expected + " — có: " + tables);
        }
    }

    @Test
    @DisplayName("Chạy lại lần hai: không làm gì, không lỗi (idempotent)")
    void runningTwiceIsNoOp() {
        DataSource ds = freshDb("f13_twice");
        Flyway f = flyway(ds);

        f.migrate();
        MigrateResult second = f.migrate();

        Assertions.assertEquals(0, second.migrationsExecuted, "Lần hai không được chạy lại V1");
    }

    @Test
    @DisplayName("DB đã có bảng nhưng chưa có flyway_schema_history: baseline, không chạy V1")
    void baselinesExistingDatabase() throws Exception {
        DataSource ds = freshDb("f13_existing");

        // Giả lập Neon hiện tại: bảng đã tồn tại do ddl-auto=update dựng trước đó
        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE users (id BIGINT PRIMARY KEY, email VARCHAR(255))");
        }

        Flyway f = Flyway.configure()
                .dataSource(ds)
                .locations("classpath:db/migration")
                .baselineOnMigrate(true)
                .baselineVersion("1")
                .cleanDisabled(true)
                .load();

        MigrateResult result = f.migrate();

        Assertions.assertEquals(0, result.migrationsExecuted,
                "DB đã có bảng: phải baseline V1, không chạy lại (nếu chạy sẽ lỗi 'table already exists')");

        MigrationInfo[] applied = f.info().applied();
        Assertions.assertEquals(1, applied.length, "Phải có đúng 1 mục trong lịch sử");
        Assertions.assertEquals("1", applied[0].getVersion().getVersion());
        Assertions.assertEquals("BASELINE", applied[0].getType().name());
    }

    @Test
    @DisplayName("V1 tạo đúng ràng buộc: CHECK thời gian, UNIQUE part_no")
    void constraintsAreInPlace() throws Exception {
        DataSource ds = freshDb("f13_constraints");
        flyway(ds).migrate();

        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            // chk_topic_time phải chặn end_time <= start_time
            s.execute("INSERT INTO videos (file_name, file_size, sha256_hash, r2_key) "
                    + "VALUES ('v.mp4', 100, 'hash1', 'k/1')");
            ResultSet rs = s.executeQuery("SELECT id FROM videos");
            Assertions.assertTrue(rs.next());
            long vid = rs.getLong(1);

            s.execute("INSERT INTO sections (video_id, section_no, label) VALUES (" + vid + ", 1, 'S')");
            rs = s.executeQuery("SELECT id FROM sections");
            rs.next();
            long sec = rs.getLong(1);

            Assertions.assertThrows(Exception.class, () -> s.execute(
                    "INSERT INTO topics (section_id, topic_no, title, slug, start_id, end_id, start_time, end_time) "
                            + "VALUES (" + sec + ", 1, 'T', 't', 'S1', 'S2', 100.0, 50.0)"),
                    "CHECK (end_time > start_time) phải chặn end_time nhỏ hơn start_time");
        }
    }

    @Test
    @DisplayName("videos: DEFAULT hoạt động, cloud_url cho phép NULL")
    void videoDefaultsAndNullableCloudUrl() throws Exception {
        DataSource ds = freshDb("f13_defaults");
        flyway(ds).migrate();

        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            s.execute("INSERT INTO videos (file_name, file_size, sha256_hash, r2_key) "
                    + "VALUES ('v.mp4', 100, 'h2', 'k/2')");

            ResultSet rs = s.executeQuery(
                    "SELECT status, reviewed, created_at, updated_at, cloud_url FROM videos");
            Assertions.assertTrue(rs.next());

            Assertions.assertEquals("UPLOADED", rs.getString("status"),
                    "status phải có DEFAULT 'UPLOADED' — không truyền cột này vẫn phải insert được");
            Assertions.assertFalse(rs.getBoolean("reviewed"), "reviewed phải DEFAULT FALSE");
            Assertions.assertNotNull(rs.getTimestamp("created_at"), "created_at phải DEFAULT NOW()");
            Assertions.assertNotNull(rs.getTimestamp("updated_at"), "updated_at phải DEFAULT NOW()");
            Assertions.assertNull(rs.getString("cloud_url"),
                    "cloud_url phải cho phép NULL (AD-3: chỉ cần r2_key)");
        }
    }
}
