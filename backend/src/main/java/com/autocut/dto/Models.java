package com.autocut.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class Models {

    // --- B2: transcript.json ---
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record WordInfo(
        @JsonProperty("word") String word,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Sentence(
        @JsonProperty("id") String id,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("text") String text,
        @JsonProperty("words") List<WordInfo> words
    ) {
        public Sentence(String id, double start, double end, String text) {
            this(id, start, end, text, null);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TranscriptDTO(
        @JsonProperty("video") String video,
        @JsonProperty("duration") double duration,
        @JsonProperty("sentences") List<Sentence> sentences
    ) {}

    // --- B3: cut_points.json ---
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CutPoint(
        @JsonProperty("after_id") String afterId,
        @JsonProperty("time") double time,
        @JsonProperty("score") int score,
        @JsonProperty("reasons") List<String> reasons
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CutPointsDTO(
        @JsonProperty("cut_points") List<CutPoint> cutPoints
    ) {}

    // --- B4: llm_raw.json ---
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TopicLLM(
        @JsonProperty("title") String title,
        @JsonProperty("slug") String slug,
        @JsonProperty("start_id") String startId,
        @JsonProperty("end_id") String endId
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SectionLLM(
        @JsonProperty("label") String label,
        @JsonProperty("topics") List<TopicLLM> topics
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LLMRawDTO(
        @JsonProperty("sections") List<SectionLLM> sections
    ) {}

    // --- B8 / B9 / B10: segments.json ---
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record VideoPart(
        @JsonProperty("part") int part,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("file") String file
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Segment(
        @JsonProperty("id") String id,
        @JsonProperty("section_no") @JsonAlias("sectionNo") int sectionNo,
        @JsonProperty("section") String section,
        @JsonProperty("topic_no") @JsonAlias("topicNo") int topicNo,
        @JsonProperty("topic") String topic,
        @JsonProperty("slug") String slug,
        @JsonProperty("start_id") @JsonAlias("startId") String startId,
        @JsonProperty("end_id") @JsonAlias("endId") String endId,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("parts") List<VideoPart> parts
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SegmentsDTO(
        @JsonProperty("video") String video,
        @JsonProperty("lesson") String lesson,
        @JsonProperty("mode") String mode,
        @JsonProperty("reviewed") boolean reviewed,
        @JsonProperty("segments") List<Segment> segments
    ) {}

    // --- Card 3.3: Async Batch Cut Job ---
    public enum CutJobStatus {
        QUEUED,
        PROCESSING,
        COMPLETED,
        FAILED
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CutClipInfo(
        @JsonProperty("index") int index,
        @JsonProperty("name") String name,
        @JsonProperty("topic") String topic,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("padded_start") @JsonAlias("paddedStart") double paddedStart,
        @JsonProperty("padded_end") @JsonAlias("paddedEnd") double paddedEnd,
        @JsonProperty("file_size_bytes") @JsonAlias("fileSizeBytes") long fileSizeBytes,
        @JsonProperty("execution_time_ms") @JsonAlias("executionTimeMs") long executionTimeMs,
        @JsonProperty("url") String url,
        @JsonProperty("local_path") @JsonAlias("localPath") String localPath
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CutJobResponse(
        @JsonProperty("job_id") @JsonAlias("jobId") String jobId,
        @JsonProperty("status") CutJobStatus status,
        @JsonProperty("current") int current,
        @JsonProperty("total") int total,
        @JsonProperty("percent") int percent,
        @JsonProperty("message") String message,
        @JsonProperty("clips") List<CutClipInfo> clips,
        @JsonProperty("chapters_url") @JsonAlias("chaptersUrl") String chaptersUrl,
        @JsonProperty("report_url") @JsonAlias("reportUrl") String reportUrl,
        @JsonProperty("error") String error
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CutRequestDTO(
        @JsonProperty("user") String user,
        @JsonProperty("lesson") String lesson,
        @JsonProperty("video_name") @JsonAlias({"video", "videoName", "fileName"}) String videoName,
        @JsonProperty("total_duration") @JsonAlias({"totalDuration", "duration"}) double totalDuration,
        @JsonProperty("segments") List<Segment> segments
    ) {}
}
