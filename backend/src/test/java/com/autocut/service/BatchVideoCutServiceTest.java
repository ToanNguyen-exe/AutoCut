package com.autocut.service;

import com.autocut.dto.Models.*;
import com.autocut.video.CutResult;
import com.autocut.video.VideoCutter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@DisplayName("Kiểm thử BatchVideoCutService - Thẻ 3.3")
class BatchVideoCutServiceTest {

    private VideoCutter mockVideoCutter;
    private CloudflareR2Service mockR2Service;
    private ConfigService mockConfigService;
    private ObjectMapper objectMapper;
    private BatchVideoCutService service;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        mockVideoCutter = Mockito.mock(VideoCutter.class);
        mockR2Service = Mockito.mock(CloudflareR2Service.class);
        mockConfigService = Mockito.mock(ConfigService.class);
        objectMapper = new ObjectMapper();

        service = new BatchVideoCutService(mockVideoCutter, mockR2Service, mockConfigService, objectMapper);
    }

    @Test
    @DisplayName("1. Kiểm tra validation khi request không hợp lệ")
    void testSubmitCutJobValidation() {
        assertThrows(IllegalArgumentException.class, () -> service.submitCutJob(null));

        CutRequestDTO reqEmptyVideo = new CutRequestDTO("user", "lesson", "", 60.0, List.of(
            new Segment("seg_1", 1, "01_Phan", 1, "Chu de 1", "chu-de-1", "S0001", "S0005", 0.0, 10.0, null)
        ));
        assertThrows(IllegalArgumentException.class, () -> service.submitCutJob(reqEmptyVideo));

        CutRequestDTO reqEmptySegs = new CutRequestDTO("user", "lesson", "video.mp4", 60.0, List.of());
        assertThrows(IllegalArgumentException.class, () -> service.submitCutJob(reqEmptySegs));
    }

    @Test
    @DisplayName("2. Kiểm tra định dạng thời gian YouTube mm:ss và hh:mm:ss")
    void testFormatTimestamp() {
        assertEquals("00:00", service.formatTimestamp(0.0));
        assertEquals("00:36", service.formatTimestamp(36.14));
        assertEquals("01:05", service.formatTimestamp(65.0));
        assertEquals("01:00:00", service.formatTimestamp(3600.0));
        assertEquals("01:05:25", service.formatTimestamp(3925.0));
    }

    @Test
    @DisplayName("3. Kiểm tra định dạng tệp chapters.txt chuẩn YouTube")
    void testGenerateChaptersContent() {
        List<Segment> segments = List.of(
            new Segment("seg_1", 1, "01_Phan", 1, "Giới thiệu vòng lặp", "gioi-thieu", "S0001", "S0005", 0.0, 36.14, null),
            new Segment("seg_2", 1, "01_Phan", 2, "Cú pháp th:each", "cu-phap", "S0006", "S0010", 36.14, 112.57, null),
            new Segment("seg_3", 1, "01_Phan", 3, "Thực hành trong Controller", "thuc-hanh", "S0011", "S0015", 112.57, 180.0, null)
        );

        String chapters = service.generateChaptersContent(segments);
        assertNotNull(chapters);
        assertTrue(chapters.contains("00:00 - Phần 1: Giới thiệu vòng lặp"));
        assertTrue(chapters.contains("00:36 - Phần 2: Cú pháp th:each"));
        assertTrue(chapters.contains("01:52 - Phần 3: Thực hành trong Controller"));
    }

    @Test
    @DisplayName("4. Kiểm tra cấu trúc dữ liệu tệp báo cáo report.json")
    void testGenerateReportData() throws IOException {
        Path dummyVideo = tempDir.resolve("test_video.mp4");
        Files.writeString(dummyVideo, "video data content");

        BatchVideoCutService.JobState state = new BatchVideoCutService.JobState(
            "job_test_123",
            "test_user",
            "test_lesson",
            "test_video.mp4",
            120.0,
            List.of(
                new Segment("seg_1", 1, "01_Phan", 1, "Chu de 1", "chu-de-1", "S0001", "S0005", 0.0, 50.0, null)
            )
        );

        Map<String, Object> report = service.generateReportData(state, dummyVideo.toFile());
        assertNotNull(report);
        assertEquals("job_test_123", report.get("job_id"));
        assertEquals("test_user", report.get("user"));
        assertEquals("test_lesson", report.get("lesson"));
        assertEquals(1, report.get("total_segments"));

        @SuppressWarnings("unchecked")
        Map<String, Object> ffmpegConfig = (Map<String, Object>) report.get("ffmpeg_config");
        assertNotNull(ffmpegConfig);
        assertEquals("libx264", ffmpegConfig.get("video_codec"));
        assertEquals("+faststart", ffmpegConfig.get("movflags"));
        assertEquals(0.3, ffmpegConfig.get("padding_start_seconds"));
        assertEquals(0.5, ffmpegConfig.get("padding_end_seconds"));
    }

    @Test
    @DisplayName("5. Kiểm tra hàm sanitizeToSafeSlug chống Path Traversal và khử dấu tiếng Việt")
    void testSanitizeToSafeSlug() {
        assertEquals("safe_item", BatchVideoCutService.sanitizeToSafeSlug(""));
        assertEquals("default_user", BatchVideoCutService.sanitizeToSafeSlug("default_user"));
        assertEquals("user_hack", BatchVideoCutService.sanitizeToSafeSlug("../../user_hack/.."));
        assertEquals("Bai_05_Vong_Lap_Thymeleaf", BatchVideoCutService.sanitizeToSafeSlug("Bài 05: Vòng Lặp Thymeleaf!"));
    }

    @Test
    @DisplayName("6. Kiểm tra luồng thực thi cắt video bất đồng bộ và tạo hồ sơ")
    void testAsyncCutJobExecution() throws Exception {
        Path dummySource = tempDir.resolve("sample.mp4");
        Files.writeString(dummySource, "mock mp4 byte stream");

        // Mock videoCutter.cut(...) trả về thành công
        when(mockVideoCutter.cut(any(File.class), any(File.class), anyDouble(), anyDouble(), anyDouble()))
            .thenAnswer(inv -> {
                File out = inv.getArgument(1);
                Files.writeString(out.toPath(), "mock cut output");
                double start = inv.getArgument(2);
                double end = inv.getArgument(3);
                return CutResult.success("sample.mp4", out.getAbsolutePath(), Math.max(0.0, start - 0.3), end + 0.5, 150L, 1024L);
            });

        when(mockR2Service.uploadFile(any(Path.class), anyString()))
            .thenReturn("https://mock-r2.dev/autocut/file.mp4");

        List<Segment> segments = List.of(
            new Segment("seg_1", 1, "01_Phan", 1, "Giới thiệu", "gioi-thieu", "S0001", "S0003", 0.0, 10.0, null),
            new Segment("seg_2", 1, "01_Phan", 2, "Chi tiết", "chi-tiet", "S0004", "S0008", 10.0, 25.0, null)
        );

        CutRequestDTO req = new CutRequestDTO("toan_unit_test", "lesson_async_test", dummySource.toAbsolutePath().toString(), 25.0, segments);
        CutJobResponse initialResp = service.submitCutJob(req);

        assertNotNull(initialResp);
        assertTrue(initialResp.status() == CutJobStatus.QUEUED || initialResp.status() == CutJobStatus.PROCESSING);
        assertEquals(2, initialResp.total());

        // Chờ tác vụ nền hoàn tất (tối đa 5 giây)
        long waitStart = System.currentTimeMillis();
        CutJobResponse finalResp = service.getJobStatus(initialResp.jobId());
        while (finalResp.status() != CutJobStatus.COMPLETED && finalResp.status() != CutJobStatus.FAILED) {
            if (System.currentTimeMillis() - waitStart > 5000) {
                fail("Tác vụ cắt video bị quá thời gian 5s");
            }
            Thread.sleep(100);
            finalResp = service.getJobStatus(initialResp.jobId());
        }

        assertEquals(CutJobStatus.COMPLETED, finalResp.status());
        assertEquals(100, finalResp.percent());
        assertEquals(2, finalResp.clips().size());
        assertEquals(2, finalResp.current());

        // Kiểm tra file chapters.txt và report.json được tạo trên ổ đĩa
        Path lessonDir = Path.of("..", "output", "users", "toan_unit_test", "lesson_async_test");
        if (!Files.exists(lessonDir)) {
            lessonDir = Path.of("output", "users", "toan_unit_test", "lesson_async_test");
        }
        assertTrue(Files.exists(lessonDir.resolve("chapters.txt")), "chapters.txt phải được tạo");
        assertTrue(Files.exists(lessonDir.resolve("report.json")), "report.json phải được tạo");

        // Dọn dẹp thư mục test
        try {
            Files.walk(lessonDir)
                .sorted((a, b) -> b.compareTo(a))
                .forEach(p -> {
                    try { Files.deleteIfExists(p); } catch (Exception ignored) {}
                });
        } catch (Exception ignored) {}
    }
}
