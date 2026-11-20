package com.autocut.config;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.cors.CorsConfiguration;

/**
 * F05 — Cấu hình CORS.
 *
 * <p>Hiện tại {@code WebConfig} mở {@code allowedOriginPatterns("*")} kèm
 * {@code allowCredentials(true)}: mọi website có thể gọi API kèm cookie của
 * người dùng. Test này chốt luật thay thế, tách khỏi Spring để chạy nhanh.
 */
class CorsSettingsTest {

    @Test
    @DisplayName("AC-4: dev không cấu hình thì mặc định localhost:3000")
    void devDefaultsToLocalhost() {
        CorsConfiguration config = CorsSettings.build(null, true);

        Assertions.assertTrue(config.getAllowedOrigins().contains("http://localhost:3000"));
        Assertions.assertTrue(config.getAllowedOrigins().contains("http://127.0.0.1:3000"));
        Assertions.assertEquals(Boolean.TRUE, config.getAllowCredentials());
    }

    @Test
    @DisplayName("AC-5: production thiếu biến thì không được khởi động")
    void productionWithoutOriginsFailsFast() {
        IllegalStateException loi = Assertions.assertThrows(IllegalStateException.class,
                () -> CorsSettings.build(null, false),
                "Thiếu cấu hình CORS ở production phải làm ứng dụng dừng");

        Assertions.assertTrue(loi.getMessage().contains("AUTOCUT_CORS_ALLOWED_ORIGINS"),
                "Thông báo phải nêu tên biến cần đặt, thực tế: " + loi.getMessage());
    }

    @Test
    @DisplayName("AC-5: production với chuỗi rỗng cũng dừng")
    void productionWithBlankOriginsFailsFast() {
        Assertions.assertThrows(IllegalStateException.class,
                () -> CorsSettings.build("   ", false));
    }

    @Test
    @DisplayName("AC-3: dấu * bị từ chối ở mọi môi trường")
    void wildcardRejectedEverywhere() {
        Assertions.assertThrows(IllegalStateException.class,
                () -> CorsSettings.build("*", true),
                "'*' + allowCredentials là lỗ hổng, phải chặn cả ở dev");
        Assertions.assertThrows(IllegalStateException.class,
                () -> CorsSettings.build("http://localhost:3000,*", false));
    }

    @Test
    @DisplayName("Danh sách origin được tách theo dấu phẩy và cắt khoảng trắng")
    void parsesCommaSeparatedOrigins() {
        CorsConfiguration config = CorsSettings.build(
                " https://autocut.vn , https://studio.autocut.vn ", false);

        Assertions.assertEquals(2, config.getAllowedOrigins().size());
        Assertions.assertTrue(config.getAllowedOrigins().contains("https://autocut.vn"));
        Assertions.assertTrue(config.getAllowedOrigins().contains("https://studio.autocut.vn"));
        Assertions.assertFalse(config.getAllowedOrigins().contains("*"));
    }

    @Test
    @DisplayName("Origin trùng lặp chỉ giữ một lần")
    void deduplicatesOrigins() {
        CorsConfiguration config = CorsSettings.build(
                "http://localhost:3000,http://localhost:3000", true);

        Assertions.assertEquals(1, config.getAllowedOrigins().size());
    }

    @Test
    @DisplayName("Cho phép credentials, giới hạn method và header cần thiết")
    void setsCredentialsMethodsAndHeaders() {
        CorsConfiguration config = CorsSettings.build("https://autocut.vn", false);

        Assertions.assertEquals(Boolean.TRUE, config.getAllowCredentials());
        Assertions.assertTrue(config.getAllowedMethods().contains("GET"));
        Assertions.assertTrue(config.getAllowedMethods().contains("POST"));
        Assertions.assertTrue(config.getAllowedMethods().contains("OPTIONS"));
        Assertions.assertTrue(config.getAllowedHeaders().contains("Content-Type"));
        Assertions.assertTrue(config.getAllowedHeaders().contains("Authorization"));
        Assertions.assertEquals(3600L, config.getMaxAge());
        Assertions.assertTrue(config.getExposedHeaders().contains("Content-Disposition"),
                "Frontend cần đọc tên tệp khi tải clip");
    }
}
