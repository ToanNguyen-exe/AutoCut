package com.autocut.service;

import com.autocut.dto.Models.TranscriptDTO;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;

@Service
public class CacheService {

    private static final Logger log = LoggerFactory.getLogger(CacheService.class);
    private static final Path CACHE_DIR = Paths.get("cache");
    private final ObjectMapper objectMapper = new ObjectMapper();

    public CacheService() {
        try {
            if (!Files.exists(CACHE_DIR)) {
                Files.createDirectories(CACHE_DIR);
            }
        } catch (IOException e) {
            log.error("Không thể khởi tạo thư mục cache: {}", e.getMessage(), e);
            throw new IllegalStateException("Không thể khởi tạo thư mục cache", e);
        }
    }

    /**
     * Băm SHA-256 theo stream 64KB tránh tràn bộ nhớ RAM với video nặng nhiều GB.
     */
    public String computeSha256(Path videoPath) {
        if (!Files.exists(videoPath)) {
            throw new IllegalArgumentException("Tệp video không tồn tại: " + videoPath);
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            try (InputStream is = Files.newInputStream(videoPath)) {
                int bytesRead;
                while ((bytesRead = is.read(buffer)) != -1) {
                    digest.update(buffer, 0, bytesRead);
                }
            }
            byte[] hashBytes = digest.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException | IOException e) {
            log.error("Lỗi tính mã băm SHA-256 cho file {}: {}", videoPath, e.getMessage(), e);
            throw new RuntimeException("Lỗi tính mã băm SHA-256", e);
        }
    }

    /**
     * Kiểm tra và nạp transcript cũ từ cache nếu đã từng xử lý.
     */
    public Optional<TranscriptDTO> getCachedTranscript(String videoHash) {
        Path cacheFile = CACHE_DIR.resolve(videoHash + "_transcript.json");
        if (!Files.exists(cacheFile)) {
            return Optional.empty();
        }
        try {
            TranscriptDTO dto = objectMapper.readValue(cacheFile.toFile(), TranscriptDTO.class);
            log.info("Cache HIT cho mã băm: {}", videoHash);
            return Optional.of(dto);
        } catch (IOException e) {
            log.warn("Không thể đọc cache transcript cho mã băm {}: {}", videoHash, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Lưu kết quả bóc băng mới vào thư mục cache.
     */
    public void saveTranscriptCache(String videoHash, TranscriptDTO transcript) {
        Path cacheFile = CACHE_DIR.resolve(videoHash + "_transcript.json");
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(cacheFile.toFile(), transcript);
            log.info("Đã lưu transcript vào cache: {}", cacheFile);
        } catch (IOException e) {
            log.error("Không thể ghi cache transcript cho mã băm {}: {}", videoHash, e.getMessage(), e);
            throw new RuntimeException("Không thể lưu cache transcript", e);
        }
    }
}
