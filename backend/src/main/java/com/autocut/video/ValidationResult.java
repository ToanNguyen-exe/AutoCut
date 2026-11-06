package com.autocut.video;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Record đại diện cho kết quả kiểm định video (Result Pattern).
 * Đóng gói trạng thái hợp lệ, thông số kỹ thuật và mã lỗi mà không ném Runtime Exception.
 */
public record ValidationResult(
    @JsonProperty("is_valid") boolean isValid,
    @JsonProperty("file_path") String filePath,
    @JsonProperty("file_name") String fileName,
    @JsonProperty("duration") double duration,
    @JsonProperty("video_streams") int videoStreams,
    @JsonProperty("audio_streams") int audioStreams,
    @JsonProperty("format_name") String formatName,
    @JsonProperty("error_code") ErrorCode errorCode,
    @JsonProperty("error_message") String errorMessage
) {
    public static ValidationResult valid(String filePath, String fileName, double duration, int videoStreams, int audioStreams, String formatName) {
        return new ValidationResult(true, filePath, fileName, duration, videoStreams, audioStreams, formatName, ErrorCode.SUCCESS, null);
    }

    public static ValidationResult invalid(String filePath, String fileName, ErrorCode errorCode, String errorMessage) {
        return new ValidationResult(false, filePath, fileName, 0.0, 0, 0, null, errorCode, errorMessage);
    }
}
