package com.autocut.auth;

import com.autocut.entity.RefreshTokenEntity;
import com.autocut.entity.UserEntity;
import com.autocut.repository.RefreshTokenRepository;
import com.autocut.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

/**
 * Nghiệp vụ xác thực: đăng nhập BCrypt, khóa brute-force, xoay vòng refresh token và đổi mật khẩu.
 */
@Service
public class AuthService {

    public static final long REFRESH_TOKEN_TTL_SECONDS = 7L * 24L * 3600L;
    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final long LOCK_WINDOW_SECONDS = 15L * 60L;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String DUMMY_BCRYPT_HASH =
            "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public record LoginResult(
            String accessToken,
            long expiresInSeconds,
            String refreshToken,
            UserEntity user
    ) {
    }

    public AuthService(
            UserRepository userRepository,
            RefreshTokenRepository refreshTokenRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService) {
        this.userRepository = userRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public LoginResult login(String email, String rawPassword, String userAgent, String ip) {
        String normalizedEmail = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (normalizedEmail.isEmpty() || rawPassword == null || rawPassword.isEmpty()) {
            throw invalidCredentials();
        }

        UserEntity user = userRepository.findByEmailIgnoreCase(normalizedEmail).orElse(null);
        if (user == null) {
            // Thực hiện kiểm tra BCrypt giả để giảm chênh lệch thời gian phản hồi khi email không tồn tại.
            passwordEncoder.matches(rawPassword, DUMMY_BCRYPT_HASH);
            throw invalidCredentials();
        }

        Instant now = Instant.now();
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw new AuthException(
                    HttpStatus.LOCKED,
                    "ACCOUNT_LOCKED",
                    "Tài khoản đang tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau."
            );
        }

        String storedHash = user.getPasswordHash();
        if (!matchesStoredHash(storedHash, rawPassword)) {
            recordFailedAttempt(user, now);
            throw invalidCredentials();
        }

        if (!Boolean.TRUE.equals(user.getIsActive())) {
            throw new AuthException(
                    HttpStatus.FORBIDDEN,
                    "ACCOUNT_DISABLED",
                    "Tài khoản đã bị vô hiệu hóa."
            );
        }

        // Lazy migration: tài khoản cũ dùng SHA-256 hex được tự động băm lại bằng BCrypt(12) ngay lần đăng nhập đầu.
        if (!isBcryptHash(storedHash)) {
            user.setPasswordHash(passwordEncoder.encode(rawPassword));
        }

        user.setFailedLoginCount(0);
        user.setFirstFailedAt(null);
        user.setLockedUntil(null);
        user.setLastLoginAt(now);
        userRepository.save(user);

        return issueSession(user, UUID.randomUUID(), userAgent, ip, now);
    }

    @Transactional
    public LoginResult refresh(String rawRefreshToken, String userAgent, String ip) {
        if (rawRefreshToken == null || rawRefreshToken.isBlank()) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "REFRESH_TOKEN_INVALID", "Thiếu refresh token.");
        }

        String hash = sha256Hex(rawRefreshToken);
        RefreshTokenEntity existing = refreshTokenRepository.findByTokenHash(hash)
                .orElseThrow(() -> new AuthException(
                        HttpStatus.UNAUTHORIZED,
                        "REFRESH_TOKEN_INVALID",
                        "Refresh token không hợp lệ."
                ));

        Instant now = Instant.now();
        if (existing.getRevokedAt() != null) {
            // Phát hiện dùng lại refresh token đã thu hồi: vô hiệu hóa cả gia đình token.
            refreshTokenRepository.revokeFamily(existing.getFamilyId(), now);
            throw new AuthException(
                    HttpStatus.UNAUTHORIZED,
                    "REFRESH_TOKEN_REUSED",
                    "Phát hiện refresh token bị dùng lại. Toàn bộ phiên liên quan đã bị thu hồi."
            );
        }

        if (!existing.getExpiresAt().isAfter(now)) {
            throw new AuthException(
                    HttpStatus.UNAUTHORIZED,
                    "REFRESH_TOKEN_EXPIRED",
                    "Refresh token đã hết hạn."
            );
        }

        UserEntity user = userRepository.findById(existing.getUserId())
                .filter(u -> Boolean.TRUE.equals(u.getIsActive()))
                .orElseThrow(() -> {
                    refreshTokenRepository.revokeFamily(existing.getFamilyId(), now);
                    return new AuthException(
                            HttpStatus.UNAUTHORIZED,
                            "ACCOUNT_DISABLED",
                            "Tài khoản không khả dụng."
                    );
                });

        existing.setRevokedAt(now);
        refreshTokenRepository.save(existing);

        return issueSession(user, existing.getFamilyId(), userAgent, ip, now);
    }

    public void logout(String rawRefreshToken) {
        if (rawRefreshToken == null || rawRefreshToken.isBlank()) {
            return;
        }
        String hash = sha256Hex(rawRefreshToken);
        refreshTokenRepository.findByTokenHash(hash).ifPresent(entity -> {
            if (entity.getRevokedAt() == null) {
                entity.setRevokedAt(Instant.now());
                refreshTokenRepository.save(entity);
            }
        });
    }

    @Transactional
    public void changePassword(Long userId, String currentPassword, String newPassword) {
        UserEntity user = getUserById(userId);
        if (currentPassword == null || !matchesStoredHash(user.getPasswordHash(), currentPassword)) {
            throw new AuthException(
                    HttpStatus.UNAUTHORIZED,
                    "INVALID_CREDENTIALS",
                    "Mật khẩu hiện tại không đúng."
            );
        }

        validatePasswordStrength(newPassword);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setMustChangePassword(false);
        user.setFailedLoginCount(0);
        user.setFirstFailedAt(null);
        user.setLockedUntil(null);
        userRepository.save(user);

        refreshTokenRepository.revokeAllByUserId(userId, Instant.now());
    }

    public UserEntity updateProfile(Long userId, String fullName) {
        String trimmed = fullName == null ? "" : fullName.trim();
        if (trimmed.isEmpty() || trimmed.length() > 100) {
            throw new AuthException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "Tên hiển thị không hợp lệ (1-100 ký tự)."
            );
        }
        UserEntity user = getUserById(userId);
        user.setFullName(trimmed);
        return userRepository.save(user);
    }

    public UserEntity getUserById(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new AuthException(
                        HttpStatus.UNAUTHORIZED,
                        "USER_NOT_FOUND",
                        "Không tìm thấy thông tin tài khoản."
                ));
    }

    public static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 không khả dụng.", e);
        }
    }

    private LoginResult issueSession(UserEntity user, UUID familyId, String userAgent, String ip, Instant now) {
        JwtService.IssuedToken access = jwtService.issueAccessToken(user);
        String rawRefresh = generateOpaqueToken();
        String refreshHash = sha256Hex(rawRefresh);

        RefreshTokenEntity entity = new RefreshTokenEntity(
                user.getId(),
                refreshHash,
                familyId,
                now.plusSeconds(REFRESH_TOKEN_TTL_SECONDS),
                truncate(userAgent, 255),
                truncate(ip, 45)
        );
        refreshTokenRepository.save(entity);

        return new LoginResult(access.token(), access.expiresInSeconds(), rawRefresh, user);
    }

    private void recordFailedAttempt(UserEntity user, Instant now) {
        Instant firstFailed = user.getFirstFailedAt();
        int nextCount;
        if (firstFailed == null || firstFailed.plusSeconds(LOCK_WINDOW_SECONDS).isBefore(now)) {
            user.setFirstFailedAt(now);
            user.setLockedUntil(null);
            nextCount = 1;
        } else {
            nextCount = (user.getFailedLoginCount() != null ? user.getFailedLoginCount() : 0) + 1;
        }
        user.setFailedLoginCount(nextCount);

        if (nextCount >= MAX_FAILED_ATTEMPTS) {
            user.setLockedUntil(now.plusSeconds(LOCK_WINDOW_SECONDS));
            userRepository.save(user);
            throw new AuthException(
                    HttpStatus.LOCKED,
                    "ACCOUNT_LOCKED",
                    "Tài khoản tạm khóa 15 phút do đăng nhập sai quá 5 lần."
            );
        }
        userRepository.save(user);
    }

    private boolean matchesStoredHash(String storedHash, String rawPassword) {
        if (storedHash == null || rawPassword == null) {
            return false;
        }
        if (isBcryptHash(storedHash)) {
            return passwordEncoder.matches(rawPassword, storedHash);
        }
        if (isLegacySha256Hex(storedHash)) {
            byte[] expected = storedHash.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8);
            byte[] actual = sha256Hex(rawPassword).toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8);
            return MessageDigest.isEqual(expected, actual);
        }
        return false;
    }

    private static boolean isBcryptHash(String hash) {
        return hash != null && (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$"));
    }

    private static boolean isLegacySha256Hex(String hash) {
        if (hash == null || hash.length() != 64) {
            return false;
        }
        for (int i = 0; i < hash.length(); i++) {
            char c = hash.charAt(i);
            boolean hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
            if (!hex) {
                return false;
            }
        }
        return true;
    }

    private static void validatePasswordStrength(String password) {
        if (password == null || password.length() < 8) {
            throw new AuthException(
                    HttpStatus.BAD_REQUEST,
                    "WEAK_PASSWORD",
                    "Mật khẩu mới phải có ít nhất 8 ký tự, gồm chữ và số."
            );
        }
        boolean hasLetter = false;
        boolean hasDigit = false;
        for (int i = 0; i < password.length(); i++) {
            char c = password.charAt(i);
            if (Character.isLetter(c)) {
                hasLetter = true;
            } else if (Character.isDigit(c)) {
                hasDigit = true;
            }
        }
        if (!hasLetter || !hasDigit) {
            throw new AuthException(
                    HttpStatus.BAD_REQUEST,
                    "WEAK_PASSWORD",
                    "Mật khẩu mới phải gồm cả chữ cái và chữ số."
            );
        }
    }

    private static AuthException invalidCredentials() {
        return new AuthException(
                HttpStatus.UNAUTHORIZED,
                "INVALID_CREDENTIALS",
                "Email hoặc mật khẩu không đúng."
        );
    }

    private static String generateOpaqueToken() {
        byte[] buf = new byte[32];
        SECURE_RANDOM.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    private static String truncate(String val, int maxLen) {
        if (val == null) {
            return null;
        }
        return val.length() <= maxLen ? val : val.substring(0, maxLen);
    }
}
