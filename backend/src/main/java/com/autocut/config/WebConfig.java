package com.autocut.config;

import com.autocut.service.ConfigService;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * F05 — Kiểm tra cấu hình CORS fail-fast khi khởi động và quy tắc xác định môi trường dev-like.
 *
 * <p>Việc áp dụng {@code CorsConfigurationSource} cho HTTP nằm tập trung tại
 * {@link SecurityConfig#corsConfigurationSource(ConfigService, Environment)}.
 */
@Configuration
public class WebConfig {

    public WebConfig(ConfigService configService, Environment environment) {
        boolean devLike = isDevLike(environment.getActiveProfiles());
        // Dựng thử ngay khi khởi động để cấu hình sai làm ứng dụng dừng.
        CorsSettings.build(configService.getEnv(CorsSettings.ENV_KEY, null), devLike);
    }

    /**
     * Chỉ {@code dev} và {@code test} được dùng giá trị mặc định của dev.
     * Không có profile nào (hoặc {@code default}/{@code prod}) bị coi là production — fail-closed (F05 FR-2b).
     */
    public static boolean isDevLike(String[] activeProfiles) {
        if (activeProfiles == null || activeProfiles.length == 0) {
            return false;
        }
        for (String profile : activeProfiles) {
            if ("dev".equalsIgnoreCase(profile) || "test".equalsIgnoreCase(profile)) {
                return true;
            }
        }
        return false;
    }
}
