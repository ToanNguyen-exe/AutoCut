package com.autocut.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "transcripts", indexes = {
    @Index(name = "idx_transcripts_video_sentence", columnList = "video_id, sentence_id")
})
public class TranscriptEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "video_id", nullable = false)
    private VideoEntity video;

    @Column(name = "sentence_id", nullable = false, length = 10)
    private String sentenceId;

    @Column(name = "speaker", length = 50)
    private String speaker = "spk_0";

    @Column(name = "start_time", nullable = false)
    private Double startTime;

    @Column(name = "end_time", nullable = false)
    private Double endTime;

    @Column(name = "text", nullable = false, columnDefinition = "TEXT")
    private String text;

    @Column(name = "words_json", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String wordsJson;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public TranscriptEntity() {}

    public TranscriptEntity(VideoEntity video, String sentenceId, String speaker, Double startTime, Double endTime, String text, String wordsJson) {
        this.video = video;
        this.sentenceId = sentenceId;
        this.speaker = speaker != null ? speaker : "spk_0";
        this.startTime = startTime;
        this.endTime = endTime;
        this.text = text;
        this.wordsJson = wordsJson;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public VideoEntity getVideo() { return video; }
    public void setVideo(VideoEntity video) { this.video = video; }

    public String getSentenceId() { return sentenceId; }
    public void setSentenceId(String sentenceId) { this.sentenceId = sentenceId; }

    public String getSpeaker() { return speaker; }
    public void setSpeaker(String speaker) { this.speaker = speaker; }

    public Double getStartTime() { return startTime; }
    public void setStartTime(Double startTime) { this.startTime = startTime; }

    public Double getEndTime() { return endTime; }
    public void setEndTime(Double endTime) { this.endTime = endTime; }

    public String getText() { return text; }
    public void setText(String text) { this.text = text; }

    public String getWordsJson() { return wordsJson; }
    public void setWordsJson(String wordsJson) { this.wordsJson = wordsJson; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
