package com.autocut.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Kiểm thử thuật toán chèn đệm thở âm thanh (-0.3s / +0.5s) - SV1 Tuần 2.
 * Bao gồm 5 kịch bản biên theo spec đã phân tích.
 */
class AudioPaddingTest {

    private static final double PAD_START = 0.3;
    private static final double PAD_END   = 0.5;

    // ─── Kiểm thử hàm tính đệm đơn lẻ ────────────────────────────────────────

    @Test
    @DisplayName("Kịch bản 1 – Đầu video: start - 0.3 < 0 phải co lại thành 0.0")
    void testPadding_ClampAtVideoStart() {
        // start=0.1, 0.1 - 0.3 = -0.2 -> phải chặn tại 0.0
        AudioPadding.PaddedRange r = AudioPadding.apply(0.1, 5.0, 0.0, 60.0, PAD_START, PAD_END);
        assertEquals(0.0, r.paddedStart(), 0.001, "paddedStart phải là 0.0 vì video chưa đủ 0.3s trước đó");
        assertEquals(5.5, r.paddedEnd(),   0.001, "paddedEnd = 5.0 + 0.5 = 5.5");
    }

    @Test
    @DisplayName("Kịch bản 2 – Đứng độc lập, khoảng trống đủ rộng: mở rộng trọn vẹn")
    void testPadding_IsolatedSegment() {
        // prevEnd=0.0 (không có đoạn trước), nextStart=100.0 (cách xa)
        AudioPadding.PaddedRange r = AudioPadding.apply(10.0, 20.0, 0.0, 100.0, PAD_START, PAD_END);
        assertEquals(9.7,  r.paddedStart(), 0.001, "paddedStart = 10.0 - 0.3 = 9.7");
        assertEquals(20.5, r.paddedEnd(),   0.001, "paddedEnd = 20.0 + 0.5 = 20.5");
    }

    @Test
    @DisplayName("Kịch bản 3 – Đoạn liền kề sát nhau (khoảng trống 0.2s): tự co lại đúng ranh giới")
    void testPadding_AdjacentSegments_NarrowGap() {
        // Đoạn A kết thúc tại 20.0, Đoạn B bắt đầu tại 20.2 -> gap 0.2s
        // Đoạn A: start=10.0, end=20.0, nextStart=20.2
        AudioPadding.PaddedRange rA = AudioPadding.apply(10.0, 20.0, 0.0, 20.2, PAD_START, PAD_END);
        assertEquals(9.7,  rA.paddedStart(), 0.001);
        assertEquals(20.2, rA.paddedEnd(),   0.001, "paddedEnd bị chặn tại nextStart=20.2 vì 20.0+0.5=20.5 vượt qua");

        // Đoạn B: start=20.2, end=30.0, prevEnd=20.0
        AudioPadding.PaddedRange rB = AudioPadding.apply(20.2, 30.0, 20.0, 60.0, PAD_START, PAD_END);
        assertEquals(20.0, rB.paddedStart(), 0.001, "paddedStart bị chặn tại prevEnd=20.0 vì 20.2-0.3=19.9 lẹm sang đoạn A");
        assertEquals(30.5, rB.paddedEnd(),   0.001);
    }

    @Test
    @DisplayName("Kịch bản 4 – Hai đoạn dính liền nhau (khoảng trống = 0): giữ nguyên mốc tiếp giáp")
    void testPadding_ContiguousSegments_ZeroGap() {
        // Đoạn A end=15.0, Đoạn B start=15.0 -> dính liền
        AudioPadding.PaddedRange rA = AudioPadding.apply(0.0, 15.0, 0.0, 15.0, PAD_START, PAD_END);
        assertEquals(0.0,  rA.paddedStart(), 0.001);
        assertEquals(15.0, rA.paddedEnd(),   0.001, "paddedEnd bị chặn đúng tại nextStart=15.0, không được vượt sang Đoạn B");

        AudioPadding.PaddedRange rB = AudioPadding.apply(15.0, 30.0, 15.0, 60.0, PAD_START, PAD_END);
        assertEquals(15.0, rB.paddedStart(), 0.001, "paddedStart bị chặn đúng tại prevEnd=15.0, không lẹm sang Đoạn A");
        assertEquals(30.5, rB.paddedEnd(),   0.001);
    }

    @Test
    @DisplayName("Kịch bản 5 – Cuối video: end + 0.5 > totalDuration phải co lại thành totalDuration")
    void testPadding_ClampAtVideoEnd() {
        // totalDuration=60.0, end=59.8, 59.8+0.5=60.3 -> phải chặn tại 60.0
        AudioPadding.PaddedRange r = AudioPadding.apply(50.0, 59.8, 0.0, 60.0, PAD_START, PAD_END);
        assertEquals(49.7, r.paddedStart(), 0.001, "paddedStart = 50.0 - 0.3 = 49.7");
        assertEquals(60.0, r.paddedEnd(),   0.001, "paddedEnd bị chặn tại totalDuration=60.0");
    }

    // ─── Kiểm thử helper tính toàn bộ danh sách phân đoạn ───────────────────

    @Test
    @DisplayName("applyAll: Tính đệm chính xác cho toàn danh sách 3 phân đoạn liền kề")
    void testApplyAll_ThreeSegments() {
        // 3 phân đoạn: [0.0-10.0], [10.5-20.0], [20.3-30.0]; totalDuration=30.0
        List<double[]> segments = List.of(
            new double[]{0.0,  10.0},
            new double[]{10.5, 20.0},
            new double[]{20.3, 30.0}
        );
        List<AudioPadding.PaddedRange> result = AudioPadding.applyAll(segments, 30.0, PAD_START, PAD_END);

        assertEquals(3, result.size());

        // Đoạn 0: start=0.0 -> 0.0-0.3=-0.3 -> chặn 0.0; end=10.0+0.5=10.5 -> chặn tại nextStart=10.5
        assertEquals(0.0,  result.get(0).paddedStart(), 0.001);
        assertEquals(10.5, result.get(0).paddedEnd(),   0.001);

        // Đoạn 1: start=10.5-0.3=10.2 -> nhưng prevEnd=10.0 -> OK 10.2; end=20.0+0.5=20.5 -> chặn nextStart=20.3
        assertEquals(10.2, result.get(1).paddedStart(), 0.001);
        assertEquals(20.3, result.get(1).paddedEnd(),   0.001);

        // Đoạn 2: start=20.3-0.3=20.0 -> prevEnd=20.0 -> chặn 20.0; end=30.0+0.5=30.5 -> chặn totalDuration=30.0
        assertEquals(20.0, result.get(2).paddedStart(), 0.001);
        assertEquals(30.0, result.get(2).paddedEnd(),   0.001);
    }
}

