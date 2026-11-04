package com.autocut.service;

import com.autocut.dto.Models.TranscriptDTO;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Optional;

class CacheServiceTest {

    @Test
    void testComputeSha256AndCacheFlow(@TempDir Path tempDir) throws IOException {
        CacheService cacheService = new CacheService();

        // 1. Tạo tệp giả lập video
        Path mockVideo = tempDir.resolve("test_video.mp4");
        Files.writeString(mockVideo, "mock video content for SHA-256 test");

        // 2. Tính mã băm SHA-256
        String hash = cacheService.computeSha256(mockVideo);
        Assertions.assertNotNull(hash);
        Assertions.assertEquals(64, hash.length(), "SHA-256 phải là chuỗi hex 64 ký tự");

        // 3. Lưu và đọc lại cache
        TranscriptDTO dto = new TranscriptDTO("test_video.mp4", 120.0, Collections.emptyList());
        cacheService.saveTranscriptCache(hash, dto);

        Optional<TranscriptDTO> cached = cacheService.getCachedTranscript(hash);
        Assertions.assertTrue(cached.isPresent());
        Assertions.assertEquals("test_video.mp4", cached.get().video());
        Assertions.assertEquals(120.0, cached.get().duration());
    }
}
