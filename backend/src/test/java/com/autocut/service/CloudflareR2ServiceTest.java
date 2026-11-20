package com.autocut.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeAll;
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

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * F14 FR-12 — Kiểm tra CloudflareR2Service trên MinIO thật, không chạm R2 thật.
 *
 * <p>Trước đây test này upload thật lên Cloudflare R2 bằng credential trong
 * {@code .env}. Hệ quả:
 * <ul>
 *   <li>Chạy CI là đỏ, vì CI không có secret production (FR-10).</li>
 *   <li>Mỗi lần chạy test là một lần ghi vào bucket thật, tốn hạn mức.</li>
 *   <li>Test chỉ xanh trên máy có {@code .env} — đúng loại lỗi F14 muốn diệt.</li>
 * </ul>
 *
 * <p>Nay dùng MinIO trong container: cùng giao thức S3, cùng SDK, nhưng là hạ
 * tầng dùng một lần rồi xoá.
 *
 * <p><b>Vì sao gắn {@code @Tag("docker")}:</b> test cần Docker. Mặc định
 * {@code mvn test} loại nhóm này (xem {@code test.excludedGroups} trong pom),
 * nên máy không có Docker vẫn xanh. CI bật lại bằng profile {@code docker-tests}.
 */
@Tag("docker")
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest
class CloudflareR2ServiceTest {

    private static final String ACCESS_KEY = "minioadmin";
    private static final String SECRET_KEY = "minioadmin";
    private static final String BUCKET = "autocut";

    @Container
    @SuppressWarnings("resource")
    static final GenericContainer<?> MINIO =
            new GenericContainer<>(DockerImageName.parse("minio/minio:RELEASE.2024-10-13T13-34-11Z"))
                    .withExposedPorts(9000)
                    .withEnv("MINIO_ROOT_USER", ACCESS_KEY)
                    .withEnv("MINIO_ROOT_PASSWORD", SECRET_KEY)
                    .withCommand("server /data");

    @Autowired
    private CloudflareR2Service r2Service;

    /**
     * Trỏ service vào MinIO.
     *
     * <p>Phải là {@code static} và chạy trước khi ApplicationContext dựng, vì
     * CloudflareR2Service đọc và khởi tạo S3Client ngay trong constructor.
     * Sửa trong thân test là quá muộn.
     */
    @DynamicPropertySource
    static void r2Properties(DynamicPropertyRegistry registry) {
        String endpoint = "http://" + MINIO.getHost() + ":" + MINIO.getMappedPort(9000);
        registry.add("R2_ENDPOINT", () -> endpoint);
        registry.add("R2_BUCKET_NAME", () -> BUCKET);
        registry.add("R2_ACCESS_KEY_ID", () -> ACCESS_KEY);
        registry.add("R2_SECRET_ACCESS_KEY", () -> SECRET_KEY);
        // Đặt giá trị khác rỗng để không rơi về R2_PUBLIC_URL trong .env của máy dev.
        registry.add("R2_PUBLIC_URL", () -> endpoint + "/" + BUCKET);
    }

    /** MinIO không tự tạo bucket; S3Client của service giả định bucket đã có. */
    @BeforeAll
    static void createBucket() {
        try (S3Client admin = S3Client.builder()
                .endpointOverride(URI.create("http://" + MINIO.getHost() + ":" + MINIO.getMappedPort(9000)))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(ACCESS_KEY, SECRET_KEY)))
                .region(Region.of("auto"))
                .build()) {
            admin.createBucket(CreateBucketRequest.builder().bucket(BUCKET).build());
        }
    }

    @Test
    @DisplayName("Upload lên MinIO thành công và trả về URL đúng")
    void uploadsToMinio() throws Exception {
        Assertions.assertTrue(r2Service.isConfigured(),
                "Service phải được cấu hình khi đã có endpoint + access key");

        Path tempFile = Files.createTempFile("autocut-test", ".txt");
        Files.writeString(tempFile, "Hello MinIO from AutoCut!");

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
