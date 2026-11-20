package com.autocut.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

/**
 * Tìm chương trình Python và thư mục gốc dự án — không phụ thuộc máy nào.
 *
 * <p>Hai hàm ở đây tách ra từ {@code VideoController} (F14 FR-4, FR-5). Bản cũ
 * chứa đường dẫn tuyệt đối của một máy Windows cụ thể, nên chỉ chạy đúng trên
 * máy tác giả. Trong container hoặc trên Linux, chúng lặng lẽ rơi về chuỗi
 * {@code "python"}, mà lệnh này có thể không tồn tại hoặc là Python 2.
 *
 * <p>Thiết kế: logic thuần, nhận bảng biến môi trường và hàm kiểm tra tồn tại
 * qua tham số. Nhờ vậy test được mọi nhánh mà không cần cài Python, không cần
 * đọc môi trường thật, và chạy được trên CI.
 *
 * <p>Thứ tự tìm Python (FR-4): {@code PYTHON_EXE} → {@code python3} → {@code python}.
 * Không còn nhánh nào phụ thuộc tên người dùng hay thư mục hồ sơ Windows.
 */
public final class PythonRuntime {

    private static final Logger log = LoggerFactory.getLogger(PythonRuntime.class);

    /** Biến môi trường ưu tiên cao nhất, dùng trong Dockerfile. */
    public static final String ENV_PYTHON_EXE = "PYTHON_EXE";

    /** Thư mục gốc dự án, dùng trong container (FR-5). */
    public static final String ENV_AUTOCUT_HOME = "AUTOCUT_HOME";

    /** Dấu hiệu nhận biết thư mục gốc: module AI nằm ở backend/ai/cli.py. */
    private static final Path PROJECT_MARKER = Paths.get("backend", "ai", "cli.py");

    private PythonRuntime() {
    }

    // ------------------------------------------------------------------ FR-4

    /** Bản dùng thật: đọc môi trường và hệ thống tệp của tiến trình hiện tại. */
    public static String resolvePythonExecutable() {
        return resolvePythonExecutable(System.getenv(), Files::exists);
    }

    /**
     * Tìm đường dẫn (hoặc tên lệnh) Python theo thứ tự ưu tiên.
     *
     * @param env        bảng biến môi trường, thường là {@code System.getenv()}
     * @param fileExists hàm kiểm tra một đường dẫn có tồn tại không
     * @return {@code PYTHON_EXE} nếu hợp lệ, ngược lại {@code "python3"} hoặc {@code "python"}
     * @throws IllegalStateException khi không tìm thấy Python nào
     */
    static String resolvePythonExecutable(Map<String, String> env, Predicate<Path> fileExists) {
        String configured = env.get(ENV_PYTHON_EXE);

        // 1. Biến môi trường được đặt tường minh: đây là hợp đồng với Dockerfile.
        if (configured != null && !configured.isBlank()) {
            if (fileExists.test(Paths.get(configured))) {
                return configured;
            }
            // Đường dẫn hỏng không nên làm chết ứng dụng: có thể người dùng đổi máy
            // mà quên cập nhật biến. Ghi cảnh báo rồi dò tiếp.
            log.warn("{} trỏ tới tệp không tồn tại: {} — sẽ dò tiếp", ENV_PYTHON_EXE, configured);
        }

        // 2, 3. Dò trong PATH. Không cần chạy thử: chỉ cần tệp tồn tại.
        boolean windows = isWindows(env);
        for (String candidate : List.of("python3", "python")) {
            if (isOnPath(candidate, env, fileExists, windows)) {
                return candidate;
            }
        }

        throw new IllegalStateException("""
                Không tìm thấy Python.

                Đã thử: biến %s, rồi lệnh python3 và python trong PATH.
                Cách sửa:
                  • Máy có sẵn Python: đặt %s=/duong/dan/toi/python
                  • Trong Docker: image đã đặt sẵn %s=/opt/venv/bin/python
                  • Cài Python 3.10 trở lên rồi thêm vào PATH

                Chức năng AI (bóc băng, phân đoạn) cần Python; các chức năng khác
                vẫn dùng được.
                """.formatted(ENV_PYTHON_EXE, ENV_PYTHON_EXE, ENV_PYTHON_EXE));
    }

