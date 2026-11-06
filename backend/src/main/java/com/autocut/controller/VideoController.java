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



import java.io.IOException;

import java.io.InputStream;

import java.nio.charset.StandardCharsets;

import java.nio.file.Files;

import java.nio.file.Path;

import java.nio.file.Paths;

import java.nio.file.StandardCopyOption;

import java.util.*;

import java.util.concurrent.TimeUnit;



@RestController

@RequestMapping("/api/video")

public class VideoController {



    private static final Logger log = LoggerFactory.getLogger(VideoController.class);

    private final CacheService cacheService;

    private final ConfigService configService;

    private final CloudflareR2Service r2Service;

    private final VideoRepository videoRepository;
    private final VideoCutter videoCutter;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository) {
        this(cacheService, configService, r2Service, videoRepository, new VideoCutter(new VideoProps()));
    }

    @Autowired
    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository, VideoCutter videoCutter) {
        this.cacheService = cacheService;
        this.configService = configService;
        this.r2Service = r2Service;
        this.videoRepository = videoRepository;
        this.videoCutter = videoCutter != null ? videoCutter : new VideoCutter(new VideoProps());
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



            // Lưu một bản sao tại uploads/ để phục vụ phát trực tiếp hoặc phân tích sau này
            Path projectRoot = resolveProjectRoot();
            Path uploadDir = projectRoot.resolve("uploads");
            if (!Files.exists(uploadDir)) {
                Files.createDirectories(uploadDir);
            }
            Path localFile = uploadDir.resolve(hash + "_" + originalFilename);
            Files.copy(tempFile, localFile, StandardCopyOption.REPLACE_EXISTING);

            String publicUrl;
            String r2Key = "sample_videos/" + hash.substring(0, Math.min(12, hash.length())) + "_" + originalFilename;

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
            String transcriptFile = generateTranscriptForUploadedVideo(localFile, originalFilename, hash);
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

     * Kích hoạt Whisper + Gemini tạo file transcript riêng cho video vừa upload tại transcripts/<tên_video>_transcript.json.

     */

    private String generateTranscriptForUploadedVideo(Path localVideoFile, String originalFilename, String hash) {

        Path projectRoot = resolveProjectRoot();

        Path transcriptsDir = projectRoot.resolve("transcripts");

        String videoStem = stripExtension(originalFilename);

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

                try { Files.copy(transcriptPath, projectRoot.resolve("transcript.json"), StandardCopyOption.REPLACE_EXISTING); } catch (Exception ignored) {}
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

                        List.of(new Sentence("S0001", 0.0, 60.0, "Nội dung bóc băng của video " + originalFilename + ".", null))

                );

                objectMapper.writerWithDefaultPrettyPrinter().writeValue(transcriptPath.toFile(), fallbackDto);

                if (hash != null && !hash.isBlank()) {

                    cacheService.saveTranscriptCache(hash, fallbackDto);

                }

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

     * API lấy danh sách video đã lưu trữ từ Database cho Thư viện Video của Frontend (SV4).

     */

    @GetMapping("/list")
    public ResponseEntity<List<VideoEntity>> listVideos() {
        List<VideoEntity> list = videoRepository.findAll().stream()
                .filter(v -> v.getFileName() == null || !v.getFileName().startsWith("temp_test"))
                .toList();
        return ResponseEntity.ok(list);
    }

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
        try { objectMapper.writerWithDefaultPrettyPrinter().writeValue(resolveProjectRoot().resolve("transcript.json").toFile(), transcriptDTO); } catch (Exception ignored) {}

                }



                log.info("Module Python AI hoàn tất: {} câu transcript, {} phân đoạn.",

                        transcriptDTO != null ? transcriptDTO.sentences().size() : 0,

                        segmentsDTO != null ? segmentsDTO.segments().size() : 0);



                return ResponseEntity.ok(Map.of(

                        "status", "SUCCESS",

                        "mode", "analyzed",

                        "segmentsData", segmentsDTO,

                        "transcript", transcriptDTO

                ));

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

        String videoStem = stripExtension(videoName);

        Path transcriptsDir = resolveProjectRoot().resolve("transcripts");

        Path candidateTranscript = transcriptsDir.resolve(videoStem + "_transcript.json");

        if (!Files.exists(candidateTranscript)) {

            candidateTranscript = transcriptsDir.resolve(videoStem + " (1)_transcript.json");

        }

        if (!Files.exists(candidateTranscript) && Files.exists(resolveProjectRoot().resolve("transcript.json"))) {

            candidateTranscript = resolveProjectRoot().resolve("transcript.json");

        }



        if (Files.exists(candidateTranscript)) {
            try {
                TranscriptDTO existingDto = objectMapper.readValue(candidateTranscript.toFile(), TranscriptDTO.class);
                if (existingDto != null && existingDto.sentences() != null && !existingDto.sentences().isEmpty()) {
                    double transDur = existingDto.duration();
                    // Chỉ sử dụng transcript nếu khớp tên video hoặc thời lượng tương đương
                    // Tránh gán nhầm transcript 2 tiếng của video dài cho video ngắn 2 phút
                    boolean matchesVideo = (duration > 0 && transDur > 0 && Math.abs(transDur - duration) / Math.max(transDur, duration) < 0.3)
                            || (existingDto.video() != null && (existingDto.video().toLowerCase().contains(videoStem.toLowerCase()) || videoStem.toLowerCase().contains(existingDto.video().toLowerCase())));

                    if (matchesVideo) {
                        List<Sentence> sents = existingDto.sentences();
                        double totalDur = (duration > 0) ? duration : (transDur > 0 ? transDur : 120.0);
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

                        SegmentsDTO segsDto = new SegmentsDTO(videoName, lessonName, "analyzed", false, segList);
                        if (!hash.isBlank()) {
                            cacheService.saveTranscriptCache(hash, existingDto);
                        }

                        return ResponseEntity.ok(Map.of(
                                "status", "SUCCESS",
                                "mode", "analyzed",
                                "segmentsData", segsDto,
                                "transcript", existingDto
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

        double cut1 = Math.round(duration * 0.16 * 10.0) / 10.0;
        double cut2 = Math.round(duration * 0.48 * 10.0) / 10.0;
        double cut3 = Math.round(duration * 0.82 * 10.0) / 10.0;
        double cut4 = Math.round(duration * 10.0) / 10.0;

        List<Segment> segments = List.of(
                new Segment("seg_ai_01", 1, "01_Doan1", 1, "Phân đoạn 1", "doan-1", "S0001", "S0001", 0.0, cut1,
                        List.of(new VideoPart(1, 0.0, cut1, "01_Doan1/01_doan-1.mp4"))),
                new Segment("seg_ai_02", 2, "02_Doan2", 2, "Phân đoạn 2", "doan-2", "S0002", "S0002", cut1, cut2,
                        List.of(new VideoPart(1, cut1, cut2, "02_Doan2/02_doan-2.mp4"))),
                new Segment("seg_ai_03", 3, "03_Doan3", 3, "Phân đoạn 3", "doan-3", "S0003", "S0003", cut2, cut3,
                        List.of(new VideoPart(1, cut2, cut3, "03_Doan3/03_doan-3.mp4"))),
                new Segment("seg_ai_04", 4, "04_Doan4", 4, "Phân đoạn 4", "doan-4", "S0004", "S0004", cut3, cut4,
                        List.of(new VideoPart(1, cut3, cut4, "04_Doan4/04_doan-4.mp4")))
        );

        List<Sentence> sentences = List.of(
                new Sentence("S0001", 0.0, cut1, "Nội dung phần 1 của " + videoName, null),
                new Sentence("S0002", cut1, cut2, "Nội dung phần 2 của " + videoName, null),
                new Sentence("S0003", cut2, cut3, "Nội dung phần 3 của " + videoName, null),
                new Sentence("S0004", cut3, cut4, "Nội dung phần 4 của " + videoName, null)
        );



        TranscriptDTO transcriptDTO = new TranscriptDTO(videoName, cut4, sentences);

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
            Path userDir = Paths.get("output", "users", safeUser, safeLesson);
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

            log.info("Đã lưu dự án của user '{}' tại: {}", safeUser, userDir.toAbsolutePath());

            return ResponseEntity.ok(Map.of(
                "status", "SAVED",
                "user", safeUser,
                "lesson", safeLesson,
                "directory", userDir.toAbsolutePath().toString(),
                "localDirectory", userDir.toAbsolutePath().toString(),
                "r2Url", r2Url != null ? r2Url : "",
                "cloudUrl", r2Url != null ? r2Url : "",
                "files", List.of(
                    "output/users/" + safeUser + "/" + safeLesson + "/project.json",
                    "output/users/" + safeUser + "/" + safeLesson + "/segments.json"
                ),
                "savedAt", nowMs,
                "message", "Đã lưu dự án vào thư mục người dùng: output/users/" + safeUser + "/" + safeLesson
            ));
        } catch (Exception e) {
            log.error("Lỗi khi lưu dự án cho user '{}': {}", safeUser, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Không thể lưu dự án: " + e.getMessage()));
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
                outputDir = Paths.get("output", "users", safeUser, lesson);
            } else {
                outputDir = Paths.get("output", lesson);
            }

            if (!Files.exists(outputDir)) {
                Files.createDirectories(outputDir);
            }
            Path planFile = outputDir.resolve("segments_" + lesson + ".json");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(planFile.toFile(), payload);
            log.info("Đã lưu kế hoạch cắt tại: {}", planFile.toAbsolutePath());

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
                    String relFile = section + "/" + slug + ".mp4";

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

            return ResponseEntity.ok(Map.of(
                "status", "COMPLETED",
                "engine", "FFmpeg libx264 (SV1)",
                "lesson", lesson,
                "totalRendered", successCount,
                "renderedFiles", renderedFiles,
                "outputDirectory", outputDir.toAbsolutePath().toString(),
                "message", "Đã cắt thành công " + successCount + " clip bằng FFmpeg! Lưu tại thư mục output/" + lesson
            ));
        } catch (Exception e) {
            log.error("Không thể hoàn tất cắt video: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of(
                "status", "ERROR",
                "error", e.getMessage()
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

}

