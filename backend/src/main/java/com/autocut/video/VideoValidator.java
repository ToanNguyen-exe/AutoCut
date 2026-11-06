package com.autocut.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Service kiểm tra tính hợp lệ của video đầu vào (Task [P01]) sử dụng ffprobe.
 * Đảm bảo bắt các lỗi: file hỏng, không có tiếng, thời lượng <= 0 và có cơ chế chịu lỗi không làm sập luồng.
 */
@Service
public class VideoValidator {

    private static final Logger log = LoggerFactory.getLogger(VideoValidator.class);
    private final VideoProps videoProps;
    private final ObjectMapper objectMapper;

    public VideoValidator(VideoProps videoProps) {
        this.videoProps = videoProps != null ? videoProps : new VideoProps();
        this.objectMapper = new ObjectMapper();
    }

    public VideoProps getVideoProps() {
        return videoProps;
    }

    /**
     * Kiểm tra tính hợp lệ của tệp video theo đường dẫn String.
     */
    public ValidationResult validate(String filePath) {
        if (filePath == null || filePath.isBlank()) {
            return ValidationResult.invalid("", "", ErrorCode.FILE_NOT_FOUND, "Đường dẫn tệp video không được để trống");
        }
        return validate(new File(filePath));
    }

    /**
     * Kiểm tra tính hợp lệ của tệp video theo Path.
     */
    public ValidationResult validate(Path path) {
        if (path == null) {
            return ValidationResult.invalid("", "", ErrorCode.FILE_NOT_FOUND, "Đường dẫn tệp video không được null");
        }
        return validate(path.toFile());
    }

