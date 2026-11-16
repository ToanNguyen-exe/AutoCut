package com.autocut.repository;

import com.autocut.entity.TranscriptEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TranscriptRepository extends JpaRepository<TranscriptEntity, Long> {
    List<TranscriptEntity> findByVideoIdOrderByStartTimeAsc(Long videoId);
    void deleteByVideoId(Long videoId);
}
