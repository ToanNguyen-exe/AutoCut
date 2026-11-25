package com.autocut.video;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Pattern;

/**
 * F04 FR-1 — Hàm duy nhất kiểm tra đường dẫn do client gửi lên.
 *
 * <p>Trước đây bốn endpoint tự xử lý đường dẫn theo bốn kiểu khác nhau và cả
 * bốn đều cho phép đọc/ghi ngoài thư mục cho phép. Mọi chỗ nhận đường dẫn từ
 * client giờ phải đi qua {@link #resolveWithin(Path, String)}.
 *
 * <p>Ba lớp chặn:
 * <ol>
 *   <li>Chuỗi ký tự: NUL, UNC, rỗng.</li>
 *   <li>Chuẩn hoá: {@code normalize()} + {@code toAbsolutePath()} rồi so với gốc.</li>
 *   <li>Symlink: {@code toRealPath()} để đường tắt trỏ ra ngoài cũng bị phát hiện.</li>
 * </ol>
 */
public final class SafePaths {

    /** Slug dùng cho tên bài/thư mục — không cho dấu chấm đứng một mình. */
    private static final Pattern SLUG = Pattern.compile("^[a-zA-Z0-9_.-]{1,100}$");

    /** Ký tự Windows không cho phép trong tên tệp, cộng ký tự điều khiển. */
    private static final Pattern UNSAFE_NAME_CHARS =
            Pattern.compile("[<>:\"|?*\\x00-\\x1f]");

    /** SHA-256 biểu diễn chữ thường, đúng 64 ký tự hex. */
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");

    private SafePaths() {
    }

    /**
     * Trả về đường dẫn tuyệt đối, đã chuẩn hoá, chắc chắn nằm trong {@code root}.
     *
     * <p>Chấp nhận cả đường dẫn tuyệt đối miễn là nó nằm trong {@code root} —
     * frontend cũ gửi nguyên {@code local_path} do job cắt trả về (AC-8).
     *
     * @throws PathOutsideRootException nếu đường dẫn thoát ra ngoài gốc
     */
    public static Path resolveWithin(Path root, String userInput) {
        if (root == null) {
            throw new PathOutsideRootException("Thư mục gốc chưa được cấu hình");
        }
        if (userInput == null || userInput.isBlank()) {
            throw new PathOutsideRootException("Đường dẫn rỗng");
        }
        if (userInput.indexOf('\0') >= 0) {
            throw new PathOutsideRootException("Đường dẫn chứa ký tự không hợp lệ");
        }

        String input = userInput.trim();

        // "." và ".." trỏ vào chính thư mục — không phải tệp để tải.
        if (".".equals(input) || "..".equals(input)) {
            throw new PathOutsideRootException("Đường dẫn không trỏ tới tệp");
        }

        // \\server\share và //server/share không bao giờ nằm trong thư mục cục bộ.
        if (input.startsWith("\\\\") || input.startsWith("//")) {
            throw new PathOutsideRootException("Đường dẫn mạng không được phép");
        }

        Path rootAbs = root.toAbsolutePath().normalize();
        Path rootReal = realPathOfExistingAncestor(rootAbs);

        Path candidate;
        try {
            candidate = Paths.get(input);
        } catch (InvalidPathException e) {
            throw new PathOutsideRootException("Đường dẫn không hợp lệ", e);
        }

        Path target = (candidate.isAbsolute() ? candidate : rootAbs.resolve(candidate))
                .normalize()
                .toAbsolutePath();

        Path targetReal = realPathOfExistingAncestor(target);
        if (!targetReal.startsWith(rootReal)) {
            throw new PathOutsideRootException("Đường dẫn nằm ngoài thư mục cho phép");
        }
        return targetReal;
    }

    /** Tên bài / thư mục do client đặt: chỉ chữ, số, gạch, chấm. */
    public static boolean isSafeSlug(String value) {
        if (value == null || !SLUG.matcher(value).matches()) {
            return false;
        }
        return !".".equals(value) && !"..".equals(value);
    }

    /**
     * Một tên thư mục đơn do người dùng đặt: cho phép tiếng Việt có dấu, khoảng
     * trắng, ngoặc — nhưng tuyệt đối không có dấu phân cách đường dẫn.
     *
     * <p>Vì sao cần: tiêu đề bài học thật là chuỗi tự do
     * ("Bài giảng Lập trình Web Full khóa (2 Giờ - Vibe-Coding-4.mp4)"), nên lọc
     * bằng {@link #isSafeSlug} sẽ chặn nhầm mọi bài học có dấu. Nhưng nếu chỉ
     * kiểm tra theo phạm vi thì client gửi {@code users/<người khác>/<bài>} vẫn
     * nằm trong {@code output/} và đọc được dữ liệu của người khác — nên phải
     * cấm dấu phân cách ở đây.
     */
    public static boolean isSafeSegment(String value) {
        if (value == null || value.isBlank() || value.length() > 200) {
            return false;
        }
        if (".".equals(value) || "..".equals(value)) {
            return false;
        }
        if (value.indexOf('/') >= 0 || value.indexOf('\\') >= 0) {
            return false;
        }
        // Ký tự Windows không cho phép trong tên tệp, cộng ký tự điều khiển.
        return !UNSAFE_NAME_CHARS.matcher(value).find();
    }

    /** Mã video phải đúng 64 ký tự hex, chữ thường. */
    public static boolean isSha256(String value) {
        return value != null && SHA256.matcher(value).matches();
    }

    /**
     * Lấy đường dẫn thật của phần tử gần nhất đã tồn tại, rồi nối lại phần còn lại.
     *
     * <p>Cần vì tệp đích có thể chưa tồn tại (endpoint ghi tệp), mà
     * {@code toRealPath()} lại đòi hỏi tệp phải có.
     */
    private static Path realPathOfExistingAncestor(Path path) {
        Path existing = path;
        Path remainder = null;

        while (existing != null) {
            if (Files.exists(existing, LinkOption.NOFOLLOW_LINKS)) {
                break;
            }
            Path fileName = existing.getFileName();
            remainder = (remainder == null) ? fileName : fileName.resolve(remainder);
            existing = existing.getParent();
        }

        if (existing == null) {
            return path;
        }

        Path real;
        try {
            // NOFOLLOW_LINKS không dùng ở đây: ta cần đi theo symlink để phát hiện
            // đường tắt trỏ ra ngoài.
            real = existing.toRealPath();
        } catch (IOException e) {
            return path;
        }
        return remainder == null ? real : real.resolve(remainder).normalize();
    }
}
