package com.autocut.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;

/**
 * F14 FR-4 / FR-5 — Tìm Python và thư mục gốc dự án.
 *
 * <p>Trước đây hai hàm này nằm trong VideoController và chứa đường dẫn tuyệt đối
 * của máy một thành viên:
 * <pre>
 *   ~/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe
 *   ~/AppData/Local/Programs/Python/Python312/python.exe
 * </pre>
 * Trên Linux hoặc trong container hai đường dẫn đó không tồn tại, nên chỉ còn
 * cách dự phòng là chuỗi {@code "python"} — có thể không có, hoặc là Python 2.
 *
 * <p>Đây là lỗi chỉ lộ ra khi chạy ở máy khác, không lộ khi chạy ở máy tác giả.
 * Test dưới đây chốt hành vi mới để lỗi đó không quay lại.
 *
 * <p>Mọi test đều tiêm bảng biến môi trường giả và hàm kiểm tra tồn tại giả —
 * không đọc môi trường thật, không cần cài Python. Nhờ vậy chạy được trên CI.
 */
class PythonRuntimeTest {

    /**
     * Chuẩn hoá đường dẫn để so sánh được trên mọi hệ điều hành.
     *
     * <p>Windows dựng đường dẫn bằng dấu gạch chéo ngược, Linux dùng gạch chéo
     * xuôi, nên predicate giả lập hệ thống tệp phải chuẩn hoá trước khi so sánh.
     * Không chuẩn hoá thì test sẽ đỏ trên Windows dù logic đúng.
     */
    private static String normalize(Path p) {
        // Gộp các dấu chéo liên tiếp: trên Linux, Paths.get("C:\\Python312\\")
        // là một tên tệp hợp lệ, rồi .resolve("python3.exe") nối thêm "/" nên
        // sinh "C:\Python312\/python3.exe". Trên Windows thì không có dấu chéo
        // kép. Không gộp thì test giả lập Windows sẽ đỏ khi chạy trên Linux.
        return p.toString().replace('\\', '/').replaceAll("/{2,}", "/");
    }

    /** Predicate giả lập: các đường dẫn này được coi là tồn tại. */
    private static Predicate<Path> existing(String... unixPaths) {
        return p -> {
            String got = normalize(p);
            for (String want : unixPaths) {
                if (got.equals(want) || got.endsWith(want)) {
                    return true;
                }
            }
            return false;
        };
    }

