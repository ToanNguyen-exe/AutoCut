package com.autocut.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Xác thực Bearer JWT trong header Authorization và gắn AuthPrincipal vào SecurityContext.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        String token = header.substring(BEARER_PREFIX.length()).trim();
        try {
            AuthPrincipal principal = jwtService.parse(token);
            String role = principal.role() != null && !principal.role().isBlank() ? principal.role() : "INSTRUCTOR";

            if (principal.mustChangePassword() && !isAllowedWhenPasswordChangeRequired(request)) {
                writeError(response, HttpStatus.FORBIDDEN, "PASSWORD_CHANGE_REQUIRED",
                        "Tài khoản cần đổi mật khẩu lần đầu trước khi sử dụng hệ thống.");
                return;
            }

            UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    principal,
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + role))
            );
            SecurityContextHolder.getContext().setAuthentication(auth);
            filterChain.doFilter(request, response);
        } catch (AuthException ex) {
            SecurityContextHolder.clearContext();
            writeError(response, ex.getStatus(), ex.getCode(), ex.getMessage());
        }
    }

    private static boolean isAllowedWhenPasswordChangeRequired(HttpServletRequest request) {
        String uri = normalizeUri(request);
        return "/api/v1/auth/me".equals(uri)
                || "/api/v1/auth/change-password".equals(uri)
                || "/api/v1/auth/logout".equals(uri)
                || "/api/v1/auth/refresh".equals(uri)
                || "/api/v1/auth/login".equals(uri);
    }

    static String normalizeUri(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        if (ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) {
            return uri.substring(ctx.length());
        }
        return uri;
    }

    static void writeError(HttpServletResponse response, HttpStatus status, String code, String message)
            throws IOException {
        response.setStatus(status.value());
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        JSON.writeValue(response.getWriter(), Map.of(
                "error", Map.of(
                        "code", code,
                        "message", message,
                        "details", Map.of()
                )
        ));
    }
}
