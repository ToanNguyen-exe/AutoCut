package com.autocut.repository;

import com.autocut.entity.AuthTicketEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

@Repository
public interface AuthTicketRepository extends JpaRepository<AuthTicketEntity, Long> {
    Optional<AuthTicketEntity> findByTicketHash(String ticketHash);

    @Modifying
    @Transactional
    @Query("UPDATE AuthTicketEntity t SET t.usedAt = :now " +
           "WHERE t.ticketHash = :hash AND t.purpose = :purpose AND t.resourceId = :resourceId " +
           "AND t.expiresAt > :now AND (t.singleUse = false OR t.usedAt IS NULL)")
    int markUsedIfValid(
            @Param("hash") String hash,
            @Param("purpose") String purpose,
            @Param("resourceId") String resourceId,
            @Param("now") Instant now);
}
