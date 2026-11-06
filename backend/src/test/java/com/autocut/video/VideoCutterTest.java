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
    @DisplayName("Cat voi tep nguon khong ton tai: Tra ve that bai, ma loi FILE_NOT_FOUND")
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
    @DisplayName("Cat voi tep nguon rong 0-byte: Tra ve that bai, ma loi FILE_EMPTY")
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
    @DisplayName("Cat voi start am: Tra ve that bai, ma loi INVALID_TIME_RANGE")
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
    @DisplayName("Cat voi end <= start: Tra ve that bai, ma loi INVALID_TIME_RANGE")
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
    @DisplayName("Tu dong tao thu muc con long nhau khi cat clip")
    void testCut_AutoCreateParentDirectories() throws IOException {
        Path source = tempDir.resolve("source.mp4");
        Files.writeString(source, "dummy content");

        // Duong dan long nhieu cap: sub/folder/clip.mp4
        File nestedOutput = tempDir.resolve("sub").resolve("folder").resolve("clip.mp4").toFile();
        assertFalse(nestedOutput.getParentFile().exists());

        // Chay lenh cat (se that bai vi ffmpeg gia hoac file dummy, nhung thu muc cha phai duoc tao)
        videoCutter.cut(source.toFile(), nestedOutput, 0.0, 10.0);

        assertTrue(nestedOutput.getParentFile().exists(), "Thu muc cha cua tep xuat ra phai duoc tu dong tao");
    }

    @Test
    @DisplayName("Cat danh sach theo lo (cutBatch): Xu ly tuan tu khong bi crash khi co clip loi")
    void testCutBatch_FaultTolerance() throws IOException {
        Path source = tempDir.resolve("source.mp4");
        Files.writeString(source, "dummy content");

        File out1 = tempDir.resolve("out1.mp4").toFile();
        File out2 = tempDir.resolve("out2.mp4").toFile();

        List<VideoCutter.CutRequest> requests = List.of(
            new VideoCutter.CutRequest(out1, -1.0, 10.0), // loi start am
            new VideoCutter.CutRequest(out2, 20.0, 10.0)  // loi end < start
        );

        List<CutResult> results = videoCutter.cutBatch(source.toFile(), requests);

        assertEquals(2, results.size());
        assertFalse(results.get(0).success());
        assertFalse(results.get(1).success());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, results.get(0).errorCode());
        assertEquals(ErrorCode.INVALID_TIME_RANGE, results.get(1).errorCode());
    }

    // =========================================================================
    // Muc 1 - TDD: Tests cho buildCommand() - Re-encode libx264 + faststart
    // =========================================================================

    @Test
    @DisplayName("buildCommand: Phai dung libx264 va aac de re-encode (triet tieu I-Frame den hinh)")
    void testBuildCommand_UsesLibx264AndAac() {
        File input = tempDir.resolve("in.mp4").toFile();
        File output = tempDir.resolve("out.mp4").toFile();

        List<String> cmd = videoCutter.buildCommand(input, output, "0.000", "10.000");

        assertTrue(cmd.contains("libx264"), "Phai dung codec video libx264 de re-encode");
        assertTrue(cmd.contains("aac"),     "Phai dung codec audio aac de re-encode");
    }

    @Test
    @DisplayName("buildCommand: Phai chua -movflags +faststart de toi uu phat web")
    void testBuildCommand_ContainsMovflagsFaststart() {
        File input = tempDir.resolve("in.mp4").toFile();
        File output = tempDir.resolve("out.mp4").toFile();

        List<String> cmd = videoCutter.buildCommand(input, output, "5.123", "15.456");

        assertTrue(cmd.contains("-movflags"), "Thieu flag -movflags");
        assertTrue(cmd.contains("+faststart"), "Thieu gia tri +faststart");

        // Kiem tra thu tu: -movflags phai dung truoc +faststart
        int idxFlag = cmd.indexOf("-movflags");
        int idxVal  = cmd.indexOf("+faststart");
        assertEquals(idxFlag + 1, idxVal, "-movflags va +faststart phai lien tiep nhau");
    }

    @Test
    @DisplayName("buildCommand: Thoi gian cat dung so thuc double (3 chu so thap phan, Locale.US)")
    void testBuildCommand_UsesDoubleTimestamps() {
        File input = tempDir.resolve("in.mp4").toFile();
        File output = tempDir.resolve("out.mp4").toFile();

        List<String> cmd = videoCutter.buildCommand(input, output, "12.345", "67.890");

        assertTrue(cmd.contains("12.345"), "Moc start phai la so thuc 3 chu so thap phan");
        assertTrue(cmd.contains("67.890"), "Moc end phai la so thuc 3 chu so thap phan");
        // Kiem tra dung dau cham (.), khong dung dau phay (,)
        assertFalse(cmd.stream().anyMatch(s -> s.contains(",")), "Khong duoc dung dau phay - phai dung Locale.US");
    }
}