    /** Biến môi trường giả; không bao giờ chạm System.getenv(). */
    private static Map<String, String> env(String... pairs) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            m.put(pairs[i], pairs[i + 1]);
        }
        return m;
    }

    // ---------------------------------------------------------------- FR-4

    @Test
    @DisplayName("PYTHON_EXE được đặt và tệp tồn tại: dùng ngay, không dò tiếp")
    void prefersEnvVar(@TempDir Path tmp) throws IOException {
        Path fakePython = Files.createFile(tmp.resolve("python"));
        Map<String, String> e = env("PYTHON_EXE", fakePython.toString(), "PATH", "");

        String resolved = PythonRuntime.resolvePythonExecutable(e, p -> true);

        Assertions.assertEquals(fakePython.toString(), resolved);
    }

    @Test
    @DisplayName("PYTHON_EXE trỏ tới tệp không tồn tại: bỏ qua, dò tiếp python3")
    void envVarMissingFileFallsThrough() {
        Map<String, String> e = env(
                "PYTHON_EXE", "/khong/ton/tai/python",
                "PATH", "/usr/bin:/bin",
                "OS", "Linux");

        String resolved = PythonRuntime.resolvePythonExecutable(e, existing("/usr/bin/python3"));

        Assertions.assertEquals("python3", resolved,
                "Đường dẫn hỏng trong PYTHON_EXE không được làm chết ứng dụng");
    }

    @Test
    @DisplayName("Không có PYTHON_EXE: dùng python3 khi có trong PATH")
    void fallsBackToPython3() {
        Map<String, String> e = env("PATH", "/usr/local/bin:/usr/bin", "OS", "Linux");

        String resolved = PythonRuntime.resolvePythonExecutable(e, existing("/usr/bin/python3"));

        Assertions.assertEquals("python3", resolved);
    }

    @Test
    @DisplayName("Chỉ có python (không có python3): dùng python")
    void fallsBackToPython() {
        Map<String, String> e = env("PATH", "/usr/bin", "OS", "Linux");

        String resolved = PythonRuntime.resolvePythonExecutable(e, existing("/usr/bin/python"));

        Assertions.assertEquals("python", resolved);
    }

    @Test
    @DisplayName("Windows: tìm cả python3.exe trong PATH, phân tách bằng ';'")
    void findsExeOnWindows() {
        Map<String, String> e = env(
                "PATH", "C:\\Python312\\;C:\\Windows\\system32",
                "OS", "Windows_NT");

        String resolved = PythonRuntime.resolvePythonExecutable(
                e, existing("C:/Python312/python3.exe"));

        Assertions.assertEquals("python3", resolved,
                "Trên Windows tên tệp là python3.exe, không phải python3");
    }

    @Test
    @DisplayName("Windows: dấu ':' trong ổ đĩa không được cắt PATH sai")
    void windowsDriveColonDoesNotBreakPath() {
        Map<String, String> e = env(
                "PATH", "C:\\Tools\\;D:\\Python311",
                "OS", "Windows_NT");

        String resolved = PythonRuntime.resolvePythonExecutable(
                e, existing("D:/Python311/python.exe"));

        Assertions.assertEquals("python", resolved);
    }

    @Test
    @DisplayName("Không tìm thấy Python ở đâu: ném lỗi nêu rõ cách sửa")
    void noPythonThrowsClearError() {
        Map<String, String> e = env("PATH", "/usr/bin", "OS", "Linux");

        IllegalStateException ex = Assertions.assertThrows(IllegalStateException.class,
                () -> PythonRuntime.resolvePythonExecutable(e, p -> false));

        String msg = ex.getMessage();
        Assertions.assertTrue(msg.contains("PYTHON_EXE"),
                "Thông báo phải nói tới biến cần đặt, hiện tại: " + msg);
        Assertions.assertTrue(msg.toLowerCase().contains("python"),
                "Thông báo phải nói rõ thiếu gì: " + msg);
    }

    @Test
    @DisplayName("Không còn đường dẫn AppData nào trong lớp này")
    void noHardcodedWindowsPaths() {
        Map<String, String> e = env("PATH", "", "OS", "Linux");
        IllegalStateException ex = Assertions.assertThrows(IllegalStateException.class,
                () -> PythonRuntime.resolvePythonExecutable(e, p -> false));

        Assertions.assertFalse(ex.getMessage().contains("AppData"),
                "Thông báo lỗi không được nhắc đường dẫn riêng của một máy");
    }

    // ---------------------------------------------------------------- FR-5

    @Test
    @DisplayName("AUTOCUT_HOME được đặt: dùng làm thư mục gốc, không dò")
    void autocutHomeTakesPrecedence(@TempDir Path tmp) throws IOException {
        Path home = tmp.resolve("app");
        Files.createDirectories(home.resolve("backend/ai"));
        Files.createFile(home.resolve("backend/ai/cli.py"));

        Path otherCwd = tmp.resolve("somewhere-else");
        Files.createDirectories(otherCwd);

        Path root = PythonRuntime.resolveProjectRoot(
                env("AUTOCUT_HOME", home.toString()), otherCwd, Files::exists);

        Assertions.assertEquals(home.toAbsolutePath().normalize(),
                root.toAbsolutePath().normalize(),
                "AUTOCUT_HOME phải thắng thư mục làm việc hiện tại");
    }

    @Test
    @DisplayName("Không có AUTOCUT_HOME: dò ngược lên tìm backend/ai/cli.py")
    void walksUpToFindProjectRoot(@TempDir Path tmp) throws IOException {
        Path root = tmp.resolve("AutoCut");
        Files.createDirectories(root.resolve("backend/ai"));
        Files.createFile(root.resolve("backend/ai/cli.py"));

        Path cwd = root.resolve("backend");
        Files.createDirectories(cwd);

        Path found = PythonRuntime.resolveProjectRoot(env(), cwd, Files::exists);

        Assertions.assertEquals(root.toAbsolutePath().normalize(),
                found.toAbsolutePath().normalize());
    }

    @Test
    @DisplayName("Không tìm thấy dấu hiệu dự án: trả về thư mục hiện tại, không nổ")
    void fallsBackToCwd(@TempDir Path tmp) {
        Path cwd = tmp.resolve("empty");
        Assertions.assertNotNull(cwd);

        Path found = PythonRuntime.resolveProjectRoot(env(), cwd, p -> false);

        Assertions.assertEquals(cwd.toAbsolutePath().normalize(),
                found.toAbsolutePath().normalize());
    }

    @Test
    @DisplayName("AUTOCUT_HOME trỏ thư mục không có backend/ai: bỏ qua, dò tiếp")
    void invalidAutocutHomeFallsThrough(@TempDir Path tmp) throws IOException {
        Path bogus = tmp.resolve("khong-phai-du-an");
        Files.createDirectories(bogus);

        Path root = tmp.resolve("real");
        Files.createDirectories(root.resolve("backend/ai"));
        Files.createFile(root.resolve("backend/ai/cli.py"));
        Path cwd = root.resolve("backend");
        Files.createDirectories(cwd);

        Path found = PythonRuntime.resolveProjectRoot(
                env("AUTOCUT_HOME", bogus.toString()), cwd, Files::exists);

        Assertions.assertEquals(root.toAbsolutePath().normalize(),
                found.toAbsolutePath().normalize(),
                "AUTOCUT_HOME sai không được che mất dự án thật");
    }
}
