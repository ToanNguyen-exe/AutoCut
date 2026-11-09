package com.autocut.video;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class VideoCutterTest {

    private VideoCutter videoCutter;
    private VideoProps props;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        props = new VideoProps("ffprobe", "ffmpeg", 10, 60);
        videoCutter = new VideoCutter(props);
    }

    @Test
    @DisplayName("Cắt với tệp nguồn không tồn tại: Trả về thất bại, mã lỗi FILE_NOT_FOUND")
    void testCut_MissingInputFile() {
        File missingInput = tempDir.resolve("missing_source.mp4").toFile();
        File output = tempDir.resolve("output.mp4").toFile();

        CutResult result = videoCutter.cut(missingInput, output, 0.0, 10.0);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.FILE_NOT_FOUND, result.errorCode());
        assertTrue(result.executionTimeMs() >= 0);
    }

    @Test
    @DisplayName("Cắt với tệp nguồn rỗng 0-byte: Trả về thất bại, mã lỗi FILE_EMPTY")
    void testCut_ZeroByteInputFile() throws IOException {
        Path emptySource = tempDir.resolve("empty_source.mp4");
        Files.createFile(emptySource);

        File output = tempDir.resolve("output.mp4").toFile();

        CutResult result = videoCutter.cut(emptySource.toFile(), output, 0.0, 10.0);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.FILE_EMPTY, result.errorCode());
    }

    @Test
    @DisplayName("Cắt với start âm: Trả về thất bại, mã lỗi INVALID_TIME_RANGE")
    void testCut_InvalidTimeRange_NegativeStart() throws IOException {
        Path source = tempDir.resolve("source.mp4");
        Files.writeString(source, "dummy content");

        File output = tempDir.resolve("output.mp4").toFile();

        CutResult result = videoCutter.cut(source.toFile(), output, -5.0, 10.0);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, result.errorCode());
    }

    @Test
    @DisplayName("Cắt với end <= start: Trả về thất bại, mã lỗi INVALID_TIME_RANGE")
    void testCut_InvalidTimeRange_EndLessEqualStart() throws IOException {
        Path source = tempDir.resolve("source.mp4");
        Files.writeString(source, "dummy content");

        File output = tempDir.resolve("output.mp4").toFile();

        CutResult result1 = videoCutter.cut(source.toFile(), output, 10.0, 10.0);
        assertFalse(result1.success());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, result1.errorCode());

        CutResult result2 = videoCutter.cut(source.toFile(), output, 15.0, 10.0);
        assertFalse(result2.success());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, result2.errorCode());
    }

    @Test
    @DisplayName("Tự động tạo thư mục con lồng nhau khi cắt clip")
    void testCut_AutoCreateParentDirectories() throws IOException {
        Path source = tempDir.resolve("source.mp4");
        Files.writeString(source, "dummy content");

        // Đường dẫn lồng nhiều cấp: sub/folder/clip.mp4
        File nestedOutput = tempDir.resolve("sub").resolve("folder").resolve("clip.mp4").toFile();
        assertFalse(nestedOutput.getParentFile().exists());

        // Chạy lệnh cắt (sẽ thất bại vì ffmpeg giả hoặc file dummy, nhưng thư mục cha phải được tạo)
        videoCutter.cut(source.toFile(), nestedOutput, 0.0, 10.0);

        assertTrue(nestedOutput.getParentFile().exists(), "Thư mục cha của tệp xuất ra phải được tự động tạo");
    }

    @Test
    @DisplayName("Hàm kẹp biên clamp: Giá trị nằm trong [min, max] được giữ nguyên")
    void testClamp_ValueInsideRange() {
        double result = VideoCutter.clamp(5.0, 0.0, 10.0);
        assertEquals(5.0, result, 0.0001);
    }

    @Test
    @DisplayName("Hàm kẹp biên clamp: Giá trị nhỏ hơn min được kẹp về min (chống âm đầu)")
    void testClamp_ValueBelowMin() {
        double result = VideoCutter.clamp(-0.3, 0.0, 10.0);
        assertEquals(0.0, result, 0.0001);

        double startNearZero = 0.1;
        double paddingStart = 0.3;
        double padded = VideoCutter.clamp(startNearZero - paddingStart, 0.0, 10.0);
        assertEquals(0.0, padded, 0.0001);
    }

    @Test
    @DisplayName("Hàm kẹp biên clamp: Giá trị lớn hơn max được kẹp về duration (chống vượt trần)")
    void testClamp_ValueAboveMax() {
        double result = VideoCutter.clamp(12.5, 0.0, 10.0);
        assertEquals(10.0, result, 0.0001);

        double endNearDuration = 9.8;
        double paddingEnd = 0.5;
        double duration = 10.0;
        double padded = VideoCutter.clamp(endNearDuration + paddingEnd, 0.0, duration);
        assertEquals(10.0, padded, 0.0001);
    }

    @Test
    @DisplayName("Kiểm tra thông số padding_start (0.3s) và padding_end (0.5s) mặc định")
    void testEffectivePadding_DefaultValues() {
        assertEquals(0.3, videoCutter.getEffectivePaddingStart(), 0.0001);
        assertEquals(0.5, videoCutter.getEffectivePaddingEnd(), 0.0001);
    }

    @Test
    @DisplayName("Kiểm tra thông số padding tùy chỉnh qua VideoProps")
    void testEffectivePadding_CustomProps() {
        VideoProps customProps = new VideoProps("ffprobe", "ffmpeg", 10, 60, 0.4, 0.8);
        VideoCutter customCutter = new VideoCutter(customProps);

        assertEquals(0.4, customCutter.getEffectivePaddingStart(), 0.0001);
        assertEquals(0.8, customCutter.getEffectivePaddingEnd(), 0.0001);
    }

    @Test
    @DisplayName("Cắt danh sách theo lô (cutBatch): Xử lý tuần tự không bị crash khi có clip lỗi")
    void testCutBatch_FaultTolerance() throws IOException {
        Path source = tempDir.resolve("source.mp4");
        Files.writeString(source, "dummy content");

        File out1 = tempDir.resolve("out1.mp4").toFile();
        File out2 = tempDir.resolve("out2.mp4").toFile();

        List<VideoCutter.CutRequest> requests = List.of(
            new VideoCutter.CutRequest(out1, -1.0, 10.0), // lỗi start âm
            new VideoCutter.CutRequest(out2, 20.0, 10.0)  // lỗi end < start
        );

        List<CutResult> results = videoCutter.cutBatch(source.toFile(), requests);

        assertEquals(2, results.size());
        assertFalse(results.get(0).success());
        assertFalse(results.get(1).success());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, results.get(0).errorCode());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, results.get(1).errorCode());
    }
}
