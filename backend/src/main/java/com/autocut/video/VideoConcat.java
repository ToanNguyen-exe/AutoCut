package com.autocut.video;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Service ghép nối các clip đã cắt thành 1 video tổng hợp (FFmpeg Concat - Mục 4 SV1).
 *
 * <p>Yêu cầu: Các clip đầu vào phải cùng codec (libx264 + aac) —
 * điều kiện này được đảm bảo bởi {@link VideoCutter} ở Mục 3.
 *
 * <p>Lệnh FFmpeg thực thi:
 * {@code ffmpeg -y -f concat -safe 0 -i filelist.txt -c copy output.mp4}
 */
@Service
public class VideoConcat {

    private static final Logger log = LoggerFactory.getLogger(VideoConcat.class);

    private final VideoProps videoProps;

    public VideoConcat(VideoProps videoProps) {
        this.videoProps = videoProps != null ? videoProps : new VideoProps();
    }

    /**
     * Ghép danh sách clip thành 1 file MP4 duy nhất.
     * Mặc định tự động thử chế độ stream-copy trước, nếu lỗi sẽ tự động fallback sang Safe Concat Filter.
     *
     * @param clips  Danh sách file clip đầu vào
     * @param output File MP4 tổng hợp đầu ra
     * @return ConcatResult chứa trạng thái, thời gian thực thi và dung lượng file
     */
    public ConcatResult concat(List<File> clips, File output) {
        return concat(clips, output, false);
    }

    /**
     * Ghép danh sách clip với tùy chọn ép buộc re-encode (Safe Concat Filter).
     *
     * @param clips          Danh sách file clip đầu vào
     * @param output         File MP4 tổng hợp đầu ra
     * @param forceReencode  true nếu muốn bỏ qua stream-copy và dùng trực tiếp filter chuẩn hóa (cho các video khác chuẩn)
     * @return ConcatResult
     */
    public ConcatResult concat(List<File> clips, File output, boolean forceReencode) {
        long startTime = System.currentTimeMillis();
        List<String> inputPaths = toStringPaths(clips);
        String outputPath = output != null ? output.getAbsolutePath() : "";

        // 1. Kiểm tra đầu vào
        if (clips == null || clips.isEmpty()) {
            return ConcatResult.failure(List.of(), outputPath, 0L,
                ErrorCode.INVALID_INPUT, "Danh sách clip đầu vào không được null hoặc rỗng");
        }
        if (output == null) {
            return ConcatResult.failure(inputPaths, "", 0L,
                ErrorCode.INVALID_INPUT, "Tệp đầu ra không được null");
        }

        // 2. Xác minh từng clip tồn tại
        for (File clip : clips) {
            if (clip == null || !clip.exists() || !clip.isFile()) {
                String missing = clip != null ? clip.getAbsolutePath() : "null";
                log.warn("Ghép nối thất bại: Clip không tồn tại: {}", missing);
                return ConcatResult.failure(inputPaths, outputPath, 0L,
                    ErrorCode.FILE_NOT_FOUND,
                    "Clip không tồn tại: " + missing);
            }
        }

        // 3. Tạo thư mục cha cho output nếu chưa có
        File parentDir = output.getParentFile();
        if (parentDir != null && !parentDir.exists()) {
            parentDir.mkdirs();
        }

        // 4. Nếu không yêu cầu ép re-encode, thử trước chế độ nhanh (-c copy)
        if (!forceReencode) {
            ConcatResult fastResult = tryFastConcat(clips, output, inputPaths, outputPath, startTime);
            if (fastResult.success()) {
                return fastResult;
            }
            log.warn("Chế độ ghép nhanh (-c copy) thất bại (có thể do video khác chuẩn codec/resolution/fps). Đang tự động chuyển sang Safe Concat Filter (re-encode chuẩn hóa)...");
        }

        // 5. Chế độ an toàn: Chuẩn hóa tỉ lệ (scale/pad 1080p), đồng bộ fps và audio qua filter_complex
        return concatWithFilter(clips, output, inputPaths, outputPath, startTime);
    }

