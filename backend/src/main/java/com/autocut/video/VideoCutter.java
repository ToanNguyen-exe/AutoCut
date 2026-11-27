package com.autocut.video;

import com.autocut.service.ConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Service cắt video chính xác từng khung hình bằng FFmpeg (Task [P15]).
 * Sử dụng kỹ thuật re-encode (-c:v libx264) để triệt tiêu hoàn toàn lỗi đen hình I-Frame.
 * Tự động áp dụng lùi padding_start (0.3s) chống cụt âm đầu và tiến padding_end (0.5s) cho thở tự nhiên.
 * Kẹp biên an toàn trong khoảng [0, duration] bằng hàm clamp().
 * Đo lường thời gian thực thi của từng clip con phục vụ báo cáo.
 */
@Service
public class VideoCutter {

    private static final Logger log = LoggerFactory.getLogger(VideoCutter.class);

    private final VideoProps videoProps;
    private final ConfigService configService;
    private final Map<String, Double> durationCache = new ConcurrentHashMap<>();

    /** Kết quả dò NVENC một lần duy nhất; null = chưa dò. */
    private volatile Boolean nvencAvailable;

    public VideoCutter() {
        this(new VideoProps(), null);
    }

    public VideoCutter(VideoProps videoProps) {
        this(videoProps, null);
    }

    @Autowired
    public VideoCutter(VideoProps videoProps, @Lazy @Autowired(required = false) ConfigService configService) {
        this.videoProps = videoProps != null ? videoProps : new VideoProps();
        this.configService = configService;
    }

    public VideoProps getVideoProps() {
        return videoProps;
    }

    public ConfigService getConfigService() {
        return configService;
    }

    /**
     * Chọn bộ mã hoá cho nhánh re-encode dựa trên cấu hình autocut.video.encoder.
     * "auto" (mặc định) dùng NVENC nếu ffmpeg của máy có hỗ trợ, ngược lại dùng libx264.
     */
    String resolveVideoEncoder() {
        return EncoderSupport.resolve(videoProps);
    }

    /**
     * Dò xem ffmpeg hiện tại có encoder h264_nvenc hay không (kết quả cache theo ffmpeg path).
     */
    boolean isNvencAvailable() {
        return EncoderSupport.isNvencAvailable(videoProps);
    }

    /**
     * Dựng lệnh FFmpeg re-encode với bộ mã hoá chỉ định.
     * NVENC dùng -rc vbr -cq thay cho -crf của libx264.
     */
    List<String> buildCommandWithEncoder(String inputSource, File outputFile, String startStr, String endStr, String encoder) {
        if ("h264_nvenc".equals(encoder)) {
            return List.of(
                videoProps.getFfmpegPath(),
                "-y",
                "-ss", startStr,
                "-to", endStr,
                "-i", inputSource,
                "-c:v", "h264_nvenc",
                "-preset", videoProps.getNvencPreset(),
                "-rc", "vbr",
                "-cq", String.valueOf(videoProps.getNvencCq()),
                "-b:v", "0",
                // Nguồn 10-bit/4:2:2 (ProRes, nhiều camera) không được NVENC nhận trực tiếp
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-avoid_negative_ts", "make_zero",
                "-movflags", "+faststart",
                outputFile.getAbsolutePath()
            );
        }
        return buildCommand(inputSource, outputFile, startStr, endStr);
    }

    /**
     * Lấy giá trị padding_start hiệu lực: ưu tiên từ config.yaml (qua ConfigService),
     * nếu không có thì lấy từ VideoProps (mặc định 0.3s).
     */
    public double getEffectivePaddingStart() {
        if (configService != null) {
            return configService.getPaddingStart();
        }
        return videoProps.getPaddingStart();
    }

    /**
     * Lấy giá trị padding_end hiệu lực: ưu tiên từ config.yaml (qua ConfigService),
     * nếu không có thì lấy từ VideoProps (mặc định 0.5s).
     */
    public double getEffectivePaddingEnd() {
        if (configService != null) {
            return configService.getPaddingEnd();
        }
        return videoProps.getPaddingEnd();
    }

    /**
     * Hàm kẹp biên giá trị trong đoạn [min, max].
     * Ví dụ: clamp(start - 0.3, 0, duration)
     *
     * @param val Giá trị cần kẹp
     * @param min Biên dưới (thường là 0.0)
     * @param max Biên trên (thường là duration của video)
     * @return Giá trị đã được kẹp an toàn trong [min, max]
     */
    public static double clamp(double val, double min, double max) {
        if (val < min) {
            return min;
        }
        if (val > max) {
            return max;
        }
        return val;
    }

