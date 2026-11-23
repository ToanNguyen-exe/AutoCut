package com.autocut.controller;

import com.autocut.video.PathOutsideRootException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * F04 — Trả lỗi thống nhất khi đường dẫn client gửi lên bị từ chối.
 *
 * <p>Trước đây không có chỗ xử lý tập trung: mỗi endpoint tự bắt
 * {@code Exception} rồi trả 500 kèm thông báo nội bộ, vừa lộ đường dẫn thật
 * trên máy chủ vừa khó phân biệt lỗi do người dùng với lỗi hệ thống.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Mã lỗi trả về cho client, không kèm đường dẫn thật. */
    static final String INVALID_PATH = "INVALID_PATH";

    @ExceptionHandler(PathOutsideRootException.class)
    public ResponseEntity<Map<String, String>> handlePathOutsideRoot(PathOutsideRootException ex) {
        log.warn("Từ chối đường dẫn không hợp lệ: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "error", INVALID_PATH,
                "message", "Đường dẫn không hợp lệ hoặc nằm ngoài thư mục cho phép"));
    }
}
