package com.autocut.auth;

import com.autocut.entity.UserEntity;
import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class JwtServiceTest {

    private static final String TEST_SECRET = "autocut-unit-test-secret-key-at-least-32-bytes";

    private JwtService newService() {
        ConfigService config = new ConfigService() {
            @Override
            public String getJwtSecret() {
                return TEST_SECRET;
            }
        };
        return new JwtService(config, new MockEnvironment().withProperty("spring.profiles.active", "dev"));
    }

    @Test
    @DisplayName("AC-9: thieu JWT_SECRET o dev/prod phai dung khoi dong voi thong bao ro rang")
    void missingJwtSecretOutsideTestProfileThrows() {
        ConfigService emptySecretConfig = new ConfigService() {
            @Override
            public String getJwtSecret() {
                return "";
            }
        };
        MockEnvironment prodEnv = new MockEnvironment();

        IllegalStateException ex = Assertions.assertThrows(IllegalStateException.class,
                () -> new JwtService(emptySecretConfig, prodEnv));
        Assertions.assertTrue(ex.getMessage().contains("JWT_SECRET chưa được cấu hình"),
                "Thong bao loi phai neu ro JWT_SECRET, thuc te: " + ex.getMessage());
    }

    @Test
    @DisplayName("issueAccessToken -> parse tra dung userId, role va TTL 900s")
    void issue_thenParse_returnsSameUserId() {
        JwtService jwtService = newService();
        UserEntity user = new UserEntity("gv@truong.edu.vn", "$2a$12$dummy", "Giang Vien", "INSTRUCTOR");
        user.setId(42L);
        user.setMustChangePassword(true);

        JwtService.IssuedToken issued = jwtService.issueAccessToken(user);
        Assertions.assertEquals(900L, issued.expiresInSeconds());
        Assertions.assertNotNull(issued.token());

        AuthPrincipal principal = jwtService.parse(issued.token());
        Assertions.assertEquals(42L, principal.userId());
        Assertions.assertEquals("gv@truong.edu.vn", principal.email());
        Assertions.assertEquals("INSTRUCTOR", principal.role());
        Assertions.assertTrue(principal.mustChangePassword());
        Assertions.assertNotNull(principal.jti());
    }

    @Test
    @DisplayName("Token het han phai nem TokenExpired (TOKEN_EXPIRED)")
    void parse_expiredToken_throwsTokenExpired() {
        JwtService jwtService = newService();
        UserEntity user = new UserEntity("gv@truong.edu.vn", "$2a$12$dummy", "Giang Vien", "INSTRUCTOR");
        user.setId(7L);

        String expired = jwtService.issueAccessTokenWithTtl(user, -60L).token();
        AuthException ex = Assertions.assertThrows(AuthException.class, () -> jwtService.parse(expired));
        Assertions.assertEquals("TOKEN_EXPIRED", ex.getCode());
    }

    @Test
    @DisplayName("Token bi sua chu ky phai bi tu choi")
    void parse_tamperedSignature_throws() {
        JwtService jwtService = newService();
        UserEntity user = new UserEntity("gv@truong.edu.vn", "$2a$12$dummy", "Giang Vien", "INSTRUCTOR");
        user.setId(7L);

        String token = jwtService.issueAccessToken(user).token();
        String tampered = token.substring(0, token.length() - 4) + "AAAA";

        Assertions.assertThrows(AuthException.class, () -> jwtService.parse(tampered));
    }
}
