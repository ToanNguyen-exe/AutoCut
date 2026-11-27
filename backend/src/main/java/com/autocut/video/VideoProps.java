package com.autocut.video;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Cấu hình tham số cho phân hệ Video của SV1.
 * Tự động ánh xạ từ prefix "autocut.video" trong application.properties.
 */
@Component
@ConfigurationProperties(prefix = "autocut.video")
public class VideoProps {

    private String ffprobePath = "ffprobe";
    private String ffmpegPath = "ffmpeg";
    private int timeoutSeconds = 20;
    private int cutTimeoutSeconds = 300;
    private double paddingStart = 0.3; // Lùi 0.3s chống cụt âm đầu theo config.yaml
    private double paddingEnd = 0.5;   // Tiến 0.5s cho thở tự nhiên theo config.yaml

    /**
     * Bộ mã hoá dùng cho nhánh re-encode (cắt chính xác từng frame).
     * auto = dùng GPU (NVENC) nếu ffmpeg hỗ trợ, ngược lại về libx264.
     * nvenc / libx264 = ép buộc một lựa chọn.
     */
    private String encoder = "auto";
    /** Preset NVENC: p1 (nhanh nhất) → p7 (chất lượng nhất). */
    private String nvencPreset = "p4";
    /** Chất lượng không đổi của NVENC (tương đương -crf của libx264, số nhỏ = nét hơn). */
    private int nvencCq = 23;

    /**
     * Cho phép bước ghép clip tự động re-encode toàn bộ khi stream-copy thất bại.
     * Mặc định false: video dài re-encode có thể tốn hàng chục phút tới hàng giờ,
     * nên chỉ bật khi thật sự cần.
     */
    private boolean concatAllowReencode = false;

    public VideoProps() {}

    public VideoProps(String ffprobePath, String ffmpegPath, int timeoutSeconds) {
        this(ffprobePath, ffmpegPath, timeoutSeconds, 300, 0.3, 0.5);
    }

    public VideoProps(String ffprobePath, String ffmpegPath, int timeoutSeconds, int cutTimeoutSeconds) {
        this(ffprobePath, ffmpegPath, timeoutSeconds, cutTimeoutSeconds, 0.3, 0.5);
    }

    public VideoProps(String ffprobePath, String ffmpegPath, int timeoutSeconds, int cutTimeoutSeconds, double paddingStart, double paddingEnd) {
        this.ffprobePath = ffprobePath;
        this.ffmpegPath = ffmpegPath;
        this.timeoutSeconds = timeoutSeconds;
        this.cutTimeoutSeconds = cutTimeoutSeconds;
        this.paddingStart = paddingStart;
        this.paddingEnd = paddingEnd;
    }

    public String getFfprobePath() {
        // F14 AC-4: không còn đường dẫn tuyệt đối của riêng một máy.
        // Trỏ tới "ffprobe" thì hệ điều hành tự tìm trong PATH; trong container
        // giá trị này được đặt qua FFPROBE_PATH=/usr/bin/ffprobe.
        return ffprobePath;
    }

    public void setFfprobePath(String ffprobePath) {
        this.ffprobePath = ffprobePath;
    }

    public String getFfmpegPath() {
        return ffmpegPath;
    }

    public void setFfmpegPath(String ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
    }

    public int getTimeoutSeconds() {
        return timeoutSeconds;
    }

    public void setTimeoutSeconds(int timeoutSeconds) {
        this.timeoutSeconds = timeoutSeconds;
    }

    public int getCutTimeoutSeconds() {
        return cutTimeoutSeconds;
    }

    public void setCutTimeoutSeconds(int cutTimeoutSeconds) {
        this.cutTimeoutSeconds = cutTimeoutSeconds;
    }

    public double getPaddingStart() {
        return paddingStart;
    }

    public void setPaddingStart(double paddingStart) {
        this.paddingStart = paddingStart;
    }

    public double getPaddingEnd() {
        return paddingEnd;
    }

    public void setPaddingEnd(double paddingEnd) {
        this.paddingEnd = paddingEnd;
    }

    public String getEncoder() {
        return encoder;
    }

    public void setEncoder(String encoder) {
        this.encoder = encoder;
    }

    public String getNvencPreset() {
        return nvencPreset;
    }

    public void setNvencPreset(String nvencPreset) {
        this.nvencPreset = nvencPreset;
    }

    public int getNvencCq() {
        return nvencCq;
    }

    public void setNvencCq(int nvencCq) {
        this.nvencCq = nvencCq;
    }

    public boolean isConcatAllowReencode() {
        return concatAllowReencode;
    }

    public void setConcatAllowReencode(boolean concatAllowReencode) {
        this.concatAllowReencode = concatAllowReencode;
    }
}
