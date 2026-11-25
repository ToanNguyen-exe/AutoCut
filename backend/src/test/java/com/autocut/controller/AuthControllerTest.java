package com.autocut.controller;

import com.autocut.auth.AuthException;
import com.autocut.auth.AuthPrincipal;
import com.autocut.auth.AuthService;
import com.autocut.auth.TicketService;
import com.autocut.entity.UserEntity;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit test cho {@link AuthController} theo dac ta F01 (/api/v1/auth/**).
 *
 * <p>Cac assertion cu ve SHA-256 khong salt va so khop mat khau plaintext trong phien ban
 * truoc da duoc thay the hoan toan bang BCrypt(12), JWT và refresh token cookie theo F01.
 */
class AuthControllerTest {

    private AuthService authService;
    private TicketService ticketService;
    private AuthController authController;

    @BeforeEach
    void setUp() {
        authService = Mockito.mock(AuthService.class);
        ticketService = Mockito.mock(TicketService.class);
        authController = new AuthController(authService, ticketService);
    }

    @Test
    @DisplayName("POST /login tra access_token, user khong lo password_hash va Set-Cookie HttpOnly")
    void login_setsHttpOnlyCookieAndReturnsToken() {
        UserEntity user = new UserEntity("gv@truong.edu.vn", "$2a$12$hash", "Giang Vien", "INSTRUCTOR");
        user.setId(15L);
        when(authService.login(eq("gv@truong.edu.vn"), eq("MatKhau123"), Mockito.any(), Mockito.any()))
                .thenReturn(new AuthService.LoginResult("jwt.access.token", 900L, "raw-refresh-1", user));

        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("User-Agent", "JUnit");
        req.setRemoteAddr("127.0.0.1");

        ResponseEntity<Map<String, Object>> res = authController.login(
                Map.of("email", "gv@truong.edu.vn", "password", "MatKhau123"),
                req
        );

        Assertions.assertEquals(HttpStatus.OK, res.getStatusCode());
        Assertions.assertEquals("jwt.access.token", res.getBody().get("access_token"));
        Assertions.assertEquals("Bearer", res.getBody().get("token_type"));
        Assertions.assertEquals(900L, res.getBody().get("expires_in"));

        String setCookie = res.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        Assertions.assertNotNull(setCookie);
        Assertions.assertTrue(setCookie.contains("autocut_refresh=raw-refresh-1"));
        Assertions.assertTrue(setCookie.contains("HttpOnly"));
        Assertions.assertTrue(setCookie.contains("SameSite=Strict"));

        @SuppressWarnings("unchecked")
        Map<String, Object> userDto = (Map<String, Object>) res.getBody().get("user");
        Assertions.assertEquals("gv@truong.edu.vn", userDto.get("email"));
        Assertions.assertFalse(userDto.containsKey("password"));
        Assertions.assertFalse(userDto.containsKey("password_hash"));
    }

    @Test
    @DisplayName("POST /logout thu hoi refresh token va xoa cookie (Max-Age=0)")
    void logout_revokesTokenAndClearsCookie() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        ResponseEntity<Void> res = authController.logout("raw-refresh-1", req);

        Assertions.assertEquals(HttpStatus.NO_CONTENT, res.getStatusCode());
        verify(authService).logout("raw-refresh-1");

        String setCookie = res.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        Assertions.assertNotNull(setCookie);
        Assertions.assertTrue(setCookie.contains("Max-Age=0"));
    }

    @Test
    @DisplayName("POST /tickets tu choi khi mustChangePassword=true voi 403 PASSWORD_CHANGE_REQUIRED")
    void createTicket_requiresPasswordChangeFirst() {
        AuthPrincipal mustChange = new AuthPrincipal(1L, "admin@truong.edu.vn", "ADMIN", true, "jti-1");

        AuthException ex = Assertions.assertThrows(AuthException.class,
                () -> authController.createTicket(mustChange, Map.of("purpose", "STREAM", "resource_id", "abc")));
        Assertions.assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
        Assertions.assertEquals("PASSWORD_CHANGE_REQUIRED", ex.getCode());
    }
}
