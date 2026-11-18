package com.autocut.config;

import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * F13 — Chứng minh test KHÔNG chạm database production.
 *
 * <p>Đây là test có giá trị cao nhất trong F13. Nếu ai đó sau này vô tình bỏ
 * {@code @Profile("!test")} khỏi DatabaseConfig, test này sẽ đỏ ngay — trước
 * khi có người lỡ chạy {@code mvn test} trên máy có .env thật và xoá sạch Neon.
 *
 * <p>Nguyên lý: test không kiểm tra "đã cấu hình đúng chưa", mà kiểm tra
 * "đường đi tới production có tồn tại không". Đường không tồn tại thì không
 * thể đi nhầm.
 */
@SpringBootTest
@ActiveProfiles("test")
class TestProfileIsolationTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ConfigService configService;

    @Test
    @DisplayName("DataSource của profile test KHÔNG phải bean production")
    void productionDataSourceBeanDoesNotExist() {
        String[] names = context.getBeanNamesForType(DataSource.class);
        for (String name : names) {
            Object bean = context.getBean(name);
            String cls = bean.getClass().getName();
            Assertions.assertFalse(
                    cls.contains("DatabaseConfig"),
                    "Profile test không được nạp DatabaseConfig — bean '" + name + "' là " + cls
                            + ". Nếu thấy lỗi này, @Profile(\"!test\") đã bị bỏ khỏi DatabaseConfig.");
        }
    }

    @Test
    @DisplayName("Không có bean DatabaseConfig trong context")
    void databaseConfigNotLoaded() {
        Assertions.assertTrue(
                context.getBeansOfType(DatabaseConfig.class).isEmpty(),
                "DatabaseConfig phải KHÔNG tồn tại ở profile test — đây là cơ chế cô lập chính");
    }

    @Test
    @DisplayName("DataSource đang dùng là H2 in-memory, không phải Postgres Neon")
    void usesH2InMemory() throws Exception {
        try (Connection c = dataSource.getConnection()) {
            String product = c.getMetaData().getDatabaseProductName();
            String url = c.getMetaData().getURL();

            Assertions.assertEquals("H2", product,
                    "Profile test phải dùng H2, nhận được: " + product + " tại " + url);
            Assertions.assertTrue(url.contains("jdbc:h2:mem:"), "Phải là H2 in-memory: " + url);
            Assertions.assertFalse(url.contains("neon"), "TUYỆT ĐỐI không được trỏ Neon: " + url);
        }
    }

    @Test
    @DisplayName("Dù .env có DATABASE_URL thật, test vẫn chỉ thấy H2")
    void envIsReadButUnused() throws Exception {
        // ConfigService vẫn đọc .env (đó là việc của nó), nhưng DataSource của
        // test không đi qua đó. Chứng minh: nếu .env có URL Neon thì giá trị đó
        // KHÔNG xuất hiện trong DataSource đang dùng.
        String envUrl = null;
        try {
            envUrl = configService.getDotenv().get("DATABASE_URL");
        } catch (Exception ignored) {
            // .env không có cũng không sao — test vẫn phải xanh
        }

        try (Connection c = dataSource.getConnection()) {
            String jdbcUrl = c.getMetaData().getURL();
            if (envUrl != null && !envUrl.isBlank()) {
                String host = envUrl.replaceAll(".*@", "").replaceAll("[:/].*", "");
                Assertions.assertFalse(
                        jdbcUrl.contains(host),
                        "DataSource test đang trỏ tới host trong .env (" + host + "). "
                                + "Cơ chế cô lập đã hỏng — dừng lại và kiểm tra @Profile(\"!test\").");
            }
        }
    }

    @Test
    @DisplayName("Flyway đã chạy thật trên H2: có bảng + lịch sử migration")
    void flywayRanOnTestDatabase() throws Exception {
        try (Connection c = dataSource.getConnection(); Statement s = c.createStatement()) {
            ResultSet rs = s.executeQuery(
                    "SELECT COUNT(*) FROM information_schema.tables "
                            + "WHERE table_schema='public' AND table_type='BASE TABLE'");
            rs.next();
            Assertions.assertTrue(rs.getInt(1) >= 6,
                    "Phải có ít nhất 6 bảng do V1 tạo, thực tế: " + rs.getInt(1));

            // Hàng đầu tiên trong lịch sử luôn là marker "table created": version NULL.
            // Chỉ lấy các bản ghi migration thật (có số version).
            rs = s.executeQuery(
                    "SELECT version, type, success FROM flyway_schema_history "
                            + "WHERE version IS NOT NULL ORDER BY installed_rank");
            Assertions.assertTrue(rs.next(), "Phải có ít nhất một migration thật trong lịch sử");
            Assertions.assertEquals("1", rs.getString("version"));
            Assertions.assertEquals("SQL", rs.getString("type"),
                    "DB rỗng phải chạy V1 thật (type=SQL), không phải đánh dấu baseline");
            Assertions.assertTrue(rs.getBoolean("success"), "Migration V1 phải thành công");
        }
    }
}
