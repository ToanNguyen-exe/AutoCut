package com.autocut.config;

import com.autocut.service.ConfigService;
import io.github.cdimascio.dotenv.Dotenv;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.net.URI;

@Configuration
public class DatabaseConfig {

    private static final Logger log = LoggerFactory.getLogger(DatabaseConfig.class);

    private final ConfigService configService;

    public DatabaseConfig(ConfigService configService) {
        this.configService = configService;
    }

    @Bean
    public DataSource dataSource() {
        Dotenv dotenv = configService.getDotenv();
        String databaseUrl = dotenv.get("DATABASE_URL");

        if (databaseUrl == null || databaseUrl.isBlank()) {
            throw new IllegalStateException("Chưa cấu hình DATABASE_URL trong .env. Vui lòng cung cấp chuỗi kết nối PostgreSQL của Neon!");
        }

        try {
            // Chuẩn hóa URL từ postgres:// sang jdbc:postgresql://
            String cleanUrl = databaseUrl;
            if (cleanUrl.startsWith("postgres://") || cleanUrl.startsWith("postgresql://")) {
                URI uri = URI.create(cleanUrl);
                String userInfo = uri.getUserInfo();
                String username = "";
                String password = "";
                if (userInfo != null && userInfo.contains(":")) {
                    String[] parts = userInfo.split(":", 2);
                    username = parts[0];
                    password = parts[1];
                }

                String host = uri.getHost();
                int port = uri.getPort() != -1 ? uri.getPort() : 5432;
                String path = uri.getPath(); // /neondb
                String query = uri.getQuery();

                String jdbcUrl = "jdbc:postgresql://" + host + ":" + port + path;
                if (query != null && !query.isBlank()) {
                    jdbcUrl += "?" + query;
                    if (!query.contains("sslmode")) {
                        jdbcUrl += "&sslmode=require";
                    }
                } else {
                    jdbcUrl += "?sslmode=require";
                }

                log.info("Kết nối Neon Lakebase Postgres thành công tại host: {}", host);

                return DataSourceBuilder.create()
                        .driverClassName("org.postgresql.Driver")
                        .url(jdbcUrl)
                        .username(username)
                        .password(password)
                        .build();
            }

            return DataSourceBuilder.create()
                    .driverClassName("org.postgresql.Driver")
                    .url(databaseUrl)
                    .build();

        } catch (Exception e) {
            log.error("Lỗi phân tích DATABASE_URL: {}", e.getMessage(), e);
            throw new IllegalStateException("Không thể khởi tạo DataSource Neon: " + e.getMessage());
        }
    }
}
