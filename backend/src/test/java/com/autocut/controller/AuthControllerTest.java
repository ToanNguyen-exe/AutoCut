package com.autocut.controller;

import com.autocut.entity.UserEntity;
import com.autocut.repository.UserRepository;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

class AuthControllerTest {

    private UserRepository userRepository;
    private AuthController authController;

    @BeforeEach
    void setUp() {
        userRepository = Mockito.mock(UserRepository.class);
        authController = new AuthController(userRepository);
    }

    @Test
    @DisplayName("Xác thực mật khẩu: khớp đúng plain text và SHA-256 hash")
    void testPasswordVerification() {
        String raw = "admin123";
        String hashed = AuthController.hashPassword(raw);

        Assertions.assertTrue(AuthController.verifyPassword(raw, hashed), "Hash SHA-256 phải khớp");
        Assertions.assertTrue(AuthController.verifyPassword(raw, raw), "Plain text phải khớp");
        Assertions.assertFalse(AuthController.verifyPassword("wrongpass", hashed), "Sai mật khẩu phải trả về false");
    }

    @Test
    @DisplayName("Đăng nhập thành công với tài khoản trong Database")
    void testLoginSuccess() {
        UserEntity user = new UserEntity(
                "admin@autocut.ai",
                AuthController.hashPassword("admin123"),
                "Nguyễn Văn Toàn",
                "ADMIN"
        );
        user.setId(1L);

        when(userRepository.findByEmailIgnoreCase("admin@autocut.ai")).thenReturn(Optional.of(user));

        Map<String, String> body = Map.of(
                "username", "admin@autocut.ai",
                "password", "admin123"
        );

        ResponseEntity<Map<String, Object>> response = authController.login(body);

        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertEquals("SUCCESS", response.getBody().get("status"));

        @SuppressWarnings("unchecked")
        Map<String, Object> userData = (Map<String, Object>) response.getBody().get("user");
        Assertions.assertNotNull(userData);
        Assertions.assertEquals("admin@autocut.ai", userData.get("email"));
        Assertions.assertEquals("Nguyễn Văn Toàn", userData.get("name"));
        Assertions.assertEquals("ADMIN", userData.get("role"));
    }

    @Test
    @DisplayName("Đăng nhập thất bại khi sai mật khẩu")
    void testLoginWrongPassword() {
        UserEntity user = new UserEntity(
                "admin@autocut.ai",
                AuthController.hashPassword("admin123"),
                "Nguyễn Văn Toàn",
                "ADMIN"
        );
        user.setId(1L);

        when(userRepository.findByEmailIgnoreCase("admin@autocut.ai")).thenReturn(Optional.of(user));

        Map<String, String> body = Map.of(
                "username", "admin@autocut.ai",
                "password", "sai_mat_khau"
        );

        ResponseEntity<Map<String, Object>> response = authController.login(body);

        Assertions.assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertEquals("ERROR", response.getBody().get("status"));
    }

    @Test
    @DisplayName("Đăng nhập thất bại khi tài khoản không tồn tại trong Database")
    void testLoginUserNotFound() {
        when(userRepository.findByEmailIgnoreCase(anyString())).thenReturn(Optional.empty());
        when(userRepository.findAll()).thenReturn(List.of());

        Map<String, String> body = Map.of(
                "username", "khong_ton_tai@autocut.ai",
                "password", "pass123"
        );

        ResponseEntity<Map<String, Object>> response = authController.login(body);

        Assertions.assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertEquals("ERROR", response.getBody().get("status"));
    }
}
