package com.autocut.repository;

import com.autocut.entity.TopicEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TopicRepository extends JpaRepository<TopicEntity, Long> {
    List<TopicEntity> findBySectionIdOrderByPositionAsc(Long sectionId);
    List<TopicEntity> findBySectionVideoIdOrderByPositionAsc(Long videoId);
}
