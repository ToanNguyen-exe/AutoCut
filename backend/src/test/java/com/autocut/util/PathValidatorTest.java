package com.autocut.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class PathValidatorTest {

    @TempDir
    Path tempDir;

    @Test
    @DisplayName("Chặn path traversal chứa ../../.env")
    void testBlockPathTraversal_DotDotEnv() {
        Path projectRoot = tempDir;

        SecurityException ex = assertThrows(SecurityException.class, () ->
            PathValidator.resolveSafeOutputPath(projectRoot, "../../.env")
        );
        assertTrue(ex.getMessage().contains("traversal") || ex.getMessage().contains("output"));
    }

    @Test
    @DisplayName("Chặn path traversal ẩn bên trong subpath: sub/../../.env")
    void testBlockPathTraversal_NestedDotDot() {
        Path projectRoot = tempDir;

        assertThrows(SecurityException.class, () ->
            PathValidator.resolveSafeOutputPath(projectRoot, "sub/../../.env")
        );
    }

    @Test
    @DisplayName("Chặn đường dẫn tuyệt đối hoặc thoát ra ngoài thư mục output")
    void testBlockPathTraversal_RootPath() {
        Path projectRoot = tempDir;

        assertThrows(SecurityException.class, () ->
            PathValidator.resolveSafeOutputPath(projectRoot, "/etc/passwd")
        );
    }

    @Test
    @DisplayName("Cho phép đường dẫn hợp lệ nằm trong thư mục output: output/clip.mp4")
    void testAllowValidPath_WithOutputPrefix() throws IOException {
        Path projectRoot = tempDir;
        Path outputDir = projectRoot.resolve("output");
        Files.createDirectories(outputDir);
        Path validFile = outputDir.resolve("test_clip.mp4");
        Files.writeString(validFile, "dummy video data");

        Path resolved = PathValidator.resolveSafeOutputPath(projectRoot, "output/test_clip.mp4");
        assertEquals(validFile.toAbsolutePath().normalize(), resolved);
    }

    @Test
    @DisplayName("Cho phép đường dẫn tương đối không có tiền tố output/: clip.mp4")
    void testAllowValidPath_WithoutOutputPrefix() throws IOException {
        Path projectRoot = tempDir;
        Path outputDir = projectRoot.resolve("output");
        Files.createDirectories(outputDir);
        Path validFile = outputDir.resolve("test_clip.mp4");
        Files.writeString(validFile, "dummy video data");

        Path resolved = PathValidator.resolveSafeOutputPath(projectRoot, "test_clip.mp4");
        assertEquals(validFile.toAbsolutePath().normalize(), resolved);
    }

    @Test
    @DisplayName("Đường dẫn null hoặc rỗng phải ném IllegalArgumentException")
    void testNullOrBlankPath() {
        Path projectRoot = tempDir;

        assertThrows(IllegalArgumentException.class, () ->
            PathValidator.resolveSafeOutputPath(projectRoot, null)
        );
        assertThrows(IllegalArgumentException.class, () ->
            PathValidator.resolveSafeOutputPath(projectRoot, "   ")
        );
    }
}

