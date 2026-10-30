package com.autocut.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

@SpringBootTest
public class SchemaMigrationTest {

    @Autowired
    private DataSource dataSource;

    @Test
    void testDeploySchemaToNeonPostgres() throws Exception {
        Assertions.assertNotNull(dataSource, "DataSource must not be null");

        // Đọc nội dung schema.sql
        Path schemaPath = Paths.get("..", "database", "schema.sql").toAbsolutePath().normalize();
        if (!Files.exists(schemaPath)) {
            schemaPath = Paths.get("database", "schema.sql").toAbsolutePath().normalize();
        }
        Assertions.assertTrue(Files.exists(schemaPath), "schema.sql must exist at: " + schemaPath);

        String sql = Files.readString(schemaPath);

        // Thực thi toàn bộ DDL lên Neon Lakebase Postgres
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
            System.out.println(">>> Đã thực thi database/schema.sql lên Neon Postgres thành công!");

            // Kiểm tra danh sách bảng đã tạo trong schema public
            ResultSet rs = stmt.executeQuery(
                "SELECT table_name FROM information_schema.tables " +
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' " +
                "ORDER BY table_name"
            );

            List<String> tables = new ArrayList<>();
            while (rs.next()) {
                tables.add(rs.getString("table_name"));
            }

            System.out.println(">>> Danh sách bảng hiện có trên Neon Postgres: " + tables);

            // Kiểm tra đủ 6 bảng cốt lõi
            Assertions.assertTrue(tables.contains("users"), "Missing table: users");
            Assertions.assertTrue(tables.contains("videos"), "Missing table: videos");
            Assertions.assertTrue(tables.contains("transcripts"), "Missing table: transcripts");
            Assertions.assertTrue(tables.contains("sections"), "Missing table: sections");
            Assertions.assertTrue(tables.contains("topics"), "Missing table: topics");
            Assertions.assertTrue(tables.contains("video_parts"), "Missing table: video_parts");
        }
    }
}
