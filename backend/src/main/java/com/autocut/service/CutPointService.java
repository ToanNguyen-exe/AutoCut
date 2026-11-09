package com.autocut.service;

import com.autocut.dto.Models.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Service chấm điểm điểm cắt âm học (P05) và căn chỉnh ranh giới âm học Boundary Snapping (P10, P11).
 * Tuân thủ quy chuẩn thiết kế hệ thống AutoCut AI (Thẻ 3.2).
 */
@Service
public class CutPointService {

    private static final Logger log = LoggerFactory.getLogger(CutPointService.class);
    private static final Pattern OFF_TOPIC_PATTERN = Pattern.compile(
            "(?i)(ngoài lề|ngoai le|nghỉ giải lao|nghi giai lao|nói chuyện phiếm|phiếm|off_topic|out_of_scope)"
    );

    private final ConfigService configService;
    private final ObjectMapper objectMapper;

    public CutPointService() {
        this(new ConfigService(), new ObjectMapper());
    }

    @Autowired
    public CutPointService(ConfigService configService) {
        this(configService, new ObjectMapper());
    }

    public CutPointService(ConfigService configService, ObjectMapper objectMapper) {
        this.configService = configService != null ? configService : new ConfigService();
        this.objectMapper = objectMapper != null ? objectMapper : new ObjectMapper();
    }

    /**
     * B3 / P05: Chấm điểm các điểm cắt ứng viên dựa trên khoảng im lặng và từ nối.
     * - Ranh giới cơ bản giữa 2 câu: +1 điểm
     * - Khoảng im lặng >= 1.5s (pauseThreshold): +2 điểm
     * - Khoảng im lặng >= 3.0s: +1 điểm
     * - Câu tiếp theo bắt đầu bằng cụm từ nối (cue phrase): +3 điểm
     */
    public CutPointsDTO calculateCutPoints(TranscriptDTO transcript) {
        if (transcript == null || transcript.sentences() == null || transcript.sentences().size() < 2) {
            return new CutPointsDTO(Collections.emptyList());
        }

        List<Sentence> sentences = transcript.sentences();
        double pauseThreshold = configService.getPauseThreshold();
        List<String> cuePhrases = configService.getCuePhrases();
        List<CutPoint> cutPoints = new ArrayList<>();

        for (int i = 0; i < sentences.size() - 1; i++) {
            Sentence s1 = sentences.get(i);
            Sentence s2 = sentences.get(i + 1);

            int score = 1;
            List<String> reasons = new ArrayList<>();
            reasons.add("RANH_GIOI_CO_BAN");

            double gap = s2.start() - s1.end();
            if (gap >= pauseThreshold) {
                score += 2;
                reasons.add(String.format("KHOANG_LANG_LON (%.2fs >= %.1fs)", gap, pauseThreshold));
            }
            if (gap >= 3.0) {
                score += 1;
                reasons.add(String.format("KHOANG_LANG_RAT_LON (%.2fs >= 3.0s)", gap));
            }

            // Kiểm tra từ nối câu tiếp theo
            String textNext = (s2.text() != null) ? s2.text().trim().toLowerCase() : "";
            for (String phrase : cuePhrases) {
                String cleanPhrase = phrase.trim().toLowerCase();
                if (!cleanPhrase.isEmpty() && textNext.startsWith(cleanPhrase)) {
                    score += 3;
                    reasons.add("TU_NOI_CHUYEN_Y: '" + phrase + "'");
                    break;
                }
            }

            // Mốc cắt lý tưởng rơi vào điểm giữa khoảng lặng
            double cutTime;
            if (gap > 0) {
                cutTime = Math.round(((s1.end() + s2.start()) / 2.0) * 100.0) / 100.0;
            } else {
                cutTime = Math.round(s1.end() * 100.0) / 100.0;
            }

            cutPoints.add(new CutPoint(s1.id(), cutTime, score, reasons));
        }

        log.info("Đã chấm điểm {} điểm cắt ứng viên cho video '{}'", cutPoints.size(), transcript.video());
        return new CutPointsDTO(cutPoints);
    }

