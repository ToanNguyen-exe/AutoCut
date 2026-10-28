package com.autocut.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record VideoValidationResult(
    @JsonProperty("is_valid") boolean isValid,
    @JsonProperty("file_path") String filePath,
    @JsonProperty("file_name") String fileName,
    @JsonProperty("duration") double duration,
    @JsonProperty("video_streams") int videoStreams,
    @JsonProperty("audio_streams") int audioStreams,
    @JsonProperty("format_name") String formatName,
    @JsonProperty("error_message") String errorMessage
) {
    public static VideoValidationResult valid(String filePath, String fileName, double duration, int videoStreams, int audioStreams, String formatName) {
        return new VideoValidationResult(true, filePath, fileName, duration, videoStreams, audioStreams, formatName, null);
    }

    public static VideoValidationResult invalid(String filePath, String fileName, String errorMessage) {
        return new VideoValidationResult(false, filePath, fileName, 0.0, 0, 0, null, errorMessage);
    }
}
