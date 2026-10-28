package com.autocut.service;

import com.autocut.dto.VideoValidationResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Service kiểm tra tính hợp lệ của video đầu vào (Task [P01]) sử dụng ffprobe.
 * Đảm bảo bắt các lỗi: file hỏng, không có tiếng, thời lượng <= 0 và có cơ chế chịu lỗi không làm sập luồng.
 */
@Service
public class VideoValidator {
    private static final Logger log = LoggerFactory.getLogger(VideoValidator.class);
    private final ObjectMapper objectMapper;
    private String ffprobePath;

    public VideoValidator(@Value("${ffmpeg.ffprobe-path:ffprobe}") String ffprobePath) {
        this.objectMapper = new ObjectMapper();
        this.ffprobePath = ffprobePath;
    }

    public void setFfprobePath(String ffprobePath) {
        this.ffprobePath = ffprobePath;
    }

    public String getFfprobePath() {
        return this.ffprobePath;
    }

    /**
     * Kiểm tra tính hợp lệ của tệp video theo đường dẫn String.
     */
    public VideoValidationResult validate(String filePath) {
        if (filePath == null || filePath.isBlank()) {
            return VideoValidationResult.invalid("", "", "Đường dẫn tệp video không được để trống");
        }
        return validate(new File(filePath));
    }

    /**
     * Kiểm tra tính hợp lệ của tệp video theo Path.
     */
    public VideoValidationResult validate(Path path) {
        if (path == null) {
            return VideoValidationResult.invalid("", "", "Đường dẫn tệp video không được null");
        }
        return validate(path.toFile());
    }

