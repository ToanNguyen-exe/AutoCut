package com.autocut.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cấu hình tham số cho phân hệ Video của SV1.
 * Tự động ánh xạ từ prefix "autocut.video" trong application.properties.
 */
@ConfigurationProperties(prefix = "autocut.video")
public class VideoProps {

    private String ffprobePath = "ffprobe";
    private String ffmpegPath = "ffmpeg";
    private int timeoutSeconds = 20;

    public VideoProps() {}

    public VideoProps(String ffprobePath, String ffmpegPath, int timeoutSeconds) {
        this.ffprobePath = ffprobePath;
        this.ffmpegPath = ffmpegPath;
        this.timeoutSeconds = timeoutSeconds;
    }

    public String getFfprobePath() {
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
}
