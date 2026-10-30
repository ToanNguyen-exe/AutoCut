package com.autocut.video;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Service cắt video chính xác từng khung hình bằng FFmpeg (Task [P15]).
 * Sử dụng kỹ thuật re-encode (-c:v libx264) để triệt tiêu hoàn toàn lỗi đen hình I-Frame.
 * Đo lường thời gian thực thi của từng clip con phục vụ báo cáo.
 */
@Service
public class VideoCutter {

    private static final Logger log = LoggerFactory.getLogger(VideoCutter.class);

    private final VideoProps videoProps;

    public VideoCutter(VideoProps videoProps) {
        this.videoProps = videoProps != null ? videoProps : new VideoProps();
    }

    public VideoProps getVideoProps() {
        return videoProps;
    }

    /**
     * DTO hỗ trợ cắt theo lô nhiều phân đoạn.
     */
    public record CutRequest(
        File outputFile,
        double start,
        double end
    ) {}

    /**
     * Cắt video chính xác theo đường dẫn String.
     */
    public CutResult cut(String inputPath, String outputPath, double start, double end) {
        if (inputPath == null || inputPath.isBlank()) {
            return CutResult.failure("", outputPath != null ? outputPath : "", start, end, 0L,
                ErrorCode.FILE_NOT_FOUND, "Đường dẫn tệp video nguồn không được để trống");
        }
        if (outputPath == null || outputPath.isBlank()) {
            return CutResult.failure(inputPath, "", start, end, 0L,
                ErrorCode.UNKNOWN_ERROR, "Đường dẫn tệp video đích không được để trống");
        }
        return cut(new File(inputPath), new File(outputPath), start, end);
    }

    /**
     * Cắt video chính xác theo Path.
     */
    public CutResult cut(Path inputPath, Path outputPath, double start, double end) {
        if (inputPath == null || outputPath == null) {
            return CutResult.failure(
                inputPath != null ? inputPath.toString() : "",
                outputPath != null ? outputPath.toString() : "",
                start, end, 0L,
                ErrorCode.FILE_NOT_FOUND, "Đường dẫn đầu vào/đầu ra không được null"
            );
        }
        return cut(inputPath.toFile(), outputPath.toFile(), start, end);
    }

    /**
     * Cắt video chính xác từ mốc start đến mốc end (Accurate Cut).
     *
     * Câu lệnh chuẩn:
     * ffmpeg -y -ss <start> -to <end> -i <in> -c:v libx264 -preset fast -crf 22 -c:a aac -avoid_negative_ts make_zero <out>
     *
     * @param inputFile  Tệp video nguồn gốc
     * @param outputFile Tệp video con xuất ra
     * @param start      Mốc bắt đầu (giây)
     * @param end        Mốc kết thúc (giây)
     * @return CutResult chứa trạng thái, thời gian cắt thực tế (ms) và dung lượng file
     */
    public CutResult cut(File inputFile, File outputFile, double start, double end) {
        long startTime = System.currentTimeMillis();

        String inputPathStr = inputFile != null ? inputFile.getAbsolutePath() : "";
        String outputPathStr = outputFile != null ? outputFile.getAbsolutePath() : "";

        // 1. Kiểm tra tính hợp lệ của tệp đầu vào
        if (inputFile == null || !inputFile.exists() || !inputFile.isFile()) {
            log.warn("Cắt video thất bại: Tệp nguồn không tồn tại: {}", inputPathStr);
            return CutResult.failure(inputPathStr, outputPathStr, start, end, 0L,
                ErrorCode.FILE_NOT_FOUND, ErrorCode.FILE_NOT_FOUND.getDescription());
        }

        if (inputFile.length() == 0) {
            log.warn("Cắt video thất bại: Tệp nguồn rỗng 0 byte: {}", inputPathStr);
            return CutResult.failure(inputPathStr, outputPathStr, start, end, 0L,
                ErrorCode.FILE_EMPTY, ErrorCode.FILE_EMPTY.getDescription());
        }

        if (outputFile == null) {
            return CutResult.failure(inputPathStr, "", start, end, 0L,
                ErrorCode.UNKNOWN_ERROR, "Tệp đích không được null");
        }

        // 2. Kiểm tra mốc thời gian cắt
        if (start < 0 || end <= start) {
            log.warn("Cắt video thất bại: Mốc thời gian không hợp lệ (start={}, end={})", start, end);
            return CutResult.failure(inputPathStr, outputPathStr, start, end, 0L,
                ErrorCode.INVALID_TIME_RANGE,
                String.format(Locale.US, "Mốc thời gian không hợp lệ: start=%.3f, end=%.3f", start, end));
        }

        // 3. Tự động khởi tạo thư mục cha nếu chưa tồn tại
        File parentDir = outputFile.getParentFile();
        if (parentDir != null && !parentDir.exists()) {
            boolean created = parentDir.mkdirs();
            if (created) {
                log.debug("Đã tạo thư mục đích: {}", parentDir.getAbsolutePath());
            }
        }

        // 4. Xây dựng câu lệnh FFmpeg Accurate Cut
        // Định dạng số với Locale.US để đảm bảo dấu chấm thập phân (ví dụ 12.345 thay vì 12,345)
        String startStr = String.format(Locale.US, "%.3f", start);
        String endStr = String.format(Locale.US, "%.3f", end);

        List<String> command = List.of(
            videoProps.getFfmpegPath(),
            "-y",
            "-ss", startStr,
            "-to", endStr,
            "-i", inputFile.getAbsolutePath(),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "22",
            "-c:a", "aac",
            "-avoid_negative_ts", "make_zero",
            outputFile.getAbsolutePath()
        );

        log.info("Bắt đầu cắt clip [{} -> {}]: start={}, end={}", inputFile.getName(), outputFile.getName(), startStr, endStr);

        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            Process process = pb.start();

            // Đọc đồng thời stderr (nơi ffmpeg in log/tiến độ) và stdout bằng StreamUtil để chống deadlock
            CompletableFuture<String> stderrFuture = StreamUtil.readStreamAsync(process.getErrorStream());
            CompletableFuture<String> stdoutFuture = StreamUtil.readStreamAsync(process.getInputStream());

            int timeoutSec = videoProps.getCutTimeoutSeconds() > 0 ? videoProps.getCutTimeoutSeconds() : 300;
            boolean finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);