    /**
     * B6 / P10: Căn chỉnh ranh giới âm học (Boundary Snapping).
     * Quét cửa sổ trượt +/- window câu xung quanh mốc câu của AI để chọn điểm cắt có điểm số cao nhất.
     */
    public double snapBoundary(String targetSentenceId, boolean isStartBoundary, TranscriptDTO transcript, CutPointsDTO cutPoints) {
        if (targetSentenceId == null || transcript == null || transcript.sentences() == null || cutPoints == null || cutPoints.cutPoints() == null) {
            return 0.0;
        }

        List<Sentence> sentences = transcript.sentences();
        int targetIdx = -1;
        for (int i = 0; i < sentences.size(); i++) {
            if (targetSentenceId.equalsIgnoreCase(sentences.get(i).id())) {
                targetIdx = i;
                break;
            }
        }

        if (targetIdx < 0) {
            return 0.0;
        }

        // Nếu là ranh giới đầu tiên của video
        if (isStartBoundary && targetIdx == 0) {
            return 0.0;
        }
        // Nếu là ranh giới kết thúc của câu cuối cùng video
        if (!isStartBoundary && targetIdx == sentences.size() - 1) {
            return transcript.duration() > 0 ? transcript.duration() : sentences.get(targetIdx).end();
        }

        int targetCutPointIdx = isStartBoundary ? (targetIdx - 1) : targetIdx;
        List<CutPoint> points = cutPoints.cutPoints();
        if (points.isEmpty()) {
            Sentence s = sentences.get(targetIdx);
            return isStartBoundary ? s.start() : s.end();
        }

        int window = configService.getSnapWindowSentences();
        int minIdx = Math.max(0, targetCutPointIdx - window);
        int maxIdx = Math.min(points.size() - 1, targetCutPointIdx + window);

        CutPoint bestPoint = null;
        int bestScore = -1;
        int minDistance = Integer.MAX_VALUE;

        for (int i = minIdx; i <= maxIdx; i++) {
            CutPoint cp = points.get(i);
            int dist = Math.abs(i - targetCutPointIdx);
            if (cp.score() > bestScore || (cp.score() == bestScore && dist < minDistance)) {
                bestScore = cp.score();
                bestPoint = cp;
                minDistance = dist;
            }
        }

        if (bestPoint != null) {
            return bestPoint.time();
        }

        Sentence s = sentences.get(targetIdx);
        return isStartBoundary ? s.start() : s.end();
    }

