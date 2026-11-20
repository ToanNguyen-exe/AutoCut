package com.autocut.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * F14 FR-12 — Kiểm tra CloudflareR2Service trên S3 thật, không chạm R2 thật.
 *
 * <p>Trước đây test này upload thật lên Cloudflare R2 bằng credential trong
 * {@code .env}. Hệ quả:
 * <ul>
 *   <li>Chạy CI là đỏ, vì CI không có secret production (FR-10).</li>
 *   <li>Mỗi lần chạy test là một lần ghi vào bucket thật, tốn hạn mức.</li>
 *   <li>Test chỉ xanh trên máy có {@code .env} — đúng loại lỗi F14 muốn diệt.</li>
 * </ul>
 *
 * <p><b>Vì sao dùng s3mock chứ không phải MinIO:</b> MinIO đã xoá toàn bộ ảnh
 * Docker của họ khỏi Docker Hub — kéo {@code minio/minio} trả 404, nên mọi test
 * dựa vào ảnh đó đều đỏ ngay ở bước pull. {@code adobe/s3mock} là ảnh S3 giả
 * dựng riêng cho test tích hợp, nhẹ và vẫn được phát hành đều.
 *
 * <p><b>Vì sao cần path-style:</b> s3mock (như phần lớn S3 tự dựng) chỉ hiểu
 * địa chỉ {@code endpoint/bucket/key}, không hiểu {@code bucket.endpoint/key}.
 * Service có cờ {@code R2_PATH_STYLE}, mặc định tắt để không đổi hành vi trên
 * Cloudflare R2 thật.
 *
 * <p><b>Vì sao gắn {@code @Tag("docker")}:</b> test cần Docker. Mặc định
 * {@code mvn test} loại nhóm này (xem {@code test.excludedGroups} trong pom),
 * nên máy không có Docker vẫn xanh. CI bật lại bằng profile {@code docker-tests}.
 */
@Tag("docker")
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest
class CloudflareR2ServiceTest {

    private static final String BUCKET = "autocut";
    private static final int S3_PORT = 9090;

    @Container
    @SuppressWarnings("resource")
    static final GenericContainer<?> S3_MOCK =
            new GenericContainer<>(DockerImageName.parse("adobe/s3mock:5.2.3"))
                    .withExposedPorts(S3_PORT)
                    // Tạo bucket ngay lúc khởi động: service giả định bucket có sẵn.
                    .withEnv("COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS", BUCKET);

    @Autowired
    private CloudflareR2Service r2Service;

    /**
     * Trỏ service vào S3 giả.
     *
     * <p>Phải là {@code static} và chạy trước khi ApplicationContext dựng, vì
     * CloudflareR2Service đọc cấu hình và khởi tạo S3Client ngay trong
     * constructor. Sửa trong thân test là quá muộn.
     */
    @DynamicPropertySource
    static void r2Properties(DynamicPropertyRegistry registry) {
        String endpoint = "http://" + S3_MOCK.getHost() + ":" + S3_MOCK.getMappedPort(S3_PORT);
        registry.add("R2_ENDPOINT", () -> endpoint);
        registry.add("R2_BUCKET_NAME", () -> BUCKET);
        registry.add("R2_ACCESS_KEY_ID", () -> "test");
        registry.add("R2_SECRET_ACCESS_KEY", () -> "test");
        registry.add("R2_PATH_STYLE", () -> "true");
        // Đặt giá trị khác rỗng để không rơi về R2_PUBLIC_URL trong .env của máy dev.
        registry.add("R2_PUBLIC_URL", () -> endpoint + "/" + BUCKET);
    }

    @Test
    @DisplayName("Upload thành công và trả về URL đúng")
    void uploadsToS3() throws Exception {
        Assertions.assertTrue(r2Service.isConfigured(),
                "Service phải được cấu hình khi đã có endpoint + access key");

        Path tempFile = Files.createTempFile("autocut-test", ".txt");
        Files.writeString(tempFile, "Hello S3 from AutoCut!");

        try {
            String url = r2Service.uploadFile(tempFile, "test-connection.txt");

            Assertions.assertNotNull(url);
            Assertions.assertTrue(url.contains("autocut/test-connection.txt"),
                    "URL phải chứa tiền tố thư mục autocut/, nhận được: " + url);
        } finally {
            Files.deleteIfExists(tempFile);
        }
    }

    @Test
    @DisplayName("Dung lượng đã dùng đếm được file vừa upload")
    void countsUsageBytes() throws Exception {
        Path tempFile = Files.createTempFile("autocut-usage", ".txt");
        Files.writeString(tempFile, "0123456789");
        long expected = Files.size(tempFile);

        try {
            r2Service.uploadFile(tempFile, "usage-check.txt");
            long usage = r2Service.getCurrentUsageBytes();

            Assertions.assertTrue(usage >= expected,
                    "Dung lượng phải đếm được file vừa upload: cần >= " + expected + ", nhận " + usage);
        } finally {
            Files.deleteIfExists(tempFile);
        }
    }
}
