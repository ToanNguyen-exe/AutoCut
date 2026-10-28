package com.autocut.video;

/**
 * Danh mục mã lỗi chuẩn hóa cho quá trình kiểm định video (SV1 - P01).
 */
public enum ErrorCode {
    SUCCESS("Thành công"),
    FILE_NOT_FOUND("Tệp video không tồn tại hoặc không thể đọc"),
    FILE_EMPTY("Tệp video rỗng (0 bytes)"),
    CORRUPTED_FILE("Tệp hỏng hoặc không đúng định dạng media"),
    NO_AUDIO_STREAM("Video không có luồng âm thanh thực tế (audio stream = 0)"),
    INVALID_DURATION("Thời lượng video không hợp lệ (duration <= 0)"),
    TIMEOUT("ffprobe chạy quá thời gian chờ cho phép (timeout)"),
    PROCESS_EXECUTION_FAILED("Không thể khởi chạy công cụ ffprobe"),
    JSON_PARSE_ERROR("Không thể giải mã cấu trúc JSON từ ffprobe"),
    UNKNOWN_ERROR("Lỗi không xác định");

    private final String description;

    ErrorCode(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
