package com.autocut.service;

import com.autocut.entity.VideoEntity;
import com.autocut.repository.VideoRepository;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Optional;

@SpringBootTest
public class NeonDatabaseTest {

    @Autowired
    private VideoRepository videoRepository;

    @Test
    void testNeonDatabaseConnectionAndCrud() {
        String testHash = "neon_test_hash_" + System.currentTimeMillis();
        VideoEntity video = new VideoEntity("Bai05_VongLap.mp4", testHash, "UPLOADED", 104857600L);
        video.setCloudUrl("https://pub-603b1f9629e046de80cf86f3f046ca84.r2.dev/autocut/sample_videos/Vibe-Coding-4.mp4");

        // 1. Lưu vào Neon Postgres
        VideoEntity saved = videoRepository.save(video);
        Assertions.assertNotNull(saved.getId(), "Lỗi: ID chưa được sinh từ Neon Postgres!");
        System.out.println(">>> Lưu thành công vào Neon Postgres! ID = " + saved.getId());

        // 2. Tìm lại theo SHA-256
        Optional<VideoEntity> found = videoRepository.findBySha256Hash(testHash);
        Assertions.assertTrue(found.isPresent(), "Không tìm thấy bản ghi vừa lưu trong Neon!");
        Assertions.assertEquals("Bai05_VongLap.mp4", found.get().getFileName());
        System.out.println(">>> Đọc dữ liệu từ Neon Postgres thành công: " + found.get().getFileName());

        // 3. Dọn dẹp bản ghi test
        videoRepository.delete(saved);
        Assertions.assertFalse(videoRepository.findBySha256Hash(testHash).isPresent());
        System.out.println(">>> Xóa dữ liệu test trên Neon thành công!");
    }
}
