package com.autocut.video;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Chọn bộ mã hoá video cho các bước re-encode (cắt chính xác, ghép chuẩn hoá).
 *
 * <p>Dùng NVENC khi ffmpeg của máy hỗ trợ (nhanh hơn libx264 khoảng 1,5–2 lần ở 720p,
 * chênh lệch còn lớn hơn ở độ phân giải cao). Ngoài ra NVENC đẩy việc nặng sang GPU
 * nên CPU còn rảnh cho các tác vụ khác.</p>
 */
final class EncoderSupport {

    private static final Logger log = LoggerFactory.getLogger(EncoderSupport.class);

    /** Kết quả dò theo đường dẫn ffmpeg: mỗi bản ffmpeg có thể khác nhau. */
    private static final Map<String, Boolean> NVENC_CACHE = new ConcurrentHashMap<>();

    static final String NVENC = "h264_nvenc";
    static final String LIBX264 = "libx264";

    private EncoderSupport() {
    }

    /**
     * Trả về tên encoder nên dùng: {@code h264_nvenc} hoặc {@code libx264}.
     */
    static String resolve(VideoProps props) {
        String configured = props != null ? props.getEncoder() : null;
        String normalized = configured == null ? "auto" : configured.trim().toLowerCase(Locale.ROOT);

        if ("nvenc".equals(normalized) || NVENC.equals(normalized)) {
            return NVENC;
        }
        if (LIBX264.equals(normalized) || "cpu".equals(normalized)) {
            return LIBX264;
        }
        return isNvencAvailable(props) ? NVENC : LIBX264;
    }

    /**
     * Dò ffmpeg một lần cho mỗi đường dẫn, sau đó dùng lại kết quả.
     */
    static boolean isNvencAvailable(VideoProps props) {
        String ffmpeg = props != null ? props.getFfmpegPath() : "ffmpeg";
        Boolean cached = NVENC_CACHE.get(ffmpeg);
        if (cached != null) {
            return cached;
        }

        boolean available = false;
        try {
            Process p = new ProcessBuilder(ffmpeg, "-hide_banner", "-encoders").start();
            // Đọc stdout song song: danh sách encoder dài hơn buffer 64KB, đọc sau waitFor sẽ treo.
            CompletableFuture<String> output = StreamUtil.readStreamAsync(p.getInputStream());
            CompletableFuture<String> errors = StreamUtil.readStreamAsync(p.getErrorStream());
            boolean done = p.waitFor(10, TimeUnit.SECONDS);
            if (done && p.exitValue() == 0) {
                String text = output.get(5, TimeUnit.SECONDS);
                available = text != null && text.contains(NVENC);
            } else {
                p.destroyForcibly();
            }
        } catch (Exception e) {
            log.debug("Không dò được NVENC: {}", e.getMessage());
        }

        NVENC_CACHE.put(ffmpeg, available);
        log.info("Bộ mã hoá cho re-encode: {}", available ? "h264_nvenc (GPU)" : "libx264 (CPU)");
        return available;
    }
}
