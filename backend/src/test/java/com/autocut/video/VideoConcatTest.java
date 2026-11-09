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

class VideoConcatTest {

    private VideoConcat videoConcat;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        VideoProps props = new VideoProps("ffprobe", "ffmpeg", 10, 60);
        videoConcat = new VideoConcat(props);
    }

    // =========================================================================
    // AC-1: Input rỗng hoặc null → failure không ném exception
    // =========================================================================

    @Test
    @DisplayName("AC-1a: Danh sach clip null -> failure, ErrorCode.INVALID_INPUT")
    void testConcat_NullList() {
        File output = tempDir.resolve("out.mp4").toFile();

        ConcatResult result = videoConcat.concat(null, output);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.INVALID_INPUT, result.errorCode());
    }

    @Test
    @DisplayName("AC-1b: Danh sach clip rong -> failure, ErrorCode.INVALID_INPUT")
    void testConcat_EmptyList() {
        File output = tempDir.resolve("out.mp4").toFile();

        ConcatResult result = videoConcat.concat(List.of(), output);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.INVALID_INPUT, result.errorCode());
    }

    @Test
    @DisplayName("AC-1c: Output null -> failure, ErrorCode.INVALID_INPUT")
    void testConcat_NullOutput() throws IOException {
        Path clip1 = tempDir.resolve("clip1.mp4");
        Files.writeString(clip1, "dummy");

        ConcatResult result = videoConcat.concat(List.of(clip1.toFile()), null);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.INVALID_INPUT, result.errorCode());
    }

    // =========================================================================
    // AC-2: Input có file không tồn tại → failure FILE_NOT_FOUND
    // =========================================================================

    @Test
    @DisplayName("AC-2: Mot clip khong ton tai -> failure FILE_NOT_FOUND")
    void testConcat_MissingClip() throws IOException {
        Path clip1 = tempDir.resolve("clip1.mp4");
        Files.writeString(clip1, "dummy");
        File missingClip = tempDir.resolve("missing.mp4").toFile();
        File output = tempDir.resolve("out.mp4").toFile();

        ConcatResult result = videoConcat.concat(List.of(clip1.toFile(), missingClip), output);

        assertNotNull(result);
        assertFalse(result.success());
        assertEquals(ErrorCode.FILE_NOT_FOUND, result.errorCode());
    }

    // =========================================================================
    // AC-3: buildFileList() sinh đúng format "file '/path'"
    // =========================================================================

    @Test
    @DisplayName("AC-3: buildFileList phai sinh dung format: file '/path/to/clip.mp4'")
    void testBuildFileList_Format() throws IOException {
        Path clip1 = tempDir.resolve("clip1.mp4");
        Path clip2 = tempDir.resolve("clip2.mp4");
        Files.writeString(clip1, "dummy");
        Files.writeString(clip2, "dummy");

        String fileList = videoConcat.buildFileList(List.of(clip1.toFile(), clip2.toFile()));

        assertNotNull(fileList);
        // Mỗi dòng phải có dạng: file '/absolute/path'
        String[] lines = fileList.split(System.lineSeparator());
        assertEquals(2, lines.length);
        assertTrue(lines[0].startsWith("file '"), "Dong dau phai bat dau bang: file '");
        assertTrue(lines[0].endsWith("'"), "Dong dau phai ket thuc bang: '");
        assertTrue(lines[0].contains("clip1.mp4"), "Dong dau phai chua ten file clip1.mp4");
        assertTrue(lines[1].startsWith("file '"), "Dong thu hai phai bat dau bang: file '");
        assertTrue(lines[1].contains("clip2.mp4"), "Dong thu hai phai chua ten file clip2.mp4");
    }

    @Test
    @DisplayName("AC-3b: buildFileList dung forward slash, khong chua ky tu backslash trong gia tri path")
    void testBuildFileList_UsesForwardSlash() throws IOException {
        Path clip1 = tempDir.resolve("clip1.mp4");
        Files.writeString(clip1, "dummy");

        String fileList = videoConcat.buildFileList(List.of(clip1.toFile()));

        // Trong chuoi "file '...'", phan path khong duoc chua backslash
        // (FFmpeg tren Windows can forward slash trong filelist)
        String pathPart = fileList.replaceAll("^file '", "").replaceAll("'$", "").trim();
        assertFalse(pathPart.contains("\\"),
            "Path ben trong file list phai dung forward slash, khong dung backslash");
    }

    // =========================================================================
    // AC-4: buildCommand() phải dùng -f concat -safe 0 -c copy
    // =========================================================================

    @Test
    @DisplayName("AC-4: buildCommand phai chua -f concat -safe 0 -c copy")
    void testBuildCommand_ConcatFlags() throws IOException {
        Path fileListPath = tempDir.resolve("filelist.txt");
        Files.writeString(fileListPath, "file '/tmp/clip1.mp4'");
        File output = tempDir.resolve("out.mp4").toFile();

        List<String> cmd = videoConcat.buildCommand(fileListPath.toFile(), output);

        assertNotNull(cmd);
        assertTrue(cmd.contains("-f"),      "Thieu flag -f");
        assertTrue(cmd.contains("concat"),  "Thieu gia tri concat");
        assertTrue(cmd.contains("-safe"),   "Thieu flag -safe");
        assertTrue(cmd.contains("0"),       "Thieu gia tri 0 cho -safe");
        assertTrue(cmd.contains("-c"),      "Thieu flag -c");
        assertTrue(cmd.contains("copy"),    "Thieu gia tri copy");

        // Kiem tra thu tu: -f concat phai lien tiep
        int idxF = cmd.indexOf("-f");
        assertEquals("concat", cmd.get(idxF + 1), "-f phai theo sau la concat");

        // Kiem tra thu tu: -safe 0 phai lien tiep
        int idxSafe = cmd.indexOf("-safe");
        assertEquals("0", cmd.get(idxSafe + 1), "-safe phai theo sau la 0");
    }

    @Test
    @DisplayName("AC-4b: buildCommand phai bat dau bang ffmpeg path va co -y de overwrite")
    void testBuildCommand_StartsWithFfmpegAndOverwrite() throws IOException {
        Path fileListPath = tempDir.resolve("filelist.txt");
        Files.writeString(fileListPath, "file '/tmp/clip1.mp4'");
        File output = tempDir.resolve("out.mp4").toFile();

        List<String> cmd = videoConcat.buildCommand(fileListPath.toFile(), output);

        assertFalse(cmd.isEmpty(), "Command khong duoc rong");
        // Phan tu dau la ffmpeg path
        assertNotNull(cmd.get(0), "Phan tu dau phai la ffmpeg path");
        assertTrue(cmd.contains("-y"), "Phai co -y de tu dong ghi de output");
    }

    // =========================================================================
    // AC-5: Temp filelist.txt bị xóa sau khi concat xong (kể cả khi lỗi)
    // =========================================================================

    @Test
    @DisplayName("AC-5: File filelist.txt tam phai bi xoa sau khi concat (du thanh cong hay that bai)")
    void testConcat_CleanupTempFileOnFailure() throws IOException {
        // Dung clip gia (sẽ fail ffmpeg), nhưng kiểm tra không có file filelist.txt con lai
        Path clip1 = tempDir.resolve("clip1.mp4");
        Path clip2 = tempDir.resolve("clip2.mp4");
        Files.writeString(clip1, "dummy content");
        Files.writeString(clip2, "dummy content");
        File output = tempDir.resolve("out.mp4").toFile();

        // Dem so file truoc khi chay
        long filesBefore = Files.list(tempDir).count();

        videoConcat.concat(List.of(clip1.toFile(), clip2.toFile()), output);

        // Sau khi chay, khong duoc co file filelist.txt nao con lai trong tempDir
        boolean fileListExists = Files.list(tempDir)
            .anyMatch(p -> p.getFileName().toString().startsWith("filelist") &&
                          p.getFileName().toString().endsWith(".txt"));
        assertFalse(fileListExists, "File filelist.txt tam phai bi xoa sau khi concat ket thuc");
    }

    // =========================================================================
    // AC-7: FFmpeg exit code != 0 → failure CUT_FAILED với stderr detail
    // (Được bao gồm trong luồng concat fail vì file dummy không phải MP4 thật)
    // =========================================================================

    @Test
    @DisplayName("AC-7: FFmpeg loi (file gia) -> failure, errorCode la CUT_FAILED hoac PROCESS_EXECUTION_FAILED")
    void testConcat_FfmpegError_WithDummyFiles() throws IOException {
        Path clip1 = tempDir.resolve("clip1.mp4");
        Path clip2 = tempDir.resolve("clip2.mp4");
        Files.writeString(clip1, "not a real mp4");
        Files.writeString(clip2, "not a real mp4");
        File output = tempDir.resolve("out.mp4").toFile();

        ConcatResult result = videoConcat.concat(List.of(clip1.toFile(), clip2.toFile()), output);

        // Phai tra ve failure (du may co cai dat ffmpeg hay khong)
        assertFalse(result.success());
        assertNotNull(result.errorCode());
        // Ma loi phai la CUT_FAILED hoac PROCESS_EXECUTION_FAILED hoac TIMEOUT
        assertTrue(
            result.errorCode() == ErrorCode.CUT_FAILED ||
            result.errorCode() == ErrorCode.PROCESS_EXECUTION_FAILED ||
            result.errorCode() == ErrorCode.TIMEOUT,
            "Ma loi phai la CUT_FAILED, PROCESS_EXECUTION_FAILED hoac TIMEOUT, nhung la: " + result.errorCode()
        );
    }

    // =========================================================================
    // Kiem tra ConcatResult record
    // =========================================================================

    @Test
    @DisplayName("ConcatResult.success() phai chua day du thong tin")
    void testConcatResult_SuccessFactory() {
        List<String> inputs = List.of("/path/clip1.mp4", "/path/clip2.mp4");
        ConcatResult result = ConcatResult.success(inputs, "/path/out.mp4", 1234L, 56789L);

        assertTrue(result.success());
        assertEquals(inputs, result.inputFiles());
        assertEquals("/path/out.mp4", result.outputFile());
        assertEquals(1234L, result.executionTimeMs());
        assertEquals(56789L, result.outputSizeBytes());
        assertEquals(ErrorCode.SUCCESS, result.errorCode());
        assertNull(result.errorMessage());
    }

    @Test
    @DisplayName("ConcatResult.failure() phai chua day du thong tin loi")
    void testConcatResult_FailureFactory() {
        List<String> inputs = List.of("/path/clip1.mp4");
        ConcatResult result = ConcatResult.failure(inputs, "/path/out.mp4", 500L,
            ErrorCode.FILE_NOT_FOUND, "Clip khong ton tai");

        assertFalse(result.success());
        assertEquals(ErrorCode.FILE_NOT_FOUND, result.errorCode());
        assertEquals("Clip khong ton tai", result.errorMessage());
        assertEquals(0L, result.outputSizeBytes());
    }
}

