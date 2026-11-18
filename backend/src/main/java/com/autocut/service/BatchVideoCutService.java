package com.autocut.service;

import com.autocut.dto.Models.*;
import com.autocut.video.CutResult;
import com.autocut.video.PathSlugifier;
import com.autocut.video.VideoCutter;
import com.autocut.video.VideoProps;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/**
 * Service quản lý hàng đợi và điều phối cắt video bài giảng theo lô bất đồng bộ (Thẻ 3.3).
 *
 * <p>Nhiệm vụ:
 * <ul>
 *   <li>Tiếp nhận yêu cầu cắt video từ Studio Web và sinh jobId phản hồi ngay (chống timeout trình duyệt).</li>
 *   <li>Điều phối tiến trình nền thực hiện cắt từng phân đoạn qua {@link VideoCutter} của SV1.</li>
 *   <li>Áp dụng đệm thở âm thanh (-0.3s / +0.5s) và cờ faststart để xem trực tuyến tức thì.</li>
 *   <li>Tự động xuất 2 tệp hồ sơ: chapters.txt (mốc chương YouTube) và report.json (báo cáo kỹ thuật).</li>
 *   <li>Tự động đẩy các clip và hồ sơ lên Cloudflare R2 phân lập theo User và Lesson.</li>
 * </ul>
 */
@Service
public class BatchVideoCutService {

    private static final Logger log = LoggerFactory.getLogger(BatchVideoCutService.class);

    private final VideoCutter videoCutter;
    private final CloudflareR2Service r2Service;
    private final ConfigService configService;
    private final ObjectMapper objectMapper;
    private final ExecutorService executor;

    private final Map<String, JobState> jobStore = new ConcurrentHashMap<>();

    public BatchVideoCutService() {
        this(new VideoCutter(new VideoProps()), null, new ConfigService(), new ObjectMapper());
    }

    @Autowired
    public BatchVideoCutService(VideoCutter videoCutter,
                                @Autowired(required = false) CloudflareR2Service r2Service,
                                ConfigService configService) {
        this(videoCutter, r2Service, configService, new ObjectMapper());
    }

    public BatchVideoCutService(VideoCutter videoCutter,
                                CloudflareR2Service r2Service,
                                ConfigService configService,
                                ObjectMapper objectMapper) {
        this.videoCutter = videoCutter != null ? videoCutter : new VideoCutter(new VideoProps());
        this.r2Service = r2Service;
        this.configService = configService;
        this.objectMapper = objectMapper != null ? objectMapper : new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
        this.executor = Executors.newFixedThreadPool(2);
    }

    /**
     * Lớp trạng thái nội bộ lưu trữ tiến trình cắt.
     */
    public static class JobState {
        public final String jobId;
        public final String user;
        public final String lesson;
        public final String videoName;
        public final double totalDuration;
        public final List<Segment> segments;
        public volatile CutJobStatus status = CutJobStatus.QUEUED;
        public volatile int current = 0;
        public volatile int total = 0;
        public volatile int percent = 0;
        public volatile String message = "Đang chờ trong hàng đợi xử lý";
        public volatile String error = null;
        public final List<CutClipInfo> clips = new CopyOnWriteArrayList<>();
        public volatile String chaptersUrl = null;
        public volatile String reportUrl = null;
        public volatile String chaptersPath = null;
        public volatile String reportPath = null;
        public final long createdAt = System.currentTimeMillis();
        public volatile long completedAt = 0;

        public JobState(String jobId, String user, String lesson, String videoName, double totalDuration, List<Segment> segments) {
            this.jobId = jobId;
            this.user = user;
            this.lesson = lesson;
            this.videoName = videoName;
            this.totalDuration = totalDuration;
            this.segments = segments != null ? segments : Collections.emptyList();
            this.total = this.segments.size();
        }

        public CutJobResponse toResponse() {
            return new CutJobResponse(
                jobId,
                status,
                current,
                total,
                percent,
                message,
                new ArrayList<>(clips),
                chaptersUrl,
                reportUrl,
                error
            );
        }
    }

