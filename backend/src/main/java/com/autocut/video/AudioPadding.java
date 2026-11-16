package com.autocut.video;

import java.util.ArrayList;
import java.util.List;

/**
 * Thuật toán chèn đệm thở âm thanh (-0.3s / +0.5s) cho VideoEngine SV1 Tuần 2.
 *
 * <p>Mục đích: Mở rộng mốc cắt về hai phía để giọng nói đầu câu không bị cụt âm
 * và đuôi câu không bị ngắt đột ngột. Tự động co lại (clamp) nếu chạm vào
 * phân đoạn liền kề hoặc biên của video.
 *
 * <p>Công thức:
 * <pre>
 *   paddedStart = max(prevSegmentEnd, max(0.0, start - paddingStart))
 *   paddedEnd   = min(nextSegmentStart, min(totalDuration, end + paddingEnd))
 * </pre>
 */
public final class AudioPadding {

    private AudioPadding() {}

    /**
     * Kết quả sau khi áp dụng đệm cho một phân đoạn.
     *
     * @param paddedStart Mốc bắt đầu đã lùi, đã clamp
     * @param paddedEnd   Mốc kết thúc đã tiến, đã clamp
     */
    public record PaddedRange(double paddedStart, double paddedEnd) {}

    /**
     * Tính khoảng thời gian đệm cho một phân đoạn đơn lẻ.
     *
     * @param start         Mốc bắt đầu gốc của phân đoạn (giây)
     * @param end           Mốc kết thúc gốc của phân đoạn (giây)
     * @param prevEnd       Mốc kết thúc của phân đoạn liền trước (0.0 nếu là đầu tiên)
     * @param nextStart     Mốc bắt đầu của phân đoạn liền sau (totalDuration nếu là cuối cùng)
     * @param paddingStart  Khoảng đệm đầu (giây, thường 0.3)
     * @param paddingEnd    Khoảng đệm đuôi (giây, thường 0.5)
     * @return PaddedRange chứa paddedStart và paddedEnd đã được clamp an toàn
     */
    public static PaddedRange apply(
            double start, double end,
            double prevEnd, double nextStart,
            double paddingStart, double paddingEnd) {

        // Lùi đầu: không được vượt qua prevEnd và không âm
        double ps = Math.max(prevEnd, start - paddingStart);
        ps = Math.max(0.0, ps);

        // Tiến đuôi: không được vượt qua nextStart
        double pe = Math.min(nextStart, end + paddingEnd);

        return new PaddedRange(ps, pe);
    }

    /**
     * Tính khoảng đệm cho toàn bộ danh sách phân đoạn, tự động xử lý
     * các ranh giới liền kề mà không cần caller tính tay.
     *
     * @param segments      Danh sách phân đoạn dưới dạng mảng [start, end]
     * @param totalDuration Tổng thời lượng video gốc (giây)
     * @param paddingStart  Khoảng đệm đầu (giây)
     * @param paddingEnd    Khoảng đệm đuôi (giây)
     * @return Danh sách PaddedRange tương ứng theo thứ tự đầu vào
     */
    public static List<PaddedRange> applyAll(
            List<double[]> segments,
            double totalDuration,
            double paddingStart,
            double paddingEnd) {

        List<PaddedRange> result = new ArrayList<>(segments.size());

        for (int i = 0; i < segments.size(); i++) {
            double start = segments.get(i)[0];
            double end   = segments.get(i)[1];

            double prevEnd   = (i == 0) ? 0.0 : segments.get(i - 1)[1];
            double nextStart = (i == segments.size() - 1) ? totalDuration : segments.get(i + 1)[0];

            result.add(apply(start, end, prevEnd, nextStart, paddingStart, paddingEnd));
        }

        return result;
    }
}

