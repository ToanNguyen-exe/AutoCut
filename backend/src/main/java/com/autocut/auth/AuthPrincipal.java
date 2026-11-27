package com.autocut.auth;

/**
 * Thông tin danh tính người dùng đã xác thực gắn vào SecurityContext.
 */
public record AuthPrincipal(
        Long userId,
        String email,
        String role,
        boolean mustChangePassword,
        String jti
) {
}
