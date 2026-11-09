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
        return cut(inputPath, outputPath, start, end, 0.0);
    }

    public CutResult cut(String inputPath, String outputPath, double start, double end, double totalDuration) {
        if (inputPath == null || inputPath.isBlank()) {
            return CutResult.failure("", outputPath != null ? outputPath : "", start, end, 0L,
                ErrorCode.FILE_NOT_FOUND, "Đường dẫn tệp video nguồn không được để trống");
        }
        if (outputPath == null || outputPath.isBlank()) {
            return CutResult.failure(inputPath, "", start, end, 0L,
                ErrorCode.UNKNOWN_ERROR, "Đường dẫn tệp video đích không được để trống");
        }
        return cut(new File(inputPath), new File(outputPath), start, end, totalDuration);
    }

    /**
     * Cắt video chính xác theo Path.
     */
    public CutResult cut(Path inputPath, Path outputPath, double start, double end) {
        return cut(inputPath, outputPath, start, end, 0.0);
    }

    public CutResult cut(Path inputPath, Path outputPath, double start, double end, double totalDuration) {
        if (inputPath == null || outputPath == null) {
            return CutResult.failure(
                inputPath != null ? inputPath.toString() : "",
                outputPath != null ? outputPath.toString() : "",
                start, end, 0L,
                ErrorCode.FILE_NOT_FOUND, "Đường dẫn đầu vào/đầu ra không được null"
            );
        }
        return cut(inputPath.toFile(), outputPath.toFile(), start, end, totalDuration);
    }

    /**
     * Hàm kẹp biên giá trị trong khoảng [min, max].
     */
    public double clamp(double value, double min, double max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    /**
     * Tính toán mốc cắt sau khi áp dụng đệm thở (-paddingStart / +paddingEnd) và kẹp biên an toàn.
     *
     * @param start         Mốc bắt đầu gốc (giây)
     * @param end           Mốc kết thúc gốc (giây)
     * @param totalDuration Thời lượng tổng của video nguồn (giây, <= 0 nếu chưa xác định)
     * @return mảng 2 phần tử [paddedStart, paddedEnd]
     */
    public double[] calculatePaddedRange(double start, double end, double totalDuration) {
        double maxBound = totalDuration > 0 ? totalDuration : Double.MAX_VALUE;
        double paddedStart = clamp(start - videoProps.getPaddingStart(), 0.0, maxBound);
        double paddedEnd = (totalDuration > 0)
            ? clamp(end + videoProps.getPaddingEnd(), paddedStart, totalDuration)
            : (end + videoProps.getPaddingEnd());
        return new double[]{paddedStart, paddedEnd};
    }

    /**
     * Cắt video chính xác từ mốc start đến mốc end (Accurate Cut).
     * Tự động áp dụng đệm thở âm thanh (-0.3s / +0.5s) và kẹp biên an toàn.
     *
     * Câu lệnh chuẩn:
     * ffmpeg -y -ss <paddedStart> -to <paddedEnd> -i <in> -c:v libx264 -preset fast -crf 22 -c:a aac -avoid_negative_ts make_zero -movflags +faststart <out>
     */
    public CutResult cut(File inputFile, File outputFile, double start, double end) {
        return cut(inputFile, outputFile, start, end, 0.0);
    }

    /**
     * Cắt video chính xác kèm theo tổng thời lượng (totalDuration) để kẹp biên chính xác.
     */
    public CutResult cut(File inputFile, File outputFile, double start, double end, double totalDuration) {
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

        // 4. Áp dụng đệm thở âm thanh (-0.3s / +0.5s) và kẹp biên
        double[] paddedRange = calculatePaddedRange(start, end, totalDuration);
        double paddedStart = paddedRange[0];
        double paddedEnd = paddedRange[1];

        // Định dạng số với Locale.US để đảm bảo dấu chấm thập phân (ví dụ 12.345 thay vì 12,345)
        String startStr = String.format(Locale.US, "%.3f", paddedStart);
        String endStr = String.format(Locale.US, "%.3f", paddedEnd);

        List<String> command = buildCommand(inputFile, outputFile, startStr, endStr);

        log.info("Bắt đầu cắt clip [{} -> {}]: thô=[{} -> {}], đệm thở=[{} -> {}]",
            inputFile.getName(), outputFile.getName(), start, end, startStr, endStr);

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
            double durationSec = paddedEnd - paddedStart;

            log.info("Cắt video thành công: {} (Thời lượng: {:.2f}s, Thời gian cắt thực tế: {} ms ({:.2f}s), Dung lượng: {} bytes)",
                outputFile.getName(), durationSec, executionTimeMs, executionTimeMs / 1000.0, outputSize);

            return CutResult.success(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs, outputSize);

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
     * Xây dựng danh sách tham số FFmpeg (package-private để test kiểm tra).
     * Bao gồm -movflags +faststart để tối ưu phát trực tuyến web (moov atom ở đầu file).
     */
    List<String> buildCommand(File inputFile, File outputFile, String startStr, String endStr) {
        return List.of(
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
            "-movflags", "+faststart",
            outputFile.getAbsolutePath()
        );
    }

    /**
     * Cắt danh sách nhiều clip con từ cùng 1 video nguồn (Batch cutting).
     *
     * @param inputFile Tệp video nguồn
     * @param requests  Danh sách yêu cầu cắt (gồm outputFile, start, end)
     * @return Danh sách CutResult tương ứng
     */
    public List<CutResult> cutBatch(File inputFile, List<CutRequest> requests) {
        return cutBatch(inputFile, requests, 0.0);
    }

    /**
     * Cắt danh sách nhiều clip con kèm tổng thời lượng video gốc để kẹp biên.
     */
    public List<CutResult> cutBatch(File inputFile, List<CutRequest> requests, double totalDuration) {
        List<CutResult> results = new ArrayList<>();
        if (requests == null || requests.isEmpty()) {
            return results;
        }

        log.info("Bắt đầu xử lý cắt theo lô: {} clip từ video {}", requests.size(), inputFile != null ? inputFile.getName() : "null");

        for (CutRequest req : requests) {
            if (req == null) continue;
            CutResult result = cut(inputFile, req.outputFile(), req.start(), req.end(), totalDuration);
            results.add(result);
            if (!result.success()) {
                log.warn("[Batch] Cắt thất bại clip {}: {}",
                    req.outputFile() != null ? req.outputFile().getName() : "null", result.errorMessage());
            }
        }

        return results;
    }
}
