package com.autocut.service;

import com.autocut.dto.VideoValidationResult;
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

class VideoValidatorTest {

    private VideoValidator validator;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        validator = new VideoValidator("ffprobe");
    }

    @Test
    @DisplayName("Kiểm tra file null: Trả về kết quả không hợp lệ, không crash")
    void testValidate_NullFile() {
        VideoValidationResult result = validator.validate((File) null);
        assertNotNull(result);
        assertFalse(result.isValid());
        assertTrue(result.errorMessage().contains("null"));
    }

    @Test
    @DisplayName("Kiểm tra file không tồn tại: Trả về kết quả không hợp lệ")
    void testValidate_NonExistentFile() {
        File missingFile = tempDir.resolve("missing_video.mp4").toFile();
        VideoValidationResult result = validator.validate(missingFile);
        assertNotNull(result);
        assertFalse(result.isValid());
        assertTrue(result.errorMessage().contains("không tồn tại"));
    }

    @Test
    @DisplayName("Kiểm tra file 0 byte: Trả về kết quả không hợp lệ")
    void testValidate_ZeroByteFile() throws IOException {
        Path emptyFilePath = tempDir.resolve("empty.mp4");
        Files.createFile(emptyFilePath);

        VideoValidationResult result = validator.validate(emptyFilePath.toFile());
        assertNotNull(result);
        assertFalse(result.isValid());
        assertTrue(result.errorMessage().contains("0 bytes"));
    }

    @Test
    @DisplayName("Kiểm tra file rác/hỏng: Bắt lỗi file hỏng và không làm sập chương trình")
    void testValidate_CorruptedFile() throws IOException {
        Path corruptedPath = tempDir.resolve("corrupted.mp4");
        Files.writeString(corruptedPath, "Day la file van ban gia mao video mp4");

        VideoValidationResult result = validator.validate(corruptedPath.toFile());
        assertNotNull(result);
        assertFalse(result.isValid());
        assertNotNull(result.errorMessage());
    }

    @Test
    @DisplayName("Cơ chế chịu lỗi khi xử lý theo lô (validateBatch): Bỏ qua file lỗi và chạy tiếp")
    void testValidateBatch_FaultTolerance() throws IOException {
        Path emptyFile = tempDir.resolve("empty.mp4");
        Files.createFile(emptyFile);

        Path corruptedFile = tempDir.resolve("corrupted.mp4");
        Files.writeString(corruptedFile, "fake video content");

        File missingFile = tempDir.resolve("not_found.mp4").toFile();

        List<File> batch = List.of(emptyFile.toFile(), corruptedFile.toFile(), missingFile);

        List<VideoValidationResult> results = validator.validateBatch(batch);

        assertEquals(3, results.size());
        assertFalse(results.get(0).isValid());
        assertFalse(results.get(1).isValid());
        assertFalse(results.get(2).isValid());
    }
}
