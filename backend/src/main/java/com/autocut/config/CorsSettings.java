package com.autocut.config;

import org.springframework.web.cors.CorsConfiguration;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * F05 — Luật CORS của AutoCut, tách khỏi Spring để test được bằng hàm thuần.
 *
 * <p>Lỗi cũ: {@code allowedOriginPatterns("*")} đi kèm
 * {@code allowCredentials(true)} — mọi website trên Internet gọi được API kèm
 * cookie người dùng. Cấu hình mới chỉ cho phép danh sách origin cụ thể.
 *
 * <p>Quy tắc quyết định dev hay production:
 * <ul>
 *   <li>Có profile {@code dev} hoặc {@code test}, hoặc không có profile nào
 *       (người chạy local) → cho phép giá trị mặc định của dev.</li>
 *   <li>Không có profile nhưng chạy ở production thật → phải đặt biến môi trường.</li>
 * </ul>
 */
public final class CorsSettings {

    /** Biến môi trường khai báo danh sách origin, cách nhau bằng dấu phẩy. */
    public static final String ENV_KEY = "AUTOCUT_CORS_ALLOWED_ORIGINS";

    private static final List<String> DEV_DEFAULTS = List.of(
            "http://localhost:3000",
            "http://127.0.0.1:3000");

    private static final List<String> METHODS = List.of(
            "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");

    private static final List<String> HEADERS = List.of(
            "Authorization", "Content-Type", "Accept", "X-Requested-With", "X-Request-Id");

    private static final List<String> EXPOSED = List.of(
            "Content-Disposition", "Content-Length");

    private CorsSettings() {
    }

    /**
     * @param rawOrigins giá trị của {@link #ENV_KEY}, có thể null
     * @param devLike    true nếu đang chạy dev/test
     * @throws IllegalStateException khi cấu hình thiếu ở production hoặc chứa '*'
     */
    public static CorsConfiguration build(String rawOrigins, boolean devLike) {
        List<String> origins = parse(rawOrigins);

        if (origins.stream().anyMatch(o -> o.contains("*"))) {
            throw new IllegalStateException(
                    "CORS không được dùng '*': hãy liệt kê origin cụ thể trong " + ENV_KEY);
        }

        if (origins.isEmpty()) {
            if (!devLike) {
                throw new IllegalStateException(
                        "Thiếu " + ENV_KEY + " ở môi trường production. "
                                + "Ví dụ: " + ENV_KEY + "=https://autocut.vn");
            }
            origins = DEV_DEFAULTS;
        }

        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(new ArrayList<>(origins));
        config.setAllowCredentials(true);
        config.setAllowedMethods(METHODS);
        config.setAllowedHeaders(HEADERS);
        config.setExposedHeaders(EXPOSED);
        config.setMaxAge(3600L);
        return config;
    }

    /** Tách theo dấu phẩy, cắt khoảng trắng, bỏ rỗng và trùng lặp, giữ thứ tự. */
    private static List<String> parse(String rawOrigins) {
        if (rawOrigins == null || rawOrigins.isBlank()) {
            return List.of();
        }
        Set<String> result = new LinkedHashSet<>();
        for (String part : rawOrigins.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                result.add(trimmed);
            }
        }
        return new ArrayList<>(result);
    }
}
