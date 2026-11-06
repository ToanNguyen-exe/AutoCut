package com.autocut.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class PathSlugifierTest {

    @TempDir
    Path tempDir;

    @Test
    @DisplayName("Xóa toàn bộ dấu tiếng Việt và chuẩn hóa chữ đ/Đ")
    void testRemoveAccents() {
        String input = "Đường đi đến Đắk Lắk vòng lặp xử lý chuỗi";
        String expected = "Duong di den Dak Lak vong lap xu ly chuoi";
        assertEquals(expected, PathSlugifier.removeAccents(input));
    }

    @Test
    @DisplayName("Slugify: Loại bỏ triệt để các ký tự cấm của hệ điều hành và dấu chấm lửng")
    void testSlugify_StripIllegalCharsAndEllipses() {
        // Kiểm tra với các ký tự cấm: \ / : * ? " < > | và dấu ...
        String input = "do...while? / \\ : * \" < > |";
        String slug = PathSlugifier.slugify(input);
        assertEquals("do-while", slug);
    }

    @Test
    @DisplayName("Trích xuất slug thông minh từ tên chủ đề có tiền tố bài giảng")
    void testExtractTopicSlug() {
        assertEquals("do-while", PathSlugifier.extractTopicSlug("Vòng lặp do...while?"));
        assertEquals("for", PathSlugifier.extractTopicSlug("Vòng lặp for"));
        assertEquals("while", PathSlugifier.extractTopicSlug("Vòng lặp while"));
        assertEquals("tinh-tong-1-den-n", PathSlugifier.extractTopicSlug("Tính tổng 1 đến N"));
    }

    @Test
    @DisplayName("Sinh tên thư mục phần lớn theo dạng PascalCase có số thứ tự 2 chữ số")
    void testToSectionFolderName() {
        assertEquals("01_LyThuyet", PathSlugifier.toSectionFolderName(1, "Lý thuyết"));
        assertEquals("02_ThucHanhViDu", PathSlugifier.toSectionFolderName(2, "Thực hành ví dụ"));
        assertEquals("03_BaiTap", PathSlugifier.toSectionFolderName(3, "Bài tập"));
    }

    @Test
    @DisplayName("Chuyển đổi mẫu chuẩn: 'Vòng lặp do...while?' -> '03_do-while.mp4'")
    void testToTopicFileName_SampleConversion() {
        String result = PathSlugifier.toTopicFileName(3, "Vòng lặp do...while?");
        assertEquals("03_do-while.mp4", result);

        String resultDirectSlug = PathSlugifier.toTopicFileName(3, "do...while?");
        assertEquals("03_do-while.mp4", resultDirectSlug);

        String resultFor = PathSlugifier.toTopicFileName(1, "Vòng lặp for");
        assertEquals("01_for.mp4", resultFor);
    }

    @Test
    @DisplayName("Tự động sinh cây thư mục bằng Files.createDirectories()")
    void testCreateDirectories() throws IOException {
        Path deepFolder = tempDir.resolve("Bai05_VongLap").resolve("01_LyThuyet");
        assertFalse(Files.exists(deepFolder));

        Path created = PathSlugifier.createDirectories(deepFolder);
        assertTrue(Files.exists(created));
        assertTrue(Files.isDirectory(created));

        // Gọi lại không bị lỗi (idempotent)
        assertDoesNotThrow(() -> PathSlugifier.createDirectories(deepFolder));
    }

    @Test
    @DisplayName("Hàm resolveOutputFile: Tự tạo thư mục cha và trả về đường dẫn file đầy đủ")
    void testResolveOutputFile() throws IOException {
        Path baseOutputDir = tempDir.resolve("Course_Java");

        Path outputFile = PathSlugifier.resolveOutputFile(
            baseOutputDir,
            1, "Lý thuyết",
            3, "Vòng lặp do...while?"
        );

        assertNotNull(outputFile);
        assertEquals("03_do-while.mp4", outputFile.getFileName().toString());
        assertEquals("01_LyThuyet", outputFile.getParent().getFileName().toString());

        // Kiểm tra thư mục cha 01_LyThuyet đã được tự động tạo thực tế trên đĩa
        assertTrue(Files.exists(outputFile.getParent()));
        assertTrue(Files.isDirectory(outputFile.getParent()));
    }
}