    /**
     * Tiếp nhận yêu cầu cắt video từ Client, sinh jobId và nạp vào hàng đợi nền.
     */
    public CutJobResponse submitCutJob(CutRequestDTO req) {
        if (req == null) {
            throw new IllegalArgumentException("Yêu cầu cắt video không được để trống");
        }
        if (req.videoName() == null || req.videoName().isBlank()) {
            throw new IllegalArgumentException("Tên tệp video nguồn không được để trống");
        }
        if (req.segments() == null || req.segments().isEmpty()) {
            throw new IllegalArgumentException("Danh sách phân đoạn cắt không được để trống");
        }

        String user = (req.user() != null && !req.user().isBlank()) ? req.user() : "default_user";
        String lesson = (req.lesson() != null && !req.lesson().isBlank()) ? req.lesson() : "lesson_01";
        String jobId = "job_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 6);

        JobState state = new JobState(jobId, user, lesson, req.videoName(), req.totalDuration(), req.segments());
        jobStore.put(jobId, state);

        log.info("[BatchVideoCutService] Đã nhận Job #{}: user='{}', lesson='{}', segments={}",
            jobId, user, lesson, req.segments().size());

        executor.submit(() -> executeJob(state));

        return state.toResponse();
    }

    /**
     * Lấy trạng thái hiện tại của tác vụ cắt video theo jobId.
     */
    public CutJobResponse getJobStatus(String jobId) {
        if (jobId == null || jobId.isBlank()) {
            return null;
        }
        JobState state = jobStore.get(jobId);
        return state != null ? state.toResponse() : null;
    }

