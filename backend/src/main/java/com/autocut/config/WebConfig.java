package com.autocut.config;

import com.autocut.service.ConfigService;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * F05 — Cấu hình CORS.
 *
 * <p>Trước đây: {@code allowedOriginPatterns("*")} + {@code allowCredentials(true)},
 * nghĩa là bất kỳ website nào cũng gọi được API kèm cookie người dùng.
 *
 * <p>Bây giờ: chỉ những origin khai báo trong {@code AUTOCUT_CORS_ALLOWED_ORIGINS}.
 * Ở môi trường production (profile {@code prod}, hoặc không có profile nào)
 * thiếu biến này thì ứng dụng <b>không khởi động</b> — cấu hình sai phải lộ ra
 * lúc deploy, không phải lúc bị khai thác.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final ConfigService configService;
    private final boolean devLike;

    public WebConfig(ConfigService configService, Environment environment) {
        this.configService = configService;
        this.devLike = isDevLike(environment.getActiveProfiles());

        // Dựng thử ngay khi khởi động để cấu hình sai làm ứng dụng dừng.
        CorsSettings.build(configService.getEnv(CorsSettings.ENV_KEY, null), devLike);
    }

    /**
     * Chỉ {@code dev} và {@code test} được dùng giá trị mặc định của dev.
     * Không có profile nào bị coi là production — an toàn theo hướng đóng.
     */
    static boolean isDevLike(String[] activeProfiles) {
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

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        CorsConfiguration config = CorsSettings.build(
                configService.getEnv(CorsSettings.ENV_KEY, null), devLike);

        registry.addMapping("/api/**")
                .allowedOrigins(config.getAllowedOrigins().toArray(new String[0]))
                .allowedMethods(config.getAllowedMethods().toArray(new String[0]))
                .allowedHeaders(config.getAllowedHeaders().toArray(new String[0]))
                .exposedHeaders(config.getExposedHeaders().toArray(new String[0]))
                .allowCredentials(Boolean.TRUE.equals(config.getAllowCredentials()))
                .maxAge(config.getMaxAge() == null ? 1800 : config.getMaxAge());
    }
}
