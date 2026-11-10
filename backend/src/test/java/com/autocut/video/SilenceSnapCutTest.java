package com.autocut.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * TDD - Red phase: Tests cho SilenceSnapCut (Muc 3 - Tuan 2 SV1).
 *
 * Contract:
 *   INPUT : sentences (Whisper transcript) + segments (LLM start_id/end_id) + totalDuration
 *   OUTPUT: danh sach [segStart, segEnd] cho tung phan video sau khi snap vao giua khoang lang
 *
 * Cong thuc:
 *   gap      = nextSegment.startTime - currentSegment.endTime
 *   cutPoint = currentSegment.endTime + gap / 2   (neu gap > 0)
 *            = currentSegment.endTime              (neu gap <= 0, khong co khoang lang)
 */
class SilenceSnapCutTest {

    // -------------------------------------------------------------------------
    // Helper: tao nhanh danh sach cau (id bat dau tu "S0001")
    // -------------------------------------------------------------------------
    private static List<SilenceSnapCut.Sentence> sentences(double... times) {
        // times: start0, end0, start1, end1, ...
        List<SilenceSnapCut.Sentence> list = new java.util.ArrayList<>();
        for (int i = 0; i < times.length; i += 2) {
            String id = String.format("S%04d", (i / 2) + 1);
            list.add(new SilenceSnapCut.Sentence(id, times[i], times[i + 1]));
        }
        return list;
    }

    // -------------------------------------------------------------------------
    // KB1: 1 diem split, khoang lang du rong (0.8s) -> cutPoint = midpoint
    // -------------------------------------------------------------------------
    @Test
    @DisplayName("KB1: 1 diem split, silence 0.8s -> cutPoint chinh giua khoang lang")
    void testSnap_OneSplit_WideSilence() {
        // Phan 1: S0001-S0002, Phan 2: S0003-S0004
        // S0002.endTime=10.0, S0003.startTime=10.8 -> gap=0.8s -> cutPoint=10.4
        List<SilenceSnapCut.Sentence> sents = sentences(
            0.0, 5.0,   // S0001
            5.2, 10.0,  // S0002  <- end of segment 1
            10.8, 15.0, // S0003  <- start of segment 2
            15.2, 20.0  // S0004
        );
        List<SilenceSnapCut.Segment> segs = List.of(
            new SilenceSnapCut.Segment("S0001", "S0002"),
            new SilenceSnapCut.Segment("S0003", "S0004")
        );

        List<double[]> result = SilenceSnapCut.snap(sents, segs, 20.0);

        assertEquals(2, result.size());
        assertEquals(0.0,  result.get(0)[0], 0.001, "Phan 1 bat dau tu 0.0");
        assertEquals(10.4, result.get(0)[1], 0.001, "Phan 1 ket thuc tai midpoint 10.0 + 0.8/2 = 10.4");
        assertEquals(10.4, result.get(1)[0], 0.001, "Phan 2 bat dau tai cutPoint 10.4");
        assertEquals(20.0, result.get(1)[1], 0.001, "Phan 2 ket thuc tai totalDuration");
    }

    // -------------------------------------------------------------------------
    // KB2: khoang lang hep (0.05s) -> van tinh duoc midpoint, khong crash
    // -------------------------------------------------------------------------
    @Test
    @DisplayName("KB2: Silence rat hep 0.05s -> van tinh midpoint dung, khong throw exception")
    void testSnap_NarrowSilence_NoException() {
        List<SilenceSnapCut.Sentence> sents = sentences(
            0.0,  5.0,  // S0001
            5.1, 10.0,  // S0002 <- end=10.0
            10.05, 15.0, // S0003 <- start=10.05, gap=0.05
            15.1, 20.0  // S0004
        );
        List<SilenceSnapCut.Segment> segs = List.of(
            new SilenceSnapCut.Segment("S0001", "S0002"),
            new SilenceSnapCut.Segment("S0003", "S0004")
        );

        List<double[]> result = assertDoesNotThrow(() ->
            SilenceSnapCut.snap(sents, segs, 20.0)
        );

        assertEquals(2, result.size());
        assertEquals(10.025, result.get(0)[1], 0.001, "cutPoint = 10.0 + 0.05/2 = 10.025");
        assertEquals(10.025, result.get(1)[0], 0.001);
    }

