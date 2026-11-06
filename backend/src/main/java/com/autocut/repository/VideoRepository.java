package com.autocut.repository;

import com.autocut.entity.VideoEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface VideoRepository extends JpaRepository<VideoEntity, Long> {
    Optional<VideoEntity> findBySha256Hash(String sha256Hash);
}
