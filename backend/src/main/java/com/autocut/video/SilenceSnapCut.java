package com.autocut.video;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Thuat toan Silence Snap Cut - SV1 Tuan 2 Muc 3.
 *
 * <p>Dat dao cat chinh giua khoang lang giua hai phan bai giang,
 * dam bao Phan 1 khong bi dinh cau mo dau cua Phan 2 va nguoc lai.
 *
 * <p>Cong thuc:
 * <pre>
 *   gap      = nextSegStart.startTime - curSegEnd.endTime
 *   cutPoint = curSegEnd.endTime + gap / 2   (neu gap > 0)
 *            = curSegEnd.endTime              (neu gap &lt;= 0)
 * </pre>
 *
 * <p>Input den tu 2 nguon cua SV2:
 * <ul>
 *   <li>Whisper transcript: danh sach {@link Sentence} co id, startTime, endTime</li>
 *   <li>LLM Segmentation: danh sach {@link Segment} chi chua start_id va end_id (khong co so giay)</li>
 * </ul>
 */
public final class SilenceSnapCut {

    private SilenceSnapCut() {}

    // -------------------------------------------------------------------------
    // Data records (khong tao dependency moi, dung Java record)
    // -------------------------------------------------------------------------

    /**
     * Mot cau tu Whisper transcript.
     *
     * @param id        Ma cau (vi du "S0001")
     * @param startTime Thoi diem bat dau (giay)
     * @param endTime   Thoi diem ket thuc (giay)
     */
    public record Sentence(String id, double startTime, double endTime) {}

    /**
     * Mot phan bai giang tu LLM Segmentation.
     * Chi chua ma cau dau va cuoi, khong co so giay.
     *
     * @param startId Ma cau dau tien cua phan (vi du "S0001")
     * @param endId   Ma cau cuoi cung cua phan (vi du "S0045")
     */
    public record Segment(String startId, String endId) {}

    // -------------------------------------------------------------------------
    // Core algorithm
    // -------------------------------------------------------------------------

    /**
     * Tinh danh sach [segStart, segEnd] cho tung phan video sau khi snap vao giua khoang lang.
     *
     * @param sentences     Danh sach cau tu Whisper (co id, startTime, endTime)
     * @param segments      Danh sach phan bai giang tu LLM (co startId, endId)
     * @param totalDuration Tong thoi luong video (giay)
     * @return Danh sach cac doan [start, end] tuong ung voi tung Segment
     */
    public static List<double[]> snap(
            List<Sentence> sentences,
            List<Segment> segments,
            double totalDuration) {

        // Index nhanh theo id de tra cuu O(1)
        Map<String, Sentence> index = sentences.stream()
            .collect(Collectors.toMap(Sentence::id, Function.identity()));

        List<double[]> result = new ArrayList<>(segments.size());

        for (int i = 0; i < segments.size(); i++) {
            double segStart = (i == 0)
                ? 0.0
                : result.get(i - 1)[1]; // cutPoint cua bien truoc chinh la start cua bien nay

            double segEnd;
            if (i == segments.size() - 1) {
                // Segment cuoi cung: ke thuc tai totalDuration
                segEnd = totalDuration;
            } else {
                // Tinh cutPoint = midpoint cua khoang lang giua segment i va i+1
                Sentence curEnd  = index.get(segments.get(i).endId());
                Sentence nextStart = index.get(segments.get(i + 1).startId());

                double endTime   = curEnd.endTime();
                double startTime = nextStart.startTime();
                double gap       = startTime - endTime;

                segEnd = (gap > 0)
                    ? endTime + gap / 2.0
                    : endTime; // gap <= 0: khong co khoang lang, cat ngay tai endTime
            }

            result.add(new double[]{segStart, segEnd});
        }

        return result;
    }
}