    /**
     * B7 / P10 + P11: Căn chỉnh ranh giới toàn bộ phân đoạn, loại bỏ phân đoạn ngoài lề
     * và sáp nhập các phân đoạn quá ngắn (< min_duration).
     */
    public SegmentsDTO snapAndFilterSegments(SegmentsDTO rawSegments, TranscriptDTO transcript, CutPointsDTO cutPoints) {
        if (rawSegments == null || rawSegments.segments() == null || rawSegments.segments().isEmpty()) {
            return rawSegments;
        }

        List<Segment> originalSegs = rawSegments.segments();
        double totalDuration = transcript != null && transcript.duration() > 0
                ? transcript.duration()
                : originalSegs.get(originalSegs.size() - 1).end();

        // 1. Snapping từng phân đoạn
        List<Segment> snappedList = new ArrayList<>();
        for (int i = 0; i < originalSegs.size(); i++) {
            Segment seg = originalSegs.get(i);

            // Bỏ phân đoạn ngoài lề
            String fullTitle = (seg.topic() + " " + seg.section()).trim();
            if (OFF_TOPIC_PATTERN.matcher(fullTitle).find()) {
                log.info("P11: Đã loại bỏ phân đoạn ngoài lề: '{}'", fullTitle);
                continue;
            }

            double snapStart;
            double snapEnd;

            if (i == 0 || seg.startId() == null) {
                snapStart = (i == 0) ? 0.0 : seg.start();
            } else {
                snapStart = snapBoundary(seg.startId(), true, transcript, cutPoints);
            }

            if (i == originalSegs.size() - 1 || seg.endId() == null) {
                snapEnd = (i == originalSegs.size() - 1) ? totalDuration : seg.end();
            } else {
                snapEnd = snapBoundary(seg.endId(), false, transcript, cutPoints);
            }

            // Đảm bảo start < end
            if (snapEnd <= snapStart) {
                snapEnd = snapStart + Math.max(1.0, seg.end() - seg.start());
            }

            snappedList.add(new Segment(
                    seg.id(),
                    seg.sectionNo(),
                    seg.section(),
                    seg.topicNo(),
                    seg.topic(),
                    seg.slug(),
                    seg.startId(),
                    seg.endId(),
                    Math.round(snapStart * 100.0) / 100.0,
                    Math.round(snapEnd * 100.0) / 100.0,
                    seg.parts()
            ));
        }

        if (snappedList.isEmpty()) {
            snappedList = originalSegs;
        }

        // 2. Sáp nhập phân đoạn ngắn (< min_duration, mặc định 30s)
        double minDuration = configService.getMinDuration();
        List<Segment> mergedList = new ArrayList<>();

        for (Segment current : snappedList) {
            double dur = current.end() - current.start();
            if (dur < minDuration && !mergedList.isEmpty()) {
                // Gộp vào phân đoạn trước đó
                int lastIdx = mergedList.size() - 1;
                Segment prev = mergedList.get(lastIdx);
                log.info("P11: Gộp phân đoạn ngắn ({:.1f}s < {:.1f}s) '{}' vào '{}'",
                        dur, minDuration, current.topic(), prev.topic());

                Segment merged = new Segment(
                        prev.id(),
                        prev.sectionNo(),
                        prev.section(),
                        prev.topicNo(),
                        prev.topic() + " & " + current.topic(),
                        prev.slug(),
                        prev.startId(),
                        current.endId(),
                        prev.start(),
                        current.end(),
                        prev.parts()
                );
                mergedList.set(lastIdx, merged);
            } else {
                mergedList.add(current);
            }
        }

        // 3. Đảm bảo các phân đoạn liền kề liên tục không có khe hở (Contiguous)
        List<Segment> finalized = new ArrayList<>();
        double currentCursor = 0.0;
        for (int i = 0; i < mergedList.size(); i++) {
            Segment s = mergedList.get(i);
            double sStart = (i == 0) ? 0.0 : currentCursor;
            double sEnd = (i == mergedList.size() - 1) ? Math.max(sStart + 1.0, totalDuration) : Math.max(sStart + 1.0, s.end());
            currentCursor = sEnd;

            finalized.add(new Segment(
                    s.id() != null ? s.id() : String.format("seg_ai_%02d", i + 1),
                    s.sectionNo() > 0 ? s.sectionNo() : (i + 1),
                    s.section(),
                    s.topicNo() > 0 ? s.topicNo() : 1,
                    s.topic(),
                    s.slug(),
                    s.startId(),
                    s.endId(),
                    Math.round(sStart * 100.0) / 100.0,
                    Math.round(sEnd * 100.0) / 100.0,
                    s.parts()
            ));
        }

        return new SegmentsDTO(
                rawSegments.video(),
                rawSegments.lesson(),
                rawSegments.mode(),
                rawSegments.reviewed(),
                finalized
        );
    }

    /**
     * Xuất tệp cut_points.json ra đĩa theo đúng khế ước dữ liệu Data Contract.
     */
    public Path exportCutPointsJson(CutPointsDTO cutPoints, Path outputPath) throws IOException {
        Files.createDirectories(outputPath.getParent());
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(outputPath.toFile(), cutPoints);
        log.info("Đã xuất tệp cut_points.json thành công tại: {}", outputPath.toAbsolutePath());
        return outputPath;
    }
}