    // -------------------------------------------------------------------------
    // KB3: nhieu diem split (3 phan) -> 3 segments dung thu tu
    // -------------------------------------------------------------------------
    @Test
    @DisplayName("KB3: 3 phan, 2 diem split -> 3 segments dung cutPoint")
    void testSnap_ThreeSegments_TwoSplits() {
        // S0001-S0003 | S0004-S0006 | S0007-S0009
        // Split 1: S0003.end=15.0, S0004.start=16.0 -> gap=1.0 -> cut=15.5
        // Split 2: S0006.end=30.0, S0007.start=31.2 -> gap=1.2 -> cut=30.6
        List<SilenceSnapCut.Sentence> sents = sentences(
            0.0,  5.0,  // S0001
            5.2,  10.0, // S0002
            10.2, 15.0, // S0003
            16.0, 20.0, // S0004
            20.5, 25.0, // S0005
            25.3, 30.0, // S0006
            31.2, 35.0, // S0007
            35.5, 40.0, // S0008
            40.3, 45.0  // S0009
        );
        List<SilenceSnapCut.Segment> segs = List.of(
            new SilenceSnapCut.Segment("S0001", "S0003"),
            new SilenceSnapCut.Segment("S0004", "S0006"),
            new SilenceSnapCut.Segment("S0007", "S0009")
        );

        List<double[]> result = SilenceSnapCut.snap(sents, segs, 45.0);

        assertEquals(3, result.size());
        assertEquals(0.0,  result.get(0)[0], 0.001);
        assertEquals(15.5, result.get(0)[1], 0.001, "cut1 = 15.0 + 1.0/2 = 15.5");
        assertEquals(15.5, result.get(1)[0], 0.001);
        assertEquals(30.6, result.get(1)[1], 0.001, "cut2 = 30.0 + 1.2/2 = 30.6");
        assertEquals(30.6, result.get(2)[0], 0.001);
        assertEquals(45.0, result.get(2)[1], 0.001);
    }

    // -------------------------------------------------------------------------
    // KB4: gap <= 0 (cau sat nhau / chong lap) -> cutPoint = endTime cau cuoi phan truoc
    // -------------------------------------------------------------------------
    @Test
    @DisplayName("KB4: gap <= 0 (cau chong lap) -> cutPoint = endTime phan truoc, khong am")
    void testSnap_ZeroOrNegativeGap_ClampToEndTime() {
        // S0002.end=10.0, S0003.start=10.0 -> gap=0 -> cutPoint=10.0
        List<SilenceSnapCut.Sentence> sents = sentences(
            0.0,  5.0,  // S0001
            5.2,  10.0, // S0002 <- end=10.0
            10.0, 15.0, // S0003 <- start=10.0, gap=0
            15.2, 20.0  // S0004
        );
        List<SilenceSnapCut.Segment> segs = List.of(
            new SilenceSnapCut.Segment("S0001", "S0002"),
            new SilenceSnapCut.Segment("S0003", "S0004")
        );

        List<double[]> result = SilenceSnapCut.snap(sents, segs, 20.0);

        assertEquals(2, result.size());
        assertEquals(10.0, result.get(0)[1], 0.001, "gap=0 -> cutPoint = endTime = 10.0");
        assertEquals(10.0, result.get(1)[0], 0.001);
    }

    // -------------------------------------------------------------------------
    // KB5: chi co 1 segment (khong co diem split) -> tra ve 1 segment [0, totalDuration]
    // -------------------------------------------------------------------------
    @Test
    @DisplayName("KB5: chi 1 segment (khong split) -> 1 segment tron ven tu 0 den totalDuration")
    void testSnap_SingleSegment_ReturnsFullRange() {
        List<SilenceSnapCut.Sentence> sents = sentences(
            0.0,  5.0,  // S0001
            5.2, 10.0   // S0002
        );
        List<SilenceSnapCut.Segment> segs = List.of(
            new SilenceSnapCut.Segment("S0001", "S0002")
        );

        List<double[]> result = SilenceSnapCut.snap(sents, segs, 10.0);

        assertEquals(1, result.size());
        assertEquals(0.0,  result.get(0)[0], 0.001);
        assertEquals(10.0, result.get(0)[1], 0.001);
    }
}