            long executionTimeMs = System.currentTimeMillis() - startTime;

            if (!finished) {
                process.destroyForcibly();
                log.error("Cắt video bị timeout sau {} giây đối với tệp: {}", timeoutSec, outputFile.getName());
                return CutResult.failure(inputPathStr, outputPathStr, start, end, executionTimeMs,
                    ErrorCode.TIMEOUT, ErrorCode.TIMEOUT.getDescription());
            }

            String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
            int exitCode = process.exitValue();

            if (exitCode != 0 || !outputFile.exists() || outputFile.length() == 0) {
                String errorDetail = (stderr != null && !stderr.isBlank()) ? stderr.trim() : "Exit code: " + exitCode;
                log.error("Lệnh FFmpeg thất bại khi cắt clip {} (exit code: {}) - Chi tiết: {}",
                    outputFile.getName(), exitCode, errorDetail);
                return CutResult.failure(inputPathStr, outputPathStr, start, end, executionTimeMs,
                    ErrorCode.CUT_FAILED, "FFmpeg lỗi (code " + exitCode + "): " + errorDetail);
            }

            long outputSize = outputFile.length();
            double durationSec = end - start;

            log.info("Cắt video thành công: {} (Thời lượng: {:.2f}s, Thời gian cắt thực tế: {} ms ({:.2f}s), Dung lượng: {} bytes)",
                outputFile.getName(), durationSec, executionTimeMs, executionTimeMs / 1000.0, outputSize);

            return CutResult.success(inputPathStr, outputPathStr, start, end, executionTimeMs, outputSize);

        } catch (java.io.IOException e) {
            long executionTimeMs = System.currentTimeMillis() - startTime;
            log.error("Không thể khởi chạy ffmpeg: {}. Vui lòng kiểm tra cài đặt ffmpeg.", e.getMessage());
            return CutResult.failure(inputPathStr, outputPathStr, start, end, executionTimeMs,
                ErrorCode.PROCESS_EXECUTION_FAILED, "Không thể khởi chạy ffmpeg: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            long executionTimeMs = System.currentTimeMillis() - startTime;
            log.error("Tiến trình cắt video bị gián đoạn: {}", e.getMessage());
            return CutResult.failure(inputPathStr, outputPathStr, start, end, executionTimeMs,
                ErrorCode.UNKNOWN_ERROR, "Tiến trình cắt bị gián đoạn: " + e.getMessage());
        } catch (Exception e) {
            long executionTimeMs = System.currentTimeMillis() - startTime;
            log.error("Lỗi ngoại lệ khi cắt video {}: {}", outputFile.getName(), e.getMessage());
            return CutResult.failure(inputPathStr, outputPathStr, start, end, executionTimeMs,
                ErrorCode.UNKNOWN_ERROR, "Lỗi không xác định khi cắt video: " + e.getMessage());
        }
    }

    /**
     * Cắt danh sách nhiều clip con từ cùng 1 video nguồn (Batch cutting).
     *
     * @param inputFile Tệp video nguồn
     * @param requests  Danh sách yêu cầu cắt (gồm outputFile, start, end)
     * @return Danh sách CutResult tương ứng
     */
    public List<CutResult> cutBatch(File inputFile, List<CutRequest> requests) {
        List<CutResult> results = new ArrayList<>();
        if (requests == null || requests.isEmpty()) {
            return results;
        }

        log.info("Bắt đầu xử lý cắt theo lô: {} clip từ video {}", requests.size(), inputFile != null ? inputFile.getName() : "null");

        for (CutRequest req : requests) {
            if (req == null) continue;
            CutResult result = cut(inputFile, req.outputFile(), req.start(), req.end());
            results.add(result);
            if (!result.success()) {
                log.warn("[Batch] Cắt thất bại clip {}: {}",
                    req.outputFile() != null ? req.outputFile().getName() : "null", result.errorMessage());
            }
        }

        return results;
    }
}
