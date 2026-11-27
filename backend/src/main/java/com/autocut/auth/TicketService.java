package com.autocut.auth;

import com.autocut.entity.AuthTicketEntity;
import com.autocut.entity.UserEntity;
import com.autocut.repository.AuthTicketRepository;
import com.autocut.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Set;

/**
 * Cấp và xác thực vé ngắn hạn (?ticket=...) thay cho JWT trên URL (SSE, phát video, tải file).
 */
@Service
public class TicketService {

    private static final Set<String> ALLOWED_PURPOSES = Set.of("SSE", "STREAM", "DOWNLOAD");
    private static final long SINGLE_USE_TTL_SECONDS = 60L;
    private static final long STREAM_TTL_SECONDS = 300L;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final AuthTicketRepository ticketRepository;
    private final UserRepository userRepository;

    public record IssuedTicket(String ticket, long expiresInSeconds) {
    }

    public TicketService(AuthTicketRepository ticketRepository, UserRepository userRepository) {
        this.ticketRepository = ticketRepository;
        this.userRepository = userRepository;
    }

    public IssuedTicket issue(Long userId, String purpose, String resourceId) {
        String normalizedPurpose = purpose == null ? "" : purpose.trim().toUpperCase();
        String trimmedResource = resourceId == null ? "" : resourceId.trim();

        if (!ALLOWED_PURPOSES.contains(normalizedPurpose) || trimmedResource.isEmpty() || trimmedResource.length() > 100) {
            throw new AuthException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TICKET_REQUEST",
                    "Yêu cầu cấp vé không hợp lệ."
            );
        }

        UserEntity user = userRepository.findById(userId)
                .filter(u -> Boolean.TRUE.equals(u.getIsActive()))
                .orElseThrow(() -> new AuthException(
                        HttpStatus.UNAUTHORIZED,
                        "ACCOUNT_DISABLED",
                        "Tài khoản không khả dụng."
                ));

        boolean singleUse = !"STREAM".equals(normalizedPurpose);
        long ttlSeconds = singleUse ? SINGLE_USE_TTL_SECONDS : STREAM_TTL_SECONDS;

        byte[] rawBytes = new byte[32];
        SECURE_RANDOM.nextBytes(rawBytes);
        String rawTicket = Base64.getUrlEncoder().withoutPadding().encodeToString(rawBytes);
        String hash = AuthService.sha256Hex(rawTicket);

        AuthTicketEntity entity = new AuthTicketEntity(
                hash,
                user.getId(),
                normalizedPurpose,
                trimmedResource,
                singleUse,
                Instant.now().plusSeconds(ttlSeconds)
        );
        ticketRepository.save(entity);

        return new IssuedTicket(rawTicket, ttlSeconds);
    }

    @Transactional
    public AuthPrincipal consume(String rawTicket, String expectedPurpose, String expectedResourceId) {
        if (rawTicket == null || rawTicket.isBlank()
                || expectedPurpose == null || expectedPurpose.isBlank()
                || expectedResourceId == null || expectedResourceId.isBlank()) {
            throw invalidTicket();
        }

        String hash = AuthService.sha256Hex(rawTicket);
        String purpose = expectedPurpose.trim().toUpperCase();
        String resource = expectedResourceId.trim();

        int updated = ticketRepository.markUsedIfValid(hash, purpose, resource, Instant.now());
        if (updated != 1) {
            throw invalidTicket();
        }

        AuthTicketEntity entity = ticketRepository.findByTicketHash(hash)
                .orElseThrow(TicketService::invalidTicket);

        UserEntity user = userRepository.findById(entity.getUserId())
                .filter(u -> Boolean.TRUE.equals(u.getIsActive()))
                .orElseThrow(TicketService::invalidTicket);

        return new AuthPrincipal(
                user.getId(),
                user.getEmail(),
                user.getRole(),
                Boolean.TRUE.equals(user.getMustChangePassword()),
                null
        );
    }

    private static AuthException invalidTicket() {
        return new AuthException(
                HttpStatus.UNAUTHORIZED,
                "TICKET_INVALID",
                "Vé truy cập không hợp lệ hoặc đã hết hạn."
        );
    }
}
