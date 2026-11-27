package com.autocut.auth;

import com.autocut.config.BootstrapAdminRunner;
import com.autocut.entity.RefreshTokenEntity;
import com.autocut.entity.UserEntity;
import com.autocut.repository.RefreshTokenRepository;
import com.autocut.repository.UserRepository;
import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthServiceTest {

    private UserRepository userRepository;
    private RefreshTokenRepository refreshTokenRepository;
    private PasswordEncoder passwordEncoder;
    private JwtService jwtService;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        userRepository = Mockito.mock(UserRepository.class);
        refreshTokenRepository = Mockito.mock(RefreshTokenRepository.class);
        passwordEncoder = new BCryptPasswordEncoder(12);
        ConfigService config = new ConfigService() {
            @Override
            public String getJwtSecret() {
                return "autocut-unit-test-secret-key-at-least-32-bytes";
            }
        };
        jwtService = new JwtService(config, new MockEnvironment().withProperty("spring.profiles.active", "test"));
        authService = new AuthService(userRepository, refreshTokenRepository, passwordEncoder, jwtService);

        when(refreshTokenRepository.save(any(RefreshTokenEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
    }

    private UserEntity activeUser(String email, String rawPass) {
        UserEntity u = new UserEntity(email, passwordEncoder.encode(rawPass), "Giang Vien", "INSTRUCTOR");
        u.setId(10L);
        u.setIsActive(true);
        return u;
    }

    @Test
    @DisplayName("BCrypt hash bat dau bang $2a$12$/$2b$12$; TU CHOI plaintext; SHA-256 cu duoc xac thuc 1 lan va tu dong nang cap len BCrypt(12)")
    void rejectsPlaintext_andUpgradesLegacySha256OnLogin() throws Exception {
        String encoded = passwordEncoder.encode("MatKhau123");
        Assertions.assertTrue(encoded.startsWith("$2a$12$") || encoded.startsWith("$2b$12$"),
                "Hash phai la BCrypt cost 12");

        // DB luu plaintext -> VAN TU CHOI hoan toan
        UserEntity plaintextUser = new UserEntity("plain@autocut.ai", "MatKhau123", "Plain", "INSTRUCTOR");
        plaintextUser.setId(1L);
        when(userRepository.findByEmailIgnoreCase("plain@autocut.ai")).thenReturn(Optional.of(plaintextUser));
        AuthException plainEx = Assertions.assertThrows(AuthException.class,
                () -> authService.login("plain@autocut.ai", "MatKhau123", "ua", "127.0.0.1"));
        Assertions.assertEquals("INVALID_CREDENTIALS", plainEx.getCode());

        // Yeu cau thay doi theo DB hien huu: user cu luu SHA-256 hex (64 ky tu) dang nhap dung phai thanh cong
        // va ngay lap tuc duoc bam lai bang BCrypt cost 12 trong DB (lazy migration).
        String sha256 = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest("MatKhau123".getBytes(StandardCharsets.UTF_8)));
        UserEntity shaUser = new UserEntity("sha@autocut.ai", sha256, "Sha", "INSTRUCTOR");
        shaUser.setId(2L);
        shaUser.setIsActive(true);
        when(userRepository.findByEmailIgnoreCase("sha@autocut.ai")).thenReturn(Optional.of(shaUser));

        // Sai mat khau voi SHA-256 van bi dem loi nhu thuong
        AuthException wrongSha = Assertions.assertThrows(AuthException.class,
                () -> authService.login("sha@autocut.ai", "SaiMatKhau", "ua", "127.0.0.1"));
        Assertions.assertEquals("INVALID_CREDENTIALS", wrongSha.getCode());
        Assertions.assertEquals(1, shaUser.getFailedLoginCount());
        Assertions.assertEquals(sha256, shaUser.getPasswordHash());

        // Dung mat khau -> dang nhap thanh cong va DB hash doi thanh BCrypt cost 12
        AuthService.LoginResult result = authService.login("sha@autocut.ai", "MatKhau123", "ua", "127.0.0.1");
        Assertions.assertNotNull(result.accessToken());
        Assertions.assertTrue(
                shaUser.getPasswordHash().startsWith("$2a$12$") || shaUser.getPasswordHash().startsWith("$2b$12$"),
                "Password hash trong DB phai duoc nang cap ngay sang BCrypt(12), thuc te: " + shaUser.getPasswordHash());
        Assertions.assertTrue(passwordEncoder.matches("MatKhau123", shaUser.getPasswordHash()));
        Assertions.assertEquals(0, shaUser.getFailedLoginCount());
    }

    @Test
    @DisplayName("AC-2: sai mat khau hay email khong ton tai deu tra cung 401 INVALID_CREDENTIALS")
    void login_wrongPasswordOrUnknownEmail_uniformInvalidCredentials() {
        UserEntity u = activeUser("gv@truong.edu.vn", "MatKhau123");
        when(userRepository.findByEmailIgnoreCase("gv@truong.edu.vn")).thenReturn(Optional.of(u));
        when(userRepository.findByEmailIgnoreCase("nobody@truong.edu.vn")).thenReturn(Optional.empty());

        AuthException ex1 = Assertions.assertThrows(AuthException.class,
                () -> authService.login("gv@truong.edu.vn", "SaiMatKhau1", "ua", "127.0.0.1"));
        AuthException ex2 = Assertions.assertThrows(AuthException.class,
                () -> authService.login("nobody@truong.edu.vn", "SaiMatKhau1", "ua", "127.0.0.1"));

        Assertions.assertEquals(HttpStatus.UNAUTHORIZED, ex1.getStatus());
        Assertions.assertEquals(HttpStatus.UNAUTHORIZED, ex2.getStatus());
        Assertions.assertEquals(ex1.getCode(), ex2.getCode());
        Assertions.assertEquals(ex1.getMessage(), ex2.getMessage());
        Assertions.assertEquals(1, u.getFailedLoginCount());
        Assertions.assertNotNull(u.getFirstFailedAt());
    }

    @Test
    @DisplayName("AC-3: sai 5 lan trong 15 phut -> khoa 15 phut (423 ACCOUNT_LOCKED), khi dang khoa khong gia han")
    void login_fifthFailureLocksAccount_andLockedDoesNotExtend() {
        UserEntity u = activeUser("gv@truong.edu.vn", "MatKhau123");
        when(userRepository.findByEmailIgnoreCase("gv@truong.edu.vn")).thenReturn(Optional.of(u));

        for (int i = 0; i < 4; i++) {
            AuthException ex = Assertions.assertThrows(AuthException.class,
                    () -> authService.login("gv@truong.edu.vn", "SaiPass1", "ua", "127.0.0.1"));
            Assertions.assertEquals("INVALID_CREDENTIALS", ex.getCode());
        }

        AuthException locked = Assertions.assertThrows(AuthException.class,
                () -> authService.login("gv@truong.edu.vn", "SaiPass1", "ua", "127.0.0.1"));
        Assertions.assertEquals(HttpStatus.valueOf(423), locked.getStatus());
        Assertions.assertEquals("ACCOUNT_LOCKED", locked.getCode());
        Instant lockEnd = u.getLockedUntil();
        Assertions.assertNotNull(lockEnd);

        // Thu lai (ke ca dung mat khau) khi dang khoa -> van 423 va khong tang failedCount/lockedUntil
        AuthException retryWhileLocked = Assertions.assertThrows(AuthException.class,
                () -> authService.login("gv@truong.edu.vn", "MatKhau123", "ua", "127.0.0.1"));
        Assertions.assertEquals("ACCOUNT_LOCKED", retryWhileLocked.getCode());
        Assertions.assertEquals(5, u.getFailedLoginCount());
        Assertions.assertEquals(lockEnd, u.getLockedUntil());
    }

    @Test
    @DisplayName("FR-3: sai lai sau cua so 15 phut -> reset dem ve 1")
    void login_failureAfterWindow_resetsCounter() {
        UserEntity u = activeUser("gv@truong.edu.vn", "MatKhau123");
        u.setFailedLoginCount(4);
        u.setFirstFailedAt(Instant.now().minusSeconds(16 * 60));
        when(userRepository.findByEmailIgnoreCase("gv@truong.edu.vn")).thenReturn(Optional.of(u));

        AuthException ex = Assertions.assertThrows(AuthException.class,
                () -> authService.login("gv@truong.edu.vn", "SaiPass1", "ua", "127.0.0.1"));
        Assertions.assertEquals("INVALID_CREDENTIALS", ex.getCode());
        Assertions.assertEquals(1, u.getFailedLoginCount());
        Assertions.assertNull(u.getLockedUntil());
    }

    @Test
    @DisplayName("AC-5: refresh xoay vong token; dung lai token cu thu hoi toan bo family")
    void refresh_rotates_andReusedRevokesWholeFamily() {
        UserEntity u = activeUser("gv@truong.edu.vn", "MatKhau123");
        when(userRepository.findByEmailIgnoreCase("gv@truong.edu.vn")).thenReturn(Optional.of(u));
        when(userRepository.findById(10L)).thenReturn(Optional.of(u));

        AuthService.LoginResult res = authService.login("gv@truong.edu.vn", "MatKhau123", "ua", "127.0.0.1");
        String r1 = res.refreshToken();
        String r1Hash = AuthService.sha256Hex(r1);

        RefreshTokenEntity storedR1 = new RefreshTokenEntity(10L, r1Hash, UUID.randomUUID(), Instant.now().plusSeconds(3600), "ua", "127.0.0.1");
        when(refreshTokenRepository.findByTokenHash(r1Hash)).thenReturn(Optional.of(storedR1));

        AuthService.LoginResult refreshed = authService.refresh(r1, "ua", "127.0.0.1");
        Assertions.assertNotEquals(r1, refreshed.refreshToken());
        Assertions.assertNotNull(storedR1.getRevokedAt());

        // Ke tan cong dung lai R1 sau khi R1 da bi thu hoi
        AuthException reuseEx = Assertions.assertThrows(AuthException.class,
                () -> authService.refresh(r1, "ua", "127.0.0.1"));
        Assertions.assertEquals("REFRESH_TOKEN_REUSED", reuseEx.getCode());
        verify(refreshTokenRepository).revokeFamily(Mockito.eq(storedR1.getFamilyId()), any(Instant.class));
    }

    @Test
    @DisplayName("AC-6 & FR-7: doi mat khau bat yeu cau manh, luu BCrypt va thu hoi moi refresh token")
    void changePassword_checksStrength_andRevokesAllSessions() {
        UserEntity u = activeUser("gv@truong.edu.vn", "MatKhau123");
        when(userRepository.findById(10L)).thenReturn(Optional.of(u));

        AuthException weak = Assertions.assertThrows(AuthException.class,
                () -> authService.changePassword(10L, "MatKhau123", "123456"));
        Assertions.assertEquals("WEAK_PASSWORD", weak.getCode());

        authService.changePassword(10L, "MatKhau123", "MatKhauMoi9");
        Assertions.assertTrue(passwordEncoder.matches("MatKhauMoi9", u.getPasswordHash()));
        Assertions.assertFalse(Boolean.TRUE.equals(u.getMustChangePassword()));
        verify(refreshTokenRepository).revokeAllByUserId(Mockito.eq(10L), any(Instant.class));
    }

    @Test
    @DisplayName("FR-9: BootstrapAdminRunner khong tao admin123 mac dinh khi thieu bien moi truong")
    void bootstrapAdmin_withoutEnvVars_createsNothing() {
        ConfigService emptyEnv = new ConfigService() {
            @Override
            public String getEnv(String key, String defaultValue) {
                return defaultValue;
            }
        };
        when(userRepository.existsByRoleIgnoreCase("ADMIN")).thenReturn(false);

        BootstrapAdminRunner runner = new BootstrapAdminRunner(userRepository, emptyEnv, passwordEncoder);
        runner.run(new DefaultApplicationArguments());

        verify(userRepository, never()).save(any());
    }
}