    /**
     * Kiểm tra tính hợp lệ của tệp video đầu vào (Kiểm định tệp vật lý qua ffprobe).
     *
     * @param videoFile Tệp video cần kiểm tra
     * @return ValidationResult chứa kết quả và chi tiết lỗi nếu có
     */
    public ValidationResult validate(File videoFile) {
        if (videoFile == null) {
            log.warn("Kiểm tra thất bại: Đối tượng File là null");
            return ValidationResult.invalid("", "", ErrorCode.FILE_NOT_FOUND, "Tệp video không được null");
        }

        String pathStr = videoFile.getAbsolutePath();
        String fileName = videoFile.getName();

        // 1. Kiểm tra sự tồn tại của tệp vật lý
        if (!videoFile.exists() || !videoFile.isFile()) {
            log.warn("Kiểm tra thất bại: Tệp không tồn tại hoặc không thể đọc: {}", pathStr);
            return ValidationResult.invalid(pathStr, fileName, ErrorCode.FILE_NOT_FOUND, ErrorCode.FILE_NOT_FOUND.getDescription());
        }

        if (videoFile.length() == 0) {
            log.warn("Kiểm tra thất bại: Tệp có dung lượng bằng 0 byte: {}", pathStr);
            return ValidationResult.invalid(pathStr, fileName, ErrorCode.FILE_EMPTY, ErrorCode.FILE_EMPTY.getDescription());
        }

        try {
            // 2. Gọi lệnh ffprobe với format JSON
            ProcessBuilder pb = new ProcessBuilder(
                videoProps.getFfprobePath(),
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                pathStr
            );

            Process process = pb.start();

            // Đọc đồng thời stdout và stderr qua StreamUtil bằng BufferedReader để chống pipe deadlock
            CompletableFuture<String> stdoutFuture = StreamUtil.readStreamAsync(process.getInputStream());
            CompletableFuture<String> stderrFuture = StreamUtil.readStreamAsync(process.getErrorStream());

            int timeoutSec = videoProps.getTimeoutSeconds() > 0 ? videoProps.getTimeoutSeconds() : 20;
            boolean finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);

            if (!finished) {
                process.destroyForcibly();
                log.error("ffprobe bị timeout sau {} giây đối với tệp: {}", timeoutSec, pathStr);
                return ValidationResult.invalid(pathStr, fileName, ErrorCode.TIMEOUT, ErrorCode.TIMEOUT.getDescription());
            }

            String stdout = stdoutFuture.get(2, TimeUnit.SECONDS);
            String stderr = stderrFuture.get(2, TimeUnit.SECONDS);

            int exitCode = process.exitValue();
            if (exitCode != 0 || stdout.isBlank()) {
                String errorDetail = !stderr.isBlank() ? stderr.trim() : "Exit code: " + exitCode;
                log.warn("Tệp hỏng hoặc không đúng định dạng media: {} - Chi tiết: {}", pathStr, errorDetail);
                return ValidationResult.invalid(pathStr, fileName, ErrorCode.CORRUPTED_FILE,
                    ErrorCode.CORRUPTED_FILE.getDescription() + " (" + errorDetail + ")");
            }

            // 3. Phân tích kết quả JSON từ ffprobe
            JsonNode rootNode;
            try {
                rootNode = objectMapper.readTree(stdout);
            } catch (Exception e) {
                log.warn("Không thể parse JSON từ ffprobe cho tệp {}: {}", pathStr, e.getMessage());
                return ValidationResult.invalid(pathStr, fileName, ErrorCode.JSON_PARSE_ERROR,
                    ErrorCode.JSON_PARSE_ERROR.getDescription() + ": " + e.getMessage());
            }

            // 4. Kiểm tra các luồng media (Streams)
            JsonNode streamsNode = rootNode.path("streams");
            if (!streamsNode.isArray() || streamsNode.isEmpty()) {
                log.warn("Tệp không chứa bất kỳ luồng media nào: {}", pathStr);
                return ValidationResult.invalid(pathStr, fileName, ErrorCode.CORRUPTED_FILE,
                    "Tệp không chứa bất kỳ luồng media nào");
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

            // Bắt lỗi bắt buộc: Video phải có luồng âm thanh thực tế
            if (audioStreams == 0) {
                log.warn("Video không có luồng âm thanh thực tế (audio stream = 0): {}", pathStr);
                return ValidationResult.invalid(pathStr, fileName, ErrorCode.NO_AUDIO_STREAM,
                    ErrorCode.NO_AUDIO_STREAM.getDescription());
            }

            // 5. Kiểm tra thời lượng video (Duration > 0)
            JsonNode formatNode = rootNode.path("format");
            double duration = formatNode.path("duration").asDouble(0.0);
            if (duration <= 0.0) {
                duration = streamMaxDuration;
            }

            if (duration <= 0.0 || Double.isNaN(duration)) {
                log.warn("Thời lượng video không hợp lệ (duration <= 0): {} (duration={})", pathStr, duration);
                return ValidationResult.invalid(pathStr, fileName, ErrorCode.INVALID_DURATION,
                    ErrorCode.INVALID_DURATION.getDescription());
            }

            String formatName = formatNode.path("format_name").asText("unknown");

            log.info("Xác thực video thành công: {} (Thời lượng: {}s, Audio streams: {}, Video streams: {}, Format: {})",
                fileName, duration, audioStreams, videoStreams, formatName);

            return ValidationResult.valid(pathStr, fileName, duration, videoStreams, audioStreams, formatName);

        } catch (java.io.IOException e) {
            log.error("Không thể khởi chạy ffprobe: {}. Vui lòng kiểm tra cài đặt ffprobe hoặc biến môi trường PATH.", e.getMessage());
            return ValidationResult.invalid(pathStr, fileName, ErrorCode.PROCESS_EXECUTION_FAILED,
                ErrorCode.PROCESS_EXECUTION_FAILED.getDescription() + ": " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Quá trình kiểm tra video bị gián đoạn: {}", e.getMessage());
            return ValidationResult.invalid(pathStr, fileName, ErrorCode.UNKNOWN_ERROR,
                "Quá trình kiểm tra bị gián đoạn: " + e.getMessage());
        } catch (Exception e) {
            log.error("Lỗi ngoại lệ khi kiểm tra video {}: {}", pathStr, e.getMessage());
            return ValidationResult.invalid(pathStr, fileName, ErrorCode.UNKNOWN_ERROR,
                ErrorCode.UNKNOWN_ERROR.getDescription() + ": " + e.getMessage());
        }
    }

    /**
     * Kiểm tra tính hợp lệ của một danh sách video (Hỗ trợ xử lý theo lô - Batch processing).
     * Cơ chế chịu lỗi: Video lỗi sẽ được ghi nhận nguyên nhân, hệ thống bỏ qua và tiếp tục xử lý các video khác.
     */
    public List<ValidationResult> validateBatch(List<File> videoFiles) {
        List<ValidationResult> results = new ArrayList<>();
        if (videoFiles == null || videoFiles.isEmpty()) {
            return results;
        }

        for (File file : videoFiles) {
            try {
                ValidationResult result = validate(file);
                results.add(result);
                if (!result.isValid()) {
                    log.warn("[Batch] Bỏ qua video lỗi: {} - Mã lỗi: {} - Nguyên nhân: {}",
                        file.getName(), result.errorCode(), result.errorMessage());
                }
            } catch (Exception e) {
                log.error("[Batch] Lỗi không lường trước với file {}: {}. Vẫn tiếp tục xử lý các file còn lại.",
                    file != null ? file.getName() : "null", e.getMessage());
                results.add(ValidationResult.invalid(
                    file != null ? file.getAbsolutePath() : "",
                    file != null ? file.getName() : "",
                    ErrorCode.UNKNOWN_ERROR,
                    "Lỗi không xác định trong luồng batch: " + e.getMessage()
                ));
            }
        }
        return results;
    }
}