    /**
     * Kiểm tra xem đường dẫn có phải là URL phát từ xa (HTTP/HTTPS) hay không.
     */
    public static boolean isRemoteUrl(String path) {
        if (path == null) return false;
        String trimmed = path.trim();
        return trimmed.startsWith("http://") || trimmed.startsWith("https://");
    }

    private static String getRemoteDisplayName(String url) {
        if (url == null) return "remote_video.mp4";
        int lastSlash = url.lastIndexOf('/');
        if (lastSlash >= 0 && lastSlash < url.length() - 1) {
            return url.substring(lastSlash + 1);
        }
        return url;
    }

    /**
     * Trích xuất thời lượng (duration) của video bằng ffprobe từ đường dẫn String (file cục bộ hoặc URL từ xa).
     */
    public double probeDuration(String videoSource) {
        if (videoSource == null || videoSource.isBlank()) {
            return 0.0;
        }
        if (!isRemoteUrl(videoSource)) {
            File f = new File(videoSource);
            if (!f.exists() || f.length() == 0) {
                return 0.0;
            }
        }
        try {
            ProcessBuilder pb = new ProcessBuilder(
                videoProps.getFfprobePath(),
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                videoSource
            );
            Process process = pb.start();
            CompletableFuture<String> stdoutFuture = StreamUtil.readStreamAsync(process.getInputStream());
            int timeout = videoProps.getTimeoutSeconds() > 0 ? videoProps.getTimeoutSeconds() : 15;
            boolean finished = process.waitFor(timeout, TimeUnit.SECONDS);
            if (finished && process.exitValue() == 0) {
                String out = stdoutFuture.get(1, TimeUnit.SECONDS);
                if (out != null && !out.isBlank()) {
                    return Double.parseDouble(out.trim());
                }
            }
        } catch (Exception e) {
            log.debug("Không thể trích xuất duration bằng ffprobe cho nguồn {}: {}", videoSource, e.getMessage());
        }
        return 0.0;
    }

    /**
     * Trích xuất thời lượng (duration) của video bằng ffprobe để phục vụ kẹp biên max.
     */
    public double probeDuration(File videoFile) {
        if (videoFile == null || !videoFile.exists() || videoFile.length() == 0) {
            return 0.0;
        }
        return probeDuration(videoFile.getAbsolutePath());
    }

    /**
     * Lấy thời lượng video từ cache hoặc thăm dò bằng ffprobe nếu chưa có (hỗ trợ cả URL từ xa).
     */
    public double getOrProbeDuration(String videoSource) {
        if (videoSource == null || videoSource.isBlank()) return 0.0;
        return durationCache.computeIfAbsent(videoSource, this::probeDuration);
    }

    /**
     * Lấy thời lượng video từ cache hoặc thăm dò bằng ffprobe nếu chưa có.
     */
    public double getOrProbeDuration(File videoFile) {
        if (videoFile == null) return 0.0;
        return getOrProbeDuration(videoFile.getAbsolutePath());
    }

    /**
     * DTO hỗ trợ cắt theo lô nhiều phân đoạn.
     */
    public record CutRequest(
        File outputFile,
        double start,
        double end,
        double duration
    ) {
        public CutRequest(File outputFile, double start, double end) {
            this(outputFile, start, end, 0.0);
        }
    }

    /**
     * Cắt video chính xác theo đường dẫn String (hỗ trợ cả tệp cục bộ và Cloudflare R2 / HTTP URL).
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

        String trimmedInput = inputPath.trim();
        File outFile = new File(outputPath);

        if (isRemoteUrl(trimmedInput)) {
            return executeFfmpegCut(trimmedInput, getRemoteDisplayName(trimmedInput), outFile, start, end, totalDuration, true, true);
        }

        return cut(new File(trimmedInput), outFile, start, end, totalDuration);
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
     * Tính toán mốc cắt sau khi áp dụng đệm thở (-paddingStart / +paddingEnd) và kẹp biên an toàn.
     *
     * @param start         Mốc bắt đầu gốc (giây)
     * @param end           Mốc kết thúc gốc (giây)
     * @param totalDuration Thời lượng tổng của video nguồn (giây, <= 0 nếu chưa xác định)
     * @return mảng 2 phần tử [paddedStart, paddedEnd]
     */
    public double[] calculatePaddedRange(double start, double end, double totalDuration) {
        double maxBound = totalDuration > 0 ? totalDuration : Double.MAX_VALUE;
        double paddedStart = clamp(start - getEffectivePaddingStart(), 0.0, maxBound);
        double paddedEnd = (totalDuration > 0)
            ? clamp(end + getEffectivePaddingEnd(), paddedStart, totalDuration)
            : (end + getEffectivePaddingEnd());
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

        return executeFfmpegCut(inputFile.getAbsolutePath(), inputFile.getName(), outputFile, start, end, totalDuration, true, true);
    }

