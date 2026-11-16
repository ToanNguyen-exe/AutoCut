package com.autocut.video;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Record chứa kết quả của thao tác ghép nối video (FFmpeg Concat - Mục 4 SV1).
 */
public record ConcatResult(
    @JsonProperty("success") boolean success,
    @JsonProperty("input_files") List<String> inputFiles,
    @JsonProperty("output_file") String outputFile,
    @JsonProperty("execution_time_ms") long executionTimeMs,
    @JsonProperty("output_size_bytes") long outputSizeBytes,
    @JsonProperty("error_code") ErrorCode errorCode,
    @JsonProperty("error_message") String errorMessage
) {
    public static ConcatResult success(List<String> inputFiles, String outputFile,
                                       long executionTimeMs, long outputSizeBytes) {
        return new ConcatResult(true, inputFiles, outputFile,
            executionTimeMs, outputSizeBytes, ErrorCode.SUCCESS, null);
    }

    public static ConcatResult failure(List<String> inputFiles, String outputFile,
                                       long executionTimeMs,
                                       ErrorCode errorCode, String errorMessage) {
        return new ConcatResult(false, inputFiles, outputFile,
            executionTimeMs, 0L, errorCode, errorMessage);
    }
}

