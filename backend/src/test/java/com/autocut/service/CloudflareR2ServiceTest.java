package com.autocut.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.nio.file.Files;
import java.nio.file.Path;

@SpringBootTest
public class CloudflareR2ServiceTest {

    @Autowired
    private CloudflareR2Service r2Service;

    @Test
    void testUploadToR2() throws Exception {
        Assertions.assertTrue(r2Service.isConfigured(), "Cloudflare R2 service chưa được cấu hình!");

        // Tạo 1 file test nhỏ
        Path tempFile = Files.createTempFile("autocut-test", ".txt");
        Files.writeString(tempFile, "Hello Cloudflare R2 from AutoCut!");

        try {
            String testKey = "test/test-connection.txt";
            String uploadedUrl = r2Service.uploadFile(tempFile, testKey);

            System.out.println(">>> Upload thành công lên R2!");
            System.out.println(">>> Public URL: " + uploadedUrl);

            Assertions.assertNotNull(uploadedUrl);
            Assertions.assertTrue(uploadedUrl.contains("test-connection.txt"));
        } finally {
            Files.deleteIfExists(tempFile);
        }
    }
}
