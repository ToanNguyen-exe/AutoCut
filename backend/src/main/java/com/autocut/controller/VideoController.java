package com.autocut.controller;

import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.dto.Models.TranscriptDTO;
import com.autocut.service.CacheService;
import com.autocut.service.CloudflareR2Service;
import com.autocut.service.ConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/video")
public class VideoController {

    private static final Logger log = LoggerFactory.getLogger(VideoController.class);
    private final CacheService cacheService;
    private final ConfigService configService;
    private final CloudflareR2Service r2Service;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service) {
        this.cacheService = cacheService;
        this.configService = configService;
        this.r2Service = r2Service;
    }

    /**
     * API tải video mẫu lên Cloudflare R2:
     * - Tính mã băm SHA-256
     * - Tự động upload vào thư mục autocut/sample_videos/ trên R2
     * - Trả về Public URL cho cả nhóm (SV1, SV2, SV4) bấm vào là xem và test chung được ngay!
     */
    @PostMapping("/upload-sample")
    public ResponseEntity<Map<String, Object>> uploadSampleVideo(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "File video rỗng!"));
        }

        try {
            String originalFilename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "sample.mp4";
            Path tempDir = Paths.get("temp");
            if (!Files.exists(tempDir)) {
                Files.createDirectories(tempDir);
            }

            Path tempFile = tempDir.resolve(System.currentTimeMillis() + "_" + originalFilename);
            try (InputStream is = file.getInputStream()) {
                Files.copy(is, tempFile, StandardCopyOption.REPLACE_EXISTING);
            }

            // Tính mã băm SHA-256
            String hash = cacheService.computeSha256(tempFile);

            // Upload lên Cloudflare R2 trong folder autocut/sample_videos/
            String r2Key = "sample_videos/" + hash.substring(0, 12) + "_" + originalFilename;
            String publicUrl = r2Service.uploadFile(tempFile, r2Key);

            // Dọn dẹp file temp cục bộ
            Files.deleteIfExists(tempFile);

            Map<String, Object> response = new HashMap<>();
            response.put("status", "SUCCESS");
            response.put("file_name", originalFilename);
            response.put("file_size", file.getSize());
            response.put("sha256", hash);
            response.put("cloud_url", publicUrl);
            response.put("message", "Video đã được đưa lên Cloudflare R2 thành công cho cả nhóm dùng chung!");

            log.info("Đã upload video mẫu lên Cloudflare R2: {}", publicUrl);
            return ResponseEntity.ok(response);

        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Lỗi khi upload video lên R2: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Lỗi server: " + e.getMessage()));
        }
    }

    /**
     * Trả về dữ liệu mock segments_sample.json cho Frontend hiển thị lên bảng duyệt (SV4).
     */
    @GetMapping("/mock-segments")
    public ResponseEntity<SegmentsDTO> getMockSegments() {
        Path path = findFilePath("mock-data/segments_sample.json");
        if (!Files.exists(path)) {
            log.error("Không tìm thấy mock-data/segments_sample.json tại: {}", path.toAbsolutePath());
            return ResponseEntity.notFound().build();
        }
        try {
            SegmentsDTO dto = objectMapper.readValue(path.toFile(), SegmentsDTO.class);
            return ResponseEntity.ok(dto);
        } catch (IOException e) {
            log.error("Lỗi đọc segments_sample.json: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * Trả về dữ liệu mock transcript_sample.json.
     */
    @GetMapping("/mock-transcript")
    public ResponseEntity<TranscriptDTO> getMockTranscript() {
        Path path = findFilePath("mock-data/transcript_sample.json");
        if (!Files.exists(path)) {
            log.error("Không tìm thấy mock-data/transcript_sample.json tại: {}", path.toAbsolutePath());
            return ResponseEntity.notFound().build();
        }
        try {
            TranscriptDTO dto = objectMapper.readValue(path.toFile(), TranscriptDTO.class);
            return ResponseEntity.ok(dto);
        } catch (IOException e) {
            log.error("Lỗi đọc transcript_sample.json: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * Kiểm tra trạng thái cache cho mã băm video (P04).
     */
    @GetMapping("/cache/{hash}")
    public ResponseEntity<?> checkCache(@PathVariable String hash) {
        Optional<TranscriptDTO> cached = cacheService.getCachedTranscript(hash);
        if (cached.isPresent()) {
            return ResponseEntity.ok(Map.of(
                    "cached", true,
                    "transcript", cached.get()
            ));
        }
        return ResponseEntity.ok(Map.of("cached", false));
    }

    /**
     * Tiếp nhận segments đã duyệt từ Frontend gửi sang để thực hiện cắt video (B10).
     */
    @PostMapping("/render")
    public ResponseEntity<?> renderSegments(@RequestBody SegmentsDTO segments) {
        log.info("Tiếp nhận yêu cầu cắt video bài giảng: {}, số phân đoạn: {}",
                segments.lesson(), segments.segments().size());

        // Ghi nhận kế hoạch cắt vào output/reviewed_segments.json để SV1 xử lý
        try {
            Path outputDir = Paths.get("output");
            if (!Files.exists(outputDir)) {
                Files.createDirectories(outputDir);
            }
            Path outputFile = outputDir.resolve("segments_" + segments.lesson() + ".json");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(outputFile.toFile(), segments);
            log.info("Đã lưu kế hoạch cắt đã duyệt tại: {}", outputFile.toAbsolutePath());

            return ResponseEntity.ok(Map.of(
                    "status", "QUEUED",
                    "message", "Đã tiếp nhận và chuẩn bị cắt " + segments.segments().size() + " phân đoạn.",
                    "savedPlan", outputFile.toString()
            ));
        } catch (IOException e) {
            log.error("Không thể ghi nhận kế hoạch cắt: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    private Path findFilePath(String relativePath) {
        Path p = Paths.get(relativePath);
        if (Files.exists(p)) return p;
        p = Paths.get("..", relativePath);
        if (Files.exists(p)) return p;
        return Paths.get(relativePath);
    }
}
