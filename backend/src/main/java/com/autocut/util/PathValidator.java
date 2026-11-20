package com.autocut.util;

import java.nio.file.Path;

/**
 * Tiện ích kiểm tra và xác thực an toàn đường dẫn tệp (SV3 & SV1 dùng chung).
 * Chống lỗ hổng Path Traversal (CWE-22) khi người dùng truyền đường dẫn có chứa "../"
 * hoặc cố tình truy xuất các tệp hệ thống ngoài thư mục output/.
 */
public final class PathValidator {

    private PathValidator() {}

    /**
     * Phân giải và kiểm tra tính an toàn của đường dẫn tệp người dùng gửi lên.
     * Đảm bảo tệp bắt buộc phải nằm nghiêm ngặt bên trong thư mục output/ của dự án.
     *
     * @param projectRoot Thư mục gốc của dự án (project root)
     * @param userPath    Đường dẫn do người dùng hoặc client truyền vào
     * @return Path an toàn tuyệt đối đã chuẩn hóa
     * @throws SecurityException nếu phát hiện ký tự traversal hoặc đường dẫn thoát ra ngoài output/
     * @throws IllegalArgumentException nếu userPath null hoặc để trống
     */
    public static Path resolveSafeOutputPath(Path projectRoot, String userPath) {
        if (userPath == null || userPath.isBlank()) {
            throw new IllegalArgumentException("Đường dẫn tệp không được để trống");
        }

        // 1. Chặn ngay lập tức nếu đường dẫn chứa chuỗi traversal "../" hoặc "..\\"
        if (userPath.contains("..")) {
            throw new SecurityException("Phát hiện ký tự path traversal không an toàn: " + userPath);
        }

        if (projectRoot == null) {
            throw new IllegalArgumentException("Project root không được null");
        }

        Path outputBase = projectRoot.resolve("output").toAbsolutePath().normalize();

        // 2. Chuẩn hóa tiền tố: nếu client truyền "output/..." hoặc "output\\..." hoặc "..."
        Path target;
        String normalizedInput = userPath.trim();
        if (normalizedInput.startsWith("output/") || normalizedInput.startsWith("output\\")) {
            target = projectRoot.resolve(normalizedInput).toAbsolutePath().normalize();
        } else if (normalizedInput.startsWith("/") || normalizedInput.startsWith("\\")) {
            // Chặn đường dẫn tuyệt đối bắt đầu bằng root
            throw new SecurityException("Đường dẫn không được bắt đầu bằng dấu gạch chéo gốc: " + userPath);
        } else {
            target = outputBase.resolve(normalizedInput).toAbsolutePath().normalize();
        }

        // 3. Kiểm tra ranh giới an toàn: target phải nằm bên trong outputBase
        if (!target.startsWith(outputBase)) {
            throw new SecurityException("Đường dẫn không hợp lệ hoặc nằm ngoài thư mục output: " + userPath);
        }

        return target;
    }
}