    /**
     * Cắt CHÍNH XÁC TUYỆT ĐỐI: không đệm thở, không stream-copy.
     *
     * Dùng cho thao tác "gộp các phân đoạn đã chọn": người dùng chọn đúng đoạn nào thì
     * file kết quả phải chứa đúng đoạn đó. Đệm thở (-0.3s/+0.5s) và stream-copy lệch
     * keyframe sẽ làm clip dài hơn lựa chọn (2 đoạn 4s ra 10,3s thay vì 8s).
     */
    public CutResult cutExact(File inputFile, File outputFile, double start, double end) {
        String inputPathStr = inputFile != null ? inputFile.getAbsolutePath() : "";
        String outputPathStr = outputFile != null ? outputFile.getAbsolutePath() : "";
        if (inputFile == null || !inputFile.exists() || !inputFile.isFile()) {
            return CutResult.failure(inputPathStr, outputPathStr, start, end, 0L,
                ErrorCode.FILE_NOT_FOUND, ErrorCode.FILE_NOT_FOUND.getDescription());
        }
        if (inputFile.length() == 0) {
            return CutResult.failure(inputPathStr, outputPathStr, start, end, 0L,
                ErrorCode.FILE_EMPTY, ErrorCode.FILE_EMPTY.getDescription());
        }
        return executeFfmpegCut(inputFile.getAbsolutePath(), inputFile.getName(), outputFile, start, end, 0.0, false, false);
    }

