package com.autocut.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Xác thực vé ngắn hạn (?ticket=...) cho các endpoint trình duyệt không gửi được header Authorization
 * (phát video stream, tải clip, tải ZIP).
 */
@Component
public class TicketAuthFilter extends OncePerRequestFilter {

    private static final String STREAM_PREFIX = "/api/video/stream/";

    private final TicketService ticketService;

    public TicketAuthFilter(TicketService ticketService) {
        this.ticketService = ticketService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        if (SecurityContextHolder.getContext().getAuthentication() != null) {
            filterChain.doFilter(request, response);
            return;
        }

        String rawTicket = request.getParameter("ticket");
        if (rawTicket == null || rawTicket.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            JwtAuthFilter.writeError(response, HttpStatus.UNAUTHORIZED, "TICKET_INVALID",
                    "Vé truy cập chỉ áp dụng cho phương thức GET.");
            return;
        }

        TicketTarget target = resolveTarget(request);
        if (target == null) {
            JwtAuthFilter.writeError(response, HttpStatus.UNAUTHORIZED, "TICKET_INVALID",
                    "Vé truy cập không hợp lệ cho đường dẫn này.");
            return;
        }

        try {
            AuthPrincipal principal = ticketService.consume(rawTicket, target.purpose(), target.resourceId());
            if (principal.mustChangePassword()) {
                JwtAuthFilter.writeError(response, HttpStatus.FORBIDDEN, "PASSWORD_CHANGE_REQUIRED",
                        "Tài khoản cần đổi mật khẩu lần đầu trước khi sử dụng hệ thống.");
                return;
            }
            String role = principal.role() != null && !principal.role().isBlank() ? principal.role() : "INSTRUCTOR";
            UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    principal,
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + role))
            );
            SecurityContextHolder.getContext().setAuthentication(auth);
            filterChain.doFilter(request, response);
        } catch (AuthException ex) {
            SecurityContextHolder.clearContext();
            JwtAuthFilter.writeError(response, ex.getStatus(), ex.getCode(), ex.getMessage());
        }
    }

    private static TicketTarget resolveTarget(HttpServletRequest request) {
        String uri = JwtAuthFilter.normalizeUri(request);
        if (uri.startsWith(STREAM_PREFIX)) {
            String hash = uri.substring(STREAM_PREFIX.length());
            if (!hash.isBlank() && !hash.contains("/")) {
                return new TicketTarget("STREAM", hash);
            }
            return null;
        }
        if ("/api/video/download-clip".equals(uri)) {
            String path = request.getParameter("path");
            return path != null && !path.isBlank() ? new TicketTarget("DOWNLOAD", path) : null;
        }
        if ("/api/video/download-zip".equals(uri)) {
            String lesson = request.getParameter("lesson");
            return lesson != null && !lesson.isBlank() ? new TicketTarget("DOWNLOAD", lesson) : null;
        }
        return null;
    }

    private record TicketTarget(String purpose, String resourceId) {
    }
}
