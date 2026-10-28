package com.autocut.service;

import io.github.cdimascio.dotenv.Dotenv;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.File;
import java.net.URI;
import java.nio.file.Path;

@Service
public class CloudflareR2Service {

    private static final Logger log = LoggerFactory.getLogger(CloudflareR2Service.class);

    private final String endpoint;
    private final String bucketName;
    private final String accessKeyId;
    private final String secretAccessKey;
    private final String publicUrl;
    private S3Client s3Client;

    public CloudflareR2Service(ConfigService configService) {
        Dotenv dotenv = configService.getDotenv();
        this.endpoint = dotenv.get("R2_ENDPOINT", "https://7b8d9e6bf945add2f99f39d0746a42f3.r2.cloudflarestorage.com");
        this.bucketName = dotenv.get("R2_BUCKET_NAME", "autocut");
        this.accessKeyId = dotenv.get("R2_ACCESS_KEY_ID", "");
        this.secretAccessKey = dotenv.get("R2_SECRET_ACCESS_KEY", "");
        this.publicUrl = dotenv.get("R2_PUBLIC_URL", "");

        if (!accessKeyId.isBlank() && !secretAccessKey.isBlank()) {
            initClient();
        } else {
            log.warn("Cloudflare R2 chưa cấu hình R2_ACCESS_KEY_ID hoặc R2_SECRET_ACCESS_KEY trong .env");
        }
    }

    private void initClient() {
        try {
            this.s3Client = S3Client.builder()
                    .endpointOverride(URI.create(endpoint))
                    .credentialsProvider(StaticCredentialsProvider.create(
                            AwsBasicCredentials.create(accessKeyId, secretAccessKey)
                    ))
                    .region(Region.of("auto"))
                    .build();
            log.info("Khởi tạo Cloudflare R2 S3Client thành công cho bucket: {}", bucketName);
        } catch (Exception e) {
            log.error("Lỗi khi kết nối Cloudflare R2: {}", e.getMessage());
        }
    }

    /**
     * Tải một file lên Cloudflare R2
     *
     * @param localFilePath Đường dẫn file trên ổ cứng máy
     * @param r2Key         Đường dẫn lưu trên bucket (vd: uploads/Bai05.mp4 hoặc output/01_for.mp4)
     * @return URL truy cập file (hoặc r2Key nếu chưa có public domain)
     */
    public String uploadFile(Path localFilePath, String r2Key) {
        if (s3Client == null) {
            throw new IllegalStateException("Cloudflare R2 chưa được cấu hình Access Key!");
        }

        File file = localFilePath.toFile();
        if (!file.exists()) {
            throw new IllegalArgumentException("File nguồn không tồn tại: " + localFilePath);
        }

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucketName)
                .key(r2Key)
                .build();

        log.info("Bắt đầu upload lên Cloudflare R2: {} -> {}/{}", file.getName(), bucketName, r2Key);
        s3Client.putObject(request, RequestBody.fromFile(file));
        log.info("Upload hoàn tất lên R2: {}", r2Key);

        if (publicUrl != null && !publicUrl.isBlank()) {
            return publicUrl.endsWith("/") ? publicUrl + r2Key : publicUrl + "/" + r2Key;
        }
        return endpoint + "/" + bucketName + "/" + r2Key;
    }

    public boolean isConfigured() {
        return s3Client != null;
    }
}
