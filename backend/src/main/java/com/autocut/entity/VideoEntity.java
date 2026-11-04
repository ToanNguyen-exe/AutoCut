package com.autocut.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "videos", indexes = {
    @Index(name = "idx_video_sha256", columnList = "sha256_hash", unique = true),
    @Index(name = "idx_video_status", columnList = "status")
})
public class VideoEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "owner_id")
    private Long ownerId;

    @Column(name = "file_name", nullable = false)
    private String fileName;

    @Column(name = "file_path", length = 500)
    private String filePath;

    @Column(name = "r2_key", length = 500)
    private String r2Key;

    @Column(name = "cloud_url", length = 500)
    private String cloudUrl;

    @Column(name = "file_size")
    private Long fileSize;

    @Column(name = "duration")
    private Double duration;

    @Column(name = "sha256_hash", length = 64, nullable = false, unique = true)
    private String sha256Hash;

    @Column(name = "outline_text", columnDefinition = "TEXT")
    private String outlineText;

    @Column(name = "status", length = 30, nullable = false)
    private String status;

    @Column(name = "reviewed")
    private Boolean reviewed = false;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Version
    @Column(name = "version")
    private Long version;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    public VideoEntity() {}

    public VideoEntity(String fileName, String sha256Hash, String status, Long fileSize) {
        this.fileName = fileName;
        this.sha256Hash = sha256Hash;
        this.status = status;
        this.fileSize = fileSize;
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getOwnerId() { return ownerId; }
    public void setOwnerId(Long ownerId) { this.ownerId = ownerId; }
    public String getFileName() { return fileName; }
    public void setFileName(String fileName) { this.fileName = fileName; }
    public String getFilePath() { return filePath; }
    public void setFilePath(String filePath) { this.filePath = filePath; }
    public String getR2Key() { return r2Key; }
    public void setR2Key(String r2Key) { this.r2Key = r2Key; }
    public String getCloudUrl() { return cloudUrl; }
    public void setCloudUrl(String cloudUrl) { this.cloudUrl = cloudUrl; }
    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long fileSize) { this.fileSize = fileSize; }
    public Double getDuration() { return duration; }
    public void setDuration(Double duration) { this.duration = duration; }
    public String getSha256Hash() { return sha256Hash; }
    public void setSha256Hash(String sha256Hash) { this.sha256Hash = sha256Hash; }
    public String getOutlineText() { return outlineText; }
    public void setOutlineText(String outlineText) { this.outlineText = outlineText; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Boolean getReviewed() { return reviewed; }
    public void setReviewed(Boolean reviewed) { this.reviewed = reviewed; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }
}
