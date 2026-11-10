package com.autocut.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "sections", indexes = {
    @Index(name = "idx_sections_video_pos", columnList = "video_id, position")
})
public class SectionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "video_id", nullable = false)
    private VideoEntity video;

    @Column(name = "section_no", nullable = false)
    private Integer sectionNo;

    @Column(name = "position", nullable = false)
    private Integer position = 0;

    @Column(name = "label", nullable = false, length = 100)
    private String label;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @OneToMany(mappedBy = "section", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<TopicEntity> topics = new ArrayList<>();

    public SectionEntity() {}

    public SectionEntity(VideoEntity video, Integer sectionNo, Integer position, String label) {
        this.video = video;
        this.sectionNo = sectionNo;
        this.position = position;
        this.label = label;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public VideoEntity getVideo() { return video; }
    public void setVideo(VideoEntity video) { this.video = video; }

    public Integer getSectionNo() { return sectionNo; }
    public void setSectionNo(Integer sectionNo) { this.sectionNo = sectionNo; }

    public Integer getPosition() { return position; }
    public void setPosition(Integer position) { this.position = position; }

    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public List<TopicEntity> getTopics() { return topics; }
    public void setTopics(List<TopicEntity> topics) { this.topics = topics; }

    public void addTopic(TopicEntity topic) {
        topics.add(topic);
        topic.setSection(this);
    }
}