    /**
     * Tiến trình thực thi cắt video nền.
     */
    void executeJob(JobState state) {
        state.status = CutJobStatus.PROCESSING;
        state.message = "Đang khởi tạo thư mục và xác minh video nguồn...";
        log.info("[BatchVideoCutService] Bắt đầu thực thi Job #{}", state.jobId);

        try {
            String safeUser = sanitizeToSafeSlug(state.user);
            String safeLesson = sanitizeToSafeSlug(state.lesson);

            Path outputDir = Paths.get("output", "users", safeUser, safeLesson, "cuts");
            Files.createDirectories(outputDir);

            File sourceFile = resolveSourceVideoFile(state.videoName);
            if (sourceFile == null || !sourceFile.exists()) {
                state.status = CutJobStatus.FAILED;
                state.error = "Không tìm thấy tệp video nguồn: " + state.videoName;
                state.message = "Cắt video thất bại: Không tìm thấy file nguồn";
                log.error("[BatchVideoCutService] Job #{} thất bại: {}", state.jobId, state.error);
                return;
            }

            int total = state.segments.size();
            for (int i = 0; i < total; i++) {
                Segment seg = state.segments.get(i);
                state.current = i + 1;
                state.message = String.format("Đang cắt phân đoạn %d/%d: %s", i + 1, total, seg.topic());
                log.info("[BatchVideoCutService] Job #{} [{}/{}]: {} ({}s -> {}s)",
                    state.jobId, i + 1, total, seg.topic(), seg.start(), seg.end());

                String safeTopic = PathSlugifier.slugify(seg.topic());
                if (safeTopic.isBlank()) {
                    safeTopic = "part_" + (i + 1);
                }
                String clipFileName = String.format("%02d_%s.mp4", i + 1, safeTopic);
                File clipOutputFile = outputDir.resolve(clipFileName).toFile();

                CutResult cutRes = videoCutter.cut(
                    sourceFile,
                    clipOutputFile,
                    seg.start(),
                    seg.end(),
                    state.totalDuration
                );

                if (cutRes.success()) {
                    String r2Url = null;
                    if (r2Service != null) {
                        try {
                            String r2Key = "users/" + safeUser + "/" + safeLesson + "/cuts/" + clipFileName;
                            r2Url = r2Service.uploadFile(clipOutputFile.toPath(), r2Key);
                        } catch (Exception e) {
                            log.warn("[BatchVideoCutService] Không thể upload clip lên R2: {}", e.getMessage());
                        }
                    }

                    CutClipInfo clipInfo = new CutClipInfo(
                        i + 1,
                        clipFileName,
                        seg.topic(),
                        seg.start(),
                        seg.end(),
                        cutRes.start(),
                        cutRes.end(),
                        clipOutputFile.length(),
                        cutRes.executionTimeMs(),
                        r2Url,
                        clipOutputFile.getAbsolutePath()
                    );
                    state.clips.add(clipInfo);
                } else {
                    log.warn("[BatchVideoCutService] Job #{} cắt lỗi clip {}: {}",
                        state.jobId, clipFileName, cutRes.errorMessage());
                }

                state.percent = (int) Math.round(((double) (i + 1) / total) * 90.0);
            }

            // Sinh 2 tệp hồ sơ xuất xưởng (Mục 4 SV1 & Chuẩn B10)
            state.message = "Đang tổng hợp tệp chapters.txt và report.json...";
            Path userLessonDir = Paths.get("output", "users", safeUser, safeLesson);

            // 1. chapters.txt
            String chaptersContent = generateChaptersContent(state.segments);
            Path chaptersPath = userLessonDir.resolve("chapters.txt");
            Files.writeString(chaptersPath, chaptersContent, StandardCharsets.UTF_8);
            state.chaptersPath = chaptersPath.toAbsolutePath().toString();
            if (r2Service != null) {
                try {
                    state.chaptersUrl = r2Service.uploadFile(chaptersPath, "users/" + safeUser + "/" + safeLesson + "/chapters.txt");
                } catch (Exception e) {
                    log.warn("[BatchVideoCutService] Không thể upload chapters.txt lên R2: {}", e.getMessage());
                }
            }

            // 2. report.json
            Map<String, Object> reportData = generateReportData(state, sourceFile);
            Path reportPath = userLessonDir.resolve("report.json");
            objectMapper.writeValue(reportPath.toFile(), reportData);
            state.reportPath = reportPath.toAbsolutePath().toString();
            if (r2Service != null) {
                try {
                    state.reportUrl = r2Service.uploadFile(reportPath, "users/" + safeUser + "/" + safeLesson + "/report.json");
                } catch (Exception e) {
                    log.warn("[BatchVideoCutService] Không thể upload report.json lên R2: {}", e.getMessage());
                }
            }

            state.status = CutJobStatus.COMPLETED;
            state.percent = 100;
            state.completedAt = System.currentTimeMillis();
            state.message = String.format("Đã xuất bản thành công %d/%d phân đoạn bài giảng.", state.clips.size(), total);
            log.info("[BatchVideoCutService] Job #{} HOÀN TẤT trong {} ms ({} clips)",
                state.jobId, (state.completedAt - state.createdAt), state.clips.size());

        } catch (Exception e) {
            log.error("[BatchVideoCutService] Lỗi nghiêm trọng khi thực thi Job #{}: {}", state.jobId, e.getMessage(), e);
            state.status = CutJobStatus.FAILED;
            state.error = e.getMessage();
            state.message = "Đã xảy ra lỗi khi cắt video: " + e.getMessage();
        }
    }

    /**
     * Tạo nội dung chapters.txt theo chuẩn YouTube / Media Player:
     * Ví dụ:
     * 00:00 - Phần 1: Giới thiệu vòng lặp
     * 00:36 - Phần 2: Cú pháp th:each
     */
    public String generateChaptersContent(List<Segment> segments) {
        if (segments == null || segments.isEmpty()) {
            return "00:00 - Phần 1: Giới thiệu bài giảng\n";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < segments.size(); i++) {
            Segment seg = segments.get(i);
            String timeStr = formatTimestamp(seg.start());
            String title = (seg.topic() != null && !seg.topic().isBlank()) ? seg.topic() : ("Phần " + (i + 1));
            sb.append(String.format("%s - Phần %d: %s\n", timeStr, i + 1, title));
        }
        return sb.toString();
    }

