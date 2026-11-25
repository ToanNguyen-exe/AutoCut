package com.autocut.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
public class RefreshTokenEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "token_hash", length = 64, nullable = false, unique = true)
    private String tokenHash;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "user_agent", length = 255)
    private String userAgent;

    @Column(name = "ip", length = 45)
    private String ip;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public RefreshTokenEntity() {}

    public RefreshTokenEntity(Long userId, String tokenHash, UUID familyId, Instant expiresAt, String userAgent, String ip) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.familyId = familyId;
        this.expiresAt = expiresAt;
        this.userAgent = userAgent;
        this.ip = ip;
        this.createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public Long getUserId() { return userId; }
    public String getTokenHash() { return tokenHash; }
    public UUID getFamilyId() { return familyId; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public void setRevokedAt(Instant revokedAt) { this.revokedAt = revokedAt; }
    public String getUserAgent() { return userAgent; }
    public String getIp() { return ip; }
    public Instant getCreatedAt() { return createdAt; }
}
