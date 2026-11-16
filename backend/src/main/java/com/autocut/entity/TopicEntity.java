package com.autocut.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "topics", indexes = {
    @Index(name = "idx_topics_section_pos", columnList = "section_id, position"),
    @Index(name = "idx_topics_status", columnList = "status")
})
public class TopicEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "section_id", nullable = false)
    private SectionEntity section;

    @Column(name = "topic_no", nullable = false)
    private Integer topicNo;

    @Column(name = "position", nullable = false)
    private Integer position = 0;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    @Column(name = "slug", nullable = false, length = 100)
    private String slug;

    @Column(name = "start_id", nullable = false, length = 10)
    private String startId;

    @Column(name = "end_id", nullable = false, length = 10)
    private String endId;

    @Column(name = "start_time", nullable = false)
    private Double startTime;

    @Column(name = "end_time", nullable = false)
    private Double endTime;

    @Column(name = "status", nullable = false, length = 20)
    private String status = "ACTIVE";

    @Version
    @Column(name = "version")
    private Long version = 0L;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    @OneToMany(mappedBy = "topic", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<VideoPartEntity> parts = new ArrayList<>();

    public TopicEntity() {}

    public TopicEntity(SectionEntity section, Integer topicNo, Integer position, String title, String slug, String startId, String endId, Double startTime, Double endTime) {
        this.section = section;
        this.topicNo = topicNo;
        this.position = position;
        this.title = title;
        this.slug = slug;
        this.startId = startId;
        this.endId = endId;
        this.startTime = startTime;
        this.endTime = endTime;
        this.status = "ACTIVE";
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public SectionEntity getSection() { return section; }
    public void setSection(SectionEntity section) { this.section = section; }

    public Integer getTopicNo() { return topicNo; }
    public void setTopicNo(Integer topicNo) { this.topicNo = topicNo; }

    public Integer getPosition() { return position; }
    public void setPosition(Integer position) { this.position = position; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getStartId() { return startId; }
    public void setStartId(String startId) { this.startId = startId; }

    public String getEndId() { return endId; }
    public void setEndId(String endId) { this.endId = endId; }

    public Double getStartTime() { return startTime; }
    public void setStartTime(Double startTime) { this.startTime = startTime; }

    public Double getEndTime() { return endTime; }
    public void setEndTime(Double endTime) { this.endTime = endTime; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }

    public List<VideoPartEntity> getParts() { return parts; }
    public void setParts(List<VideoPartEntity> parts) { this.parts = parts; }

    public void addPart(VideoPartEntity part) {
        parts.add(part);
        part.setTopic(this);
    }
}
