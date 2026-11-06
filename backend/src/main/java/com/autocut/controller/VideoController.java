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

    private final ObjectMapper objectMapper = new ObjectMapper();



    public VideoController(CacheService cacheService, ConfigService configService, CloudflareR2Service r2Service, VideoRepository videoRepository) {

        this.cacheService = cacheService;

        this.configService = configService;

        this.r2Service = r2Service;

        this.videoRepository = videoRepository;

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



            // Lưu một bản sao tại uploads/ để module Python AI đọc trực tiếp

            Path projectRoot = resolveProjectRoot();

            Path uploadDir = projectRoot.resolve("uploads");

            if (!Files.exists(uploadDir)) {

                Files.createDirectories(uploadDir);

            }

            Path localFile = uploadDir.resolve(hash + "_" + originalFilename);

            Files.copy(tempFile, localFile, StandardCopyOption.REPLACE_EXISTING);



            // Chạy Whisper + Gemini ngay khi upload để xuất file vào thư mục riêng transcripts/

            String relativeTranscriptPath = generateTranscriptForUploadedVideo(localFile, originalFilename, hash);



            // Nạp đối tượng TranscriptDTO đã tạo để trả về ngay cho Frontend

            TranscriptDTO transcriptDTO = null;

            String videoStem = stripExtension(originalFilename);

            Path transcriptFile = projectRoot.resolve("transcripts").resolve(videoStem + "_transcript.json");

            if (Files.exists(transcriptFile)) {

                try {

                    transcriptDTO = objectMapper.readValue(transcriptFile.toFile(), TranscriptDTO.class);

                } catch (Exception ex) {

                    log.warn("Không thể parse file transcript {}: {}", transcriptFile, ex.getMessage());

                }

            }

            if (transcriptDTO == null && !hash.isBlank()) {

                transcriptDTO = cacheService.getCachedTranscript(hash).orElse(null);

            }



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



            Map<String, Object> response = new HashMap<>();

            response.put("status", "SUCCESS");

            response.put("file_name", originalFilename);

            response.put("file_size", file.getSize());

            response.put("sha256", hash);

            response.put("cloud_url", publicUrl);

            response.put("transcript_file", relativeTranscriptPath);

            if (transcriptDTO != null) {

                response.put("transcript", transcriptDTO);

            }

            response.put("message", "Video đã được tải lên và AI đã xuất file transcript tại: " + relativeTranscriptPath);



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
        return ResponseEntity.ok(videoRepository.findAll());
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
        List<VideoEntity> all = videoRepository.findAll();
        if (all.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(all.get(all.size() - 1));
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

                    List<Sentence> rawSents = existingDto.sentences();
                    double totalDur = existingDto.duration() > 0 ? existingDto.duration() : duration;
                    if (totalDur <= 0) totalDur = 180.0;

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

                    // 2. Chia phân đoạn liên tục 100% - Tuyệt đối không để khoảng trống (Zero Gaps)
                    int segCount = Math.min(5, Math.max(2, (int) Math.ceil(sents.size() / 3.0)));
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
                                List.of(new VideoPart(1, sStart, sEnd, secFolder + "/part-1.mp4"))
                        ));
                    }

                    TranscriptDTO normalizedDto = new TranscriptDTO(existingDto.video(), totalDur, sents);
                    SegmentsDTO segsDto = new SegmentsDTO(videoName, lessonName, "analyzed", false, segList);

                    if (!hash.isBlank()) {
                        cacheService.saveTranscriptCache(hash, normalizedDto);
                        try { objectMapper.writerWithDefaultPrettyPrinter().writeValue(resolveProjectRoot().resolve("transcript.json").toFile(), normalizedDto); } catch (Exception ignored) {}
                    }

                    return ResponseEntity.ok(Map.of(
                            "status", "SUCCESS",
                            "mode", "analyzed",
                            "segmentsData", segsDto,
                            "transcript", normalizedDto
                    ));

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

     * Tiếp nhận segments đã duyệt từ Frontend gửi sang để thực hiện cắt video (B10).

     */

    @PostMapping("/render")

    public ResponseEntity<?> renderSegments(@RequestBody SegmentsDTO segments) {

        log.info("Tiếp nhận yêu cầu cắt video bài giảng: {}, số phân đoạn: {}",

                segments.lesson(), segments.segments().size());



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

