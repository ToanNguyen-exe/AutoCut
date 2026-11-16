package com.autocut.repository;

import com.autocut.entity.SectionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface SectionRepository extends JpaRepository<SectionEntity, Long> {
    List<SectionEntity> findByVideoIdOrderByPositionAsc(Long videoId);
    void deleteByVideoId(Long videoId);
}
