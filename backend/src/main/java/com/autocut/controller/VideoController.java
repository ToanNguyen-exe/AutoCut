package com.autocut.controller;

import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.dto.Models.TranscriptDTO;
import com.autocut.service.CacheService;
import com.autocut.service.ConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/video")
public class VideoController {

    private static final Logger log = LoggerFactory.getLogger(VideoController.class);
    private final CacheService cacheService;
    private final ConfigService configService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VideoController(CacheService cacheService, ConfigService configService) {
        this.cacheService = cacheService;
        this.configService = configService;
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
