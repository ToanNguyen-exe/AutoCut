package com.autocut.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Cấu hình tham số cho phân hệ Video của SV1.
 * Tự động ánh xạ từ prefix "autocut.video" trong application.properties.
 */
@ConfigurationProperties(prefix = "autocut.video")
public class VideoProps {

    private String ffprobePath = "ffprobe";
    private String ffmpegPath = "ffmpeg";
    private int timeoutSeconds = 20;
    private int cutTimeoutSeconds = 300;

    public VideoProps() {}

    public VideoProps(String ffprobePath, String ffmpegPath, int timeoutSeconds) {
        this(ffprobePath, ffmpegPath, timeoutSeconds, 300);
    }

    public VideoProps(String ffprobePath, String ffmpegPath, int timeoutSeconds, int cutTimeoutSeconds) {
        this.ffprobePath = ffprobePath;
        this.ffmpegPath = ffmpegPath;
        this.timeoutSeconds = timeoutSeconds;
        this.cutTimeoutSeconds = cutTimeoutSeconds;
    }

    public String getFfprobePath() {
        if ("ffprobe".equalsIgnoreCase(ffprobePath)) {
            Path wingetFfprobe = Paths.get(System.getProperty("user.home"),
                    "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffprobe.exe");
            if (Files.exists(wingetFfprobe)) {
                return wingetFfprobe.toAbsolutePath().toString();
            }
        }
        return ffprobePath;
    }

    public void setFfprobePath(String ffprobePath) {
        this.ffprobePath = ffprobePath;
    }

    public String getFfmpegPath() {
        if ("ffmpeg".equalsIgnoreCase(ffmpegPath)) {
            Path wingetFfmpeg = Paths.get(System.getProperty("user.home"),
                    "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe");
            if (Files.exists(wingetFfmpeg)) {
                return wingetFfmpeg.toAbsolutePath().toString();
            }
        }
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
}
