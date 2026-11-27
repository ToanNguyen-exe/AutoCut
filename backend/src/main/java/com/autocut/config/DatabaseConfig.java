package com.autocut.config;

import com.autocut.service.ConfigService;
import io.github.cdimascio.dotenv.Dotenv;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

import javax.sql.DataSource;
import java.net.URI;

/**
 * Cấu hình DataSource cho Postgres (Neon).
 *
 * <p>Profile "test" KHÔNG nạp class này — bean DataSource không tồn tại, nên
 * không có đường nào để test chạm vào DATABASE_URL thật. Đây là "xoá đường đi"
 * chứ không phải "chặn đường đi": kể cả .env có đúng chuỗi kết nối production
 * thì test cũng không đọc được nó.
 *
 * <p>Test tự cấp DataSource riêng (Testcontainers hoặc H2 ở chế độ PostgreSQL)
 * qua cấu hình của chính nó.
 */
@Configuration
@Profile("!test")
public class DatabaseConfig {

    private static final Logger log = LoggerFactory.getLogger(DatabaseConfig.class);

    private final ConfigService configService;

    public DatabaseConfig(ConfigService configService) {
        this.configService = configService;
    }

    @Bean
    public DataSource dataSource() {
        String databaseUrl = configService.getEnv("DATABASE_URL", null);
        if (databaseUrl != null) {
            databaseUrl = databaseUrl.trim();
            if (databaseUrl.startsWith("\"") && databaseUrl.endsWith("\"") && databaseUrl.length() >= 2) {
                databaseUrl = databaseUrl.substring(1, databaseUrl.length() - 1).trim();
            }
            if (databaseUrl.startsWith("'") && databaseUrl.endsWith("'") && databaseUrl.length() >= 2) {
                databaseUrl = databaseUrl.substring(1, databaseUrl.length() - 1).trim();
            }
        }

        // Thà chết lúc khởi động hơn chạy bằng RAM rồi mất dữ liệu âm thầm (AD-7).
        if (databaseUrl == null || databaseUrl.isBlank() || databaseUrl.contains("ep-xyz")) {
            throw new IllegalStateException("""
                    Thiếu DATABASE_URL.

                    Đặt trong backend/.env dòng:
                        DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

                    Lấy chuỗi kết nối ở Neon Console > Connect. Không dùng H2 thay thế:
                    dự án không có fallback in-memory (quyết định AD-7).
                    """);
        }

        try {
            String jdbcUrl = toJdbcUrl(databaseUrl);
            String username = "";
            String password = "";

            if (jdbcUrl.startsWith("jdbc:postgresql://")) {
                // jdbc:postgresql://user:pass@host:5432/db -> parse phần user info
                URI uri = URI.create(databaseUrl);
                String userInfo = uri.getUserInfo();
                if (userInfo != null && userInfo.contains(":")) {
                    String[] parts = userInfo.split(":", 2);
                    username = parts[0];
                    password = parts[1];
                }
            }

            log.info("DataSource Postgres: {}", maskUrl(jdbcUrl));

            return DataSourceBuilder.create()
                    .driverClassName("org.postgresql.Driver")
                    .url(jdbcUrl)
                    .username(username)
                    .password(password)
                    .build();

        } catch (Exception e) {
            log.error("Lỗi phân tích DATABASE_URL: {}", e.getMessage());
            throw new IllegalStateException("Không thể khởi tạo DataSource: " + e.getMessage(), e);
        }
    }

    /**
     * Chuẩn hoá chuỗi kết nối Postgres thành JDBC URL.
     *
     * <p>Hàm thuần (không đọc biến môi trường, không I/O) để test được 4 trường hợp
     * mà không cần database thật.
     *
     * <p>SSL theo đích đến, không phải hằng số: Neon bắt buộc TLS, Postgres chạy
     * trong Docker/localhost thì không có chứng chỉ nên phải bỏ sslmode, nếu không
     * kết nối sẽ hỏng với lỗi "server does not support SSL".
     *
     * @param databaseUrl chuỗi postgres:// hoặc postgresql:// hoặc jdbc:postgresql://
     * @return JDBC URL hợp lệ cho driver Postgres
     */
    static String toJdbcUrl(String databaseUrl) {
        if (databaseUrl == null || databaseUrl.isBlank()) {
            throw new IllegalArgumentException("DATABASE_URL rỗng");
        }

        String url = databaseUrl.trim();
        if (url.startsWith("\"") && url.endsWith("\"") && url.length() >= 2) {
            url = url.substring(1, url.length() - 1).trim();
        }
        if (url.startsWith("'") && url.endsWith("'") && url.length() >= 2) {
            url = url.substring(1, url.length() - 1).trim();
        }

        // Đã là JDBC URL: chỉ cần bổ sung sslmode nếu đích đến cần
        if (url.startsWith("jdbc:postgresql://")) {
            return applySslMode(url);
        }

        if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
            URI uri = URI.create(url);

            String host = uri.getHost();
            if (host == null) {
                throw new IllegalArgumentException("DATABASE_URL thiếu host: " + maskUrl(url));
            }
            int port = uri.getPort() != -1 ? uri.getPort() : 5432;
            String path = uri.getPath() == null ? "" : uri.getPath();
            String query = uri.getQuery();

            String jdbcUrl = "jdbc:postgresql://" + host + ":" + port + path;
            if (query != null && !query.isBlank()) {
                jdbcUrl += "?" + query;
            }
            return applySslMode(jdbcUrl);
        }

        throw new IllegalArgumentException(
                "DATABASE_URL phải bắt đầu bằng postgresql:// hoặc postgres://, nhận được: " + maskUrl(url));
    }

    /** Thêm sslmode=require chỉ khi đích đến không phải máy cục bộ/Docker. */
    private static String applySslMode(String jdbcUrl) {
        String lower = jdbcUrl.toLowerCase();

        boolean isLocal = lower.contains("//localhost")
                || lower.contains("//127.0.0.1")
                || lower.contains("//postgres:")   // tên service trong docker-compose
                || lower.contains("//postgres/");

        if (isLocal) {
            return jdbcUrl; // Postgres local thường không bật TLS
        }

        if (lower.contains("sslmode=")) {
            return jdbcUrl; // đã khai báo tường minh, tôn trọng người viết
        }

        return jdbcUrl + (jdbcUrl.contains("?") ? "&" : "?") + "sslmode=require";
    }

    /** Che mật khẩu khi ghi log. */
    private static String maskUrl(String url) {
        return url.replaceAll("://[^:/@]+:[^@]+@", "://***:***@");
    }
}