    /**
     * Thử ghép nhanh bằng FFmpeg Concat Demuxer (-c copy).
     */
    private ConcatResult tryFastConcat(List<File> clips, File output, List<String> inputPaths, String outputPath, long startTime) {
        Path tempFileList = null;
        try {
            tempFileList = Files.createTempFile("filelist_", ".txt");
            String content = buildFileList(clips);
            Files.writeString(tempFileList, content);

            List<String> command = buildCommand(tempFileList.toFile(), output);
            log.info("Bắt đầu thử ghép nhanh {} clip bằng stream-copy -> {}", clips.size(), output.getName());

            ProcessBuilder pb = new ProcessBuilder(command);
            Process process = pb.start();

            CompletableFuture<String> stderrFuture = StreamUtil.readStreamAsync(process.getErrorStream());
            StreamUtil.readStreamAsync(process.getInputStream());

            int timeoutSec = videoProps.getCutTimeoutSeconds() > 0 ? videoProps.getCutTimeoutSeconds() : 300;
            boolean finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);

            long executionTimeMs = System.currentTimeMillis() - startTime;
            if (!finished) {
                process.destroyForcibly();
                log.error("Ghép video stream-copy bị timeout sau {} giây", timeoutSec);
                return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                    ErrorCode.TIMEOUT, ErrorCode.TIMEOUT.getDescription());
            }

            String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
            int exitCode = process.exitValue();

