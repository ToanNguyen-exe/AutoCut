package com.autocut.service;

import com.autocut.dto.Models.*;
import com.autocut.entity.*;
import com.autocut.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * Service lưu trữ và truy vấn phân đoạn bài giảng vào Cơ sở dữ liệu Neon Postgres (Thẻ 3.4).
 * Quản lý tính toàn vẹn giữa các bảng: videos -> sections -> topics -> video_parts, và transcripts.
 */
@Service
public class SegmentPersistenceService {

    private static final Logger log = LoggerFactory.getLogger(SegmentPersistenceService.class);

    private final VideoRepository videoRepository;
    private final SectionRepository sectionRepository;
    private final TopicRepository topicRepository;
    private final VideoPartRepository videoPartRepository;
    private final TranscriptRepository transcriptRepository;
    private final ObjectMapper objectMapper;

    @Autowired
    public SegmentPersistenceService(
            VideoRepository videoRepository,
            SectionRepository sectionRepository,
            TopicRepository topicRepository,
            VideoPartRepository videoPartRepository,
            TranscriptRepository transcriptRepository) {
        this.videoRepository = videoRepository;
        this.sectionRepository = sectionRepository;
        this.topicRepository = topicRepository;
        this.videoPartRepository = videoPartRepository;
        this.transcriptRepository = transcriptRepository;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Tra cứu VideoEntity theo ID, SHA-256 hash hoặc tên file.
     */
    public Optional<VideoEntity> findVideo(String query) {
        if (query == null || query.isBlank()) {
            return Optional.empty();
        }
        try {
            long id = Long.parseLong(query.trim());
            Optional<VideoEntity> byId = videoRepository.findById(id);
            if (byId.isPresent()) return byId;
        } catch (NumberFormatException ignored) {}

        Optional<VideoEntity> byHash = videoRepository.findBySha256Hash(query.trim());
        if (byHash.isPresent()) return byHash;

        for (VideoEntity v : videoRepository.findAll()) {
            if (query.equalsIgnoreCase(v.getFileName())) {
                return Optional.of(v);
            }
        }
        return Optional.empty();
    }

    /**
     * Lưu danh sách các phân đoạn hoàn chỉnh vào Database Neon Postgres (Thẻ 3.4).
     * Thực hiện xóa sạch cấu trúc cũ của video trước khi chèn mới để tránh trùng lặp.
     */
    @Transactional
    public int saveSegmentsToDatabase(Long videoId, List<Segment> segments) {
        if (videoId == null || segments == null || segments.isEmpty()) {
            log.warn("Bỏ qua lưu DB: videoId null hoặc segments rỗng");
            return 0;
        }

        VideoEntity video = videoRepository.findById(videoId).orElse(null);
        if (video == null) {
            log.error("Không tìm thấy Video với id={}", videoId);
            return 0;
        }

        // 1. Xóa các sections cũ (cascade sẽ xóa topics và video_parts)
        List<SectionEntity> oldSections = sectionRepository.findByVideoIdOrderByPositionAsc(videoId);
        if (!oldSections.isEmpty()) {
            sectionRepository.deleteAll(oldSections);
            sectionRepository.flush();
        }

        // 2. Nhóm các segment theo nhãn section
        Map<String, List<Segment>> grouped = new LinkedHashMap<>();
        for (Segment seg : segments) {
            String secLabel = seg.section();
            if (secLabel == null || secLabel.isBlank()) {
                secLabel = "Phần " + (seg.sectionNo() > 0 ? seg.sectionNo() : 1);
            }
            grouped.computeIfAbsent(secLabel, k -> new ArrayList<>()).add(seg);
        }

        int sectionPos = 1;
        int totalTopics = 0;
        List<SectionEntity> sectionsToSave = new ArrayList<>();

        for (Map.Entry<String, List<Segment>> entry : grouped.entrySet()) {
            String label = entry.getKey();
            List<Segment> segList = entry.getValue();

            int secNo = segList.get(0).sectionNo() > 0 ? segList.get(0).sectionNo() : sectionPos;
            SectionEntity secEntity = new SectionEntity(video, secNo, sectionPos++, label);

            int topicPos = 1;
            for (Segment s : segList) {
                int topNo = s.topicNo() > 0 ? s.topicNo() : topicPos;
                String title = s.topic() != null ? s.topic() : "Chủ đề " + topicPos;
                String slug = s.slug() != null && !s.slug().isBlank() ? s.slug() : ("chu_de_" + topicPos);
                String startId = s.startId() != null ? s.startId() : "S0001";
                String endId = s.endId() != null ? s.endId() : "S0002";
                double start = s.start();
                double end = Math.max(start + 0.1, s.end()); // Ràng buộc end_time > start_time

                TopicEntity topicEntity = new TopicEntity(secEntity, topNo, topicPos++, title, slug, startId, endId, start, end);

                if (s.parts() != null && !s.parts().isEmpty()) {
                    for (VideoPart part : s.parts()) {
                        String r2Key = part.file() != null ? part.file() : "cuts/part_" + part.part() + ".mp4";
                        String cloudUrl = video.getCloudUrl() != null ? video.getCloudUrl() : "";
                        VideoPartEntity partEntity = new VideoPartEntity(
                                topicEntity,
                                part.part(),
                                part.start(),
                                part.end(),
                                r2Key,
                                cloudUrl,
                                0L,
                                "COMPLETED"
                        );
                        topicEntity.addPart(partEntity);
                    }
                }

                secEntity.addTopic(topicEntity);
                totalTopics++;
            }

            sectionsToSave.add(secEntity);
        }

        sectionRepository.saveAll(sectionsToSave);
        video.setReviewed(true);
        videoRepository.save(video);

        log.info("Đã lưu thành công {} sections và {} topics vào Database Neon cho video id={}",
                sectionsToSave.size(), totalTopics, videoId);
        return totalTopics;
    }

    /**
     * Lưu dữ liệu lời thoại Whisper theo từng câu vào bảng transcripts.
     */
    @Transactional
    public int saveTranscriptToDatabase(Long videoId, TranscriptDTO transcriptDTO) {
        if (videoId == null || transcriptDTO == null || transcriptDTO.sentences() == null || transcriptDTO.sentences().isEmpty()) {
            return 0;
        }

        VideoEntity video = videoRepository.findById(videoId).orElse(null);
        if (video == null) {
            return 0;
        }

        List<TranscriptEntity> old = transcriptRepository.findByVideoIdOrderByStartTimeAsc(videoId);
        if (!old.isEmpty()) {
            transcriptRepository.deleteAll(old);
            transcriptRepository.flush();
        }

        List<TranscriptEntity> entities = new ArrayList<>();
        for (Sentence s : transcriptDTO.sentences()) {
            String wordsJson = null;
            if (s.words() != null && !s.words().isEmpty()) {
                try {
                    wordsJson = objectMapper.writeValueAsString(s.words());
                } catch (Exception ignored) {}
            }
            entities.add(new TranscriptEntity(video, s.id(), "spk_0", s.start(), s.end(), s.text(), wordsJson));
        }

        transcriptRepository.saveAll(entities);
        log.info("Đã lưu {} câu transcript vào Database cho video id={}", entities.size(), videoId);
        return entities.size();
    }

    /**
     * Nạp lại toàn bộ cấu trúc phân đoạn từ Database Neon theo videoId.
     */
    @Transactional(readOnly = true)
    public SegmentsDTO getSegmentsFromDatabase(Long videoId) {
        VideoEntity video = videoRepository.findById(videoId).orElse(null);
        if (video == null) {
            return null;
        }

        List<SectionEntity> sections = sectionRepository.findByVideoIdOrderByPositionAsc(videoId);
        List<Segment> segmentList = new ArrayList<>();

        int globalIdx = 1;
        for (SectionEntity sec : sections) {
            List<TopicEntity> topics = topicRepository.findBySectionIdOrderByPositionAsc(sec.getId());
            for (TopicEntity t : topics) {
                List<VideoPartEntity> partEntities = videoPartRepository.findByTopicIdOrderByPartNoAsc(t.getId());
                List<VideoPart> parts = new ArrayList<>();
                for (VideoPartEntity pe : partEntities) {
                    parts.add(new VideoPart(pe.getPartNo(), pe.getStartTime(), pe.getEndTime(), pe.getR2Key()));
                }

                segmentList.add(new Segment(
                        "seg_db_" + (t.getId() != null ? t.getId() : globalIdx),
                        sec.getSectionNo(),
                        sec.getLabel(),
                        t.getTopicNo(),
                        t.getTitle(),
                        t.getSlug(),
                        t.getStartId(),
                        t.getEndId(),
                        t.getStartTime(),
                        t.getEndTime(),
                        parts
                ));
                globalIdx++;
            }
        }

        return new SegmentsDTO(
                video.getFileName(),
                video.getFileName(),
                "analyzed",
                Boolean.TRUE.equals(video.getReviewed()),
                segmentList
        );
    }

    /**
     * Nạp lại transcript từ bảng transcripts trong Database theo videoId.
     */
    @Transactional(readOnly = true)
    public TranscriptDTO getTranscriptFromDatabase(Long videoId) {
        VideoEntity video = videoRepository.findById(videoId).orElse(null);
        if (video == null) {
            return null;
        }

        List<TranscriptEntity> rows = transcriptRepository.findByVideoIdOrderByStartTimeAsc(videoId);
        if (rows.isEmpty()) {
            return null;
        }

        List<Sentence> sentences = new ArrayList<>();
        for (TranscriptEntity r : rows) {
            List<WordInfo> words = null;
            if (r.getWordsJson() != null && !r.getWordsJson().isBlank()) {
                try {
                    words = objectMapper.readValue(r.getWordsJson(), objectMapper.getTypeFactory().constructCollectionType(List.class, WordInfo.class));
                } catch (Exception ignored) {}
            }
            sentences.add(new Sentence(r.getSentenceId(), r.getStartTime(), r.getEndTime(), r.getText(), words));
        }

        double duration = video.getDuration() != null ? video.getDuration() : 0.0;
        if (duration <= 0 && !sentences.isEmpty()) {
            duration = sentences.get(sentences.size() - 1).end();
        }

        return new TranscriptDTO(video.getFileName(), duration, sentences);
    }
}