    /**
     * Kiểm tra một tên lệnh có trong PATH không.
     *
     * <p>Trên Windows tên tệp có đuôi {@code .exe}; trên Unix không có đuôi.
     * Dùng {@code File.pathSeparator} để tách PATH cho đúng hệ điều hành.
     */
    private static boolean isOnPath(String command, Map<String, String> env,
                                    Predicate<Path> fileExists, boolean windows) {
        String path = env.getOrDefault("PATH", "");
        if (path.isBlank()) {
            return false;
        }

        List<String> names = new ArrayList<>();
        names.add(command);
        if (windows) {
            names.add(command + ".exe");
        }

        // Dấu phân cách lấy theo nền tảng của bảng env, KHÔNG theo máy đang chạy:
        // Windows dùng ';' (vì ':' nằm trong ổ đĩa C:\), Unix dùng ':'.
        // Dùng nhầm sẽ không tách được PATH và mọi lần dò đều thất bại.
        String separator = windows ? ";" : ":";

        for (String dir : path.split(java.util.regex.Pattern.quote(separator))) {
            if (dir.isBlank()) {
                continue;
            }
            Path base;
            try {
                base = Paths.get(dir);
            } catch (Exception e) {
                continue; // PATH có mục không hợp lệ — bỏ qua, không làm chết
            }
            for (String name : names) {
                if (fileExists.test(base.resolve(name))) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Windows nếu env báo vậy, hoặc nếu hệ điều hành thật là Windows. */
    private static boolean isWindows(Map<String, String> env) {
        String os = env.get("OS");
        if (os != null) {
            return os.toLowerCase().contains("windows");
        }
        return System.getProperty("os.name", "").toLowerCase().contains("windows");
    }

    // ------------------------------------------------------------------ FR-5

    /** Bản dùng thật: thư mục làm việc hiện tại của tiến trình. */
    public static Path resolveProjectRoot() {
        return resolveProjectRoot(System.getenv(), Paths.get("").toAbsolutePath().normalize(), Files::exists);
    }

    /**
     * Tìm thư mục gốc dự án.
     *
     * <p>Thứ tự: {@code AUTOCUT_HOME} → dò ngược từ thư mục hiện tại lên các cấp
     * cha → thư mục hiện tại.
     *
     * <p>Dò ngược cần thiết vì backend có thể được chạy từ {@code backend/}
     * (Maven) hoặc từ gốc repo (IDE), và trong container là {@code /app}.
     *
     * @param env        bảng biến môi trường
     * @param cwd        thư mục làm việc hiện tại
     * @param fileExists hàm kiểm tra tồn tại
     * @return thư mục gốc, đã chuẩn hoá tuyệt đối
     */
    static Path resolveProjectRoot(Map<String, String> env, Path cwd, Predicate<Path> fileExists) {
        Path start = cwd.toAbsolutePath().normalize();

        // 1. AUTOCUT_HOME — container đặt biến này để không phụ thuộc cwd.
        String configured = env.get(ENV_AUTOCUT_HOME);
        if (configured != null && !configured.isBlank()) {
            Path home;
            try {
                home = Paths.get(configured).toAbsolutePath().normalize();
            } catch (Exception e) {
                log.warn("{} không phải đường dẫn hợp lệ: {}", ENV_AUTOCUT_HOME, configured);
                home = null;
            }
            if (home != null) {
                if (fileExists.test(home.resolve(PROJECT_MARKER))) {
                    return home;
                }
                // Biến sai không được che mất dự án thật: ghi cảnh báo rồi dò tiếp.
                log.warn("{}={} nhưng không thấy {} — sẽ dò từ thư mục hiện tại",
                        ENV_AUTOCUT_HOME, home, PROJECT_MARKER);
            }
        }

        // 2. Dò ngược lên các cấp cha.
        for (Path dir = start; dir != null; dir = dir.getParent()) {
            if (fileExists.test(dir.resolve(PROJECT_MARKER))) {
                return dir;
            }
        }

        // 3. Không thấy dấu hiệu nào: trả về cwd để lỗi hiện ra ở chỗ dùng,
        //    kèm đường dẫn cụ thể, thay vì nổ ở đây với thông báo mơ hồ.
        log.warn("Không tìm thấy {} tính từ {} — dùng thư mục hiện tại",
                PROJECT_MARKER, start);
        return start;
    }
}
