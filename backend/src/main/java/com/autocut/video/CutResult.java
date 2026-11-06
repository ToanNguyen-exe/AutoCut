package com.autocut.video;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Record chứa kết quả của thao tác cắt video chính xác (Task [P15]).
 * Bao gồm mốc thời gian, thời gian thực thi (executionTimeMs), dung lượng file con và mã lỗi nếu có.
 */
public record CutResult(
    @JsonProperty("success") boolean success,
    @JsonProperty("input_file") String inputFile,
    @JsonProperty("output_file") String outputFile,
    @JsonProperty("start") double start,
    @JsonProperty("end") double end,
    @JsonProperty("duration") double duration,
    @JsonProperty("execution_time_ms") long executionTimeMs,
    @JsonProperty("output_size_bytes") long outputSizeBytes,
    @JsonProperty("error_code") ErrorCode errorCode,
    @JsonProperty("error_message") String errorMessage
) {
    public static CutResult success(String inputFile, String outputFile, double start, double end, long executionTimeMs, long outputSizeBytes) {
        double duration = Math.max(0.0, end - start);
        return new CutResult(true, inputFile, outputFile, start, end, duration, executionTimeMs, outputSizeBytes, ErrorCode.SUCCESS, null);
    }

    public static CutResult failure(String inputFile, String outputFile, double start, double end, long executionTimeMs, ErrorCode errorCode, String errorMessage) {
        return new CutResult(false, inputFile, outputFile, start, end, 0.0, executionTimeMs, 0L, errorCode, errorMessage);
    }
}