            if (exitCode != 0 || !output.exists() || output.length() == 0) {
                if (output.exists() && output.length() == 0) {
                    output.delete();
                }
                String detail = (stderr != null && !stderr.isBlank()) ? stderr.trim() : "Exit code: " + exitCode;
                return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                    ErrorCode.CUT_FAILED, "Stream-copy lỗi: " + detail);
            }

            long outputSize = output.length();
            log.info("Ghép video thành công (stream-copy): {} ({} bytes, {} ms)", output.getName(), outputSize, executionTimeMs);
            return ConcatResult.success(inputPaths, outputPath, executionTimeMs, outputSize);

        } catch (Exception e) {
            long executionTimeMs = System.currentTimeMillis() - startTime;
            return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                ErrorCode.PROCESS_EXECUTION_FAILED, "Lỗi khi chạy stream-copy: " + e.getMessage());
        } finally {
            if (tempFileList != null) {
                try {
                    Files.deleteIfExists(tempFileList);
                } catch (IOException ignored) {}
            }
        }
    }

    /**
     * Chế độ ghép nối an toàn bằng Concat Filter (-filter_complex).
     * Tự động scale về chuẩn 1920x1080 (giữ nguyên tỷ lệ gốc, pad viền đen nếu cần),
     * đồng bộ fps=30 và resample âm thanh về 44.1kHz Stereo.
     */
    public ConcatResult concatWithFilter(List<File> clips, File output, List<String> inputPaths, String outputPath, long startTime) {
        try {
            List<String> command = buildCommandFilter(clips, output);
            log.info("Bắt đầu ghép {} clip bằng Safe Concat Filter -> {}", clips.size(), output.getName());

            ProcessBuilder pb = new ProcessBuilder(command);
            Process process = pb.start();

            CompletableFuture<String> stderrFuture = StreamUtil.readStreamAsync(process.getErrorStream());
            StreamUtil.readStreamAsync(process.getInputStream());

            int timeoutSec = videoProps.getCutTimeoutSeconds() > 0 ? videoProps.getCutTimeoutSeconds() : 600;
            boolean finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);

            long executionTimeMs = System.currentTimeMillis() - startTime;

            if (!finished) {
                process.destroyForcibly();
                log.error("Ghép video bằng filter bị timeout sau {} giây", timeoutSec);
                return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                    ErrorCode.TIMEOUT, ErrorCode.TIMEOUT.getDescription());
            }

            String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
            int exitCode = process.exitValue();

            if (exitCode != 0 || !output.exists() || output.length() == 0) {
                String detail = (stderr != null && !stderr.isBlank()) ? stderr.trim() : "Exit code: " + exitCode;
                log.error("FFmpeg concat filter thất bại (exit code: {}) - {}", exitCode, detail);
                return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                    ErrorCode.CUT_FAILED, "FFmpeg filter lỗi (code " + exitCode + "): " + detail);
            }

            long outputSize = output.length();
            log.info("Ghép video thành công bằng Concat Filter: {} ({} bytes, {} ms)", output.getName(), outputSize, executionTimeMs);
            return ConcatResult.success(inputPaths, outputPath, executionTimeMs, outputSize);

        } catch (IOException e) {
            long executionTimeMs = System.currentTimeMillis() - startTime;
            log.error("Không thể khởi chạy ffmpeg filter: {}", e.getMessage());
            return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                ErrorCode.PROCESS_EXECUTION_FAILED, "Không thể khởi chạy ffmpeg: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            long executionTimeMs = System.currentTimeMillis() - startTime;
            return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                ErrorCode.UNKNOWN_ERROR, "Tiến trình bị gián đoạn: " + e.getMessage());
        } catch (Exception e) {
            long executionTimeMs = System.currentTimeMillis() - startTime;
            log.error("Lỗi không xác định khi ghép video: {}", e.getMessage());
            return ConcatResult.failure(inputPaths, outputPath, executionTimeMs,
                ErrorCode.UNKNOWN_ERROR, "Lỗi không xác định: " + e.getMessage());
        }
    }

    /**
     * Xây dựng câu lệnh FFmpeg Concat Filter để chuẩn hóa và ghép các video khác thông số.
     */
    List<String> buildCommandFilter(List<File> clips, File output) {
        List<String> cmd = new ArrayList<>();
        cmd.add(videoProps.getFfmpegPath());
        cmd.add("-y");

        for (File clip : clips) {
            cmd.add("-i");
            cmd.add(clip.getAbsolutePath());
        }

        StringBuilder filter = new StringBuilder();
        int n = clips.size();
        for (int i = 0; i < n; i++) {
            filter.append(String.format(
                "[%d:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v%d];",
                i, i
            ));
            filter.append(String.format(
                "[%d:a]aformat=sample_rates=44100:channel_layouts=stereo[a%d];",
                i, i
            ));
        }

        for (int i = 0; i < n; i++) {
            filter.append(String.format("[v%d][a%d]", i, i));
        }
        filter.append(String.format("concat=n=%d:v=1:a=1[v][a]", n));

        cmd.add("-filter_complex");
        cmd.add(filter.toString());
        cmd.add("-map");
        cmd.add("[v]");
        cmd.add("-map");
        cmd.add("[a]");
        cmd.add("-c:v");
        cmd.add("libx264");
        cmd.add("-preset");
        cmd.add("fast");
        cmd.add("-crf");
        cmd.add("22");
        cmd.add("-c:a");
        cmd.add("aac");
        cmd.add("-movflags");
        cmd.add("+faststart");
        cmd.add(output.getAbsolutePath());

        return cmd;
    }

    /**
     * Sinh nội dung filelist.txt theo chuẩn FFmpeg concat demuxer.
     * Mỗi dòng có dạng: {@code file '/absolute/forward/slash/path.mp4'}
     *
     * <p>Package-private để test kiểm tra trực tiếp.
     */
    String buildFileList(List<File> clips) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < clips.size(); i++) {
            // Dùng forward slash để FFmpeg trên Windows không bị lỗi parse path
            String path = clips.get(i).getAbsolutePath().replace('\\', '/');
            sb.append("file '").append(path).append("'");
            if (i < clips.size() - 1) {
                sb.append(System.lineSeparator());
            }
        }
        return sb.toString();
    }

    /**
     * Xây dựng lệnh FFmpeg concat.
     * {@code ffmpeg -y -f concat -safe 0 -i <filelist> -c copy <output>}
     *
     * <p>Package-private để test kiểm tra trực tiếp.
     */
    List<String> buildCommand(File fileList, File output) {
        return List.of(
            videoProps.getFfmpegPath(),
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", fileList.getAbsolutePath(),
            "-c", "copy",
            output.getAbsolutePath()
        );
    }

    private List<String> toStringPaths(List<File> clips) {
        if (clips == null) return List.of();
        List<String> paths = new ArrayList<>();
        for (File f : clips) {
            paths.add(f != null ? f.getAbsolutePath() : "null");
        }
        return paths;
    }
}

