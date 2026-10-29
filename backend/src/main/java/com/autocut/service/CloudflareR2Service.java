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
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Object;

import java.io.File;
import java.net.URI;
import java.nio.file.Path;

@Service
public class CloudflareR2Service {

    private static final Logger log = LoggerFactory.getLogger(CloudflareR2Service.class);
    public static final long MAX_STORAGE_LIMIT_BYTES = 8L * 1024 * 1024 * 1024; // Trần an toàn 8GB (tránh vượt 10GB free của Cloudflare)
    public static final String ROOT_FOLDER = "autocut/";
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
     * Tính tổng dung lượng hiện tại đang lưu trữ trong bucket (bytes)
     */
    public long getCurrentUsageBytes() {
        if (s3Client == null) return 0;
        long totalBytes = 0;
        String continuationToken = null;

        do {
            ListObjectsV2Request.Builder builder = ListObjectsV2Request.builder()
                    .bucket(bucketName)
                    .prefix(ROOT_FOLDER);
            if (continuationToken != null) {
                builder.continuationToken(continuationToken);
            }

            ListObjectsV2Response res = s3Client.listObjectsV2(builder.build());
            for (S3Object obj : res.contents()) {
                totalBytes += obj.size();
            }
            continuationToken = res.nextContinuationToken();
        } while (continuationToken != null);

        return totalBytes;
    }

    /**
     * Tải một file lên Cloudflare R2 bên trong folder "autocut/"
     * Tự động kiểm tra trần dung lượng 8GB để bảo vệ tài khoản, tránh phát sinh phí ngoài ý muốn.
     *
     * @param localFilePath Đường dẫn file trên ổ cứng máy
     * @param relativeKey   Đường dẫn tương đối bên trong folder autocut (vd: uploads/Bai05.mp4)
     * @return URL truy cập file
     */
    public String uploadFile(Path localFilePath, String relativeKey) {
        if (s3Client == null) {
            throw new IllegalStateException("Cloudflare R2 chưa được cấu hình Access Key!");
        }

        File file = localFilePath.toFile();
        if (!file.exists()) {
            throw new IllegalArgumentException("File nguồn không tồn tại: " + localFilePath);
        }

        long fileSize = file.length();
        long currentUsage = getCurrentUsageBytes();

        // Kiểm tra trần 8GB
        if (currentUsage + fileSize > MAX_STORAGE_LIMIT_BYTES) {
            double currentGb = (double) currentUsage / (1024 * 1024 * 1024);
            double incomingGb = (double) fileSize / (1024 * 1024 * 1024);
            String err = String.format("CẢNH BÁO: Dung lượng lưu trữ Cloudflare R2 đã đạt %.2f GB / 8.00 GB giới hạn an toàn. Không thể upload thêm file %.2f GB để tránh phát sinh chi phí!",
                    currentGb, incomingGb);
            log.error(err);
            throw new IllegalStateException(err);
        }

        // Tự động ghim tiền tố folder autocut/
        String finalKey = relativeKey.startsWith("/") ? relativeKey.substring(1) : relativeKey;
        if (!finalKey.startsWith(ROOT_FOLDER)) {
            finalKey = ROOT_FOLDER + finalKey;
        }

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucketName)
                .key(finalKey)
                .build();

        log.info("Bắt đầu upload lên Cloudflare R2: {} -> {}/{}", file.getName(), bucketName, finalKey);
        s3Client.putObject(request, RequestBody.fromFile(file));
        log.info("Upload hoàn tất lên R2: {}", finalKey);

        if (publicUrl != null && !publicUrl.isBlank()) {
            return publicUrl.endsWith("/") ? publicUrl + finalKey : publicUrl + "/" + finalKey;
        }
        return endpoint + "/" + bucketName + "/" + finalKey;
    }

    public boolean isConfigured() {
        return s3Client != null;
    }
}
