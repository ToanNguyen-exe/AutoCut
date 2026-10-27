package com.autocut.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class Models {

    // --- B2: transcript.json ---
    public record WordInfo(
        @JsonProperty("word") String word,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end
    ) {}

    public record Sentence(
        @JsonProperty("id") String id,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("text") String text,
        @JsonProperty("words") List<WordInfo> words
    ) {}

    public record TranscriptDTO(
        @JsonProperty("video") String video,
        @JsonProperty("duration") double duration,
        @JsonProperty("sentences") List<Sentence> sentences
    ) {}

    // --- B3: cut_points.json ---
    public record CutPoint(
        @JsonProperty("after_id") String afterId,
        @JsonProperty("time") double time,
        @JsonProperty("score") int score,
        @JsonProperty("reasons") List<String> reasons
    ) {}

    public record CutPointsDTO(
        @JsonProperty("cut_points") List<CutPoint> cutPoints
    ) {}

    // --- B4: llm_raw.json ---
    public record TopicLLM(
        @JsonProperty("title") String title,
        @JsonProperty("slug") String slug,
        @JsonProperty("start_id") String startId,
        @JsonProperty("end_id") String endId
    ) {}

    public record SectionLLM(
        @JsonProperty("label") String label,
        @JsonProperty("topics") List<TopicLLM> topics
    ) {}

    public record LLMRawDTO(
        @JsonProperty("sections") List<SectionLLM> sections
    ) {}

    // --- B8 / B9 / B10: segments.json ---
    public record VideoPart(
        @JsonProperty("part") int part,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("file") String file
    ) {}

    public record Segment(
        @JsonProperty("id") String id,
        @JsonProperty("section_no") int sectionNo,
        @JsonProperty("section") String section,
        @JsonProperty("topic_no") int topicNo,
        @JsonProperty("topic") String topic,
        @JsonProperty("slug") String slug,
        @JsonProperty("start_id") String startId,
        @JsonProperty("end_id") String endId,
        @JsonProperty("start") double start,
        @JsonProperty("end") double end,
        @JsonProperty("parts") List<VideoPart> parts
    ) {}

    public record SegmentsDTO(
        @JsonProperty("video") String video,
        @JsonProperty("lesson") String lesson,
        @JsonProperty("mode") String mode,
        @JsonProperty("reviewed") boolean reviewed,
        @JsonProperty("segments") List<Segment> segments
    ) {}
}
