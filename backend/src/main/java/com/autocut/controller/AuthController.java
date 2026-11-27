package com.autocut.controller;

import com.autocut.auth.AuthException;
import com.autocut.auth.AuthPrincipal;
import com.autocut.auth.AuthService;
import com.autocut.auth.TicketService;
import com.autocut.entity.UserEntity;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Endpoints xác thực chuẩn F01 (/api/v1/auth/**): JWT access token, HttpOnly refresh cookie và vé ngắn hạn.
 * Không đặt @CrossOrigin tại controller: toàn bộ CORS do SecurityConfig quản lý tập trung.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    public static final String REFRESH_COOKIE_NAME = "autocut_refresh";
    private static final String REFRESH_COOKIE_PATH = "/api/v1/auth";

    private final AuthService authService;
    private final TicketService ticketService;

    public AuthController(AuthService authService, TicketService ticketService) {
        this.authService = authService;
        this.ticketService = ticketService;
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request) {

        String email = firstNonBlank(body, "email", "username");
        String password = body != null && body.get("password") != null ? String.valueOf(body.get("password")) : "";

        AuthService.LoginResult result = authService.login(
                email,
                password,
                request != null ? request.getHeader("User-Agent") : null,
                resolveClientIp(request)
        );

        ResponseCookie cookie = buildRefreshCookie(result.refreshToken(),
                Duration.ofSeconds(AuthService.REFRESH_TOKEN_TTL_SECONDS),
                isSecureRequest(request));

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(toTokenResponse(result));
    }

    @PostMapping("/refresh")
    public ResponseEntity<Map<String, Object>> refresh(
            @CookieValue(name = REFRESH_COOKIE_NAME, required = false) String refreshToken,
            HttpServletRequest request) {

        AuthService.LoginResult result = authService.refresh(
                refreshToken,
                request != null ? request.getHeader("User-Agent") : null,
                resolveClientIp(request)
        );

        ResponseCookie cookie = buildRefreshCookie(result.refreshToken(),
                Duration.ofSeconds(AuthService.REFRESH_TOKEN_TTL_SECONDS),
                isSecureRequest(request));

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(toTokenResponse(result));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @CookieValue(name = REFRESH_COOKIE_NAME, required = false) String refreshToken,
            HttpServletRequest request) {

        authService.logout(refreshToken);
        ResponseCookie cleared = buildRefreshCookie("", Duration.ZERO, isSecureRequest(request));

        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, cleared.toString())
                .build();
    }

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> me(@AuthenticationPrincipal AuthPrincipal principal) {
        UserEntity user = requireUser(principal);
        return ResponseEntity.ok(toUserDto(user));
    }

    @PatchMapping("/me")
    public ResponseEntity<Map<String, Object>> updateMe(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody(required = false) Map<String, Object> body) {

        if (principal == null) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Chưa đăng nhập.");
        }
        String fullName = firstNonBlank(body, "full_name", "fullName", "name");
        UserEntity updated = authService.updateProfile(principal.userId(), fullName);
        return ResponseEntity.ok(toUserDto(updated));
    }

    @PostMapping("/change-password")
    public ResponseEntity<Map<String, Object>> changePassword(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request) {

        if (principal == null) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Chưa đăng nhập.");
        }
        String currentPassword = firstNonBlank(body, "current_password", "currentPassword");
        String newPassword = firstNonBlank(body, "new_password", "newPassword");

        authService.changePassword(principal.userId(), currentPassword, newPassword);
        ResponseCookie cleared = buildRefreshCookie("", Duration.ZERO, isSecureRequest(request));

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cleared.toString())
                .body(Map.of(
                        "status", "SUCCESS",
                        "message", "Đổi mật khẩu thành công. Toàn bộ phiên cũ đã được thu hồi.",
                        "relogin_required", true
                ));
    }

    @PostMapping("/tickets")
    public ResponseEntity<Map<String, Object>> createTicket(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody(required = false) Map<String, Object> body) {

        if (principal == null) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Chưa đăng nhập.");
        }
        if (principal.mustChangePassword()) {
            throw new AuthException(HttpStatus.FORBIDDEN, "PASSWORD_CHANGE_REQUIRED",
                    "Tài khoản cần đổi mật khẩu lần đầu trước khi sử dụng tài nguyên.");
        }

        String purpose = firstNonBlank(body, "purpose");
        String resourceId = firstNonBlank(body, "resource_id", "resourceId");
        TicketService.IssuedTicket issued = ticketService.issue(principal.userId(), purpose, resourceId);

        return ResponseEntity.ok(Map.of(
                "ticket", issued.ticket(),
                "expires_in", issued.expiresInSeconds()
        ));
    }

    private UserEntity requireUser(AuthPrincipal principal) {
        if (principal == null) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Chưa đăng nhập.");
        }
        return authService.getUserById(principal.userId());
    }

    private static Map<String, Object> toTokenResponse(AuthService.LoginResult result) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("access_token", result.accessToken());
        payload.put("token_type", "Bearer");
        payload.put("expires_in", result.expiresInSeconds());
        payload.put("user", toUserDto(result.user()));
        return payload;
    }

    static Map<String, Object> toUserDto(UserEntity u) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", u.getId());
        dto.put("email", u.getEmail());
        dto.put("full_name", u.getFullName() != null ? u.getFullName() : u.getEmail());
        dto.put("role", u.getRole());
        dto.put("storage_used_bytes", u.getStorageUsedBytes() != null ? u.getStorageUsedBytes() : 0L);
        dto.put("storage_limit_bytes", u.getStorageLimitBytes() != null ? u.getStorageLimitBytes() : 2147483648L);
        dto.put("must_change_password", Boolean.TRUE.equals(u.getMustChangePassword()));
        return dto;
    }

    private static ResponseCookie buildRefreshCookie(String value, Duration maxAge, boolean secure) {
        return ResponseCookie.from(REFRESH_COOKIE_NAME, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Strict")
                .path(REFRESH_COOKIE_PATH)
                .maxAge(maxAge)
                .build();
    }

    private static boolean isSecureRequest(HttpServletRequest request) {
        if (request == null) {
            return false;
        }
        if (request.isSecure()) {
            return true;
        }
        String proto = request.getHeader("X-Forwarded-Proto");
        return "https".equalsIgnoreCase(proto);
    }

    private static String resolveClientIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma >= 0 ? forwarded.substring(0, comma) : forwarded).trim();
        }
        return request.getRemoteAddr();
    }

    private static String firstNonBlank(Map<String, Object> body, String... keys) {
        if (body == null) {
            return "";
        }
        for (String key : keys) {
            Object val = body.get(key);
            if (val != null) {
                String s = String.valueOf(val);
                if (!s.isBlank()) {
                    return s;
                }
            }
        }
        return "";
    }
}
