package com.autocut.controller;

import com.autocut.entity.UserEntity;
import com.autocut.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@CrossOrigin(origins = "*")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private final UserRepository userRepository;

    public AuthController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public static String hashPassword(String input) {
        if (input == null) return "";
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }

    public static boolean verifyPassword(String rawPassword, String storedHash) {
        if (rawPassword == null || storedHash == null) return false;
        if (storedHash.equals(rawPassword)) return true;
        return storedHash.equalsIgnoreCase(hashPassword(rawPassword));
    }

    private Optional<UserEntity> findUserByIdentifier(String identifier) {
        if (identifier == null || identifier.isBlank()) return Optional.empty();
        String clean = identifier.trim();

        // 1. Khớp chính xác email
        Optional<UserEntity> direct = userRepository.findByEmailIgnoreCase(clean);
        if (direct.isPresent()) return direct;

        // 2. Nếu nhập username không có domain, thử thêm @autocut.ai
        if (!clean.contains("@")) {
            Optional<UserEntity> withDomain = userRepository.findByEmailIgnoreCase(clean + "@autocut.ai");
            if (withDomain.isPresent()) return withDomain;
        }

        // 3. Khớp tiền tố email
        return userRepository.findAll().stream()
                .filter(u -> u.getEmail() != null && u.getEmail().toLowerCase().startsWith(clean.toLowerCase() + "@"))
                .findFirst();
    }

    @PostMapping({"/api/video/auth/login", "/api/auth/login", "/api/video/login"})
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> request) {
        String identifier = request.get("username");
        if (identifier == null || identifier.isBlank()) {
            identifier = request.get("email");
        }
        String password = request.get("password");

        if (identifier == null || identifier.isBlank() || password == null || password.isBlank()) {
            Map<String, Object> err = new HashMap<>();
            err.put("status", "ERROR");
            err.put("message", "Vui lòng nhập đầy đủ tài khoản/email và mật khẩu!");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(err);
        }

        Optional<UserEntity> userOpt = findUserByIdentifier(identifier);
        if (userOpt.isEmpty()) {
            log.warn("Đăng nhập thất bại: Không tìm thấy tài khoản '{}' trong database", identifier);
            Map<String, Object> err = new HashMap<>();
            err.put("status", "ERROR");
            err.put("message", "Email/Tài khoản hoặc mật khẩu không chính xác!");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        UserEntity user = userOpt.get();
        if (!verifyPassword(password, user.getPasswordHash())) {
            log.warn("Đăng nhập thất bại: Sai mật khẩu cho tài khoản '{}'", user.getEmail());
            Map<String, Object> err = new HashMap<>();
            err.put("status", "ERROR");
            err.put("message", "Email/Tài khoản hoặc mật khẩu không chính xác!");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        log.info("Đăng nhập thành công từ Database: id={}, email={}", user.getId(), user.getEmail());

        String email = user.getEmail();
        String username = email.contains("@") ? email.substring(0, email.indexOf("@")) : email;
        String fullName = user.getFullName() != null && !user.getFullName().isBlank() ? user.getFullName() : username;
        String avatarChar = fullName.substring(0, 1).toUpperCase();

        Map<String, Object> userData = new HashMap<>();
        userData.put("id", user.getId());
        userData.put("email", email);
        userData.put("username", username);
        userData.put("name", fullName);
        userData.put("role", user.getRole());
        userData.put("avatar", avatarChar);
        userData.put("avatarColor", "from-purple-600 to-indigo-600");
        userData.put("storageUsedBytes", user.getStorageUsedBytes());
        userData.put("storageLimitBytes", user.getStorageLimitBytes());

        Map<String, Object> resp = new HashMap<>();
        resp.put("status", "SUCCESS");
        resp.put("message", "Đăng nhập thành công từ Database!");
        resp.put("user", userData);

        return ResponseEntity.ok(resp);
    }

    @PostMapping({"/api/video/auth/logout", "/api/auth/logout"})
    public ResponseEntity<Map<String, Object>> logout() {
        return ResponseEntity.ok(Map.of(
                "status", "SUCCESS",
                "message", "Đăng xuất thành công"
        ));
    }
}
