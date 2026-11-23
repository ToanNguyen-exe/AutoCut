package com.autocut.video;

import com.autocut.service.CacheService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Trích xuất biên độ âm thanh thật (Audio Waveform Peaks) từ file video bằng FFmpeg.
 * Đọc luồng PCM 16-bit mono 8000Hz và tính toán biên độ đỉnh theo streaming để tối ưu bộ nhớ.
 */
@Component
public class WaveformGenerator {

    private static final Logger log = LoggerFactory.getLogger(WaveformGenerator.class);

    public static final int DEFAULT_AUDIO_RATE = 8000; // 8kHz mono
    public static final int DEFAULT_SAMPLES_PER_SEC = 10; // 10 peaks/giây

    private final VideoProps videoProps;

    public WaveformGenerator() {
        this(new VideoProps());
    }

    public WaveformGenerator(VideoProps videoProps) {
        this.videoProps = videoProps != null ? videoProps : new VideoProps();
    }

    /**
     * Trích xuất các điểm đỉnh âm thanh (peaks) từ tệp video nguồn bằng ffmpeg.
     *
     * @param sourceVideo Đường dẫn file video vật lý
     * @param samplesPerSec Số lượng điểm peaks trên mỗi giây video (mặc định 10)
     * @return WaveformResult chứa mảng biên độ âm thanh thật
     */
    public WaveformResult extractPeaks(Path sourceVideo, int samplesPerSec) {
        if (sourceVideo == null || !Files.exists(sourceVideo)) {
            log.warn("Tập tin video nguồn không tồn tại hoặc null: {}", sourceVideo);
            return WaveformResult.empty();
        }

        int targetSamplesPerSec = samplesPerSec > 0 ? samplesPerSec : DEFAULT_SAMPLES_PER_SEC;
        int samplesPerBucket = Math.max(1, DEFAULT_AUDIO_RATE / targetSamplesPerSec);

        List<String> cmd = new ArrayList<>();
        cmd.add(videoProps.getFfmpegPath());
        cmd.add("-v");
        cmd.add("error");
        cmd.add("-i");
        cmd.add(sourceVideo.toAbsolutePath().toString());
        cmd.add("-vn"); // Bỏ qua luồng video
        cmd.add("-ac");
        cmd.add("1");   // Mono (1 kênh)
        cmd.add("-ar");
        cmd.add(String.valueOf(DEFAULT_AUDIO_RATE));
        cmd.add("-f");
        cmd.add("s16le");
        cmd.add("-acodec");
        cmd.add("pcm_s16le");
        cmd.add("pipe:1"); // Xuất ra stdout cho Java đọc

        Process process = null;
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(false);
            process = pb.start();

            // Đọc luồng PCM dạng streaming để tránh tràn RAM với video dung lượng lớn
            List<Byte> minMaxList = new ArrayList<>();
            List<Integer> normalizedPeaksList = new ArrayList<>();

            long totalSamples = 0;
            short minInBucket = Short.MAX_VALUE;
            short maxInBucket = Short.MIN_VALUE;
            int currentBucketSamples = 0;

            byte[] buffer = new byte[65536]; // Buffer 64KB
            try (InputStream in = new BufferedInputStream(process.getInputStream())) {
                int bytesRead;
                int leftoverByte = -1;

                while ((bytesRead = in.read(buffer)) != -1) {
                    int offset = 0;

                    // Nếu còn 1 byte sót lại từ vòng lặp trước
                    if (leftoverByte != -1) {
                        short sample = (short) ((leftoverByte & 0xFF) | ((buffer[0] & 0xFF) << 8));
                        if (sample < minInBucket) minInBucket = sample;
                        if (sample > maxInBucket) maxInBucket = sample;
                        currentBucketSamples++;
                        totalSamples++;

                        if (currentBucketSamples >= samplesPerBucket) {
                            addBucket(minMaxList, normalizedPeaksList, minInBucket, maxInBucket);
                            minInBucket = Short.MAX_VALUE;
                            maxInBucket = Short.MIN_VALUE;
                            currentBucketSamples = 0;
                        }

                        offset = 1;
                        leftoverByte = -1;
                    }

                    int sampleLimit = bytesRead - ((bytesRead - offset) % 2);
                    for (int i = offset; i < sampleLimit; i += 2) {
                        short sample = (short) ((buffer[i] & 0xFF) | ((buffer[i + 1] & 0xFF) << 8));
                        if (sample < minInBucket) minInBucket = sample;
                        if (sample > maxInBucket) maxInBucket = sample;
                        currentBucketSamples++;
                        totalSamples++;

                        if (currentBucketSamples >= samplesPerBucket) {
                            addBucket(minMaxList, normalizedPeaksList, minInBucket, maxInBucket);
                            minInBucket = Short.MAX_VALUE;
                            maxInBucket = Short.MIN_VALUE;
                            currentBucketSamples = 0;
                        }
                    }

                    // Lưu byte lẻ nếu có
                    if (sampleLimit < bytesRead) {
                        leftoverByte = buffer[bytesRead - 1];
                    }
                }

                // Xử lý bucket dở dang cuối cùng nếu có
                if (currentBucketSamples > 0) {
                    addBucket(minMaxList, normalizedPeaksList, minInBucket, maxInBucket);
                }
            }

            int timeoutSec = videoProps.getTimeoutSeconds() > 0 ? videoProps.getTimeoutSeconds() : 60;
            boolean finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.warn("Lệnh ffmpeg trích xuất âm thanh bị timeout sau {}s", timeoutSec);
            }

