package com.autocut.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "auth_tickets")
public class AuthTicketEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "ticket_hash", length = 64, nullable = false, unique = true)
    private String ticketHash;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "purpose", length = 10, nullable = false)
    private String purpose;

    /** SHA-256 (hex) của đường dẫn tài nguyên — nhờ vậy đường dẫn dài bao nhiêu cũng vừa cột. */
    @Column(name = "resource_id", length = 100, nullable = false)
    private String resourceId;

    @Column(name = "single_use", nullable = false)
    private Boolean singleUse;

    @Column(name = "used_at")
    private Instant usedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public AuthTicketEntity() {}

    public AuthTicketEntity(String ticketHash, Long userId, String purpose, String resourceId, boolean singleUse, Instant expiresAt) {
        this.ticketHash = ticketHash;
        this.userId = userId;
        this.purpose = purpose;
        this.resourceId = resourceId;
        this.singleUse = singleUse;
        this.expiresAt = expiresAt;
        this.createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public String getTicketHash() { return ticketHash; }
    public Long getUserId() { return userId; }
    public String getPurpose() { return purpose; }
    public String getResourceId() { return resourceId; }
    public Boolean getSingleUse() { return singleUse; }
    public Instant getUsedAt() { return usedAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getCreatedAt() { return createdAt; }
}
