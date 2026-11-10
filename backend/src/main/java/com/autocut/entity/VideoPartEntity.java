package com.autocut.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "video_parts", indexes = {
    @Index(name = "idx_parts_topic", columnList = "topic_id")
}, uniqueConstraints = {
    @UniqueConstraint(name = "uq_topic_part", columnNames = {"topic_id", "part_no"})
})
public class VideoPartEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "topic_id", nullable = false)
    private TopicEntity topic;

    @Column(name = "part_no", nullable = false)
    private Integer partNo = 1;

    @Column(name = "start_time", nullable = false)
    private Double startTime;

    @Column(name = "end_time", nullable = false)
    private Double endTime;

    @Column(name = "r2_key", nullable = false, length = 500)
    private String r2Key;

    @Column(name = "cloud_url", nullable = false, length = 500)
    private String cloudUrl;

    @Column(name = "file_size")
    private Long fileSize;

    @Column(name = "status", nullable = false, length = 20)
    private String status = "PENDING";

    @Column(name = "rendered_at")
    private LocalDateTime renderedAt;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public VideoPartEntity() {}

    public VideoPartEntity(TopicEntity topic, Integer partNo, Double startTime, Double endTime, String r2Key, String cloudUrl, Long fileSize, String status) {
        this.topic = topic;
        this.partNo = partNo;
        this.startTime = startTime;
        this.endTime = endTime;
        this.r2Key = r2Key;
        this.cloudUrl = cloudUrl;
        this.fileSize = fileSize;
        this.status = status != null ? status : "PENDING";
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public TopicEntity getTopic() { return topic; }
    public void setTopic(TopicEntity topic) { this.topic = topic; }

    public Integer getPartNo() { return partNo; }
    public void setPartNo(Integer partNo) { this.partNo = partNo; }

    public Double getStartTime() { return startTime; }
    public void setStartTime(Double startTime) { this.startTime = startTime; }

    public Double getEndTime() { return endTime; }
    public void setEndTime(Double endTime) { this.endTime = endTime; }

    public String getR2Key() { return r2Key; }
    public void setR2Key(String r2Key) { this.r2Key = r2Key; }

    public String getCloudUrl() { return cloudUrl; }
    public void setCloudUrl(String cloudUrl) { this.cloudUrl = cloudUrl; }

    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long fileSize) { this.fileSize = fileSize; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public LocalDateTime getRenderedAt() { return renderedAt; }
    public void setRenderedAt(LocalDateTime renderedAt) { this.renderedAt = renderedAt; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
