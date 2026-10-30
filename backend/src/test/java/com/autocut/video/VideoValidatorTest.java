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

class VideoValidatorTest {

    private VideoValidator validator;
    private VideoProps props;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        props = new VideoProps("ffprobe", "ffmpeg", 10);
        validator = new VideoValidator(props);
    }

    @Test
    @DisplayName("Kiểm tra file null: Trả về kết quả không hợp lệ, mã lỗi FILE_NOT_FOUND")
    void testValidate_NullFile() {
        ValidationResult result = validator.validate((File) null);
        assertNotNull(result);
        assertFalse(result.isValid());
        assertEquals(ErrorCode.FILE_NOT_FOUND, result.errorCode());
    }

    @Test
    @DisplayName("Kiểm tra file không tồn tại: Trả về kết quả không hợp lệ, mã lỗi FILE_NOT_FOUND")
    void testValidate_NonExistentFile() {
        File missingFile = tempDir.resolve("missing_video.mp4").toFile();
        ValidationResult result = validator.validate(missingFile);
        assertNotNull(result);
        assertFalse(result.isValid());
        assertEquals(ErrorCode.FILE_NOT_FOUND, result.errorCode());
    }

    @Test
    @DisplayName("Kiểm tra file 0 byte: Trả về kết quả không hợp lệ, mã lỗi FILE_EMPTY")
    void testValidate_ZeroByteFile() throws IOException {
        Path emptyFilePath = tempDir.resolve("empty.mp4");
        Files.createFile(emptyFilePath);

        ValidationResult result = validator.validate(emptyFilePath.toFile());
        assertNotNull(result);
        assertFalse(result.isValid());
        assertEquals(ErrorCode.FILE_EMPTY, result.errorCode());
    }

    @Test
    @DisplayName("Kiểm tra file rác/hỏng: Bắt lỗi file hỏng và không làm sập chương trình")
    void testValidate_CorruptedFile() throws IOException {
        Path corruptedPath = tempDir.resolve("corrupted.mp4");
        Files.writeString(corruptedPath, "Day la file gia mao mp4");

        ValidationResult result = validator.validate(corruptedPath.toFile());
        assertNotNull(result);
        assertFalse(result.isValid());
        assertNotEquals(ErrorCode.SUCCESS, result.errorCode());
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

        List<ValidationResult> results = validator.validateBatch(batch);

        assertEquals(3, results.size());
        assertFalse(results.get(0).isValid());
        assertFalse(results.get(1).isValid());
        assertFalse(results.get(2).isValid());
    }
}
