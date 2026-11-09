package com.autocut.controller;

import com.autocut.repository.VideoRepository;
import com.autocut.service.CacheService;
import com.autocut.service.CloudflareR2Service;
import com.autocut.service.ConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

class SaveProjectTest {

    private ConfigService configService;
    private CacheService cacheService;
    private CloudflareR2Service r2Service;
    private VideoRepository videoRepository;
    private VideoController controller;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        configService = new ConfigService();
        cacheService = new CacheService();
        r2Service = Mockito.mock(CloudflareR2Service.class);
        videoRepository = Mockito.mock(VideoRepository.class);
        controller = new VideoController(cacheService, configService, r2Service, videoRepository);

        when(r2Service.uploadFile(any(Path.class), anyString()))
                .thenReturn("https://pub-603b1f9629e046de80cf86f3f046ca84.r2.dev/autocut/users/test/project.json");
    }

    @AfterEach
    void tearDown() throws IOException {
        Path testOutputDir = Paths.get("output", "users");
        if (Files.exists(testOutputDir)) {
            // Dọn dẹp các thư mục test sinh ra trong ca kiểm thử
            for (String testUser : List.of("test_u01", "test_u02", "____test_hack___")) {
                Path uDir = testOutputDir.resolve(testUser);
                if (Files.exists(uDir)) {
                    Files.walk(uDir)
                            .sorted(Comparator.reverseOrder())
                            .map(Path::toFile)
                            .forEach(File::delete);
                }
            }
        }
    }

    @Test
    @DisplayName("1. Lưu dự án thành công: tạo đủ project.json, segments.json và trả về HTTP 200")
    void testSaveProjectSuccess() throws Exception {
        Map<String, Object> payload = Map.of(
                "user", "test_u01",
                "lesson", "Bai05_VongLap",
                "video", "vibe_short.mp4",
                "duration", 120.0,
                "segments", List.of(
                        Map.of("id", "seg01", "topic", "Vòng lặp for", "start", 0.0, "end", 45.0)
                )
        );

        ResponseEntity<?> response = controller.saveProject(payload);

        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());

        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        Assertions.assertEquals("SAVED", body.get("status"));
        Assertions.assertTrue(body.containsKey("cloudUrl"));

        Path projectFile = Paths.get("output", "users", "test_u01", "Bai05_VongLap", "project.json");
        Path segmentsFile = Paths.get("output", "users", "test_u01", "Bai05_VongLap", "segments.json");

        Assertions.assertTrue(Files.exists(projectFile), "Tệp project.json phải được tạo trên đĩa");
        Assertions.assertTrue(Files.exists(segmentsFile), "Tệp segments.json phải được tạo trên đĩa");

        // Kiểm tra nội dung project.json
        Map<?, ?> readMeta = objectMapper.readValue(projectFile.toFile(), Map.class);
        Assertions.assertEquals("test_u01", readMeta.get("user"));
        Assertions.assertEquals("2.0", readMeta.get("schemaVersion"));
        Assertions.assertNotNull(readMeta.get("savedAt"));
    }

    @Test
    @DisplayName("2. Kiểm thử phân lập người dùng: u01 và u02 lưu cùng tên bài không bị đè dữ liệu")
    void testSaveProjectUserIsolation() throws Exception {
        Map<String, Object> payload1 = Map.of(
                "user", "test_u01",
                "lesson", "ChungTenBai",
                "video", "vid1.mp4",
                "customNote", "Ghi chú của u01"
        );
        Map<String, Object> payload2 = Map.of(
                "user", "test_u02",
                "lesson", "ChungTenBai",
                "video", "vid2.mp4",
                "customNote", "Ghi chú của u02"
        );

        controller.saveProject(payload1);
        controller.saveProject(payload2);

        Path p1 = Paths.get("output", "users", "test_u01", "ChungTenBai", "project.json");
        Path p2 = Paths.get("output", "users", "test_u02", "ChungTenBai", "project.json");

        Assertions.assertTrue(Files.exists(p1));
        Assertions.assertTrue(Files.exists(p2));

        Map<?, ?> read1 = objectMapper.readValue(p1.toFile(), Map.class);
        Map<?, ?> read2 = objectMapper.readValue(p2.toFile(), Map.class);

        Assertions.assertEquals("Ghi chú của u01", read1.get("customNote"));
        Assertions.assertEquals("Ghi chú của u02", read2.get("customNote"));
    }

    @Test
    @DisplayName("3. Tự động làm sạch tên người dùng và bài giảng có ký tự đặc biệt nguy hiểm")
    void testSaveProjectSanitize() {
        Map<String, Object> payload = Map.of(
                "user", "../../test:hack/?*",
                "lesson", "Bài Giảng 01: C/C++",
                "video", "test.mp4"
        );

        ResponseEntity<?> response = controller.saveProject(payload);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());

        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        Assertions.assertEquals("SAVED", body.get("status"));
    }
}
