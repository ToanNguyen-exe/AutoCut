package com.autocut.controller;

import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.dto.Models.TranscriptDTO;
import com.autocut.entity.VideoEntity;
import com.autocut.repository.VideoRepository;
import com.autocut.service.CacheService;
import com.autocut.service.CloudflareR2Service;
import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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

    @Test
    @DisplayName("saveProject should save peaks.json next to segments.json and getPeaks should read it")
    void testSaveProject_AndGetPeaks() throws Exception {
        String testUser = "peaks_user";
        String testLesson = "peaks_lesson";

        Map<String, Object> req = new java.util.HashMap<>();
        req.put("user", testUser);
        req.put("lesson", testLesson);
        req.put("segments", java.util.List.of(Map.of("id", "seg_1", "start", 0.0, "end", 10.0)));
        req.put("peaks", java.util.List.of(0, 25, 80, 100, 40, 10));

        ResponseEntity<?> saveResponse = controller.saveProject(req);
        Assertions.assertEquals(HttpStatus.OK, saveResponse.getStatusCode());

        // Kiểm tra 2 file segments.json và peaks.json được lưu cùng thư mục
        java.nio.file.Path projectRoot = com.autocut.service.PythonRuntime.resolveProjectRoot();
        java.nio.file.Path userDir = projectRoot.resolve("output").resolve("users").resolve(testUser).resolve(testLesson);
        java.nio.file.Path segmentsFile = userDir.resolve("segments.json");
        java.nio.file.Path peaksFile = userDir.resolve("peaks.json");

        Assertions.assertTrue(java.nio.file.Files.exists(segmentsFile), "segments.json phải tồn tại");
        Assertions.assertTrue(java.nio.file.Files.exists(peaksFile), "peaks.json phải tồn tại cạnh segments.json");
        Assertions.assertEquals(segmentsFile.getParent(), peaksFile.getParent());

        // Gọi getPeaks để SV4 lấy dữ liệu thật
        ResponseEntity<?> peaksResponse = controller.getPeaks(testLesson, testUser, null);
        Assertions.assertEquals(HttpStatus.OK, peaksResponse.getStatusCode());
        Assertions.assertNotNull(peaksResponse.getBody());

        com.fasterxml.jackson.databind.JsonNode node = (com.fasterxml.jackson.databind.JsonNode) peaksResponse.getBody();
        Assertions.assertTrue(node.has("peaks"));
        Assertions.assertEquals(6, node.get("peaks").size());
        Assertions.assertEquals(80, node.get("peaks").get(2).asInt());

        // Dọn dẹp tệp test
        java.nio.file.Files.deleteIfExists(peaksFile);
        java.nio.file.Files.deleteIfExists(segmentsFile);
        java.nio.file.Files.deleteIfExists(userDir.resolve("project.json"));
        java.nio.file.Files.deleteIfExists(userDir);
    }

    @Test
    @DisplayName("getPeaks should block path traversal")
    void testGetPeaks_BlockPathTraversal() {
        ResponseEntity<?> res1 = controller.getPeaks("../../.env", "admin", null);
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, res1.getStatusCode());

        ResponseEntity<?> res2 = controller.getPeaks("BaiGiang", "../../admin", null);
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, res2.getStatusCode());
    }

    @Test
    @DisplayName("getPeaks chấp nhận tiêu đề bài học tiếng Việt, không trả 400")
    void testGetPeaks_AcceptsVietnameseLessonTitle() {
        // F20: tiêu đề thật có dấu và khoảng trắng. Trước đây isSafeSlug chặn nên trả 400.
        // Không có peaks.json nên kết quả đúng là 404 — điều cần khẳng định là qua được bước validate.
        ResponseEntity<?> res = controller.getPeaks("Bài giảng Lập trình Web Full khóa (2 Giờ)", "admin", null);
        Assertions.assertEquals(HttpStatus.NOT_FOUND, res.getStatusCode());
    }

    @Test
    @DisplayName("getPeaks chặn đường dẫn tuyệt đối ở tham số video")
    void testGetPeaks_BlocksAbsoluteVideoPath() {
        // F04: resolve thẳng cho phép đọc ngoài uploads bằng path tuyệt đối.
        ResponseEntity<?> res = controller.getPeaks("BaiGiang", "admin", "C:/Windows/win.ini");
        Assertions.assertEquals(HttpStatus.NOT_FOUND, res.getStatusCode());
    }

    @Test
    @DisplayName("getPeaks should return 404 when peaks.json and video are not found")
    void testGetPeaks_NotFound() {
        ResponseEntity<?> res = controller.getPeaks("unknown_lesson_12345", "unknown_user", null);
        Assertions.assertEquals(HttpStatus.NOT_FOUND, res.getStatusCode());
    }

    @Test
    void testSanitizeStemAndSafeSlugPreserveDotsInTitles() {
        String titleWithDot = "YTSave.to_YouTube_Media_NEgDBzHg9_c_Tự-học-JS";
        String filenameWithDot = titleWithDot + ".mp4";

        String stemFromTitle = VideoController.sanitizeStem(titleWithDot);
        String stemFromFile = VideoController.sanitizeStem(filenameWithDot);

        Assertions.assertEquals("ytsave-to_youtube_media_negdbzhg9_c_tu-hoc-js", stemFromFile);
        Assertions.assertEquals(stemFromFile, stemFromTitle);
        Assertions.assertEquals("node-js-co-ban", VideoController.sanitizeStem("Node.js cơ bản"));
        Assertions.assertEquals("bai_test_upload", VideoController.sanitizeStem("bai_test_upload.mp4"));

        String slugFromTitle = VideoController.sanitizeToSafeSlug(titleWithDot);
        Assertions.assertFalse("ytsave".equals(slugFromTitle),
                "sanitizeToSafeSlug không được cắt cụt tên bài chứa dấu chấm thành 'ytsave'");
        Assertions.assertTrue(slugFromTitle.contains("youtube_media"),
                "sanitizeToSafeSlug phải giữ lại phần sau '.to', thực tế: " + slugFromTitle);
    }

    @Test
    void testNormalizeFallbackSentencesDoesNotInjectFakeMusicBeats() {
        List<com.autocut.dto.Models.Sentence> raw = List.of(
                new com.autocut.dto.Models.Sentence("S0001", 5.0, 10.0, "Xin chào các bạn.", null),
                new com.autocut.dto.Models.Sentence("S0002", 25.0, 30.0, "Hôm nay học về biến.", null)
        );

        List<com.autocut.dto.Models.Sentence> normalized = VideoController.normalizeFallbackSentences(raw);

        Assertions.assertEquals(2, normalized.size(), "Không được tự bơm câu Intro Beat / Beat Drop / Outro Fade");
        Assertions.assertEquals("S0001", normalized.get(0).id());
        Assertions.assertEquals("Xin chào các bạn.", normalized.get(0).text());
        Assertions.assertEquals("S0002", normalized.get(1).id());
        Assertions.assertEquals("Hôm nay học về biến.", normalized.get(1).text());
    }

    @Test
    void testUploadWithHyphensUsesCanonicalStemMatchingAnalyze() throws Exception {
        byte[] content = new byte[]{9, 8, 7, 6, 5, 4, 3, 2};
        String original = "YTSave.to_YouTube_Media_NEgDBzHg9_c_Tự-học-JS.mp4";
        MockMultipartFile mediaFile = new MockMultipartFile("file", original, "video/mp4", content);

        ResponseEntity<Map<String, Object>> response = controller.uploadSampleVideo(mediaFile);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());

        String expectedStem = "ytsave-to_youtube_media_negdbzhg9_c_tu-hoc-js";
        String transcriptFile = (String) response.getBody().get("transcript_file");
        String sha256 = (String) response.getBody().get("sha256");

        try {
            Assertions.assertEquals("transcripts/" + expectedStem + "_transcript.json", transcriptFile,
                    "Tên file transcript khi upload phải khớp 100% với stem chuẩn của analyze/Python để không sinh 2 file!");
        } finally {
            Files.deleteIfExists(Paths.get("..", "transcripts", expectedStem + "_transcript.json"));
            Files.deleteIfExists(Paths.get("transcripts", expectedStem + "_transcript.json"));
            Files.deleteIfExists(Paths.get("..", "transcripts", "ytsave_to_youtube_media_negdbzhg9_c_tu_hoc_js_transcript.json"));
            Files.deleteIfExists(Paths.get("transcripts", "ytsave_to_youtube_media_negdbzhg9_c_tu_hoc_js_transcript.json"));
            if (sha256 != null) {
                Files.deleteIfExists(Paths.get("..", "uploads", sha256 + "_" + expectedStem + ".mp4"));
                Files.deleteIfExists(Paths.get("uploads", sha256 + "_" + expectedStem + ".mp4"));
                Files.deleteIfExists(Paths.get("..", "uploads", sha256 + "_ytsave_to_youtube_media_negdbzhg9_c_tu_hoc_js.mp4"));
                Files.deleteIfExists(Paths.get("uploads", sha256 + "_ytsave_to_youtube_media_negdbzhg9_c_tu_hoc_js.mp4"));
            }
        }
    }

    @Test
    void testMergeSelectedClips_InvalidSegments_ReturnsBadRequest() {
        ResponseEntity<?> emptyRes = controller.mergeSelectedClips(Map.of(
                "videoName", "test.mp4",
                "segments", List.of()
        ));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, emptyRes.getStatusCode());

        ResponseEntity<?> singleRes = controller.mergeSelectedClips(Map.of(
                "videoName", "test.mp4",
                "segments", List.of(Map.of("start", 0.0, "end", 10.0))
        ));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, singleRes.getStatusCode());

        ResponseEntity<?> invalidRangeRes = controller.mergeSelectedClips(Map.of(
                "videoName", "test.mp4",
                "segments", List.of(
                        Map.of("start", 10.0, "end", 5.0),
                        Map.of("start", 20.0, "end", 30.0)
                )
        ));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, invalidRangeRes.getStatusCode());
    }

    @Test
    void testMergeSelectedClips_UnsafeLesson_ReturnsBadRequest() {
        ResponseEntity<?> res = controller.mergeSelectedClips(Map.of(
                "videoName", "test.mp4",
                "lesson", "../../.env",
                "segments", List.of(
                        Map.of("start", 0.0, "end", 10.0),
                        Map.of("start", 20.0, "end", 30.0)
                )
        ));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, res.getStatusCode());
    }

    @Test
    void testMergeSelectedClips_ValidNonAdjacentSegmentsAndVietnameseLesson_CutsAndConcats() throws Exception {
        com.autocut.video.VideoCutter mockCutter = Mockito.mock(com.autocut.video.VideoCutter.class);
        com.autocut.video.VideoConcat mockConcat = Mockito.mock(com.autocut.video.VideoConcat.class);
        VideoController mockController = new VideoController(
                cacheService, configService, r2Service, videoRepository, mockCutter, mockConcat
        );

        Mockito.when(mockCutter.cut(
                Mockito.anyString(), Mockito.anyString(), Mockito.anyDouble(), Mockito.anyDouble()
        )).thenAnswer(inv -> com.autocut.video.CutResult.success(
                inv.getArgument(0), inv.getArgument(1),
                inv.getArgument(2), inv.getArgument(3), 50L, 1024L
        ));

        Mockito.when(mockConcat.concat(
                Mockito.anyList(), Mockito.any(java.io.File.class), Mockito.anyBoolean()
        )).thenAnswer(inv -> {
            java.io.File outFile = inv.getArgument(1);
            return com.autocut.video.ConcatResult.success(List.of(), outFile.getAbsolutePath(), 100L, 2048L);
        });

        ResponseEntity<?> res = mockController.mergeSelectedClips(Map.of(
                "videoName", "https://example.com/sample.mp4",
                "lesson", "Bài 08 - Ép kiểu dữ liệu",
                "segments", List.of(
                        Map.of("start", 30.0, "end", 45.0, "topic", "Doan 4"),
                        Map.of("start", 60.0, "end", 75.0, "topic", "Doan 6")
                )
        ));

        Assertions.assertEquals(HttpStatus.OK, res.getStatusCode());
        Assertions.assertNotNull(res.getBody());
        Map<?, ?> body = (Map<?, ?>) res.getBody();
        Assertions.assertEquals("SUCCESS", body.get("status"));
        Assertions.assertEquals(2, body.get("mergedCount"));
        Assertions.assertTrue(String.valueOf(body.get("outputFile")).startsWith("combined/"));
        Assertions.assertTrue(String.valueOf(body.get("downloadUrl")).startsWith("/api/video/download-clip?path="));

        Mockito.verify(mockCutter, Mockito.times(1)).cut(
                Mockito.eq("https://example.com/sample.mp4"), Mockito.anyString(), Mockito.eq(30.0), Mockito.eq(45.0)
        );
        Mockito.verify(mockCutter, Mockito.times(1)).cut(
                Mockito.eq("https://example.com/sample.mp4"), Mockito.anyString(), Mockito.eq(60.0), Mockito.eq(75.0)
        );
        Mockito.verify(mockConcat, Mockito.times(1)).concat(
                Mockito.argThat(list -> list.size() == 2), Mockito.any(java.io.File.class), Mockito.eq(false)
        );
    }

    @Test
    void testMergeSelectedClips_UnknownVideo_ReturnsBadRequestWithoutFallbackToVibeShort() {
        ResponseEntity<?> res = controller.mergeSelectedClips(Map.of(
                "videoName", "khong_ton_tai_99999.mp4",
                "lesson", "BaiTest",
                "segments", List.of(
                        Map.of("start", 0.0, "end", 10.0),
                        Map.of("start", 20.0, "end", 30.0)
                )
        ));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, res.getStatusCode());
        Assertions.assertNotNull(res.getBody());
        String json = String.valueOf(res.getBody());
        Assertions.assertFalse(json.contains("vibe_short"), "Không được âm thầm fallback sang vibe_short.mp4");
    }

    @Test
    void testMergeSelectedClips_StaleHashDoesNotOverrideMatchingVideoName() throws Exception {
        java.nio.file.Path uploadsDir = Paths.get("uploads");
        java.nio.file.Path publicDir = Paths.get("frontend", "public", "videos");
        if (!Files.exists(publicDir)) {
            publicDir = Paths.get("..", "frontend", "public", "videos");
        }
        Files.createDirectories(uploadsDir);
        String staleHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        java.nio.file.Path staleFile = uploadsDir.resolve(staleHash + "_stale_other.mp4");
        java.nio.file.Path expectedTarget = publicDir.resolve("Bai08_Ep_kieu_du_lieu.mp4");
        Assumptions.assumeTrue(Files.isRegularFile(expectedTarget), "Cần file mẫu Bai08_Ep_kieu_du_lieu.mp4");
        Files.write(staleFile, new byte[]{1, 2, 3});

        try {
            com.autocut.video.VideoCutter mockCutter = Mockito.mock(com.autocut.video.VideoCutter.class);
            com.autocut.video.VideoConcat mockConcat = Mockito.mock(com.autocut.video.VideoConcat.class);
            VideoController mockController = new VideoController(
                    cacheService, configService, r2Service, videoRepository, mockCutter, mockConcat
            );
            Mockito.when(mockCutter.cutExact(Mockito.any(java.io.File.class), Mockito.any(java.io.File.class), Mockito.anyDouble(), Mockito.anyDouble()))
                    .thenAnswer(inv -> com.autocut.video.CutResult.success(
                            inv.getArgument(0).toString(), inv.getArgument(1).toString(),
                            inv.getArgument(2), inv.getArgument(3), 10L, 100L));
            Mockito.when(mockConcat.concat(Mockito.anyList(), Mockito.any(java.io.File.class), Mockito.anyBoolean()))
                    .thenAnswer(inv -> com.autocut.video.ConcatResult.success(
                            List.of(), ((java.io.File) inv.getArgument(1)).getAbsolutePath(), 10L, 200L));

            ResponseEntity<?> res = mockController.mergeSelectedClips(Map.of(
                    "videoName", "Bai08_Ep_kieu_du_lieu.mp4",
                    "videoHash", staleHash,
                    "lesson", "Bài 08",
                    "segments", List.of(
                            Map.of("start", 0.0, "end", 10.0),
                            Map.of("start", 20.0, "end", 30.0)
                    )
            ));

            Assertions.assertEquals(HttpStatus.OK, res.getStatusCode());
            Mockito.verify(mockCutter, Mockito.times(2)).cutExact(
                    Mockito.argThat((java.io.File src) -> src.getName().endsWith("Bai08_Ep_kieu_du_lieu.mp4")),
                    Mockito.any(java.io.File.class),
                    Mockito.anyDouble(),
                    Mockito.anyDouble()
            );
        } finally {
            Files.deleteIfExists(staleFile);
        }
    }

    @Test
    void testMergeSelectedClips_PerSegmentSourcesAcrossJoinedVideos_UsesEachSourceAndReencodes() {
        com.autocut.video.VideoCutter mockCutter = Mockito.mock(com.autocut.video.VideoCutter.class);
        com.autocut.video.VideoConcat mockConcat = Mockito.mock(com.autocut.video.VideoConcat.class);
        VideoController mockController = new VideoController(
                cacheService, configService, r2Service, videoRepository, mockCutter, mockConcat
        );
        Mockito.when(mockCutter.cut(Mockito.anyString(), Mockito.anyString(), Mockito.anyDouble(), Mockito.anyDouble()))
                .thenAnswer(inv -> com.autocut.video.CutResult.success(
                        inv.getArgument(0), inv.getArgument(1),
                        inv.getArgument(2), inv.getArgument(3), 10L, 100L));
        Mockito.when(mockConcat.concat(Mockito.anyList(), Mockito.any(java.io.File.class), Mockito.anyBoolean()))
                .thenAnswer(inv -> com.autocut.video.ConcatResult.success(
                        List.of(), ((java.io.File) inv.getArgument(1)).getAbsolutePath(), 10L, 200L));

        ResponseEntity<?> res = mockController.mergeSelectedClips(Map.of(
                "videoName", "Bai08.mp4 & Bai07.mp4",
                "lesson", "Nối tiếp",
                "segments", List.of(
                        Map.of("start", 5.0, "end", 20.0, "videoUrl", "https://example.com/v1.mp4"),
                        Map.of("start", 10.0, "end", 30.0, "videoUrl", "https://example.com/v2.mp4")
                )
        ));

        Assertions.assertEquals(HttpStatus.OK, res.getStatusCode());
        Mockito.verify(mockCutter).cut(Mockito.eq("https://example.com/v1.mp4"), Mockito.anyString(), Mockito.eq(5.0), Mockito.eq(20.0));
        Mockito.verify(mockCutter).cut(Mockito.eq("https://example.com/v2.mp4"), Mockito.anyString(), Mockito.eq(10.0), Mockito.eq(30.0));
        Mockito.verify(mockConcat).concat(Mockito.argThat(l -> l.size() == 2), Mockito.any(java.io.File.class), Mockito.eq(true));
    }

    @Test
    void testRenderSegments_ResolvesHashedUploadAndColonLessonAndDoesNotFallbackToVibeShort() throws Exception {
        java.nio.file.Path uploadsDir = Paths.get("uploads");
        Files.createDirectories(uploadsDir);
        String validHash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        java.nio.file.Path uploadedFile = uploadsDir.resolve(validHash + "_desktop_clip.mp4");
        Files.write(uploadedFile, new byte[]{1, 2, 3, 4});

        try {
            com.autocut.video.VideoCutter mockCutter = Mockito.mock(com.autocut.video.VideoCutter.class);
            com.autocut.video.VideoConcat mockConcat = Mockito.mock(com.autocut.video.VideoConcat.class);
            VideoController mockController = new VideoController(
                    cacheService, configService, r2Service, videoRepository, mockCutter, mockConcat
            );
            Mockito.when(mockCutter.cut(Mockito.anyString(), Mockito.anyString(), Mockito.anyDouble(), Mockito.anyDouble()))
                    .thenAnswer(inv -> com.autocut.video.CutResult.success(
                            inv.getArgument(0), inv.getArgument(1),
                            inv.getArgument(2), inv.getArgument(3), 15L, 512L));

            ResponseEntity<?> res = mockController.renderSegments(Map.of(
                    "video", "Desktop Clip.mp4",
                    "videoHash", validHash,
                    "lesson", "Video: 14:30",
                    "autoConcat", false,
                    "segments", List.of(Map.of(
                            "slug", "doan-1",
                            "parts", List.of(Map.of("part", 1, "start", 0.0, "end", 10.0, "file", "01_Video/01_doan-1.mp4"))
                    ))
            ));

            Assertions.assertEquals(HttpStatus.OK, res.getStatusCode());
            Mockito.verify(mockCutter).cut(
                    Mockito.argThat(src -> src.endsWith(validHash + "_desktop_clip.mp4")),
                    Mockito.anyString(),
                    Mockito.eq(0.0),
                    Mockito.eq(10.0)
            );
            Mockito.verifyNoInteractions(mockConcat);
        } finally {
            Files.deleteIfExists(uploadedFile);
            Path createdOut = Paths.get("output", "Video_ 14_30");
            if (!Files.exists(createdOut)) {
                createdOut = Paths.get("..", "output", "Video_ 14_30");
            }
            if (Files.exists(createdOut)) {
                try (var s = Files.walk(createdOut)) {
                    s.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                        try { Files.deleteIfExists(p); } catch (Exception ignored) {}
                    });
                }
            }
        }
    }

    @Test
    void testRenderSegments_UnknownSourceAndAllCutsFailed_ReturnErrors() {
        ResponseEntity<?> missingRes = controller.renderSegments(Map.of(
                "video", "khong_ton_tai_export_999.mp4",
                "lesson", "BaiTestExport",
                "segments", List.of(Map.of("slug", "s1", "start", 0.0, "end", 10.0))
        ));
        Assertions.assertEquals(HttpStatus.BAD_REQUEST, missingRes.getStatusCode());
        Assertions.assertFalse(String.valueOf(missingRes.getBody()).contains("vibe_short"));

        com.autocut.video.VideoCutter failingCutter = Mockito.mock(com.autocut.video.VideoCutter.class);
        Mockito.when(failingCutter.cut(Mockito.anyString(), Mockito.anyString(), Mockito.anyDouble(), Mockito.anyDouble()))
                .thenReturn(com.autocut.video.CutResult.failure(
                        "src", "out", 0.0, 10.0, 10L,
                        com.autocut.video.ErrorCode.CUT_FAILED, "FFmpeg exit 1"));
        VideoController failingController = new VideoController(
                cacheService, configService, r2Service, videoRepository, failingCutter
        );
        ResponseEntity<?> failRes = failingController.renderSegments(Map.of(
                "video", "https://example.com/real.mp4",
                "lesson", "BaiTestFail",
                "segments", List.of(Map.of("slug", "s1", "start", 0.0, "end", 10.0))
        ));
        Assertions.assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, failRes.getStatusCode());
        Assertions.assertTrue(String.valueOf(failRes.getBody()).contains("FFmpeg exit 1"));
    }
}
