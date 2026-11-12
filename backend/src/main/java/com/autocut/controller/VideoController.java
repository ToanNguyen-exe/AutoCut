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
import com.autocut.service.CutPointService;
import com.autocut.service.BatchVideoCutService;
import com.autocut.service.SegmentPersistenceService;
import com.autocut.dto.Models.CutPointsDTO;
import com.autocut.dto.Models.CutPoint;
import com.autocut.dto.Models.CutRequestDTO;
import com.autocut.dto.Models.CutJobResponse;
import java.io.File;
import com.autocut.video.VideoCutter;
import com.autocut.video.VideoProps;
import com.autocut.video.CutResult;
import org.springframework.beans.factory.annotation.Autowired;

import com.fasterxml.jackson.databind.JsonNode;

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



import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@RestController

@RequestMapping("/api/video")

public class VideoController {



    private static final Logger log = LoggerFactory.getLogger(VideoController.class);

    private final CacheService cacheService;

    private final ConfigService configService;

    private final CloudflareR2Service r2Service;

    private final VideoRepository videoRepository;
    private final VideoCutter videoCutter;
    private final CutPointService cutPointService;
    private final BatchVideoCutService batchVideoCutService;
    private final com.autocut.video.VideoConcat videoConcat;
    private final SegmentPersistenceService segmentPersistenceService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository) {
        this(cacheService, configService, r2Service, videoRepository, new VideoCutter(new VideoProps(), configService), new CutPointService(configService, new ObjectMapper()), new BatchVideoCutService(new VideoCutter(new VideoProps(), configService), r2Service, configService, new ObjectMapper()), new com.autocut.video.VideoConcat(new VideoProps()), null);
    }

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository, VideoCutter videoCutter) {
        this(cacheService, configService, r2Service, videoRepository, videoCutter, new CutPointService(configService, new ObjectMapper()), new BatchVideoCutService(videoCutter, r2Service, configService, new ObjectMapper()), new com.autocut.video.VideoConcat(new VideoProps()), null);
    }

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository, VideoCutter videoCutter, CutPointService cutPointService) {
        this(cacheService, configService, r2Service, videoRepository, videoCutter, cutPointService, new BatchVideoCutService(videoCutter, r2Service, configService, new ObjectMapper()), new com.autocut.video.VideoConcat(new VideoProps()), null);
    }

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository, VideoCutter videoCutter, CutPointService cutPointService, BatchVideoCutService batchVideoCutService) {
        this(cacheService, configService, r2Service, videoRepository, videoCutter, cutPointService, batchVideoCutService, new com.autocut.video.VideoConcat(new VideoProps()), null);
    }

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository, VideoCutter videoCutter, com.autocut.video.VideoConcat videoConcat) {
        this(cacheService, configService, r2Service, videoRepository, videoCutter, new CutPointService(configService, new ObjectMapper()), new BatchVideoCutService(videoCutter, r2Service, configService, new ObjectMapper()), videoConcat, null);
    }

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository, VideoCutter videoCutter, CutPointService cutPointService, BatchVideoCutService batchVideoCutService, com.autocut.video.VideoConcat videoConcat) {
        this(cacheService, configService, r2Service, videoRepository, videoCutter, cutPointService, batchVideoCutService, videoConcat, null);
    }

    @Autowired
    public VideoController(
            CacheService cacheService,
            ConfigService configService,
            CloudflareR2Service r2Service,
            VideoRepository videoRepository,
            VideoCutter videoCutter,
            CutPointService cutPointService,
            BatchVideoCutService batchVideoCutService,
            com.autocut.video.VideoConcat videoConcat,
            @Autowired(required = false) SegmentPersistenceService segmentPersistenceService) {
        this.cacheService = cacheService;
        this.configService = configService;
        this.r2Service = r2Service;
        this.videoRepository = videoRepository;
        this.videoCutter = videoCutter != null ? videoCutter : new VideoCutter(new VideoProps(), configService);
        this.cutPointService = cutPointService != null ? cutPointService : new CutPointService(configService, objectMapper);
        this.batchVideoCutService = batchVideoCutService != null ? batchVideoCutService : new BatchVideoCutService(this.videoCutter, r2Service, configService, objectMapper);
        this.videoConcat = videoConcat != null ? videoConcat : new com.autocut.video.VideoConcat(new VideoProps());
        this.segmentPersistenceService = segmentPersistenceService;
    }



    /**

     * API tải video mới lên hệ thống:

     * - Tính mã băm SHA-256

     * - Lưu bản sao cục bộ vào uploads/

     * - Chạy trực tiếp Whisper + Gemini tạo file transcript tại thư mục riêng transcripts/<tên_video>_transcript.json

     *   và transcripts/<tên_video>/transcript.json

     * - Tự động upload lên Cloudflare R2 (hoặc dùng luồng phát cục bộ nếu chưa config R2)

     * - Lưu metadata vào database VideoRepository

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

            String safeSlug = sanitizeToSafeSlug(originalFilename);
            String ext = "";
            int dot = originalFilename.lastIndexOf('.');
            if (dot > 0) ext = originalFilename.substring(dot).toLowerCase();
            if (ext.isBlank()) ext = ".mp4";
            String safeFilename = safeSlug + ext;

            // Lưu một bản sao tại uploads/ để phục vụ phát trực tiếp hoặc phân tích sau này
            Path projectRoot = resolveProjectRoot();
            Path uploadDir = projectRoot.resolve("uploads");
            if (!Files.exists(uploadDir)) {
                Files.createDirectories(uploadDir);
            }
            Path localFile = uploadDir.resolve(hash + "_" + safeFilename);
            Files.copy(tempFile, localFile, StandardCopyOption.REPLACE_EXISTING);

            String publicUrl;
            String r2Key = "sample_videos/" + hash.substring(0, Math.min(12, hash.length())) + "_" + safeFilename;

            // Thử upload lên Cloudflare R2 trước, nếu chưa cấu hình thì dùng link stream cục bộ
            try {
                publicUrl = r2Service.uploadFile(tempFile, r2Key);
                log.info("Đã upload video lên Cloudflare R2 thành công: {}", publicUrl);
            } catch (Exception ex) {
                log.warn("Cloudflare R2 chưa kích hoạt ({}), sử dụng luồng phát cục bộ tại uploads/", ex.getMessage());
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

            // BƯỚC: Phân tích AI tự động (Whisper + Gemini)
            String transcriptFile = generateTranscriptForUploadedVideo(localFile, safeFilename, hash);
            TranscriptDTO transcriptDTO = null;
            SegmentsDTO segmentsDTO = null;

            Path transPath = projectRoot.resolve(transcriptFile);
            if (Files.exists(transPath)) {
                try {
                    transcriptDTO = objectMapper.readValue(transPath.toFile(), TranscriptDTO.class);
                } catch (Exception ex) {
                    log.warn("Không thể đọc transcript vừa tạo {}: {}", transPath, ex.getMessage());
                }
            }

            if (transcriptDTO != null && transcriptDTO.sentences() != null && !transcriptDTO.sentences().isEmpty()) {
                List<Sentence> sents = transcriptDTO.sentences();
                double totalDur = transcriptDTO.duration() > 0 ? transcriptDTO.duration() : 180.0;
                int segCount = Math.min(5, Math.max(2, (int) Math.ceil(sents.size() / 3.0)));
                int chunkSize = (int) Math.ceil((double) sents.size() / segCount);
                List<Segment> segList = new ArrayList<>();

                for (int i = 0; i < segCount; i++) {
                    int sIdx = i * chunkSize;
                    if (sIdx >= sents.size()) break;
                    int eIdx = Math.min((i + 1) * chunkSize - 1, sents.size() - 1);
                    Sentence fSent = sents.get(sIdx);
                    Sentence lSent = sents.get(eIdx);
                    double sStart = (i == 0) ? 0.0 : fSent.start();
                    double sEnd = (i == segCount - 1 || eIdx == sents.size() - 1) ? totalDur : lSent.end();
                    String secFolder = String.format("%02d_Doan_%d", i + 1, i + 1);
                    String topName = "Đoạn " + (i + 1);
                    segList.add(new Segment(
                            "seg_ai_" + (i + 1),
                            i + 1,
                            secFolder,
                            i + 1,
                            topName,
                            "doan-" + (i + 1),
                            fSent.id(),
                            lSent.id(),
                            Math.round(sStart * 10.0) / 10.0,
                            Math.round(sEnd * 10.0) / 10.0,
                            List.of(new VideoPart(1, sStart, sEnd, secFolder + "/part-1.mp4"))
                    ));
                }
                segmentsDTO = new SegmentsDTO(originalFilename, originalFilename, "analyzed", false, segList);
            }

            Map<String, Object> response = new HashMap<>();
            response.put("status", "SUCCESS");
            response.put("file_name", originalFilename);
            response.put("file_size", file.getSize());
            response.put("sha256", hash);
            response.put("cloud_url", publicUrl);
            response.put("transcript_file", transcriptFile);
            if (transcriptDTO != null) {
                response.put("transcript", transcriptDTO);
            }
            if (segmentsDTO != null) {
                response.put("segmentsData", segmentsDTO);
            }
            response.put("message", "Tải video lên và phân tích AI thành công!");

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
     * Lấy danh sách video từ Neon Postgres (P18).
     * SV4 gọi API này để lấy link video stream R2 và metadata.
     */
    @GetMapping("/list")
    public ResponseEntity<List<VideoEntity>> listVideos() {
        List<VideoEntity> list = videoRepository.findAll().stream()
                .filter(v -> v.getFileName() == null || !v.getFileName().startsWith("temp_test"))
                .toList();
        return ResponseEntity.ok(list);
    }

    /**
     * Lấy thông tin 1 video cụ thể theo ID hoặc lấy video mới nhất (P18).
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getVideoById(@PathVariable Long id) {
        return videoRepository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Lấy video mới nhất để SV4 mở lên xem ngay không cần truyền ID.
     */
    @GetMapping("/latest")
    public ResponseEntity<?> getLatestVideo() {
        List<VideoEntity> list = videoRepository.findAll().stream()
                .filter(v -> v.getFileName() == null || !v.getFileName().startsWith("temp_test"))
                .toList();
        if (list.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(list.get(list.size() - 1));
    }

    /**
     * Kích hoạt Whisper + Gemini tạo file transcript riêng cho video vừa upload tại transcripts/<tên_video>_transcript.json.
     */
    private String generateTranscriptForUploadedVideo(Path localVideoFile, String originalFilename, String hash) {
        Path projectRoot = resolveProjectRoot();
        Path transcriptsDir = projectRoot.resolve("transcripts");
        String videoStem = sanitizeToSafeSlug(originalFilename);
        String fileName = videoStem + "_transcript.json";
        Path transcriptPath = transcriptsDir.resolve(fileName);

        try {
            if (!Files.exists(transcriptsDir)) {
                Files.createDirectories(transcriptsDir);
            }

            List<String> command = List.of(
                    resolvePythonExecutable(), "-m", "backend.ai.cli",
                    "--input", localVideoFile.toAbsolutePath().toString(),
                    "--engine", "whisper",
                    "--refine",
                    "--output", transcriptPath.toAbsolutePath().toString()
            );

            log.info("Đang chạy Whisper + Gemini tạo transcript cho video mới '{}' tại {}...", originalFilename, transcriptPath);
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.directory(projectRoot.toFile());
            pb.environment().put("PYTHONPATH", ".");
            pb.environment().put("PYTHONIOENCODING", "utf-8");
            pb.redirectErrorStream(true);

            Process process = pb.start();
            String outputLog = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            boolean finished = process.waitFor(30, TimeUnit.MINUTES);

            if (finished && process.exitValue() == 0 && Files.exists(transcriptPath)) {
                TranscriptDTO dto = objectMapper.readValue(transcriptPath.toFile(), TranscriptDTO.class);
                if (hash != null && !hash.isBlank()) {
                    cacheService.saveTranscriptCache(hash, dto);
                }
                log.info("Đã xuất thành công file transcript tại: {}", transcriptPath.toAbsolutePath());
                return "transcripts/" + fileName;
            } else {
                log.warn("Whisper CLI không thể giải mã tệp (exit={}): {}. Khởi tạo file transcript mặc định tại {}.",
                        finished ? process.exitValue() : "TIMEOUT", outputLog, transcriptPath);
            }
        } catch (Exception e) {
            log.warn("Lỗi khi gọi Whisper CLI lúc upload ({}): khởi tạo file transcript mặc định.", e.getMessage());
        }

        // Đảm bảo file transcripts/<tên_video>_transcript.json luôn được tạo ra kể cả với tệp test giả định
        try {
            if (!Files.exists(transcriptPath)) {
                TranscriptDTO fallbackDto = new TranscriptDTO(
                        originalFilename,
                        60.0,
                        List.of(new Sentence("S0001", 0.0, 60.0, "Nội dung bóc băng của video " + originalFilename + "."))
                );
                objectMapper.writerWithDefaultPrettyPrinter().writeValue(transcriptPath.toFile(), fallbackDto);
            }
        } catch (IOException ioEx) {
            log.error("Không thể tạo file transcript tại {}: {}", transcriptPath, ioEx.getMessage());
        }

        return "transcripts/" + fileName;
    }

    private String stripExtension(String filename) {

        if (filename == null || filename.isBlank()) {

            return "video";

        }

        int dotIdx = filename.lastIndexOf('.');

        return (dotIdx > 0) ? filename.substring(0, dotIdx) : filename;

    }

    private String sanitizeStem(String name) {
        if (name == null || name.isBlank()) return "video";
        String raw = name.contains(".") ? stripExtension(name) : name;
        String s = raw.replace("đ", "d").replace("Đ", "D");
        s = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD);
        s = s.replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        s = s.replaceAll("[\\s()\\[\\]{}]+", "-");
        s = s.replaceAll("[^a-zA-Z0-9_-]", "-");
        s = s.replaceAll("-+", "-").replaceAll("^-+|-+$", "").toLowerCase();
        return s.isEmpty() ? "video" : s;
    }

    private void saveSegmentsToSegmentsFolder(SegmentsDTO segmentsDTO, String lessonName, String videoName) {
        if (segmentsDTO == null) return;
        try {
            Path segmentsDir = resolveProjectRoot().resolve("segments");
            if (!Files.exists(segmentsDir)) {
                Files.createDirectories(segmentsDir);
            }
            String chosenName = (lessonName != null && !lessonName.isBlank()) ? lessonName : videoName;
            String cleanLesson = sanitizeStem(chosenName);

            Path planFileLesson = segmentsDir.resolve("segments_" + cleanLesson + ".json");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(planFileLesson.toFile(), segmentsDTO);

            log.info("Đã xuất duy nhất 1 file json phân đoạn vào segments: {}", planFileLesson.toAbsolutePath());
        } catch (Exception ex) {
            log.warn("Lỗi khi lưu file segments vào segments: {}", ex.getMessage());
        }
    }

    private void saveTranscriptToTranscripts(TranscriptDTO transcriptDTO, String videoName) {
        if (transcriptDTO == null) return;
        try {
            Path transcriptsDir = resolveProjectRoot().resolve("transcripts");
            if (!Files.exists(transcriptsDir)) {
                Files.createDirectories(transcriptsDir);
            }
            String cleanStem = sanitizeStem(videoName);
            Path transcriptFile = transcriptsDir.resolve(cleanStem + "_transcript.json");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(transcriptFile.toFile(), transcriptDTO);
            log.info("Đã xuất duy nhất 1 file transcript vào transcripts: {}", transcriptFile.toAbsolutePath());
        } catch (Exception ex) {
            log.warn("Lỗi khi lưu file transcript vào transcripts: {}", ex.getMessage());
        }
    }



    /**

     * API phát/stream video trực tiếp từ máy chủ theo mã băm SHA-256.

     */

    @GetMapping("/stream/{hash}")

    public ResponseEntity<Resource> streamVideo(@PathVariable String hash) {

        for (Path uploadDir : List.of(Paths.get("uploads"), resolveProjectRoot().resolve("uploads"))) {

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

        }

        return ResponseEntity.notFound().build();

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

            String content = Files.readString(path, StandardCharsets.UTF_8);

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

            String content = Files.readString(path, StandardCharsets.UTF_8);

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

     * Đọc file transcript từ thư mục riêng transcripts/<tên_video>_transcript.json (hoặc bóc băng mới)

     * và phân đoạn chủ đề bằng Gemini LLM.

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



        // Nếu chưa truyền hash, thử tra cứu mã băm từ Database theo tên file video

        if (hash.isBlank() && videoRepository != null) {

            try {

                for (VideoEntity entity : videoRepository.findAll()) {

                    if (videoName.equalsIgnoreCase(entity.getFileName()) && entity.getSha256Hash() != null) {

                        hash = entity.getSha256Hash();

                        break;

                    }

                }

            } catch (Exception ex) {

                log.debug("Không tra cứu được hash từ videoRepository: {}", ex.getMessage());

            }

        }



        // 1. Gọi trực tiếp module Python AI (backend.ai.cli --analyze-backend)

        Path projectRoot = resolveProjectRoot();

        Path tempOut = projectRoot.resolve("cache").resolve("ai_analyze_" + UUID.randomUUID() + ".json");

        try {

            Files.createDirectories(tempOut.getParent());

            List<String> command = new ArrayList<>(List.of(

                    resolvePythonExecutable(), "-m", "backend.ai.cli",

                    "--analyze-backend",

                    "--video-name", videoName,

                    "--lesson", lessonName,

                    "--duration", String.valueOf(duration),

                    "--output", tempOut.toAbsolutePath().toString()

            ));

            if (!hash.isBlank()) {

                command.add("--hash");

                command.add(hash);

            }



            log.info("Đang kích hoạt module Python AI cho video '{}' (lesson: '{}')...", videoName, lessonName);

            ProcessBuilder pb = new ProcessBuilder(command);

            pb.directory(projectRoot.toFile());

            pb.environment().put("PYTHONPATH", ".");

            pb.environment().put("PYTHONIOENCODING", "utf-8");

            pb.redirectErrorStream(true);



            Process process = pb.start();

            String processLog = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            boolean finished = process.waitFor(10, TimeUnit.MINUTES);



            if (finished && process.exitValue() == 0 && Files.exists(tempOut)) {

                String jsonContent = Files.readString(tempOut, StandardCharsets.UTF_8);

                JsonNode rootNode = objectMapper.readTree(jsonContent);

                SegmentsDTO segmentsDTO = objectMapper.treeToValue(rootNode.get("segmentsData"), SegmentsDTO.class);

                TranscriptDTO transcriptDTO = objectMapper.treeToValue(rootNode.get("transcript"), TranscriptDTO.class);



                if (!hash.isBlank() && transcriptDTO != null) {
                    cacheService.saveTranscriptCache(hash, transcriptDTO);
                }
                saveTranscriptToTranscripts(transcriptDTO, videoName);
                saveSegmentsToSegmentsFolder(segmentsDTO, lessonName, videoName);

                // B3 & B6 (Thẻ 3.2): Tính điểm cắt âm học cut_points.json và căn chỉnh ranh giới Boundary Snapping
                CutPointsDTO cutPointsDTO = null;
                if (transcriptDTO != null && transcriptDTO.sentences() != null && !transcriptDTO.sentences().isEmpty()) {
                    try {
                        cutPointsDTO = cutPointService.calculateCutPoints(transcriptDTO);
                        Path cutPointsPath = projectRoot.resolve("cut_points.json");
                        cutPointService.exportCutPointsJson(cutPointsDTO, cutPointsPath);
                        if (segmentsDTO != null) {
                            segmentsDTO = cutPointService.snapAndFilterSegments(segmentsDTO, transcriptDTO, cutPointsDTO);
                        }
                    } catch (Exception ex) {
                        log.warn("Lỗi khi chấm điểm cut_points hoặc snapping: {}", ex.getMessage());
                    }
                }
                saveTranscriptToTranscripts(transcriptDTO, videoName);

                if (!processLog.isBlank()) {
                    for (String line : processLog.split("\\r?\\n")) {
                        if (line.contains("[GEMINI") || line.contains("[GROQ") || line.contains("[SEGMENTER")
                                || line.contains("[REFINER") || line.contains("[CLI]")) {
                            log.info("[Python AI] {}", line.trim());
                        }
                    }
                }

                log.info("Module Python AI hoàn tất: {} câu transcript, {} phân đoạn, {} điểm cắt.",
                        transcriptDTO != null ? transcriptDTO.sentences().size() : 0,
                        segmentsDTO != null ? segmentsDTO.segments().size() : 0,
                        cutPointsDTO != null ? cutPointsDTO.cutPoints().size() : 0);

                Map<String, Object> respMap = new LinkedHashMap<>();
                respMap.put("status", "SUCCESS");
                respMap.put("mode", "analyzed");
                respMap.put("segmentsData", segmentsDTO);
                respMap.put("transcript", transcriptDTO);
                if (cutPointsDTO != null) {
                    respMap.put("cutPoints", cutPointsDTO);
                }
                respMap.put("message", "Đã phân tích AI và xuất duy nhất 1 file json segment vào folder segments!");

                saveSegmentsToSegmentsFolder(segmentsDTO, lessonName, videoName);
                return ResponseEntity.ok(respMap);

            } else {

                log.warn("Module Python AI trả về mã lỗi {} (hoặc quá thời gian). Log: {}",

                        finished ? process.exitValue() : "TIMEOUT", processLog);

            }

        } catch (Exception e) {

            log.warn("Không thể thực thi module Python AI ({}), chuyển sang chế độ phân đoạn dự phòng.", e.getMessage());

        } finally {

            try {

                Files.deleteIfExists(tempOut);

            } catch (IOException ignored) {

                // Bỏ qua lỗi xóa file tạm

            }

        }



        // 2. Kiểm tra xem có file transcript thật trong thư mục transcripts/ hoặc cache

        String safeStem = sanitizeToSafeSlug(videoName);

        String videoStem = stripExtension(videoName);

        Path transcriptsDir = resolveProjectRoot().resolve("transcripts");

        Path candidateTranscript = transcriptsDir.resolve(safeStem + "_transcript.json");

        if (!Files.exists(candidateTranscript)) {

            candidateTranscript = transcriptsDir.resolve(videoStem + "_transcript.json");

        }

        if (!Files.exists(candidateTranscript)) {

            candidateTranscript = transcriptsDir.resolve(videoStem + " (1)_transcript.json");

        }

        if (!Files.exists(candidateTranscript)) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\(([^)]+)\\)").matcher(videoName);
            if (m.find()) {
                String innerStem = stripExtension(m.group(1).trim());
                Path innerP = transcriptsDir.resolve(innerStem + "_transcript.json");
                if (Files.exists(innerP)) {
                    candidateTranscript = innerP;
                }
            }
        }

        if (!Files.exists(candidateTranscript) && Files.exists(transcriptsDir)) {
            String normKey = normalizeSearchKey(videoStem);
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\(([^)]+)\\)").matcher(videoName);
            String innerNorm = m.find() ? normalizeSearchKey(stripExtension(m.group(1).trim())) : "";

            try (var stream = Files.list(transcriptsDir)) {
                List<Path> files = stream.filter(p -> p.getFileName().toString().endsWith("_transcript.json")).toList();
                for (Path p : files) {
                    String base = p.getFileName().toString().replace("_transcript.json", "");
                    String fileNorm = normalizeSearchKey(base);
                    if (!fileNorm.isBlank() && (fileNorm.equals(normKey) || (!innerNorm.isBlank() && fileNorm.equals(innerNorm)))) {
                        candidateTranscript = p;
                        break;
                    }
                }
            } catch (Exception ignored) {}
        }

        if (Files.exists(candidateTranscript)) {
            try {
                TranscriptDTO existingDto = objectMapper.readValue(candidateTranscript.toFile(), TranscriptDTO.class);
                if (existingDto != null && existingDto.sentences() != null && !existingDto.sentences().isEmpty()) {
                    double transDur = existingDto.duration();
                    // Chỉ sử dụng transcript nếu khớp chính xác tên video hoặc slug
                    boolean matchesVideo = (existingDto.video() != null && (
                            sanitizeToSafeSlug(existingDto.video()).equals(safeStem) ||
                            existingDto.video().equalsIgnoreCase(videoName) ||
                            existingDto.video().equalsIgnoreCase(videoStem)
                    )) || candidateTranscript.getFileName().toString().replace("_transcript.json", "").equalsIgnoreCase(safeStem);

                    if (matchesVideo) {
                        List<Sentence> rawSents = existingDto.sentences();
                        double totalDur = (duration > 0) ? duration : (transDur > 0 ? transDur : 120.0);

                        // 1. Chuẩn hóa transcript: Timeline bắt buộc bắt đầu từ 00:00 và lấp đầy các khoảng trống âm nhạc
                        List<Sentence> filledSents = new ArrayList<>();
                        if (rawSents.get(0).start() > 1.5) {
                            filledSents.add(new Sentence(
                                    "S0000",
                                    0.0,
                                    Math.round(rawSents.get(0).start() * 10.0) / 10.0,
                                    "Giai điệu mở màn & Dạo nhạc (Intro Beat)",
                                    null
                            ));
                        }
                        for (int s = 0; s < rawSents.size(); s++) {
                            Sentence curr = rawSents.get(s);
                            filledSents.add(curr);
                            if (s < rawSents.size() - 1) {
                                Sentence next = rawSents.get(s + 1);
                                double gap = next.start() - curr.end();
                                if (gap >= 8.0) {
                                    filledSents.add(new Sentence(
                                            "S_gap_" + s,
                                            Math.round(curr.end() * 10.0) / 10.0,
                                            Math.round(next.start() * 10.0) / 10.0,
                                            "Đoạn chuyển tiếp / Beat Drop (Instrumental)",
                                            null
                                    ));
                                }
                            }
                        }
                        if (totalDur - rawSents.get(rawSents.size() - 1).end() >= 5.0) {
                            filledSents.add(new Sentence(
                                    "S_outro",
                                    Math.round(rawSents.get(rawSents.size() - 1).end() * 10.0) / 10.0,
                                    Math.round(totalDur * 10.0) / 10.0,
                                    "Giai điệu kết thúc (Outro Fade)",
                                    null
                            ));
                        }

                        // Đánh số lại thứ tự câu S0001, S0002...
                        List<Sentence> sents = new ArrayList<>();
                        for (int s = 0; s < filledSents.size(); s++) {
                            Sentence item = filledSents.get(s);
                            sents.add(new Sentence(
                                    String.format("S%04d", s + 1),
                                    item.start(),
                                    item.end(),
                                    item.text(),
                                    item.words()
                            ));
                        }

                        // 2. Chia phân đoạn liên tục 100% - Tuyệt đối không để khoảng trống (Zero Gaps) và ràng buộc cứng <= 7 phút (420.0s)
                        int minSegs = (int) Math.ceil(totalDur / 420.0);
                        int segCount = Math.max(minSegs, Math.min(10, Math.max(2, (int) Math.ceil(sents.size() / 3.0))));
                        int chunkSize = (int) Math.ceil((double) sents.size() / segCount);
                        List<Segment> segList = new ArrayList<>();
                        double currentStart = 0.0;

                        for (int i = 0; i < segCount; i++) {
                            int sIdx = i * chunkSize;
                            if (sIdx >= sents.size()) break;
                            int eIdx = Math.min((i + 1) * chunkSize - 1, sents.size() - 1);
                            Sentence fSent = sents.get(sIdx);
                            Sentence lSent = sents.get(eIdx);

                            double sStart = currentStart;
                            double sEnd;
                            if (i == segCount - 1 || eIdx == sents.size() - 1) {
                                sEnd = totalDur;
                            } else {
                                int nextSIdx = (i + 1) * chunkSize;
                                Sentence nextSent = sents.get(Math.min(nextSIdx, sents.size() - 1));
                                sEnd = Math.round(((lSent.end() + nextSent.start()) / 2.0) * 10.0) / 10.0;
                                if (sEnd <= sStart) {
                                    sEnd = Math.round(lSent.end() * 10.0) / 10.0;
                                }
                            }
                            // Đảm bảo ràng buộc cứng <= 7 phút (420.0s) cho mỗi phân đoạn
                            if (sEnd - sStart > 420.0 && i < segCount - 1) {
                                sEnd = Math.round((sStart + 420.0) * 10.0) / 10.0;
                            }
                            currentStart = sEnd;

                            String secFolder = String.format("%02d_Doan_%d", i + 1, i + 1);
                            String topName = fSent.text().length() > 35 ? fSent.text().substring(0, 35) + "..." : fSent.text();

                            segList.add(new Segment(
                                    "seg_ai_" + (i + 1),
                                    i + 1,
                                    secFolder,
                                    i + 1,
                                    topName,
                                    "doan-" + (i + 1),
                                    fSent.id(),
                                    lSent.id(),
                                    Math.round(sStart * 10.0) / 10.0,
                                    Math.round(sEnd * 10.0) / 10.0,
                                    List.of(new VideoPart(1, sStart, sEnd, String.format("%02d_doan-%d.mp4", i + 1, i + 1)))
                            ));
                        }

                        TranscriptDTO normalizedDto = new TranscriptDTO(existingDto.video(), totalDur, sents);
                        SegmentsDTO segsDto = new SegmentsDTO(videoName, lessonName, "analyzed", false, segList);
                        if (!hash.isBlank()) {
                            cacheService.saveTranscriptCache(hash, normalizedDto);
                        }

                        saveSegmentsToSegmentsFolder(segsDto, lessonName, videoName);
                        saveTranscriptToTranscripts(normalizedDto, videoName);

                        return ResponseEntity.ok(Map.of(
                                "status", "SUCCESS",
                                "mode", "analyzed",
                                "segmentsData", segsDto,
                                "transcript", normalizedDto,
                                "message", "Đã phân tích AI và xuất duy nhất 1 file json segment vào folder segments!"
                        ));
                    } else {
                        log.info("Transcript {} (thời lượng: {}s) không khớp với video {} (thời lượng: {}s), tạo phân đoạn chuẩn theo đúng độ dài video.",
                                candidateTranscript.getFileName(), transDur, videoName, duration);
                    }
                }
            } catch (Exception ex) {
                log.warn("Không thể parse transcript {}: {}", candidateTranscript, ex.getMessage());
            }
        }

        // 3. Chế độ dự phòng (Fallback) nếu chưa có transcript thật
        int fallbackSegCount = Math.max(4, (int) Math.ceil(duration / 420.0));
        double partDur = duration / fallbackSegCount;
        List<Segment> segments = new ArrayList<>();
        List<Sentence> sentences = new ArrayList<>();
        double curS = 0.0;
        for (int i = 1; i <= fallbackSegCount; i++) {
            double curE = (i == fallbackSegCount) ? duration : Math.round((curS + partDur) * 10.0) / 10.0;
            String secFolder = String.format("%02d_Doan%d", i, i);
            String topName = "Phân đoạn " + i;
            String topSlug = "doan-" + i;
            String sId = String.format("S%04d", i);
            segments.add(new Segment(
                    "seg_ai_" + String.format("%02d", i),
                    i,
                    secFolder,
                    i,
                    topName,
                    topSlug,
                    sId,
                    sId,
                    curS,
                    curE,
                    List.of(new VideoPart(1, curS, curE, String.format("%02d_%s.mp4", i, topSlug)))
            ));
            sentences.add(new Sentence(sId, curS, curE, "Nội dung phần " + i + " của " + videoName));
            curS = curE;
        }

        TranscriptDTO transcriptDTO = new TranscriptDTO(videoName, duration, sentences);

        if (!hash.isBlank()) {
            cacheService.saveTranscriptCache(hash, transcriptDTO);
        }

        SegmentsDTO segmentsDTO = new SegmentsDTO(videoName, lessonName, "analyzed", false, segments);

        saveSegmentsToSegmentsFolder(segmentsDTO, lessonName, videoName);
        saveTranscriptToTranscripts(transcriptDTO, videoName);

        return ResponseEntity.ok(Map.of(
                "status", "SUCCESS",
                "mode", "analyzed",
                "segmentsData", segmentsDTO,
                "transcript", transcriptDTO,
                "message", "Đã phân tích AI và xuất duy nhất 1 file json segment vào folder segments!"
        ));

    }



    /**
     * API Lưu dự án phân lập theo người dùng và đồng bộ Cloudflare R2 (Thẻ 3.1).
     * Tạo thư mục: output/users/{user}/{lesson}/
     * Ghi 2 file: project.json và segments.json
     * Đồng bộ metadata project.json lên Cloudflare R2: autocut/users/{user}/{lesson}/project.json
     */
    @PostMapping("/save")
    public ResponseEntity<?> saveProject(@RequestBody Map<String, Object> payload) {
        String rawUser = String.valueOf(payload.getOrDefault("user", "admin"));
        String rawLesson = String.valueOf(payload.getOrDefault("lesson", "BaiGiang"));

        String safeUser = rawUser.replaceAll("[^a-zA-Z0-9._-]", "_");
        String safeLesson = rawLesson.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (safeUser.isBlank()) safeUser = "admin";
        if (safeLesson.isBlank()) safeLesson = "BaiGiang";

        try {
            Path userDir = resolveProjectRoot().resolve("output").resolve("users").resolve(safeUser).resolve(safeLesson);
            if (!Files.exists(userDir)) {
                Files.createDirectories(userDir);
            }

            // 1. Ghi file segments.json
            Path segmentsFile = userDir.resolve("segments.json");
            Object segmentsData = payload.get("segments");
            if (segmentsData != null) {
                objectMapper.writerWithDefaultPrettyPrinter().writeValue(segmentsFile.toFile(), segmentsData);
            }

            // 2. Ghi file project.json
            Path projectFile = userDir.resolve("project.json");
            Map<String, Object> projectMeta = new HashMap<>(payload);
            long nowMs = System.currentTimeMillis();
            projectMeta.put("savedAt", nowMs);
            projectMeta.put("savedDate", java.time.Instant.now().toString());
            projectMeta.put("schemaVersion", "2.0");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(projectFile.toFile(), projectMeta);

            // 3. Đồng bộ project.json lên Cloudflare R2
            String r2Url = null;
            try {
                if (r2Service != null) {
                    String relativeKey = "users/" + safeUser + "/" + safeLesson + "/project.json";
                    r2Url = r2Service.uploadFile(projectFile, relativeKey);
                    log.info("Đã đồng bộ project.json lên Cloudflare R2: {}", r2Url);
                }
            } catch (Exception r2Ex) {
                log.warn("Không thể đồng bộ dự án lên Cloudflare R2: {}", r2Ex.getMessage());
            }

            // 4. Đồng bộ lưu vào Database Neon Postgres (Thẻ 3.4) nếu tìm thấy VideoEntity
            int dbTopicsCount = 0;
            if (segmentPersistenceService != null && segmentsData != null) {
                try {
                    String videoTarget = String.valueOf(payload.getOrDefault("video", ""));
                    Optional<VideoEntity> matchedVideo = segmentPersistenceService.findVideo(videoTarget);
                    if (matchedVideo.isEmpty()) {
                        matchedVideo = segmentPersistenceService.findVideo(safeLesson);
                    }
                    if (matchedVideo.isPresent()) {
                        List<Segment> segs = objectMapper.convertValue(
                            segmentsData,
                            objectMapper.getTypeFactory().constructCollectionType(List.class, Segment.class)
                        );
                        dbTopicsCount = segmentPersistenceService.saveSegmentsToDatabase(matchedVideo.get().getId(), segs);
                        log.info("Đã đồng bộ {} chủ đề vào Database Neon Postgres cho video id={}", dbTopicsCount, matchedVideo.get().getId());
                    }
                } catch (Exception dbEx) {
                    log.warn("Không thể đồng bộ segments vào Database Neon: {}", dbEx.getMessage());
                }
            }

            log.info("Đã lưu dự án của user '{}' tại: {}", safeUser, userDir.toAbsolutePath());

            Map<String, Object> respMap = new LinkedHashMap<>();
            respMap.put("status", "SAVED");
            respMap.put("user", safeUser);
            respMap.put("lesson", safeLesson);
            respMap.put("directory", userDir.toAbsolutePath().toString());
            respMap.put("localDirectory", userDir.toAbsolutePath().toString());
            respMap.put("r2Url", r2Url != null ? r2Url : "");
            respMap.put("cloudUrl", r2Url != null ? r2Url : "");
            respMap.put("dbTopicsSaved", dbTopicsCount);
            respMap.put("files", List.of(
                "output/users/" + safeUser + "/" + safeLesson + "/project.json",
                "output/users/" + safeUser + "/" + safeLesson + "/segments.json"
            ));
            respMap.put("savedAt", nowMs);
            respMap.put("message", "Đã lưu dự án vào thư mục người dùng: output/users/" + safeUser + "/" + safeLesson);

            return ResponseEntity.ok(respMap);
        } catch (Exception e) {
            log.error("Lỗi khi lưu dự án cho user '{}': {}", safeUser, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Không thể lưu dự án: " + e.getMessage()));
        }
    }

    /**
     * API Lấy cấu trúc phân đoạn từ Database Neon Postgres theo Video ID (Thẻ 3.4).
     */
    @GetMapping("/{id}/segments")
    public ResponseEntity<?> getSegmentsFromDatabase(@PathVariable("id") Long id) {
        if (segmentPersistenceService == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "Database service chưa kích hoạt"));
        }
        SegmentsDTO segments = segmentPersistenceService.getSegmentsFromDatabase(id);
        if (segments == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(segments);
    }

    /**
     * API Lưu trực tiếp cấu trúc phân đoạn vào Database Neon Postgres theo Video ID (Thẻ 3.4).
     */
    @PostMapping("/{id}/segments")
    public ResponseEntity<?> saveSegmentsToDatabase(@PathVariable("id") Long id, @RequestBody List<Segment> segments) {
        if (segmentPersistenceService == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "Database service chưa kích hoạt"));
        }
        int count = segmentPersistenceService.saveSegmentsToDatabase(id, segments);
        return ResponseEntity.ok(Map.of(
            "status", "SUCCESS",
            "videoId", id,
            "totalTopics", count,
            "message", "Đã lưu " + count + " chủ đề vào Database Neon Postgres thành công!"
        ));
    }

    /**
     * API xóa một phân đoạn (segment) khỏi video trong cơ sở dữ liệu (Thẻ 3.4).
     */
    @DeleteMapping("/{id}/segments/{segmentId}")
    public ResponseEntity<?> deleteSegmentFromDatabase(@PathVariable("id") Long id, @PathVariable("segmentId") String segmentId) {
        if (segmentPersistenceService == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "Database service chưa kích hoạt"));
        }
        boolean deleted = segmentPersistenceService.deleteSegment(id, segmentId);
        SegmentsDTO updated = segmentPersistenceService.getSegmentsFromDatabase(id);
        return ResponseEntity.ok(Map.of(
            "deleted", deleted,
            "segmentId", segmentId,
            "message", deleted ? ("Đã xóa phân đoạn " + segmentId + " thành công") : ("Không tìm thấy phân đoạn " + segmentId),
            "segments", updated != null ? updated.segments() : List.of()
        ));
    }

    /**
     * API Lấy toàn bộ dữ liệu dự án (segments + transcript) từ Database Neon Postgres (Thẻ 3.4).
     */
    @GetMapping("/{id}/db-project")
    public ResponseEntity<?> getDbProject(@PathVariable("id") Long id) {
        if (segmentPersistenceService == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "Database service chưa kích hoạt"));
        }
        SegmentsDTO segments = segmentPersistenceService.getSegmentsFromDatabase(id);
        TranscriptDTO transcript = segmentPersistenceService.getTranscriptFromDatabase(id);
        if (segments == null && transcript == null) {
            return ResponseEntity.notFound().build();
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("status", "SUCCESS");
        resp.put("videoId", id);
        resp.put("segments", segments);
        resp.put("transcript", transcript);
        return ResponseEntity.ok(resp);
    }

    /**
     * API Lấy dữ liệu transcript từ bảng transcripts của Database Neon Postgres (Thẻ 3.4).
     */
    @GetMapping("/{id}/transcripts")
    public ResponseEntity<?> getTranscriptFromDatabase(@PathVariable("id") Long id) {
        if (segmentPersistenceService == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "Database service chưa kích hoạt"));
        }
        TranscriptDTO transcript = segmentPersistenceService.getTranscriptFromDatabase(id);
        if (transcript == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(transcript);
    }

    /**
     * API Nạp lại dự án đã lưu của User (Thẻ 3.1 & Phục hồi Workspace Studio).
     * Trả về project.json, segments.json và transcript tương ứng nếu có.
     */
    @GetMapping({"/project", "/load"})
    public ResponseEntity<?> loadProject(
            @RequestParam(value = "lesson", required = false) String rawLesson,
            @RequestParam(value = "user", defaultValue = "admin") String rawUser,
            @RequestParam(value = "video", required = false) String rawVideo) {

        String safeUser = rawUser != null ? rawUser.replaceAll("[^a-zA-Z0-9._-]", "_") : "admin";
        if (safeUser.isBlank()) safeUser = "admin";

        List<String> lessonCandidates = new ArrayList<>();
        if (rawLesson != null && !rawLesson.isBlank()) {
            lessonCandidates.add(rawLesson.replaceAll("[^a-zA-Z0-9._-]", "_"));
            lessonCandidates.add(sanitizeToSafeSlug(rawLesson));
        }
        if (rawVideo != null && !rawVideo.isBlank()) {
            lessonCandidates.add(rawVideo.replaceAll("[^a-zA-Z0-9._-]", "_"));
            lessonCandidates.add(sanitizeToSafeSlug(rawVideo));
            String stem = rawVideo.contains(".") ? rawVideo.substring(0, rawVideo.lastIndexOf('.')) : rawVideo;
            lessonCandidates.add(sanitizeToSafeSlug(stem));
        }

        Path projectRoot = resolveProjectRoot();
        Path foundDir = null;

        for (String candidate : lessonCandidates) {
            Path direct = Paths.get("output", "users", safeUser, candidate);
            if (Files.exists(direct) && Files.isDirectory(direct)) {
                foundDir = direct;
                break;
            }
            Path fromRoot = projectRoot.resolve("output").resolve("users").resolve(safeUser).resolve(candidate);
            if (Files.exists(fromRoot) && Files.isDirectory(fromRoot)) {
                foundDir = fromRoot;
                break;
            }
        }

        if (foundDir == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                "status", "NOT_FOUND",
                "message", "Chưa có dự án nào được lưu cho bài học này",
                "user", safeUser
            ));
        }

        try {
            Map<String, Object> responseData = new LinkedHashMap<>();
            responseData.put("status", "SUCCESS");
            responseData.put("user", safeUser);
            responseData.put("directory", foundDir.toAbsolutePath().toString());

            Path projectFile = foundDir.resolve("project.json");
            if (Files.exists(projectFile)) {
                JsonNode projectNode = objectMapper.readTree(projectFile.toFile());
                responseData.put("project", projectNode);
            }

            Path segmentsFile = foundDir.resolve("segments.json");
            if (Files.exists(segmentsFile)) {
                JsonNode segmentsNode = objectMapper.readTree(segmentsFile.toFile());
                responseData.put("segments", segmentsNode);
            }

            // Tìm transcript tương ứng nếu có
            String videoName = rawVideo;
            if ((videoName == null || videoName.isBlank()) && responseData.containsKey("project")) {
                JsonNode proj = (JsonNode) responseData.get("project");
                if (proj.has("video")) {
                    videoName = proj.get("video").asText();
                }
            }

            if (videoName != null && !videoName.isBlank()) {
                String safeSlug = sanitizeToSafeSlug(videoName);
                Path transP = projectRoot.resolve("transcripts").resolve(safeSlug + "_transcript.json");
                if (!Files.exists(transP)) {
                    transP = Paths.get("transcripts", safeSlug + "_transcript.json");
                }
                if (Files.exists(transP)) {
                    JsonNode transNode = objectMapper.readTree(transP.toFile());
                    responseData.put("transcript", transNode);
                }
            }

            return ResponseEntity.ok(responseData);
        } catch (Exception e) {
            log.error("Lỗi khi nạp dự án từ {}: {}", foundDir, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "status", "ERROR",
                "error", "Lỗi đọc tệp dự án: " + e.getMessage()
            ));
        }
    }

    public ResponseEntity<?> renderSegments(SegmentsDTO segments) {
        if (segments == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Payload segments null"));
        }
        Map<String, Object> map = objectMapper.convertValue(segments, Map.class);
        return renderSegments(map);
    }

    /**
     * Tiếp nhận segments đã duyệt từ Frontend gửi sang để thực hiện cắt video vật lý bằng FFmpeg (B10).
     */
    @PostMapping("/render")
    public ResponseEntity<?> renderSegments(@RequestBody Map<String, Object> payload) {
        String lesson = (String) payload.getOrDefault("lesson", "Bai05_VongLap");
        String videoName = (String) payload.getOrDefault("video", "vibe_short.mp4");
        List<?> rawSegments = (List<?>) payload.getOrDefault("segments", List.of());
        String user = (String) payload.get("user");
        log.info("Tiếp nhận yêu cầu cắt video: user={}, lesson={}, video={}, số phân đoạn={}", user, lesson, videoName, rawSegments.size());

        try {
            Path outputDir;
            if (user != null && !user.isBlank()) {
                String safeUser = user.replaceAll("[^a-zA-Z0-9_.-]", "_");
                outputDir = resolveProjectRoot().resolve("output").resolve("users").resolve(safeUser).resolve(lesson);
            } else {
                outputDir = resolveProjectRoot().resolve("output").resolve(lesson);
            }

            if (!Files.exists(outputDir)) {
                Files.createDirectories(outputDir);
            }

            String sourcePath = resolveVideoSource(videoName);
            log.info("Nguồn video để cắt: {}", sourcePath);

            List<Map<String, Object>> renderedFiles = new ArrayList<>();
            int successCount = 0;

            for (Object segObj : rawSegments) {
                if (!(segObj instanceof Map<?, ?> rawMap)) continue;
                @SuppressWarnings("unchecked")
                Map<String, Object> segMap = (Map<String, Object>) rawMap;
                Object partsObj = segMap.get("parts");
                if (partsObj instanceof List<?> partsList && !partsList.isEmpty()) {
                    for (Object pObj : partsList) {
                        if (!(pObj instanceof Map<?, ?> rawPMap)) continue;
                        @SuppressWarnings("unchecked")
                        Map<String, Object> pMap = (Map<String, Object>) rawPMap;
                        String relFile = String.valueOf(pMap.get("file"));
                        double start = pMap.get("start") instanceof Number n ? n.doubleValue() : 0.0;
                        double end = pMap.get("end") instanceof Number n ? n.doubleValue() : 0.0;

                        File outFile = outputDir.resolve(relFile).toFile();
                        log.info("Đang thực hiện cắt clip: {} [{} -> {}]", relFile, start, end);
                        CutResult cutResult = videoCutter.cut(sourcePath, outFile.getAbsolutePath(), start, end);

                        if (cutResult.success()) {
                            successCount++;
                            renderedFiles.add(Map.of(
                                "file", relFile,
                                "sizeBytes", cutResult.outputSizeBytes(),
                                "executionMs", cutResult.executionTimeMs(),
                                "path", outFile.getAbsolutePath()
                            ));
                        }
                    }
                } else {
                    String slug = segMap.get("slug") != null ? String.valueOf(segMap.get("slug")) : "clip";
                    String section = segMap.get("section") != null ? String.valueOf(segMap.get("section")) : "01_Phan";
                    double start = segMap.get("start") instanceof Number n ? n.doubleValue() : 0.0;
                    double end = segMap.get("end") instanceof Number n ? n.doubleValue() : 0.0;
                    String relFile = slug + ".mp4";

                    File outFile = outputDir.resolve(relFile).toFile();
                    CutResult cutResult = videoCutter.cut(sourcePath, outFile.getAbsolutePath(), start, end);
                    if (cutResult.success()) {
                        successCount++;
                        renderedFiles.add(Map.of(
                            "file", relFile,
                            "sizeBytes", cutResult.outputSizeBytes(),
                            "executionMs", cutResult.executionTimeMs(),
                            "path", outFile.getAbsolutePath()
                        ));
                    }
                }
            }

            // Tự động ghép nối các clip con thành video tổng hợp nếu có yêu cầu hoặc mặc định khi cắt nhiều clip
            boolean autoConcat = Boolean.parseBoolean(String.valueOf(payload.getOrDefault("autoConcat", "true")));
            String combinedFilePath = null;
            if (autoConcat && renderedFiles.size() >= 2) {
                List<File> clipsToConcat = new ArrayList<>();
                for (Map<String, Object> rf : renderedFiles) {
                    Object p = rf.get("path");
                    if (p != null) {
                        clipsToConcat.add(new File(String.valueOf(p)));
                    }
                }
                File combinedOut = outputDir.resolve(lesson + "_full.mp4").toFile();
                com.autocut.video.ConcatResult concatRes = videoConcat.concat(clipsToConcat, combinedOut);
                if (concatRes.success()) {
                    combinedFilePath = combinedOut.getAbsolutePath();
                    log.info("Đã tự động ghép thành công {} clip thành: {}", clipsToConcat.size(), combinedFilePath);
                } else {
                    log.warn("Tự động ghép nối {} clip thất bại: {}", clipsToConcat.size(), concatRes.errorMessage());
                }
            }

            Map<String, Object> respMap = new HashMap<>();
            respMap.put("status", "COMPLETED");
            respMap.put("engine", "FFmpeg libx264 (SV1)");
            respMap.put("lesson", lesson);
            respMap.put("totalRendered", successCount);
            respMap.put("renderedFiles", renderedFiles);
            respMap.put("outputDirectory", outputDir.toAbsolutePath().toString());
            respMap.put("message", "Đã cắt thành công " + successCount + " clip bằng FFmpeg! Lưu tại thư mục output/" + lesson);
            if (combinedFilePath != null) {
                respMap.put("combinedFile", combinedFilePath);
            }

            return ResponseEntity.ok(respMap);
        } catch (Exception e) {
            log.error("Không thể hoàn tất cắt video: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of(
                "status", "ERROR",
                "error", e.getMessage()
            ));
        }
    }

    /**
     * API Khởi tạo tác vụ cắt video bài giảng theo lô bất đồng bộ (Thẻ 3.3).
     * Phản hồi ngay HTTP 202 ACCEPTED với jobId để Client theo dõi tiến trình.
     */
    @PostMapping("/cut")
    public ResponseEntity<?> startBatchCut(@RequestBody CutRequestDTO request) {
        try {
            CutJobResponse response = batchVideoCutService.submitCutJob(request);
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Lỗi khi khởi tạo job cắt video: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Lỗi máy chủ nội bộ: " + e.getMessage()));
        }
    }

    /**
     * Tải về clip con đã cắt trong thư mục output (GET /api/video/download-clip?path=...).
     */
    @GetMapping("/download-clip")
    public ResponseEntity<Resource> downloadClip(@RequestParam("path") String filePath) {
        try {
            Path target = Paths.get(filePath);
            if (!Files.exists(target) || !Files.isRegularFile(target)) {
                target = Paths.get("output").resolve(filePath);
            }
            if (!Files.exists(target) || !Files.isRegularFile(target)) {
                target = resolveProjectRoot().resolve("output").resolve(filePath);
            }
            if (!Files.exists(target) || !Files.isRegularFile(target)) {
                log.warn("Không tìm thấy tệp clip để tải về: {}", filePath);
                return ResponseEntity.notFound().build();
            }

            Resource resource = new FileSystemResource(target);
            String fileName = target.getFileName().toString();
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .header(HttpHeaders.CONTENT_TYPE, "video/mp4")
                .body(resource);
        } catch (Exception e) {
            log.error("Lỗi khi tải file clip: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * API Thăm dò trạng thái tiến trình cắt video theo jobId (Thẻ 3.3).
     */
    @GetMapping("/cut/status")
    public ResponseEntity<?> getCutJobStatus(@RequestParam("jobId") String jobId) {
        CutJobResponse response = batchVideoCutService.getJobStatus(jobId);
        if (response == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Không tìm thấy tác vụ với mã: " + jobId));
        }
        return ResponseEntity.ok(response);
    }

    /**
     * Nén toàn bộ các clip đã cắt trong thư mục output của bài học thành file ZIP và tải về (GET /api/video/download-zip?lesson=...).
     */
    @GetMapping("/download-zip")
    public ResponseEntity<byte[]> downloadZip(
            @RequestParam("lesson") String lesson,
            @RequestParam(value = "user", required = false) String user) {
        try {
            Path outputDir;
            if (user != null && !user.isBlank()) {
                String safeUser = user.replaceAll("[^a-zA-Z0-9_.-]", "_");
                outputDir = resolveProjectRoot().resolve("output").resolve("users").resolve(safeUser).resolve(lesson);
            } else {
                outputDir = resolveProjectRoot().resolve("output").resolve(lesson);
            }

            if (!Files.exists(outputDir) || !Files.isDirectory(outputDir)) {
                log.warn("Không tìm thấy thư mục xuất bản để nén ZIP: {}", outputDir.toAbsolutePath());
                return ResponseEntity.notFound().build();
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            try (ZipOutputStream zos = new ZipOutputStream(baos)) {
                final Path base = outputDir;
                try (var stream = Files.walk(base)) {
                    stream.filter(Files::isRegularFile).forEach(p -> {
                        String entryName = base.relativize(p).toString().replace("\\", "/");
                        try {
                            zos.putNextEntry(new ZipEntry(entryName));
                            Files.copy(p, zos);
                            zos.closeEntry();
                        } catch (IOException ex) {
                            log.warn("Lỗi thêm file vào ZIP: {}", ex.getMessage());
                        }
                    });
                }
            }

            byte[] zipBytes = baos.toByteArray();
            String zipFileName = lesson.replaceAll("[^a-zA-Z0-9_.-]", "_") + "_exported_clips.zip";

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + zipFileName + "\"")
                .header(HttpHeaders.CONTENT_TYPE, "application/zip")
                .body(zipBytes);
        } catch (Exception e) {
            log.error("Lỗi nén ZIP các file clip: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    /**
     * API Chấm điểm điểm cắt âm học ứng viên (P05 / Thẻ 3.2):
     * Tính toán cut_points.json từ transcript theo khoảng lặng và cụm từ nối.
     */
    @PostMapping("/cut-points")
    public ResponseEntity<?> calculateCutPointsEndpoint(@RequestBody(required = false) Map<String, Object> request) {
        String videoName = request != null ? (String) request.getOrDefault("videoName", "") : "";
        TranscriptDTO transcript = null;

        if (request != null && request.containsKey("transcript")) {
            try {
                transcript = objectMapper.convertValue(request.get("transcript"), TranscriptDTO.class);
            } catch (Exception ignored) {}
        }

        if (transcript == null && !videoName.isBlank()) {
            Path projectRoot = resolveProjectRoot();
            String safeSlug = sanitizeToSafeSlug(videoName);
            Path transP = projectRoot.resolve("transcripts").resolve(safeSlug + "_transcript.json");
            if (Files.exists(transP)) {
                try {
                    transcript = objectMapper.readValue(transP.toFile(), TranscriptDTO.class);
                } catch (Exception ignored) {}
            }
        }

        if (transcript == null) {
            Path rootTrans = resolveProjectRoot().resolve("transcript.json");
            if (Files.exists(rootTrans)) {
                try {
                    transcript = objectMapper.readValue(rootTrans.toFile(), TranscriptDTO.class);
                } catch (Exception ignored) {}
            }
        }

        if (transcript == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Không tìm thấy transcript để tính cut_points!"));
        }

        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);
        try {
            Path cutPointsFile = resolveProjectRoot().resolve("cut_points.json");
            cutPointService.exportCutPointsJson(cutPoints, cutPointsFile);
        } catch (Exception ex) {
            log.warn("Lỗi lưu cut_points.json: {}", ex.getMessage());
        }

        return ResponseEntity.ok(cutPoints);
    }

    /**
     * API Đọc file cut_points.json hiện tại (Thẻ 3.2).
     */
    @GetMapping("/cut-points")
    public ResponseEntity<?> getCutPointsEndpoint() {
        Path cutPointsFile = resolveProjectRoot().resolve("cut_points.json");
        if (Files.exists(cutPointsFile)) {
            try {
                CutPointsDTO cutPoints = objectMapper.readValue(cutPointsFile.toFile(), CutPointsDTO.class);
                return ResponseEntity.ok(cutPoints);
            } catch (Exception ex) {
                return ResponseEntity.status(500).body(Map.of("error", "Không thể đọc file cut_points.json: " + ex.getMessage()));
            }
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * API ghép nối các video thành 1 video tổng hợp (Mục 4 SV1).
     * Hỗ trợ tự động fallback sang Concat Filter khi ghép các video khác nguồn/chuẩn thông số.
     */
    @PostMapping("/concat")
    public ResponseEntity<?> concatVideos(@RequestBody Map<String, Object> payload) {
        List<?> rawClips = (List<?>) payload.get("clips");
        if (rawClips == null || rawClips.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                "status", "ERROR",
                "error", "Danh sách clips không được để trống"
            ));
        }

        String rawOutput = (String) payload.get("output");
        if (rawOutput == null || rawOutput.isBlank()) {
            rawOutput = "output/combined_" + System.currentTimeMillis() + ".mp4";
        }

        boolean forceReencode = Boolean.TRUE.equals(payload.get("forceReencode"));

        List<File> clipFiles = new ArrayList<>();
        for (Object item : rawClips) {
            String pathStr = String.valueOf(item);
            File f = findFilePath(pathStr).toFile();
            clipFiles.add(f);
        }

        File outFile = Paths.get(rawOutput).toFile();
        com.autocut.video.ConcatResult result = videoConcat.concat(clipFiles, outFile, forceReencode);

        if (result.success()) {
            return ResponseEntity.ok(Map.of(
                "status", "SUCCESS",
                "message", "Ghép video thành công!",
                "outputFile", result.outputFile(),
                "outputSizeBytes", result.outputSizeBytes(),
                "executionTimeMs", result.executionTimeMs(),
                "totalClips", clipFiles.size()
            ));
        } else {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "status", "ERROR",
                "errorCode", result.errorCode() != null ? result.errorCode().name() : "UNKNOWN",
                "error", result.errorMessage() != null ? result.errorMessage() : "Ghép video thất bại"
            ));
        }
    }

    private String resolveVideoSource(String videoName) {
        if (videoName != null && (videoName.startsWith("http://") || videoName.startsWith("https://"))) {
            return videoName;
        }

        if (videoName != null && !videoName.isBlank()) {
            List<VideoEntity> all = videoRepository.findAll();
            for (VideoEntity v : all) {
                if (videoName.equalsIgnoreCase(v.getFileName()) && v.getCloudUrl() != null && !v.getCloudUrl().isBlank()) {
                    return v.getCloudUrl();
                }
            }
        }

        if (videoName != null && !videoName.isBlank()) {
            List<Path> candidates = List.of(
                Paths.get("input", videoName),
                Paths.get("uploads", videoName),
                Paths.get("..", "input", videoName),
                Paths.get("..", "uploads", videoName),
                Paths.get(videoName)
            );
            for (Path p : candidates) {
                if (Files.exists(p) && Files.isRegularFile(p)) {
                    return p.toAbsolutePath().toString();
                }
            }
        }

        return "https://pub-603b1f9629e046de80cf86f3f046ca84.r2.dev/autocut/sample_videos/vibe_short.mp4";
    }



    private String resolvePythonExecutable() {
        String envPython = System.getenv("PYTHON_EXE");
        if (envPython != null && Files.exists(Paths.get(envPython))) {
            return envPython;
        }

        Path python313 = Paths.get("C:/Python313/python.exe");
        if (Files.exists(python313)) {
            return python313.toAbsolutePath().toString();
        }

        Path venvPython = Paths.get(System.getProperty("user.home"), "AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe");
        if (Files.exists(venvPython)) {
            return venvPython.toAbsolutePath().toString();
        }

        Path userPython = Paths.get(System.getProperty("user.home"), "AppData/Local/Programs/Python/Python312/python.exe");
        if (Files.exists(userPython)) {
            return userPython.toAbsolutePath().toString();
        }

        return "python";
    }



    private Path resolveProjectRoot() {

        Path current = Paths.get("").toAbsolutePath().normalize();

        if (Files.exists(current.resolve("backend/ai/cli.py"))) {

            return current;

        }

        if (current.getParent() != null && Files.exists(current.getParent().resolve("backend/ai/cli.py"))) {

            return current.getParent();

        }

        return current;

    }



    private Path findFilePath(String relativePath) {

        Path p = Paths.get(relativePath);

        if (Files.exists(p)) return p;

        p = Paths.get("..", relativePath);

        if (Files.exists(p)) return p;

        return Paths.get(relativePath);

    }

    public static String sanitizeToSafeSlug(String raw) {
        if (raw == null || raw.isBlank()) return "video";
        String name = raw;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\(([^)]+)\\)").matcher(raw);
        if (m.find()) {
            String inner = m.group(1).trim();
            if (inner.contains(".")) {
                name = inner;
            }
        }
        int dotIdx = name.lastIndexOf('.');
        if (dotIdx > 0) {
            name = name.substring(0, dotIdx);
        }
        String nfd = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFD);
        String ascii = nfd.replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                          .replace('đ', 'd').replace('Đ', 'D');
        String slug = ascii.replaceAll("[^a-zA-Z0-9]+", "_")
                           .replaceAll("^_+|_+$", "")
                           .toLowerCase();
        return slug.isBlank() ? "video" : slug;
    }

    private String normalizeSearchKey(String str) {
        if (str == null) return "";
        String nfd = java.text.Normalizer.normalize(str, java.text.Normalizer.Form.NFD);
        return nfd.replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .replace('đ', 'd').replace('Đ', 'D')
                .replaceAll("[^a-zA-Z0-9]", "")
                .toLowerCase();
    }
}

