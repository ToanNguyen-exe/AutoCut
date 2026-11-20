package com.autocut.video;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * F04 FR-1 — Hàm duy nhất kiểm tra đường dẫn do client gửi lên.
 *
 * <p>Trước đây mỗi endpoint tự xử lý đường dẫn một kiểu, và cả bốn chỗ đều cho
 * phép thoát ra ngoài thư mục cho phép. Test này chốt hành vi của hàm thay thế:
 * chỉ trả về đường dẫn khi nó nằm trong thư mục gốc, còn lại ném lỗi.
 *
 * <p>Các chuỗi tấn công dưới đây lấy từ OWASP Path Traversal và từ chính cách
 * các endpoint cũ bị khai thác — kể cả dạng backslash của Windows.
 */
class SafePathsTest {

    // ---------------------------------------------------------- phải bị chặn

    @ParameterizedTest(name = "từ chối: {0}")
    @ValueSource(strings = {
            "../x",
            "../../.env",
            "a/../../x",
            "..\\..\\.env",
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "C:/Windows/win.ini",
            "\\\\server\\share\\file",
            "..",
            ".",
            "   "
    })
    @DisplayName("Chuỗi thoát ra ngoài thư mục gốc đều bị từ chối")
    void rejectsEscapingPaths(String input, @TempDir Path root) {
        Assertions.assertThrows(PathOutsideRootException.class,
                () -> SafePaths.resolveWithin(root, input),
                "Phải từ chối: " + input);
    }

    @Test
    @DisplayName("Từ chối null, rỗng, và ký tự NUL")
    void rejectsNullBlankAndNul(@TempDir Path root) {
        Assertions.assertThrows(PathOutsideRootException.class,
                () -> SafePaths.resolveWithin(root, null));
        Assertions.assertThrows(PathOutsideRootException.class,
                () -> SafePaths.resolveWithin(root, ""));
        Assertions.assertThrows(PathOutsideRootException.class,
                () -> SafePaths.resolveWithin(root, "a" + (char) 0 + "b"));
    }

    @Test
    @DisplayName("Từ chối symlink trỏ ra ngoài thư mục gốc")
    void rejectsSymlinkEscape(@TempDir Path tmp) throws IOException {
        Path root = Files.createDirectories(tmp.resolve("output"));
        Path outside = Files.createDirectories(tmp.resolve("bi-mat"));
        Files.writeString(outside.resolve("key.txt"), "noi dung");

        Path link = root.resolve("link");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (IOException | UnsupportedOperationException e) {
            Assumptions.abort("Máy không tạo được symlink (Windows cần quyền): " + e.getMessage());
        }

        Assertions.assertThrows(PathOutsideRootException.class,
                () -> SafePaths.resolveWithin(root, "link/key.txt"),
                "Symlink ra ngoài phải bị chặn sau toRealPath()");
    }

    // ---------------------------------------------------------- phải được nhận

    @ParameterizedTest(name = "chấp nhận: {0}")
    @ValueSource(strings = {
            "lesson1/01_intro.mp4",
            "a/./b.mp4",
            "users/u01/Bai05/clip_01.mp4"
    })
    @DisplayName("Đường dẫn tương đối nằm trong thư mục gốc được chấp nhận")
    void acceptsPathsInsideRoot(String input, @TempDir Path root) throws IOException {
        Path resolved = SafePaths.resolveWithin(root, input);

        Assertions.assertTrue(resolved.startsWith(root.toRealPath()),
                "Kết quả phải nằm trong thư mục gốc: " + resolved);
        Assertions.assertTrue(resolved.endsWith(Paths.get(input).getFileName()));
    }

    @Test
    @DisplayName("Đường dẫn tuyệt đối nằm trong thư mục gốc vẫn phải chạy (AC-8)")
    void acceptsAbsolutePathInsideRoot(@TempDir Path root) throws IOException {
        Path file = Files.createFile(root.resolve("clip.mp4"));

        // Frontend cũ gửi nguyên local_path tuyệt đối do job cắt trả về.
        // Nếu chặn hết đường dẫn tuyệt đối thì nút "Tải clip" chết.
        Path resolved = SafePaths.resolveWithin(root, file.toAbsolutePath().toString());

        Assertions.assertEquals(file.toRealPath(), resolved);
    }

    @Test
    @DisplayName("Đường dẫn tuyệt đối nằm ngoài thư mục gốc bị từ chối")
    void rejectsAbsolutePathOutsideRoot(@TempDir Path tmp) throws IOException {
        Path root = Files.createDirectories(tmp.resolve("output"));
        Path outside = Files.createFile(tmp.resolve("bi-mat.env"));

        Assertions.assertThrows(PathOutsideRootException.class,
                () -> SafePaths.resolveWithin(root, outside.toAbsolutePath().toString()),
                "Tệp tồn tại nhưng ở ngoài thư mục gốc thì vẫn phải chặn");
    }

    // ------------------------------------------------------------- slug & hash

    @ParameterizedTest(name = "slug hợp lệ: {0}")
    @ValueSource(strings = {"Bai05_VongLap", "lesson-1", "a.b", "abc123"})
    @DisplayName("Slug hợp lệ khớp ^[a-zA-Z0-9_.-]{1,100}$")
    void acceptsValidSlug(String value) {
        Assertions.assertTrue(SafePaths.isSafeSlug(value), "Phải nhận: " + value);
    }

    @ParameterizedTest(name = "slug không hợp lệ: {0}")
    @ValueSource(strings = {"..", ".", "../x", "a/b", "a\\b", "", "co dau cach", "a:b"})
    @DisplayName("Slug chứa đường dẫn hoặc ký tự lạ bị từ chối")
    void rejectsInvalidSlug(String value) {
        Assertions.assertFalse(SafePaths.isSafeSlug(value), "Phải từ chối: " + value);
    }

    @Test
    @DisplayName("Slug dài quá 100 ký tự bị từ chối")
    void rejectsTooLongSlug() {
        Assertions.assertFalse(SafePaths.isSafeSlug("a".repeat(101)));
        Assertions.assertTrue(SafePaths.isSafeSlug("a".repeat(100)));
    }

    @Test
    @DisplayName("Hash chỉ hợp lệ khi đúng 64 ký tự hex")
    void validatesSha256() {
        String hash = "a".repeat(64);
        Assertions.assertTrue(SafePaths.isSha256(hash));
        Assertions.assertTrue(SafePaths.isSha256("deadbeef".repeat(8)));

        Assertions.assertFalse(SafePaths.isSha256(null));
        Assertions.assertFalse(SafePaths.isSha256(""));
        Assertions.assertFalse(SafePaths.isSha256("a"),
                "Hash 1 ký tự từng trả về video đầu tiên tìm được");
        Assertions.assertFalse(SafePaths.isSha256("a".repeat(63)));
        Assertions.assertFalse(SafePaths.isSha256("a".repeat(65)));
        Assertions.assertFalse(SafePaths.isSha256("g".repeat(64)),
                "64 ký tự nhưng không phải hex");
        Assertions.assertFalse(SafePaths.isSha256("A".repeat(64)),
                "Hash SHA-256 biểu diễn chữ thường");
    }
}
