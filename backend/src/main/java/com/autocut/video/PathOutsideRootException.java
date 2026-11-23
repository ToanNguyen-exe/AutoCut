package com.autocut.video;

/**
 * F04 — Ném ra khi đường dẫn client gửi lên thoát khỏi thư mục cho phép.
 *
 * <p>Là {@link RuntimeException} để không phải khai báo {@code throws} ở mọi
 * endpoint, nhưng {@code GlobalExceptionHandler} sẽ bắt và trả về 400.
 */
public class PathOutsideRootException extends RuntimeException {

    public PathOutsideRootException(String message) {
        super(message);
    }

    public PathOutsideRootException(String message, Throwable cause) {
        super(message, cause);
    }
}
