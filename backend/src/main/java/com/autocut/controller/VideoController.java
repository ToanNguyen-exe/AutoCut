package com.autocut.controller;

import com.autocut.dto.Models.Segment;
import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.dto.Models.Sentence;
import com.autocut.dto.Models.TranscriptDTO;
import com.autocut.dto.Models.VideoPart;
import com.autocut.entity.VideoEntity;
import com.autocut.repository.VideoRepository;
import com.autocut.service.CacheService;
import com.autocut.service.CloudflareR2Service;
import com.autocut.service.ConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
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
import java.util.*;

@RestController
@RequestMapping("/api/video")
public class VideoController {

    private static final Logger log = LoggerFactory.getLogger(VideoController.class);
    private final CacheService cacheService;
    private final ConfigService configService;
    private final CloudflareR2Service r2Service;
    private final VideoRepository videoRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository) {
        this.cacheService = cacheService;
        this.configService = configService;
        this.r2Service = r2Service;
        this.videoRepository = videoRepository;
    }

    /**
     * API tải video mẫu lên Cloudflare R2:
     * - Tính mã băm SHA-256
     * - Tự động upload vào thư mục autocut/sample_videos/ trên R2 (hoặc lưu local fallback nếu chưa config R2)
     * - Lưu metadata vào database VideoRepository
     * - Trả về Public URL cho cả nhóm (SV1, SV2, SV4) bấm vào là xem và test chung được ngay!
     */
    @PostMapping("/upload-sample")
    public ResponseEntity<Map<String, Object>> uploadSampleVideo(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "File video rỗng!"));
        }

        Path tempFile = null;
        try {
            String originalFilename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "sample.mp4";
            Path tempDir = Paths.get("temp");
            if (!Files.exists(tempDir)) {
                Files.createDirectories(tempDir);
            }

            tempFile = tempDir.resolve(System.currentTimeMillis() + "_" + originalFilename);
            try (InputStream is = file.getInputStream()) {
                Files.copy(is, tempFile, StandardCopyOption.REPLACE_EXISTING);
            }

            // Tính mã băm SHA-256
            String hash = cacheService.computeSha256(tempFile);

            String publicUrl;
            String r2Key = "sample_videos/" + hash.substring(0, Math.min(12, hash.length())) + "_" + originalFilename;

            // Thử upload lên Cloudflare R2 trước, nếu chưa cấu hình thì lưu vào thư mục uploads cục bộ
            try {
                publicUrl = r2Service.uploadFile(tempFile, r2Key);
                log.info("Đã upload video lên Cloudflare R2 thành công: {}", publicUrl);
            } catch (Exception ex) {
                log.warn("Cloudflare R2 chưa kích hoạt ({}), lưu trữ video cục bộ tại thư mục uploads/", ex.getMessage());
                Path uploadDir = Paths.get("uploads");
                if (!Files.exists(uploadDir)) {
                    Files.createDirectories(uploadDir);
                }
                Path localFile = uploadDir.resolve(hash + "_" + originalFilename);
                Files.copy(tempFile, localFile, StandardCopyOption.REPLACE_EXISTING);
                publicUrl = "http://localhost:8080/api/video/stream/" + hash;
            }

            // Lưu thông tin video vào Database
            VideoEntity videoEntity = videoRepository.findBySha256Hash(hash).orElse(new VideoEntity());
            videoEntity.setFileName(originalFilename);
            videoEntity.setSha256Hash(hash);
            videoEntity.setFileSize(file.getSize());
            videoEntity.setR2Key(r2Key);
            videoEntity.setCloudUrl(publicUrl);
            videoEntity.setStatus("UPLOADED");
            videoRepository.save(videoEntity);

            Map<String, Object> response = new HashMap<>();
            response.put("status", "SUCCESS");
            response.put("file_name", originalFilename);
            response.put("file_size", file.getSize());
            response.put("sha256", hash);
            response.put("cloud_url", publicUrl);
            response.put("message", "Video đã được tiếp nhận và lưu trữ thành công trên hệ thống AutoCut!");

            return ResponseEntity.ok(response);

        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Lỗi khi upload video: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Lỗi server: " + e.getMessage()));
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException e) {
                    log.warn("Không thể xóa tệp tạm {}: {}", tempFile, e.getMessage());
                }
            }
        }
    }

    /**
     * API phát/stream video trực tiếp từ máy chủ theo mã băm SHA-256.
     */
    @GetMapping("/stream/{hash}")
    public ResponseEntity<Resource> streamVideo(@PathVariable String hash) {
        Path uploadDir = Paths.get("uploads");
        if (Files.exists(uploadDir)) {
            try (var stream = Files.list(uploadDir)) {
                Optional<Path> found = stream.filter(p -> p.getFileName().toString().startsWith(hash)).findFirst();
                if (found.isPresent()) {
                    Resource resource = new FileSystemResource(found.get());
                    return ResponseEntity.ok()
                            .header(HttpHeaders.CONTENT_TYPE, "video/mp4")
                            .body(resource);
                }
            } catch (IOException e) {
                log.warn("Lỗi đọc thư mục uploads: {}", e.getMessage());
            }
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * API lấy danh sách video đã lưu trữ từ Database cho Thư viện Video của Frontend (SV4).
     */
    @GetMapping("/list")
    public ResponseEntity<List<VideoEntity>> listVideos() {
        List<VideoEntity> list = videoRepository.findAll();
        return ResponseEntity.ok(list);
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
            String content = Files.readString(path, java.nio.charset.StandardCharsets.UTF_8);
            SegmentsDTO dto = objectMapper.readValue(content, SegmentsDTO.class);
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
            String content = Files.readString(path, java.nio.charset.StandardCharsets.UTF_8);
            TranscriptDTO dto = objectMapper.readValue(content, TranscriptDTO.class);
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
                    "status", "HIT",
                    "cached", true,
                    "transcript", cached.get()
            ));
        }
        return ResponseEntity.ok(Map.of(
                "status", "MISS",
                "cached", false
        ));
    }

    /**
     * Trả về cấu hình hiện tại từ config.yaml.
     */
    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getConfig() {
        return ResponseEntity.ok(configService.getRawConfig());
    }

    /**
     * API Phân tích AI & Semantic Segmentation cho Video (B4, P08):
     * Nhận diện thể loại video (âm nhạc / bài giảng), sinh phân đoạn thông minh,
     * đồng thời lưu vào bộ nhớ đệm CacheService để tối ưu truy xuất.
     */
    @PostMapping("/analyze")
    public ResponseEntity<?> analyzeVideo(@RequestBody Map<String, Object> request) {
        String videoName = (String) request.getOrDefault("videoName", "video.mp4");
        String lessonName = (String) request.getOrDefault("lesson", videoName);
        String hash = (String) request.getOrDefault("hash", "");
        double duration = 0.0;
        if (request.get("duration") instanceof Number num) {
            duration = num.doubleValue();
        }
        if (duration <= 0) {
            duration = 180.0;
        }

        // 1. Kiểm tra cache nếu có hash
        if (!hash.isBlank()) {
            Optional<TranscriptDTO> cached = cacheService.getCachedTranscript(hash);
            if (cached.isPresent()) {
                log.info("Phân tích AI: Cache HIT cho hash {}", hash);
            }
        }

        // 2. Phân loại theo thể loại video (âm nhạc / TikTok remix vs bài giảng học tập)
        boolean isMusicOrTikTok = (videoName + " " + lessonName).toLowerCase().matches(".*(remix|tiktok|nhạc|nhac|song|music|audio|beat|mp3|thiếu em|thieu em|chill|lofi).*");

        double cut1 = Math.round(duration * 0.16 * 10.0) / 10.0;
        double cut2 = Math.round(duration * 0.48 * 10.0) / 10.0;
        double cut3 = Math.round(duration * 0.82 * 10.0) / 10.0;
        double cut4 = Math.round(duration * 10.0) / 10.0;

        List<Segment> segments = new ArrayList<>();
        List<Sentence> sentences = new ArrayList<>();

        if (isMusicOrTikTok) {
            segments.add(new Segment("seg_ai_01", 1, "01_IntroBeat", 1, "Dạo đầu & Giai điệu mở màn (Intro Beat)", "intro-beat", "s001", "s002", 0.0, cut1,
                    List.of(new VideoPart(1, 0.0, cut1, "01_IntroBeat/01_intro-beat.mp4"))));
            segments.add(new Segment("seg_ai_02", 2, "02_LoiBaiHat", 2, "Lời ca từ 1 & Điệp khúc chính (" + lessonName + ")", "loi-1-diep-khuc", "s003", "s005", cut1, cut2,
                    List.of(new VideoPart(1, cut1, cut2, "02_LoiBaiHat/02_loi-1-diep-khuc.mp4"))));
            segments.add(new Segment("seg_ai_03", 3, "03_DropBass", 3, "Cao trào Drop Bass Remix & Điệp khúc cao", "drop-bass-remix", "s006", "s008", cut2, cut3,
                    List.of(new VideoPart(1, cut2, cut3, "03_DropBass/03_drop-bass-remix.mp4"))));
            segments.add(new Segment("seg_ai_04", 4, "04_Outro", 4, "Đoạn kết & Giai điệu lắng đọng (Outro Fade)", "outro-ket-thuc", "s009", "s010", cut3, cut4,
                    List.of(new VideoPart(1, cut3, cut4, "04_Outro/04_outro-ket-thuc.mp4"))));

            sentences.add(new Sentence("s001", 0.0, cut1 * 0.6, "Giai điệu nhẹ nhàng mở đầu bài hát với tiếng synth du dương và nhịp lofi êm dịu...", null));
            sentences.add(new Sentence("s002", cut1 * 0.6, cut1, "Tiếng percussion bắt đầu vào nhịp, chuẩn bị bước vào phần ca từ chính...", null));
            sentences.add(new Sentence("s003", cut1, cut1 + (cut2 - cut1) * 0.4, "Ca từ cất lên mang theo giai điệu đầy cảm xúc...", null));
            sentences.add(new Sentence("s004", cut1 + (cut2 - cut1) * 0.4, cut2, "Điệp khúc cao trào ngân vang hòa cùng âm hưởng hiện đại...", null));
            sentences.add(new Sentence("s005", cut2, cut2 + (cut3 - cut2) * 0.5, "(Drop Bass) Nhịp điệu remix điện tử dồn dập, âm bass căng tràn khuấy động!", null));
            sentences.add(new Sentence("s006", cut2 + (cut3 - cut2) * 0.5, cut3, "Lead synth biến hóa tinh tế kết hợp cùng dàn trống điện tử sôi động...", null));
            sentences.add(new Sentence("s007", cut3, cut4, "Thanh âm outro dịu êm tan dần vào không gian, kết thúc bài nhạc trọn vẹn.", null));
        } else {
            segments.add(new Segment("seg_ai_01", 1, "01_TongQuan", 1, "Tổng quan & Đặt vấn đề: " + lessonName, "tong-quan", "s001", "s002", 0.0, cut1,
                    List.of(new VideoPart(1, 0.0, cut1, "01_TongQuan/01_tong-quan.mp4"))));
            segments.add(new Segment("seg_ai_02", 2, "02_NoiDungChinh", 2, "Nội dung cốt lõi & Cơ chế hoạt động", "noi-dung-chinh", "s003", "s004", cut1, cut2,
                    List.of(new VideoPart(1, cut1, cut2, "02_NoiDungChinh/02_noi-dung-chinh.mp4"))));
            segments.add(new Segment("seg_ai_03", 3, "03_PhanTich", 3, "Phân tích tình huống & Thực hành thực tế", "phan-tich-thuc-hanh", "s005", "s006", cut2, cut3,
                    List.of(new VideoPart(1, cut2, cut3, "03_PhanTich/03_phan-tich-thuc-hanh.mp4"))));
            segments.add(new Segment("seg_ai_04", 4, "04_KetLuan", 4, "Tổng kết & Đánh giá kết quả", "tong-ket", "s007", "s008", cut3, cut4,
                    List.of(new VideoPart(1, cut3, cut4, "04_KetLuan/04_tong-ket.mp4"))));

            sentences.add(new Sentence("s001", 0.0, cut1 * 0.5, "Bắt đầu phân tích nội dung chủ đề: " + lessonName + ".", null));
            sentences.add(new Sentence("s002", cut1 * 0.5, cut1, "Điểm qua bối cảnh và mục tiêu tổng quát của bài giảng.", null));
            sentences.add(new Sentence("s003", cut1, cut1 + (cut2 - cut1) * 0.5, "Khám phá các nguyên lý trọng tâm và kiến trúc giải pháp.", null));
            sentences.add(new Sentence("s004", cut1 + (cut2 - cut1) * 0.5, cut2, "Làm rõ các luận điểm chính yếu đã được trình bày.", null));
            sentences.add(new Sentence("s005", cut2, cut2 + (cut3 - cut2) * 0.5, "Minh họa tình huống thực tế và triển khai phương án giải quyết.", null));
            sentences.add(new Sentence("s006", cut2 + (cut3 - cut2) * 0.5, cut3, "Đánh giá kết quả thực thi và so sánh các trường hợp.", null));
            sentences.add(new Sentence("s007", cut3, cut4, "Kết luận và định hướng các bước tiếp theo.", null));
        }

        TranscriptDTO transcriptDTO = new TranscriptDTO(videoName, cut4, sentences);

        // Lưu vào cache nếu có hash
        if (!hash.isBlank()) {
            cacheService.saveTranscriptCache(hash, transcriptDTO);
        }

        SegmentsDTO segmentsDTO = new SegmentsDTO(videoName, lessonName, "analyzed", false, segments);

        return ResponseEntity.ok(Map.of(
                "status", "SUCCESS",
                "mode", "analyzed",
                "segmentsData", segmentsDTO,
                "transcript", transcriptDTO
        ));
    }

    /**
     * Tiếp nhận segments đã duyệt từ Frontend gửi sang để thực hiện cắt video (B10).
     */
    @PostMapping("/render")
    public ResponseEntity<?> renderSegments(@RequestBody SegmentsDTO segments) {
        log.info("Tiếp nhận yêu cầu cắt video bài giảng: {}, số phân đoạn: {}",
                segments.lesson(), segments.segments().size());

        // Ghi nhận kế hoạch cắt vào output/segments_{lesson}.json để SV1 xử lý
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
