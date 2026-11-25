package com.autocut.auth;

import com.autocut.entity.UserEntity;
import com.autocut.service.ConfigService;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.UUID;

/**
 * Cấp và xác thực access token JWT (HS256) bằng khóa bí mật từ môi trường.
 */
@Service
public class JwtService {

    public static final long ACCESS_TOKEN_TTL_SECONDS = 900L;
    private static final int MIN_SECRET_BYTES = 32;
    private static final String ISSUER = "autocut-api";

    private final byte[] secretBytes;

    public record IssuedToken(String token, long expiresInSeconds) {
    }

    public JwtService(ConfigService configService, Environment environment) {
        String configured = configService.getJwtSecret();
        boolean isTest = environment != null
                && Arrays.stream(environment.getActiveProfiles()).anyMatch("test"::equalsIgnoreCase);

        if ((configured == null || configured.isBlank()) && isTest && environment != null) {
            configured = environment.getProperty("autocut.jwt.secret", "");
        }

        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(
                    "JWT_SECRET chưa được cấu hình (cần chuỗi bí mật tối thiểu 32 byte cho HS256).");
        }

        byte[] raw = configured.trim().getBytes(StandardCharsets.UTF_8);
        if (raw.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "JWT_SECRET chưa được cấu hình đủ mạnh: cần tối thiểu 32 byte cho HS256.");
        }
        this.secretBytes = raw;
    }

    public IssuedToken issueAccessToken(UserEntity user) {
        return issueAccessTokenWithTtl(user, ACCESS_TOKEN_TTL_SECONDS);
    }

    public IssuedToken issueAccessTokenWithTtl(UserEntity user, long ttlSeconds) {
        try {
            Instant now = Instant.now();
            Instant exp = now.plusSeconds(ttlSeconds);
            String jti = UUID.randomUUID().toString();

            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(ISSUER)
                    .subject(String.valueOf(user.getId()))
                    .jwtID(jti)
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(exp))
                    .claim("email", user.getEmail())
                    .claim("role", user.getRole())
                    .claim("mcp", Boolean.TRUE.equals(user.getMustChangePassword()))
                    .build();

            SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            JWSSigner signer = new MACSigner(secretBytes);
            signedJWT.sign(signer);

            return new IssuedToken(signedJWT.serialize(), ttlSeconds);
        } catch (JOSEException e) {
            throw new IllegalStateException("Không thể ký JWT token.", e);
        }
    }

    public AuthPrincipal parse(String token) {
        if (token == null || token.isBlank()) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Thiếu token xác thực.");
        }

        try {
            SignedJWT signedJWT = SignedJWT.parse(token);
            if (!JWSAlgorithm.HS256.equals(signedJWT.getHeader().getAlgorithm())) {
                throw new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Thuật toán token không hợp lệ.");
            }

            JWSVerifier verifier = new MACVerifier(secretBytes);
            if (!signedJWT.verify(verifier)) {
                throw new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Chữ ký token không hợp lệ.");
            }

            JWTClaimsSet claims = signedJWT.getJWTClaimsSet();
            Date expirationTime = claims.getExpirationTime();
            if (expirationTime == null || !expirationTime.toInstant().isAfter(Instant.now())) {
                throw new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_EXPIRED", "Phiên đăng nhập đã hết hạn.");
            }

            long userId = Long.parseLong(claims.getSubject());
            String email = claims.getStringClaim("email");
            String role = claims.getStringClaim("role");
            Boolean mcp = claims.getBooleanClaim("mcp");

            return new AuthPrincipal(
                    userId,
                    email,
                    role,
                    Boolean.TRUE.equals(mcp),
                    claims.getJWTID()
            );
        } catch (AuthException ex) {
            throw ex;
        } catch (ParseException | JOSEException | NumberFormatException e) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Token xác thực không hợp lệ.");
        }
    }
}
