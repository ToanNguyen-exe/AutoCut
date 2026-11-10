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

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.List;
import java.util.Map;

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
    void testConcatVideos_EmptyClips() {
        ResponseEntity<?> response = controller.concatVideos(Map.of("clips", List.of()));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    }

    @Test
    void testConcatVideos_MissingClips() {
        ResponseEntity<?> response = controller.concatVideos(Map.of(
            "clips", List.of("missing_clip1.mp4", "missing_clip2.mp4"),
            "output", "output/merged_test.mp4"
        ));
        Assertions.assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
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
    void testUploadVideoCreatesTranscriptInDedicatedFolder() throws Exception {
        byte[] content = new byte[]{0, 1, 2, 3, 4, 5, 6, 7};

        MockMultipartFile mediaFile = new MockMultipartFile("file", "bai_test_upload.mp4", "video/mp4", content);
        ResponseEntity<Map<String, Object>> response = controller.uploadSampleVideo(mediaFile);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());

        String transcriptFile = (String) response.getBody().get("transcript_file");
        String sha256 = (String) response.getBody().get("sha256");
        Object transcriptObj = response.getBody().get("transcript");

        Assertions.assertNotNull(transcriptFile, "Response upload phải trả về đường dẫn transcript_file");
        Assertions.assertEquals("transcripts/bai_test_upload_transcript.json", transcriptFile);
        Assertions.assertNotNull(transcriptObj, "Response upload phải trả về đối tượng transcript đã được AI xử lý");

        Path expectedFile = Paths.get("..", "transcripts", "bai_test_upload_transcript.json");
        if (!Files.exists(expectedFile)) {
            expectedFile = Paths.get("transcripts", "bai_test_upload_transcript.json");
        }
        Assertions.assertTrue(Files.exists(expectedFile),
                "File transcripts/bai_test_upload_transcript.json phải được tạo trực tiếp trong thư mục transcripts/ sau khi upload!");

        Path subfolder = Paths.get("..", "transcripts", "bai_test_upload");
        if (!Files.exists(subfolder)) {
            subfolder = Paths.get("transcripts", "bai_test_upload");
        }
        Assertions.assertFalse(Files.exists(subfolder),
                "Hệ thống không được tạo thêm thư mục con riêng của video trong transcripts/!");

        // Dọn dẹp file test sau khi kiểm chứng
        Files.deleteIfExists(expectedFile);
        if (sha256 != null) {
            Files.deleteIfExists(Paths.get("..", "uploads", sha256 + "_bai_test_upload.mp4"));
            Files.deleteIfExists(Paths.get("uploads", sha256 + "_bai_test_upload.mp4"));
            Files.deleteIfExists(Paths.get("cache", sha256 + "_transcript.json"));
        }
    }

    @Test
    void testAnalyzeVideo() {
        Map<String, Object> req = Map.of(
                "videoName", "javascript.mp4",
                "lesson", "javascript",
                "duration", 3427.57
        );
        ResponseEntity<?> response = controller.analyzeVideo(req);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        Assertions.assertEquals("SUCCESS", body.get("status"));
        TranscriptDTO transcript = (TranscriptDTO) body.get("transcript");
        SegmentsDTO segmentsData = (SegmentsDTO) body.get("segmentsData");

        Assertions.assertNotNull(transcript);
        Assertions.assertNotNull(segmentsData);
        Assertions.assertFalse(transcript.sentences().isEmpty());
        Assertions.assertFalse(segmentsData.segments().isEmpty());

        // Đảm bảo dữ liệu trả về từ module AI có mã câu chuẩn S0001..Sxxxx (không phải mock s001..s007)
        Assertions.assertTrue(
                transcript.sentences().get(0).id().matches("^S\\d{4,5}$"),
                "Mã câu từ module AI phải có định dạng S0001, nhận được: " + transcript.sentences().get(0).id()
        );
        Assertions.assertTrue(
                transcript.sentences().size() > 10,
                "Transcript thực tế từ module AI phải chứa đầy đủ các câu đã tách (> 10 câu)"
        );
    }
}
