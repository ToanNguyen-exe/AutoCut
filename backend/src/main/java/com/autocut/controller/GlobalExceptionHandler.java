package com.autocut.controller;

import com.autocut.auth.AuthException;
import com.autocut.video.PathOutsideRootException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * F01 & F04 — Trả lỗi thống nhất cho lỗi xác thực và đường dẫn không hợp lệ.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Mã lỗi trả về cho client, không kèm đường dẫn thật. */
    static final String INVALID_PATH = "INVALID_PATH";

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<Map<String, Object>> handleAuthException(AuthException ex) {
        return ResponseEntity.status(ex.getStatus()).body(Map.of(
                "error", Map.of(
                        "code", ex.getCode(),
                        "message", ex.getMessage(),
                        "details", ex.getDetails()
                )
        ));
    }

    @ExceptionHandler(PathOutsideRootException.class)
    public ResponseEntity<Map<String, String>> handlePathOutsideRoot(PathOutsideRootException ex) {
        log.warn("Từ chối đường dẫn không hợp lệ: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "error", INVALID_PATH,
                "message", "Đường dẫn không hợp lệ hoặc nằm ngoài thư mục cho phép"));
    }
}