    /**
     * Thực thi lệnh cắt video bằng FFmpeg cho cả tệp cục bộ và URL phát trực tuyến từ xa.
     */
    private CutResult executeFfmpegCut(String inputSource, String displayName, File outputFile, double start, double end, double totalDuration,
                                       boolean applyPadding, boolean allowFastCopy) {
        long startTime = System.currentTimeMillis();
        String inputPathStr = inputSource != null ? inputSource : "";
        String outputPathStr = outputFile != null ? outputFile.getAbsolutePath() : "";

        if (outputFile == null) {
            return CutResult.failure(inputPathStr, "", start, end, 0L,
                ErrorCode.UNKNOWN_ERROR, "Tệp đích không được null");
        }

        // 2. Kiểm tra mốc thời gian cắt thô
        if (start < 0 || end <= start) {
            log.warn("Cắt video thất bại: Mốc thời gian không hợp lệ (start={}, end={})", start, end);
            return CutResult.failure(inputPathStr, outputPathStr, start, end, 0L,
                ErrorCode.INVALID_TIME_RANGE,
                String.format(Locale.US, "Mốc thời gian không hợp lệ: start=%.3f, end=%.3f", start, end));
        }

        // 3. Áp dụng đệm thở âm thanh (-0.3s / +0.5s) và kẹp biên (bỏ qua khi cắt chính xác tuyệt đối)
        double videoDuration = totalDuration > 0 ? totalDuration : getOrProbeDuration(inputSource);
        double paddedStart;
        double paddedEnd;
        if (applyPadding) {
            double[] paddedRange = calculatePaddedRange(start, end, videoDuration);
            paddedStart = paddedRange[0];
            paddedEnd = paddedRange[1];
        } else {
            double maxBound = videoDuration > 0 ? videoDuration : Double.MAX_VALUE;
            paddedStart = Math.max(0.0, Math.min(start, maxBound));
            paddedEnd = Math.max(paddedStart, Math.min(end, maxBound));
        }

        // Định dạng số với Locale.US để đảm bảo dấu chấm thập phân (ví dụ 12.345 thay vì 12,345)
        String startStr = String.format(Locale.US, "%.3f", paddedStart);
        String endStr = String.format(Locale.US, "%.3f", paddedEnd);

        // Tự động khởi tạo thư mục cha nếu chưa tồn tại
        File parentDir = outputFile.getParentFile();
        if (parentDir != null && !parentDir.exists()) {
            boolean created = parentDir.mkdirs();
            if (created) {
                log.debug("Đã tạo thư mục đích: {}", parentDir.getAbsolutePath());
            }
        }

        // 4. Ưu tiên chế độ Siêu Tốc (Fast Stream-Copy -c copy) trước — chỉ khi được phép,
        //    vì stream-copy bám keyframe nên mốc cắt bị lệch (đo thực tế: chọn 2×4s ra 10,3s).
        List<String> fastCommand = buildCommandFast(inputSource, outputFile, startStr, endStr);
        if (allowFastCopy) {
        log.info("Thử cắt siêu tốc bằng Stream Copy (-c copy) [{} -> {}]: thô=[{} -> {}], đệm thở=[{} -> {}]",
            displayName, outputFile.getName(), start, end, startStr, endStr);
        try {
            ProcessBuilder pbFast = new ProcessBuilder(fastCommand);
            Process processFast = pbFast.start();
            CompletableFuture<String> stderrFast = StreamUtil.readStreamAsync(processFast.getErrorStream());
            CompletableFuture<String> stdoutFast = StreamUtil.readStreamAsync(processFast.getInputStream());

            int fastTimeout = Math.min(60, videoProps.getCutTimeoutSeconds());
            boolean finishedFast = processFast.waitFor(fastTimeout, TimeUnit.SECONDS);

            if (finishedFast && processFast.exitValue() == 0 && outputFile.exists() && outputFile.length() > 0) {
                long executionTimeMs = System.currentTimeMillis() - startTime;
                long outputSize = outputFile.length();
                double durationSec = paddedEnd - paddedStart;
                log.info("Cắt siêu tốc Stream Copy THÀNH CÔNG: {} (Thời lượng: {}s, Thời gian thực tế: {} ms, Dung lượng: {} bytes)",
                    outputFile.getName(), durationSec, executionTimeMs, outputSize);
                return CutResult.success(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs, outputSize);
            }

            if (!finishedFast) {
                processFast.destroyForcibly();
            }
            log.warn("Chế độ Stream Copy không hoàn tất hoặc lỗi (exit code: {}), tự động fallback sang Re-encode (libx264)...",
                finishedFast ? processFast.exitValue() : -1);
        } catch (Exception ex) {
            log.warn("Lỗi khi thử cắt Stream Copy: {}, tự động fallback sang Re-encode...", ex.getMessage());
        }
        }

        // 5. Fallback sang Re-encode chuẩn hóa nếu Stream Copy không khả dụng.
        //    Ưu tiên NVENC (GPU) khi ffmpeg hỗ trợ; nếu GPU lỗi thì tự động về libx264 (CPU).
        String preferredEncoder = resolveVideoEncoder();
        List<String> encodersToTry = "h264_nvenc".equals(preferredEncoder)
            ? List.of("h264_nvenc", "libx264")
            : List.of("libx264");

        log.info("Bắt đầu cắt clip Re-encode [{} -> {}]: thô=[{} -> {}], đệm thở=[{} -> {}] (duration={}s, encoder={})",
            displayName, outputFile.getName(), start, end, startStr, endStr, videoDuration, preferredEncoder);

        CutResult lastFailure = null;
        for (String encoder : encodersToTry) {
            List<String> command = buildCommandWithEncoder(inputSource, outputFile, startStr, endStr, encoder);
            long encodeStartedAt = System.currentTimeMillis();

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
                    return CutResult.failure(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs,
                        ErrorCode.TIMEOUT, ErrorCode.TIMEOUT.getDescription());
                }

                String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
                int exitCode = process.exitValue();

                if (exitCode != 0 || !outputFile.exists() || outputFile.length() == 0) {
                    String errorDetail = (stderr != null && !stderr.isBlank()) ? stderr.trim() : "Exit code: " + exitCode;
                    log.error("Lệnh FFmpeg thất bại khi cắt clip {} (encoder={}, exit code: {}) - Chi tiết: {}",
                        outputFile.getName(), encoder, exitCode, errorDetail);
                    lastFailure = CutResult.failure(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs,
                        ErrorCode.CUT_FAILED, "FFmpeg lỗi (code " + exitCode + "): " + errorDetail);
                    // GPU lỗi (driver/codec không hỗ trợ) → thử lại bằng CPU thay vì trả lỗi cho người dùng
                    continue;
                }

                long outputSize = outputFile.length();
                double durationSec = paddedEnd - paddedStart;
                long encodeMs = System.currentTimeMillis() - encodeStartedAt;

                log.info("Cắt video thành công: {} (Thời lượng: {}s, encoder={}, thời gian encode: {} ms, tổng: {} ms, dung lượng: {} bytes)",
                    outputFile.getName(), durationSec, encoder, encodeMs, executionTimeMs, outputSize);

                return CutResult.success(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs, outputSize);

            } catch (java.io.IOException e) {
                long executionTimeMs = System.currentTimeMillis() - startTime;
                log.error("Không thể khởi chạy ffmpeg (encoder={}): {}. Vui lòng kiểm tra cài đặt ffmpeg.", encoder, e.getMessage());
                lastFailure = CutResult.failure(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs,
                    ErrorCode.PROCESS_EXECUTION_FAILED, "Không thể khởi chạy ffmpeg: " + e.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                long executionTimeMs = System.currentTimeMillis() - startTime;
                log.error("Tiến trình cắt video bị gián đoạn: {}", e.getMessage());
                return CutResult.failure(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs,
                    ErrorCode.UNKNOWN_ERROR, "Tiến trình cắt bị gián đoạn: " + e.getMessage());
            } catch (Exception e) {
                long executionTimeMs = System.currentTimeMillis() - startTime;
                log.error("Lỗi ngoại lệ khi cắt video {} (encoder={}): {}", outputFile.getName(), encoder, e.getMessage());
                lastFailure = CutResult.failure(inputPathStr, outputPathStr, paddedStart, paddedEnd, executionTimeMs,
                    ErrorCode.UNKNOWN_ERROR, "Lỗi không xác định khi cắt video: " + e.getMessage());
            }
        }

