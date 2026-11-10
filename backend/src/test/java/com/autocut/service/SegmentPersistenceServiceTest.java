package com.autocut.service;

import com.autocut.dto.Models.*;
import com.autocut.entity.*;
import com.autocut.repository.*;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

@DisplayName("Kiểm thử Thẻ 3.4 - Lưu phân đoạn vào Database Neon Postgres (SegmentPersistenceService)")
class SegmentPersistenceServiceTest {

    private VideoRepository videoRepository;
    private SectionRepository sectionRepository;
    private TopicRepository topicRepository;
    private VideoPartRepository videoPartRepository;
    private TranscriptRepository transcriptRepository;
    private SegmentPersistenceService persistenceService;

    @BeforeEach
    void setUp() {
        videoRepository = mock(VideoRepository.class);
        sectionRepository = mock(SectionRepository.class);
        topicRepository = mock(TopicRepository.class);
        videoPartRepository = mock(VideoPartRepository.class);
        transcriptRepository = mock(TranscriptRepository.class);

        persistenceService = new SegmentPersistenceService(
                videoRepository,
                sectionRepository,
                topicRepository,
                videoPartRepository,
                transcriptRepository
        );
    }

    @Test
    @DisplayName("1. Lưu phân đoạn vào sections, topics và video_parts thành công")
    void testSaveSegmentsSuccess() {
        VideoEntity mockVideo = new VideoEntity("Bai05_VongLap.mp4", "hash123", "UPLOADED", 1024L);
        mockVideo.setId(10L);
        when(videoRepository.findById(10L)).thenReturn(Optional.of(mockVideo));
        when(sectionRepository.findByVideoIdOrderByPositionAsc(10L)).thenReturn(new ArrayList<>());

        List<Segment> segments = List.of(
                new Segment(
                        "seg_1", 1, "01_LyThuyet", 1, "Cú pháp th:each", "cu_phap_th_each",
                        "S0001", "S0005", 0.0, 10.0,
                        List.of(new VideoPart(1, 0.0, 10.0, "cuts/part_1.mp4"))
                ),
                new Segment(
                        "seg_2", 1, "01_LyThuyet", 2, "Biến lặp th:each", "bien_lap_th_each",
                        "S0006", "S0010", 10.0, 20.0, null
                )
        );

        int totalTopics = persistenceService.saveSegmentsToDatabase(10L, segments);
        Assertions.assertEquals(2, totalTopics);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<SectionEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(sectionRepository).saveAll(captor.capture());

        List<SectionEntity> savedSections = captor.getValue();
        Assertions.assertEquals(1, savedSections.size());
        SectionEntity sec = savedSections.get(0);
        Assertions.assertEquals("01_LyThuyet", sec.getLabel());
        Assertions.assertEquals(2, sec.getTopics().size());

        TopicEntity t1 = sec.getTopics().get(0);
        Assertions.assertEquals("Cú pháp th:each", t1.getTitle());
        Assertions.assertEquals("ACTIVE", t1.getStatus());
        Assertions.assertEquals(1, t1.getParts().size());

        verify(videoRepository).save(mockVideo);
        Assertions.assertTrue(mockVideo.getReviewed());
    }

    @Test
    @DisplayName("2. Nạp lại phân đoạn từ Database thành SegmentsDTO")
    void testGetSegmentsFromDatabase() {
        VideoEntity mockVideo = new VideoEntity("test.mp4", "hash_test", "UPLOADED", 500L);
        mockVideo.setId(20L);
        mockVideo.setReviewed(true);
        when(videoRepository.findById(20L)).thenReturn(Optional.of(mockVideo));

        SectionEntity sec = new SectionEntity(mockVideo, 1, 1, "01_TongQuan");
        sec.setId(100L);
        when(sectionRepository.findByVideoIdOrderByPositionAsc(20L)).thenReturn(List.of(sec));

        TopicEntity top = new TopicEntity(sec, 1, 1, "Giới thiệu biến", "gioi_thieu_bien", "S0001", "S0003", 0.0, 15.0);
        top.setId(200L);
        when(topicRepository.findBySectionIdOrderByPositionAsc(100L)).thenReturn(List.of(top));

        VideoPartEntity part = new VideoPartEntity(top, 1, 0.0, 15.0, "cuts/clip1.mp4", "https://r2.dev/clip1.mp4", 1000L, "COMPLETED");
        when(videoPartRepository.findByTopicIdOrderByPartNoAsc(200L)).thenReturn(List.of(part));

        SegmentsDTO dto = persistenceService.getSegmentsFromDatabase(20L);
        Assertions.assertNotNull(dto);
        Assertions.assertEquals("test.mp4", dto.video());
        Assertions.assertTrue(dto.reviewed());
        Assertions.assertEquals(1, dto.segments().size());

        Segment s = dto.segments().get(0);
        Assertions.assertEquals("Giới thiệu biến", s.topic());
        Assertions.assertEquals(0.0, s.start());
        Assertions.assertEquals(15.0, s.end());
        Assertions.assertEquals(1, s.parts().size());
    }

    @Test
    @DisplayName("3. Lưu và nạp transcript từ bảng transcripts")
    void testSaveAndGetTranscript() {
        VideoEntity mockVideo = new VideoEntity("trans.mp4", "hash_trans", "UPLOADED", 2000L);
        mockVideo.setId(30L);
        mockVideo.setDuration(12.5);
        when(videoRepository.findById(30L)).thenReturn(Optional.of(mockVideo));
        when(transcriptRepository.findByVideoIdOrderByStartTimeAsc(30L)).thenReturn(new ArrayList<>());

        TranscriptDTO dto = new TranscriptDTO("trans.mp4", 12.5, List.of(
                new Sentence("S0001", 0.0, 5.0, "Xin chào các bạn", null),
                new Sentence("S0002", 5.0, 12.5, "Hôm nay chúng ta học vòng lặp", null)
        ));

        int savedSentences = persistenceService.saveTranscriptToDatabase(30L, dto);
        Assertions.assertEquals(2, savedSentences);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<TranscriptEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(transcriptRepository).saveAll(captor.capture());
        Assertions.assertEquals(2, captor.getValue().size());

        // Test nạp lại
        when(transcriptRepository.findByVideoIdOrderByStartTimeAsc(30L)).thenReturn(captor.getValue());
        TranscriptDTO loaded = persistenceService.getTranscriptFromDatabase(30L);
        Assertions.assertNotNull(loaded);
        Assertions.assertEquals(2, loaded.sentences().size());
        Assertions.assertEquals("Xin chào các bạn", loaded.sentences().get(0).text());
    }

    @Test
    @DisplayName("4. Tra cứu Video bằng ID, Hash hoặc Tên file")
    void testFindVideo() {
        VideoEntity v = new VideoEntity("vibe.mp4", "sha_vibe_999", "UPLOADED", 100L);
        v.setId(99L);
        when(videoRepository.findById(99L)).thenReturn(Optional.of(v));
        when(videoRepository.findBySha256Hash("sha_vibe_999")).thenReturn(Optional.of(v));
        when(videoRepository.findAll()).thenReturn(List.of(v));

        Assertions.assertTrue(persistenceService.findVideo("99").isPresent());
        Assertions.assertTrue(persistenceService.findVideo("sha_vibe_999").isPresent());
        Assertions.assertTrue(persistenceService.findVideo("vibe.mp4").isPresent());
        Assertions.assertTrue(persistenceService.findVideo("not_exist.mp4").isEmpty());
    }
}