    /**
     * Chuyển đổi giây thành chuỗi timestamp chuẩn mm:ss hoặc hh:mm:ss.
     */
    public String formatTimestamp(double seconds) {
        long totalSec = (long) Math.max(0.0, seconds);
        long hours = totalSec / 3600;
        long minutes = (totalSec % 3600) / 60;
        long secs = totalSec % 60;
        if (hours > 0) {
            return String.format("%02d:%02d:%02d", hours, minutes, secs);
        } else {
            return String.format("%02d:%02d", minutes, secs);
        }
    }

    /**
     * Sinh cấu trúc dữ liệu báo cáo kỹ thuật report.json.
     */
    public Map<String, Object> generateReportData(JobState state, File sourceFile) {
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("job_id", state.jobId);
        report.put("user", state.user);
        report.put("lesson", state.lesson);
        report.put("source_video", state.videoName);
        report.put("source_file_size_bytes", sourceFile != null && sourceFile.exists() ? sourceFile.length() : 0);
        report.put("total_duration", state.totalDuration);
        report.put("total_segments", state.total);
        report.put("success_count", state.clips.size());
        report.put("failed_count", Math.max(0, state.total - state.clips.size()));
        report.put("created_at", Instant.ofEpochMilli(state.createdAt).toString());
        report.put("completed_at", Instant.ofEpochMilli(state.completedAt > 0 ? state.completedAt : System.currentTimeMillis()).toString());
        report.put("total_execution_time_ms", (state.completedAt > 0 ? state.completedAt : System.currentTimeMillis()) - state.createdAt);

        Map<String, Object> ffmpegConfig = new LinkedHashMap<>();
        ffmpegConfig.put("video_codec", "libx264");
        ffmpegConfig.put("audio_codec", "aac");
        ffmpegConfig.put("preset", "fast");
        ffmpegConfig.put("crf", 22);
        ffmpegConfig.put("movflags", "+faststart");
        ffmpegConfig.put("padding_start_seconds", 0.3);
        ffmpegConfig.put("padding_end_seconds", 0.5);
        report.put("ffmpeg_config", ffmpegConfig);

        report.put("clips", state.clips);
        return report;
    }

    /**
     * Tìm tệp video nguồn trên hệ thống theo độ ưu tiên:
     * 1. Đường dẫn tuyệt đối
     * 2. uploads/
     * 3. input/
     * 4. mock-data/
     */
    public File resolveSourceVideoFile(String videoName) {
        if (videoName == null || videoName.isBlank()) {
            return null;
        }

        File direct = new File(videoName);
        if (direct.exists()) {
            return direct;
        }

        // Nếu videoName là đường dẫn tuyệt đối mà không tồn tại thì không thử ghép relative
        if (direct.isAbsolute()) {
            return null;
        }

        List<Path> baseDirs = List.of(Paths.get("."), Paths.get(".."));
        List<String> subDirs = List.of("uploads", "input", "mock-data");

        for (Path base : baseDirs) {
            for (String sub : subDirs) {
                try {
                    Path candidate = base.resolve(sub).resolve(videoName);
                    if (Files.exists(candidate)) {
                        return candidate.toFile();
                    }
                } catch (Exception ignored) {}
            }
        }

        // Quét uploads/ tìm tệp kết thúc bằng videoName (ví dụ {sha}_{videoName})
        for (Path base : baseDirs) {
            try {
                File uploadsDir = base.resolve("uploads").toFile();
                if (uploadsDir.exists() && uploadsDir.isDirectory()) {
                    File[] files = uploadsDir.listFiles();
                    if (files != null) {
                        for (File f : files) {
                            if (f.getName().endsWith(videoName) || f.getName().contains(videoName)) {
                                return f;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        return null;
    }

    /**
     * Chuẩn hóa chuỗi an toàn chống Path Traversal và dấu tiếng Việt.
     */
    public static String sanitizeToSafeSlug(String input) {
        if (input == null || input.isBlank()) {
            return "safe_item";
        }
        String clean = PathSlugifier.removeAccents(input).trim();
        clean = clean.replaceAll("[\\\\/:*?\"<>|.]", "_");
        clean = clean.replaceAll("[^a-zA-Z0-9_-]", "_");
        clean = clean.replaceAll("_+", "_").replaceAll("^_|_$", "");
        return clean.isBlank() ? "safe_item" : clean;
    }
}
