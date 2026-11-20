package com.autocut.service;

import com.autocut.entity.VideoEntity;
import com.autocut.repository.VideoRepository;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Optional;

/**
 * CRUD cơ bản qua JPA, chạy trên database của profile test (H2 in-memory).
 *
 * <p>Tên cũ là {@code NeonDatabaseTest} và nội dung cũ ghi thẳng vào Neon
 * production mỗi lần chạy {@code mvn test} — mỗi lần chạy để lại một dòng rác
 * hoặc, nếu test chết giữa đường, một dòng rác vĩnh viễn. Đổi tên để không ai
 * tưởng nhầm đây là test cần database thật.
 *
 * <p>Điều test này chứng minh: mapping entity <-> bảng đúng (id sinh tự động,
 * tìm theo sha256_hash, xoá được) — tức là {@code ddl-auto=validate} và V1 khớp
 * với entity.
 */
@SpringBootTest
class VideoRepositoryCrudTest {

    @Autowired
    private VideoRepository videoRepository;

    @Test
    @DisplayName("Lưu, tìm theo sha256, rồi xoá")
    void saveFindDelete() {
        String testHash = "crud_hash_" + System.currentTimeMillis();
        VideoEntity video = new VideoEntity("Bai05_VongLap.mp4", testHash, "UPLOADED", 104857600L);
        video.setR2Key("sample_videos/" + testHash + "_Bai05_VongLap.mp4");

        // 1. Lưu — id phải được database sinh (IDENTITY)
        VideoEntity saved = videoRepository.save(video);
        Assertions.assertNotNull(saved.getId(), "id phải được database sinh ra");

        // 2. Tìm lại theo sha256_hash (dùng index UNIQUE idx_video_sha256)
        Optional<VideoEntity> found = videoRepository.findBySha256Hash(testHash);
        Assertions.assertTrue(found.isPresent(), "Không tìm thấy bản ghi vừa lưu");
        Assertions.assertEquals("Bai05_VongLap.mp4", found.get().getFileName());

        // 3. Giá trị mặc định do database điền (không do Java set)
        Assertions.assertNotNull(found.get().getCreatedAt(), "created_at phải có giá trị");
        Assertions.assertFalse(found.get().getReviewed(), "reviewed phải mặc định FALSE");

        // 4. Xoá
        videoRepository.delete(saved);
        Assertions.assertFalse(videoRepository.findBySha256Hash(testHash).isPresent());
    }
}
