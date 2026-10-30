package com.autocut.controller;

import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.dto.Models.TranscriptDTO;
import com.autocut.entity.VideoEntity;
import com.autocut.repository.VideoRepository;
import com.autocut.service.CacheService;
import com.autocut.service.CloudflareR2Service;
import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

class VideoControllerTest {

    private ConfigService configService;
    private CacheService cacheService;
    private CloudflareR2Service r2Service;
    private VideoRepository videoRepository;
    private VideoController controller;

    @BeforeEach
    void setUp() {
        configService = new ConfigService();
        cacheService = new CacheService();
        r2Service = Mockito.mock(CloudflareR2Service.class);
        videoRepository = Mockito.mock(VideoRepository.class);
        controller = new VideoController(cacheService, configService, r2Service, videoRepository);
    }

    @Test
    void testGetMockSegments() {
        ResponseEntity<SegmentsDTO> response = controller.getMockSegments();
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertFalse(response.getBody().segments().isEmpty());
    }

    @Test
    void testGetMockTranscript() {
        ResponseEntity<TranscriptDTO> response = controller.getMockTranscript();
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertFalse(response.getBody().sentences().isEmpty());
    }

    @Test
    void testGetConfig() {
        ResponseEntity<Map<String, Object>> response = controller.getConfig();
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
    }

    @Test
    void testRenderSegments() {
        SegmentsDTO dto = new SegmentsDTO("test.mp4", "test_lesson", "guided", true, Collections.emptyList());
        ResponseEntity<?> response = controller.renderSegments(dto);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    @Test
    void testListVideos() {
        Mockito.when(videoRepository.findAll()).thenReturn(List.of(new VideoEntity("test.mp4", "hash123", "UPLOADED", 1024L)));
        ResponseEntity<List<VideoEntity>> response = controller.listVideos();
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertEquals(1, response.getBody().size());
    }

    @Test
    void testCheckCache() {
        ResponseEntity<?> response = controller.checkCache("non_existent_hash");
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
    }

    @Test
    void testUploadEmptyFile() {
        MockMultipartFile emptyFile = new MockMultipartFile("file", "empty.mp4", "video/mp4", new byte[0]);
        ResponseEntity<?> response = controller.uploadSampleVideo(emptyFile);
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    }

    @Test
    void testAnalyzeVideo() {
        Map<String, Object> req = Map.of(
                "videoName", "Bai05_VongLap.mp4",
                "lesson", "Bai05_VongLap",
                "duration", 300.0
        );
        ResponseEntity<?> response = controller.analyzeVideo(req);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
    }
}