    /**
     * Kiểm tra tính hợp lệ của tệp video đầu vào (Kiểm định tệp vật lý qua ffprobe).
     *
     * @param videoFile Tệp video cần kiểm tra
     * @return VideoValidationResult chứa kết quả và chi tiết lỗi nếu có
     */
    public VideoValidationResult validate(File videoFile) {
        if (videoFile == null) {
            log.warn("Kiểm tra thất bại: Đối tượng File là null");
            return VideoValidationResult.invalid("", "", "Tệp video không được null");
        }

        String pathStr = videoFile.getAbsolutePath();
        String fileName = videoFile.getName();

        // 1. Kiểm tra sự tồn tại của tệp vật lý
        if (!videoFile.exists() || !videoFile.isFile()) {
            log.warn("Kiểm tra thất bại: Tệp không tồn tại hoặc không phải là file hợp lệ: {}", pathStr);
            return VideoValidationResult.invalid(pathStr, fileName, "Tệp không tồn tại hoặc không thể đọc");
        }

        if (videoFile.length() == 0) {
            log.warn("Kiểm tra thất bại: Tệp có dung lượng bằng 0 byte: {}", pathStr);
            return VideoValidationResult.invalid(pathStr, fileName, "Tệp rỗng (0 bytes)");
        }

        try {
            // 2. Gọi lệnh ffprobe với format JSON
            ProcessBuilder pb = new ProcessBuilder(
                ffprobePath,
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                pathStr
            );

            Process process = pb.start();

            // Đọc kết quả stdout và stderr
            String stdout;
            String stderr;
            try (InputStream is = process.getInputStream(); InputStream es = process.getErrorStream()) {
                stdout = new String(is.readAllBytes(), StandardCharsets.UTF_8);
                stderr = new String(es.readAllBytes(), StandardCharsets.UTF_8);
            }

            boolean finished = process.waitFor(20, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.error("ffprobe bị timeout sau 20 giây đối với tệp: {}", pathStr);
                return VideoValidationResult.invalid(pathStr, fileName, "ffprobe chạy quá thời gian chờ (timeout)");
            }

            int exitCode = process.exitValue();
            if (exitCode != 0 || stdout.isBlank()) {
                String errorDetail = !stderr.isBlank() ? stderr.trim() : "Mã lỗi exit code: " + exitCode;
                log.warn("Tệp hỏng hoặc không đúng định dạng media: {} - Chi tiết: {}", pathStr, errorDetail);
                return VideoValidationResult.invalid(pathStr, fileName, "Tệp hỏng, không đọc được cấu trúc media: " + errorDetail);
            }

            // 3. Phân tích kết quả JSON từ ffprobe
            JsonNode rootNode;
            try {
                rootNode = objectMapper.readTree(stdout);
            } catch (Exception e) {
                log.warn("Không thể parse JSON từ ffprobe cho tệp {}: {}", pathStr, e.getMessage());
                return VideoValidationResult.invalid(pathStr, fileName, "Không thể giải mã cấu trúc JSON từ ffprobe: " + e.getMessage());
            }

            // 4. Kiểm tra các luồng media (Streams)
            JsonNode streamsNode = rootNode.path("streams");
            if (!streamsNode.isArray() || streamsNode.isEmpty()) {
                log.warn("Tệp không chứa bất kỳ luồng media nào: {}", pathStr);
                return VideoValidationResult.invalid(pathStr, fileName, "Tệp không chứa bất kỳ luồng media nào");
            }

            int videoStreams = 0;
            int audioStreams = 0;
            double streamMaxDuration = 0.0;

            for (JsonNode stream : streamsNode) {
                String codecType = stream.path("codec_type").asText("");
                if ("video".equalsIgnoreCase(codecType)) {
                    videoStreams++;
                } else if ("audio".equalsIgnoreCase(codecType)) {
                    audioStreams++;
                }

                double sDuration = stream.path("duration").asDouble(0.0);
                if (sDuration > streamMaxDuration) {
                    streamMaxDuration = sDuration;
                }
            }

            // Kiểm tra bắt buộc: Video phải có luồng âm thanh thực tế
            if (audioStreams == 0) {
                log.warn("Video không có luồng âm thanh thực tế (audio stream = 0): {}", pathStr);
                return VideoValidationResult.invalid(pathStr, fileName, "Video không có luồng âm thanh thực tế (audio stream = 0)");
            }

            // 5. Kiểm tra thời lượng video (Duration > 0)
            JsonNode formatNode = rootNode.path("format");
            double duration = formatNode.path("duration").asDouble(0.0);
            if (duration <= 0.0) {
                // Fallback nếu format.duration không có, dùng duration từ streams
                duration = streamMaxDuration;
            }

            if (duration <= 0.0 || Double.isNaN(duration)) {
                log.warn("Thời lượng video không hợp lệ (duration <= 0): {} (duration={})", pathStr, duration);
                return VideoValidationResult.invalid(pathStr, fileName, "Thời lượng video không hợp lệ (duration <= 0)");
            }

            String formatName = formatNode.path("format_name").asText("unknown");

            log.info("Xác thực video thành công: {} (Thời lượng: {}s, Audio streams: {}, Video streams: {}, Format: {})",
                fileName, duration, audioStreams, videoStreams, formatName);

            return VideoValidationResult.valid(pathStr, fileName, duration, videoStreams, audioStreams, formatName);

        } catch (java.io.IOException e) {
            log.error("Không thể khởi chạy ffprobe: {}. Vui lòng kiểm tra cài đặt ffprobe hoặc biến môi trường PATH.", e.getMessage());
            return VideoValidationResult.invalid(pathStr, fileName, "Không thể khởi chạy công cụ ffprobe: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Quá trình kiểm tra video bị gián đoạn: {}", e.getMessage());
            return VideoValidationResult.invalid(pathStr, fileName, "Quá trình kiểm tra bị gián đoạn: " + e.getMessage());
        } catch (Exception e) {
            log.error("Lỗi ngoại lệ khi kiểm tra video {}: {}", pathStr, e.getMessage());
            return VideoValidationResult.invalid(pathStr, fileName, "Lỗi không xác định khi kiểm tra video: " + e.getMessage());
        }
    }

    /**
     * Kiểm tra tính hợp lệ của một danh sách video (Hỗ trợ xử lý theo lô - Batch processing).
     * Cơ chế chịu lỗi: Video lỗi sẽ được ghi nhận nguyên nhân, hệ thống bỏ qua và tiếp tục xử lý các video khác.
     */
    public List<VideoValidationResult> validateBatch(List<File> videoFiles) {
        List<VideoValidationResult> results = new ArrayList<>();
        if (videoFiles == null || videoFiles.isEmpty()) {
            return results;
        }

        for (File file : videoFiles) {
            try {
                VideoValidationResult result = validate(file);
                results.add(result);
                if (!result.isValid()) {
                    log.warn("[Batch] Bỏ qua video lỗi: {} - Nguyên nhân: {}", file.getName(), result.errorMessage());
                }
            } catch (Exception e) {
                log.error("[Batch] Lỗi không lường trước với file {}: {}. Vẫn tiếp tục xử lý các file còn lại.",
                    file != null ? file.getName() : "null", e.getMessage());
                results.add(VideoValidationResult.invalid(
                    file != null ? file.getAbsolutePath() : "",
                    file != null ? file.getName() : "",
                    "Lỗi không xác định trong luồng batch: " + e.getMessage()
                ));
            }
        }
        return results;
    }
}
