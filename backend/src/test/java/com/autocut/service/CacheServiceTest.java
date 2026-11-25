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
        CacheService cacheService = new CacheService(tempDir.resolve("cache"));

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

    @Test
    void testWaveformCacheFlow(@TempDir Path tempDir) throws IOException {
        CacheService cacheService = new CacheService(tempDir.resolve("cache"));
        Path mockVideo = tempDir.resolve("test_waveform_video.mp4");
        Files.writeString(mockVideo, "mock content for waveform cache test");

        String hash = cacheService.computeSha256(mockVideo);

        // Chưa có cache
        Optional<com.autocut.video.WaveformResult> initial = cacheService.getCachedWaveform(hash);
        Assertions.assertTrue(initial.isEmpty(), "Ban đầu chưa có cache sóng âm");

        // Lưu cache
        com.autocut.video.WaveformResult result = new com.autocut.video.WaveformResult(
                true, 45.0, 10, new int[]{15, 30, 80, 100, 20}, new byte[]{-15, 30}
        );
        cacheService.saveWaveformCache(hash, result);

        // Đọc lại cache
        Optional<com.autocut.video.WaveformResult> cached = cacheService.getCachedWaveform(hash);
        Assertions.assertTrue(cached.isPresent(), "Phải đọc được waveform từ cache");
        Assertions.assertTrue(cached.get().hasAudio());
        Assertions.assertEquals(45.0, cached.get().durationSec());
        Assertions.assertArrayEquals(new int[]{15, 30, 80, 100, 20}, cached.get().peaks());
    }
}
