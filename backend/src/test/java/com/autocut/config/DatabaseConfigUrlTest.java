package com.autocut.config;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Kiểm tra hàm thuần chuyển DATABASE_URL -> JDBC URL.
 *
 * <p>Không cần database thật, không cần Spring context: đây chính là lý do
 * toJdbcUrl được tách thành static method. 4 nhóm trường hợp dưới đây là 4
 * lỗi thật đã từng xảy ra khi cấu hình sai.
 */
class DatabaseConfigUrlTest {

    @Test
    @DisplayName("Neon: đổi scheme và thêm sslmode=require")
    void neonUrl() {
        String jdbc = DatabaseConfig.toJdbcUrl(
                "postgresql://user:pw@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?channel_binding=require");

        Assertions.assertEquals(
                "jdbc:postgresql://ep-cool-name-123456.ap-southeast-1.aws.neon.tech:5432/neondb"
                        + "?channel_binding=require&sslmode=require",
                jdbc);
    }

    @Test
    @DisplayName("Postgres local: KHÔNG thêm sslmode (server không có TLS)")
    void localUrlNoSsl() {
        String jdbc = DatabaseConfig.toJdbcUrl("postgresql://postgres:pw@localhost:5432/autocut");
        Assertions.assertEquals("jdbc:postgresql://localhost:5432/autocut", jdbc);
        Assertions.assertFalse(jdbc.contains("sslmode"), "localhost không được có sslmode");
    }

    @Test
    @DisplayName("127.0.0.1 và service docker 'postgres': cũng không thêm sslmode")
    void loopbackAndDockerServiceNoSsl() {
        Assertions.assertFalse(DatabaseConfig.toJdbcUrl("postgres://u:p@127.0.0.1/db").contains("sslmode"));
        Assertions.assertFalse(DatabaseConfig.toJdbcUrl("postgres://u:p@postgres:5432/db").contains("sslmode"));
    }

    @Test
    @DisplayName("Đã khai báo sslmode tường minh: tôn trọng, không ghi đè")
    void explicitSslModePreserved() {
        String jdbc = DatabaseConfig.toJdbcUrl("postgresql://u:p@db.example.com/app?sslmode=verify-full");
        Assertions.assertTrue(jdbc.contains("sslmode=verify-full"));
        Assertions.assertFalse(jdbc.contains("sslmode=require"), "không được thêm sslmode thứ hai");
        Assertions.assertEquals(1, countOccurrences(jdbc, "sslmode="), "sslmode chỉ được xuất hiện một lần");
    }

    @Test
    @DisplayName("Đã là JDBC URL: chỉ bổ sung sslmode khi đích đến cần")
    void alreadyJdbc() {
        Assertions.assertEquals(
                "jdbc:postgresql://ep-x.neon.tech:5432/db?sslmode=require",
                DatabaseConfig.toJdbcUrl("jdbc:postgresql://ep-x.neon.tech:5432/db"));

        Assertions.assertEquals(
                "jdbc:postgresql://localhost:5432/db",
                DatabaseConfig.toJdbcUrl("jdbc:postgresql://localhost:5432/db"));
    }

    @Test
    @DisplayName("Thiếu cổng: mặc định 5432")
    void defaultPort() {
        Assertions.assertTrue(
                DatabaseConfig.toJdbcUrl("postgres://u:p@db.example.com/app").contains(":5432/"));
    }

    @Test
    @DisplayName("Chuỗi rỗng hoặc scheme lạ: ném lỗi rõ ràng, không đoán mò")
    void rejectsInvalid() {
        Assertions.assertThrows(IllegalArgumentException.class, () -> DatabaseConfig.toJdbcUrl(null));
        Assertions.assertThrows(IllegalArgumentException.class, () -> DatabaseConfig.toJdbcUrl("  "));
        Assertions.assertThrows(IllegalArgumentException.class, () -> DatabaseConfig.toJdbcUrl("mysql://u:p@host/db"));
    }

    @Test
    @DisplayName("Log không được lộ mật khẩu")
    void maskHidesPassword() {
        // maskUrl là private; kiểm tra gián tiếp qua message lỗi của url sai scheme
        IllegalArgumentException ex = Assertions.assertThrows(IllegalArgumentException.class,
                () -> DatabaseConfig.toJdbcUrl("mysql://user:supersecret@host/db"));
        Assertions.assertFalse(ex.getMessage().contains("supersecret"),
                "thông báo lỗi không được chứa mật khẩu: " + ex.getMessage());
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0, idx = 0;
        while ((idx = haystack.indexOf(needle, idx)) != -1) {
            count++;
            idx += needle.length();
        }
        return count;
    }
}
