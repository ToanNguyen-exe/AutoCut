package com.autocut.repository;

import com.autocut.entity.VideoPartEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface VideoPartRepository extends JpaRepository<VideoPartEntity, Long> {
    List<VideoPartEntity> findByTopicIdOrderByPartNoAsc(Long topicId);
}
