package com.autocut.service;

import com.autocut.dto.Models.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("P05 & P10 / Thẻ 3.2: Kiểm thử thuật toán CutPointService & Boundary Snapping")
class CutPointServiceTest {

    private CutPointService cutPointService;
    private ConfigService configService;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        configService = new ConfigService();
        objectMapper = new ObjectMapper();
        cutPointService = new CutPointService(configService, objectMapper);
    }

    @Test
    @DisplayName("P05: Chấm điểm cơ bản (+1 điểm ranh giới giữa 2 câu)")
    void testCalculateCutPoints_BaseScore() {
        Sentence s1 = new Sentence("S0001", 0.0, 5.0, "Chào các bạn.", null);
        Sentence s2 = new Sentence("S0002", 5.5, 10.0, "Hôm nay chúng ta học tiếp.", null);
        TranscriptDTO transcript = new TranscriptDTO("test.mp4", 10.0, List.of(s1, s2));

        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);
        assertNotNull(cutPoints);
        assertEquals(1, cutPoints.cutPoints().size());

        CutPoint cp = cutPoints.cutPoints().get(0);
        assertEquals("S0001", cp.afterId());
        assertEquals(5.25, cp.time(), 0.01);
        assertEquals(1, cp.score());
        assertTrue(cp.reasons().contains("RANH_GIOI_CO_BAN"));
    }

    @Test
    @DisplayName("P05: Khoảng im lặng >= 1.5s (+2 điểm) và >= 3.0s (+1 điểm)")
    void testCalculateCutPoints_SilenceScoring() {
        // Gap 2.0s (10.0 - 12.0) -> +2 điểm = 3 điểm
        Sentence s1 = new Sentence("S0001", 0.0, 10.0, "Kết thúc phần lý thuyết.", null);
        Sentence s2 = new Sentence("S0002", 12.0, 20.0, "Bây giờ làm ví dụ.", null);

        // Gap 3.5s (20.0 - 23.5) -> +2 (>=1.5s) + 1 (>=3.0s) = 4 điểm
        Sentence s3 = new Sentence("S0003", 23.5, 30.0, "Xong ví dụ 1.", null);

        TranscriptDTO transcript = new TranscriptDTO("test.mp4", 30.0, List.of(s1, s2, s3));
        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);

        assertEquals(2, cutPoints.cutPoints().size());

        CutPoint cp1 = cutPoints.cutPoints().get(0);
        assertEquals(3, cp1.score(), "Gap 2.0s phải đạt 3 điểm");
        assertEquals(11.0, cp1.time(), 0.01);

        CutPoint cp2 = cutPoints.cutPoints().get(1);
        assertEquals(4, cp2.score(), "Gap 3.5s phải đạt 4 điểm");
        assertEquals(21.75, cp2.time(), 0.01);
    }

    @Test
    @DisplayName("P05: Từ nối chuyển ý (+3 điểm khi gặp 'tiếp theo', 'chuyển sang'...)")
    void testCalculateCutPoints_CuePhraseScoring() {
        Sentence s1 = new Sentence("S0001", 0.0, 5.0, "Đó là cấu trúc for.", null);
        Sentence s2 = new Sentence("S0002", 6.8, 12.0, "Tiếp theo chúng ta sẽ tìm hiểu vòng lặp while.", null);

        TranscriptDTO transcript = new TranscriptDTO("test.mp4", 12.0, List.of(s1, s2));
        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);

        CutPoint cp = cutPoints.cutPoints().get(0);
        // Base(1) + Silence>=1.5s (2) + Cue phrase (3) = 6 điểm
        assertEquals(6, cp.score());
        assertTrue(cp.reasons().stream().anyMatch(r -> r.contains("TU_NOI_CHUYEN_Y")));
    }

    @Test
    @DisplayName("P10: Boundary Snapping trượt cửa sổ +/- 3 câu chọn điểm cắt có điểm cao nhất")
    void testSnapBoundary_SlidingWindow() {
        Sentence s1 = new Sentence("S0001", 0.0, 5.0, "Câu 1.", null);
        Sentence s2 = new Sentence("S0002", 5.2, 10.0, "Câu 2.", null); // Gap 0.2s -> 1 điểm
        Sentence s3 = new Sentence("S0003", 10.1, 15.0, "Câu 3.", null); // Gap 0.1s -> 1 điểm
        Sentence s4 = new Sentence("S0004", 18.0, 25.0, "Tiếp theo sang bài mới.", null); // Gap 3.0s + Cue -> 7 điểm
        Sentence s5 = new Sentence("S0005", 25.2, 30.0, "Câu 5.", null);

        TranscriptDTO transcript = new TranscriptDTO("test.mp4", 30.0, List.of(s1, s2, s3, s4, s5));
        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);

        // Giả sử AI ban đầu chọn câu S0003 làm ranh giới kết thúc
        double snapped = cutPointService.snapBoundary("S0003", false, transcript, cutPoints);

        // Trong cửa sổ quanh S0003, điểm cắt sau S0003 (giữa S0003 và S0004) có gap 3.0s + Cue đạt 7 điểm tại mốc 16.5s
        assertEquals(16.5, snapped, 0.01, "Phải hút về điểm cắt lý tưởng 16.5s có điểm số cao nhất");
    }

    @Test
    @DisplayName("P11: Tự động loại bỏ phân đoạn ngoài lề và gộp các phân đoạn < 30s")
    void testSnapAndFilterSegments_OffTopicAndMergeShort() {
        TranscriptDTO transcript = new TranscriptDTO("test.mp4", 120.0, List.of(
                new Sentence("S0001", 0.0, 20.0, "Mở đầu bài học.", null),
                new Sentence("S0002", 20.5, 45.0, "Nội dung chính phần 1.", null),
                new Sentence("S0003", 45.5, 60.0, "Nói chuyện phiếm và nghỉ giải lao 5 phút.", null),
                new Sentence("S0004", 60.5, 75.0, "Bài học siêu ngắn.", null), // 14.5s < 30s
                new Sentence("S0005", 75.5, 120.0, "Nội dung phần 2 chi tiết.", null)
        ));

        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);

        List<Segment> rawList = List.of(
                new Segment("seg_1", 1, "01_MoDau", 1, "Giới thiệu", "gioi-thieu", "S0001", "S0002", 0.0, 45.0, Collections.emptyList()),
                new Segment("seg_2", 2, "02_GiaoLuu", 1, "Nghỉ giải lao ngoài lề", "nghi-giai-lao", "S0003", "S0003", 45.0, 60.0, Collections.emptyList()),
                new Segment("seg_3", 3, "03_BaiHoc", 1, "Phần cực ngắn", "phan-cuc-ngan", "S0004", "S0004", 60.0, 75.0, Collections.emptyList()), // < 30s
                new Segment("seg_4", 3, "03_BaiHoc", 2, "Nội dung tiếp", "noi-dung-tiep", "S0005", "S0005", 75.0, 120.0, Collections.emptyList())
        );

        SegmentsDTO rawSegments = new SegmentsDTO("test.mp4", "BaiGiang", "raw", false, rawList);
        SegmentsDTO filtered = cutPointService.snapAndFilterSegments(rawSegments, transcript, cutPoints);

        assertNotNull(filtered);
        // Đoạn ngoài lề bị xóa (còn 3), đoạn ngắn 15s bị gộp vào đoạn sau -> còn 2 đoạn
        assertTrue(filtered.segments().size() <= 2);
        assertTrue(filtered.segments().stream().noneMatch(s -> s.topic().contains("Nghỉ giải lao")));
        // Kiểm tra tính liên tục từ 0.0 đến 120.0
        assertEquals(0.0, filtered.segments().get(0).start());
        assertEquals(120.0, filtered.segments().get(filtered.segments().size() - 1).end());
    }

    @Test
    @DisplayName("P05 / Data Contract: Xuất file cut_points.json hợp lệ theo chuẩn thiết kế")
    void testExportCutPointsJson(@TempDir Path tempDir) throws Exception {
        Sentence s1 = new Sentence("S0001", 0.0, 5.0, "Câu 1.", null);
        Sentence s2 = new Sentence("S0002", 6.0, 10.0, "Câu 2.", null);
        TranscriptDTO transcript = new TranscriptDTO("test.mp4", 10.0, List.of(s1, s2));

        CutPointsDTO cutPoints = cutPointService.calculateCutPoints(transcript);
        Path jsonPath = tempDir.resolve("cut_points.json");

        cutPointService.exportCutPointsJson(cutPoints, jsonPath);
        assertTrue(Files.exists(jsonPath));

        String content = Files.readString(jsonPath);
        assertTrue(content.contains("\"cut_points\""));
        assertTrue(content.contains("\"after_id\" : \"S0001\""));
        assertTrue(content.contains("\"score\""));
        assertTrue(content.contains("\"reasons\""));
    }
}
