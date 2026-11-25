package com.autocut.auth;

import org.springframework.http.HttpStatus;

import java.util.Collections;
import java.util.Map;

/**
 * Ngoại lệ chuẩn hóa cho các lỗi xác thực, phân quyền và quản lý phiên.
 */
public class AuthException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> details;

    public AuthException(HttpStatus status, String code, String message) {
        this(status, code, message, Collections.emptyMap());
    }

    public AuthException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details != null ? details : Collections.emptyMap();
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }
}