            if (totalSamples == 0) {
                log.info("Video không có track âm thanh hoặc không đọc được mẫu âm thanh nào: {}", sourceVideo.getFileName());
                return WaveformResult.empty();
            }

            double durationSec = (double) totalSamples / DEFAULT_AUDIO_RATE;

            // Chuyển kết quả sang mảng nguyên thủy
            byte[] minMaxArray = new byte[minMaxList.size()];
            for (int i = 0; i < minMaxList.size(); i++) {
                minMaxArray[i] = minMaxList.get(i);
            }

            int[] normalizedArray = new int[normalizedPeaksList.size()];
            for (int i = 0; i < normalizedPeaksList.size(); i++) {
                normalizedArray[i] = normalizedPeaksList.get(i);
            }

            log.info("Trích xuất biên độ âm thanh thành công cho {}: duration={}s, buckets={}",
                    sourceVideo.getFileName(), String.format("%.2f", durationSec), normalizedArray.length);

            return new WaveformResult(true, durationSec, targetSamplesPerSec, normalizedArray, minMaxArray);

        } catch (Exception e) {
            log.error("Lỗi khi dùng ffmpeg trích xuất sóng âm cho {}: {}", sourceVideo, e.getMessage(), e);
            return WaveformResult.empty();
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    /**
     * Trích xuất biên độ âm thanh có hỗ trợ đa tầng cache:
     * 1. Kiểm tra destinationPeaksFile (peaks.json cạnh segments): Nếu đã có -> trả về ngay.
     * 2. Kiểm tra cache toàn cục theo SHA-256 (cacheService): Nếu đã từng phân tích video này -> trả về ngay.
     * 3. Cache MISS: Chạy ffmpeg trích xuất thật và lưu đồng thời vào cache SHA-256 lẫn destinationPeaksFile.
     */
    public WaveformResult extractPeaksWithCache(Path sourceVideo, int samplesPerSec, Path destinationPeaksFile, CacheService cacheService, String lesson) {
        // Tầng 1: Đọc từ file cache đích (ví dụ peaks.json cạnh segments.json)
        if (destinationPeaksFile != null && Files.exists(destinationPeaksFile)) {
            try {
                WaveformResult cached = readPeaksFromFile(destinationPeaksFile);
                if (cached != null && cached.peaks() != null && cached.peaks().length > 0) {
                    log.info("Waveform Destination Cache HIT tại: {}", destinationPeaksFile);
                    return cached;
                }
            } catch (Exception e) {
                log.warn("Lỗi đọc cache đích: {}", e.getMessage());
            }
        }

        // Tầng 2: Kiểm tra cache toàn cục theo SHA-256
        String videoHash = null;
        if (cacheService != null && sourceVideo != null && Files.exists(sourceVideo)) {
            try {
                videoHash = cacheService.computeSha256(sourceVideo);
                Optional<WaveformResult> globalCached = cacheService.getCachedWaveform(videoHash);
                if (globalCached.isPresent()) {
                    log.info("Waveform Global SHA-256 Cache HIT cho {}", sourceVideo.getFileName());
                    WaveformResult res = globalCached.get();
                    if (destinationPeaksFile != null) {
                        try {
                            savePeaksToFile(res, lesson, destinationPeaksFile);
                        } catch (Exception ignored) {}
                    }
                    return res;
                }
            } catch (Exception e) {
                log.warn("Không thể tính hash hoặc đọc cache toàn cục: {}", e.getMessage());
            }
        }

        // Tầng 3: Cache MISS - Chạy ffmpeg trích xuất thật
        WaveformResult result = extractPeaks(sourceVideo, samplesPerSec);

        // Lưu vào cache toàn cục
        if (cacheService != null && videoHash != null && result.hasAudio()) {
            cacheService.saveWaveformCache(videoHash, result);
        }

        // Lưu vào file peaks.json cạnh segments.json
        if (destinationPeaksFile != null && result.hasAudio()) {
            try {
                savePeaksToFile(result, lesson, destinationPeaksFile);
            } catch (Exception e) {
                log.warn("Lỗi lưu file peaks.json đích: {}", e.getMessage());
            }
        }

        return result;
    }

    private static void addBucket(List<Byte> minMaxList, List<Integer> normalizedPeaksList, short min, short max) {
        if (min == Short.MAX_VALUE && max == Short.MIN_VALUE) {
            min = 0;
            max = 0;
        }

        // int8 scale: -128 .. 127
        byte byteMin = (byte) Math.max(-128, Math.min(127, Math.round(min / 256.0)));
        byte byteMax = (byte) Math.max(-128, Math.min(127, Math.round(max / 256.0)));

        minMaxList.add(byteMin);
        minMaxList.add(byteMax);

        // Chuẩn hóa đỉnh 0 - 100 cho UI
        int peakAmp = Math.max(Math.abs(min), Math.abs(max));
        int normalized = Math.min(100, Math.max(0, (int) Math.round(peakAmp * 100.0 / 32768.0)));
        normalizedPeaksList.add(normalized);
    }

    /**
     * Hàm thuần tính mảng byte [min, max] kiểu int8 từ mảng PCM 16-bit.
     */
    public static byte[] toPeaks(short[] pcm, int samplesPerBucket) {
        if (pcm == null || pcm.length == 0 || samplesPerBucket <= 0) {
            return new byte[0];
        }

        int bucketCount = (pcm.length + samplesPerBucket - 1) / samplesPerBucket;
        byte[] result = new byte[bucketCount * 2];

        int outIdx = 0;
        for (int i = 0; i < pcm.length; i += samplesPerBucket) {
            int end = Math.min(pcm.length, i + samplesPerBucket);
            short min = Short.MAX_VALUE;
            short max = Short.MIN_VALUE;

            for (int j = i; j < end; j++) {
                if (pcm[j] < min) min = pcm[j];
                if (pcm[j] > max) max = pcm[j];
            }

            byte byteMin = (byte) Math.max(-128, Math.min(127, Math.round(min / 256.0)));
            byte byteMax = (byte) Math.max(-128, Math.min(127, Math.round(max / 256.0)));

            result[outIdx++] = byteMin;
            result[outIdx++] = byteMax;
        }

        return result;
    }

    /**
     * Hàm thuần tính mảng biên độ chuẩn hoá 0 - 100 từ mảng PCM 16-bit.
     */
    public static int[] toNormalizedPeaks(short[] pcm, int samplesPerBucket) {
        if (pcm == null || pcm.length == 0 || samplesPerBucket <= 0) {
            return new int[0];
        }

        int bucketCount = (pcm.length + samplesPerBucket - 1) / samplesPerBucket;
        int[] result = new int[bucketCount];

        int outIdx = 0;
        for (int i = 0; i < pcm.length; i += samplesPerBucket) {
            int end = Math.min(pcm.length, i + samplesPerBucket);
            int peakAmp = 0;

            for (int j = i; j < end; j++) {
                int abs = Math.abs(pcm[j]);
                if (abs > peakAmp) peakAmp = abs;
            }

            int normalized = Math.min(100, Math.max(0, (int) Math.round(peakAmp * 100.0 / 32768.0)));
            result[outIdx++] = normalized;
        }

        return result;
    }

    /**
     * Hàm thuần giảm độ phân giải của peaks bằng hệ số gom factor.
     */
    public static byte[] downsample(byte[] peaks, int factor) {
        if (peaks == null || peaks.length < 2 || factor <= 1) {
            return peaks != null ? peaks.clone() : new byte[0];
        }

        int totalPairs = peaks.length / 2;
        int newPairs = (totalPairs + factor - 1) / factor;
        byte[] result = new byte[newPairs * 2];

        int outIdx = 0;
        for (int p = 0; p < totalPairs; p += factor) {
            int end = Math.min(totalPairs, p + factor);
            byte min = Byte.MAX_VALUE;
            byte max = Byte.MIN_VALUE;

            for (int k = p; k < end; k++) {
                byte currMin = peaks[k * 2];
                byte currMax = peaks[k * 2 + 1];
                if (currMin < min) min = currMin;
                if (currMax > max) max = currMax;
            }

            result[outIdx++] = min;
            result[outIdx++] = max;
        }

        return result;
    }

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Lưu kết quả trích xuất biên độ âm thanh thật vào file peaks.json.
     *
     * @param result Kết quả trích xuất WaveformResult
     * @param lesson Tên bài học
     * @param targetFile Đường dẫn tệp peaks.json cần ghi
     * @return Đường dẫn file đã lưu
     * @throws IOException nếu ghi file thất bại
     */
    public Path savePeaksToFile(WaveformResult result, String lesson, Path targetFile) throws IOException {
        if (targetFile == null) {
            throw new IllegalArgumentException("targetFile không được null");
        }
        if (targetFile.getParent() != null && !Files.exists(targetFile.getParent())) {
            Files.createDirectories(targetFile.getParent());
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("lesson", lesson != null ? lesson : "default");
        data.put("hasAudio", result != null && result.hasAudio());
        data.put("duration", result != null ? result.durationSec() : 0.0);
        data.put("samplesPerSec", result != null ? result.samplesPerSec() : DEFAULT_SAMPLES_PER_SEC);
        data.put("peaks", result != null && result.peaks() != null ? result.peaks() : new int[0]);
        data.put("generatedAt", System.currentTimeMillis());

        objectMapper.writerWithDefaultPrettyPrinter().writeValue(targetFile.toFile(), data);
        log.info("Đã lưu file peaks.json thành công tại: {}", targetFile.toAbsolutePath());
        return targetFile;
    }

    /**
     * Lưu file peaks.json nằm cạnh file segments.json.
     *
     * @param result Kết quả trích xuất WaveformResult
     * @param lesson Tên bài học
     * @param segmentsFile Đường dẫn tới file segments.json
     * @return Đường dẫn file peaks.json đã lưu
     * @throws IOException nếu ghi file thất bại
     */
    public Path savePeaksNextToSegments(WaveformResult result, String lesson, Path segmentsFile) throws IOException {
        if (segmentsFile == null) {
            throw new IllegalArgumentException("segmentsFile không được null");
        }
        Path parentDir = segmentsFile.getParent();
        if (parentDir == null) {
            parentDir = Paths.get(".");
        }
        Path peaksFile = parentDir.resolve("peaks.json");
        return savePeaksToFile(result, lesson, peaksFile);
    }

    /**
     * Đọc và phục hồi WaveformResult từ file peaks.json đã lưu.
     *
     * @param peaksFile Đường dẫn file peaks.json
     * @return WaveformResult
     * @throws IOException nếu đọc hoặc parse file thất bại
     */
    public WaveformResult readPeaksFromFile(Path peaksFile) throws IOException {
        if (peaksFile == null || !Files.exists(peaksFile)) {
            return WaveformResult.empty();
        }

        JsonNode root = objectMapper.readTree(peaksFile.toFile());
        boolean hasAudio = root.path("hasAudio").asBoolean(true);
        double duration = root.path("duration").asDouble(0.0);
        int samplesPerSec = root.path("samplesPerSec").asInt(DEFAULT_SAMPLES_PER_SEC);

        JsonNode peaksNode = root.path("peaks");
        int[] peaks = new int[0];
        if (peaksNode.isArray()) {
            peaks = new int[peaksNode.size()];
            for (int i = 0; i < peaksNode.size(); i++) {
                peaks[i] = peaksNode.get(i).asInt();
            }
        }

        return new WaveformResult(hasAudio, duration, samplesPerSec, peaks, new byte[0]);
    }
}