        return lastFailure != null ? lastFailure
            : CutResult.failure(inputPathStr, outputPathStr, paddedStart, paddedEnd,
                System.currentTimeMillis() - startTime, ErrorCode.UNKNOWN_ERROR, "Không thể cắt video");
    }

    /**
     * Xây dựng danh sách tham số FFmpeg từ nguồn video String (cục bộ hoặc URL).
     */
    List<String> buildCommand(String inputSource, File outputFile, String startStr, String endStr) {
        return List.of(
            videoProps.getFfmpegPath(),
            "-y",
            "-ss", startStr,
            "-to", endStr,
            "-i", inputSource,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "22",
            // Ép 8-bit 4:2:0 để trình duyệt phát được cả khi nguồn là 10-bit 4:2:2
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-avoid_negative_ts", "make_zero",
            "-movflags", "+faststart",
            outputFile.getAbsolutePath()
        );
    }

    /**
     * Xây dựng danh sách tham số FFmpeg (package-private để test kiểm tra).
     * Bao gồm -movflags +faststart để tối ưu phát trực tuyến web (moov atom ở đầu file).
     */
    List<String> buildCommand(File inputFile, File outputFile, String startStr, String endStr) {
        return buildCommand(inputFile != null ? inputFile.getAbsolutePath() : "", outputFile, startStr, endStr);
    }

    /**
     * Xây dựng câu lệnh FFmpeg siêu tốc bằng Stream Copy (-c copy) không re-encode.
     * Tốc độ nhanh hơn 50 - 100 lần so với libx264, giữ nguyên 100% chất lượng gốc.
     */
    List<String> buildCommandFast(String inputSource, File outputFile, String startStr, String endStr) {
        return List.of(
            videoProps.getFfmpegPath(),
            "-y",
            "-ss", startStr,
            "-to", endStr,
            "-i", inputSource,
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-movflags", "+faststart",
            outputFile.getAbsolutePath()
        );
    }

    List<String> buildCommandFast(File inputFile, File outputFile, String startStr, String endStr) {
        return buildCommandFast(inputFile != null ? inputFile.getAbsolutePath() : "", outputFile, startStr, endStr);
    }

    /**
     * Cắt danh sách nhiều clip con từ cùng 1 video nguồn (Batch cutting).
     *
     * @param inputFile Tệp video nguồn
     * @param requests  Danh sách yêu cầu cắt (gồm outputFile, start, end, duration)
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
            double dur = req.duration() > 0 ? req.duration() : totalDuration;
            CutResult result = cut(inputFile, req.outputFile(), req.start(), req.end(), dur);
            results.add(result);
            if (!result.success()) {
                log.warn("[Batch] Cắt thất bại clip {}: {}",
                    req.outputFile() != null ? req.outputFile().getName() : "null", result.errorMessage());
            }
        }

        return results;
    }
}
