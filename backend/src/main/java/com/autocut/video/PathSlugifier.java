package com.autocut.video;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Tiện ích tự động tạo cây thư mục và chuẩn hóa tên file/slug (Task 3 của SV1).
 * Đảm bảo tên file/thư mục không dấu, loại bỏ 100% ký tự cấm của hệ điều hành.
 */
public final class PathSlugifier {

    private static final Pattern DIACRITICAL_MARKS = Pattern.compile("\\p{InCombiningDiacriticalMarks}+");
    private static final Pattern ILLEGAL_OS_CHARS = Pattern.compile("[\\\\/:*?\"<>|]");
    private static final Pattern MULTI_HYPHENS = Pattern.compile("-+");

    // Các tiền tố thường gặp trong bài giảng để trích xuất slug ngắn gọn nếu có
    private static final Pattern COMMON_PREFIXES = Pattern.compile(
        "^(vong\\s+lap|bai\\s+tap|bai\\s+hoc|vi\\s+du|ly\\s+thuyet|thuc\\s+hanh|tim\\s+hieu\\s+ve|gioi\\s+thieu\\s+ve)\\s+",
        Pattern.CASE_INSENSITIVE
    );

    private PathSlugifier() {}

    /**
     * 1. Xóa toàn bộ dấu tiếng Việt.
     * Xử lý riêng ký tự đ/Đ và dùng Normalizer NFD tách dấu cho các nguyên âm.
     *
     * @param text Chuỗi văn bản tiếng Việt
     * @return Chuỗi không dấu
     */
    public static String removeAccents(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }
        // Ký tự đ/Đ không phân tách được bằng NFD nên cần replace thủ công
        String normalized = text.replace("đ", "d").replace("Đ", "D");
        normalized = Normalizer.normalize(normalized, Normalizer.Form.NFD);
        return DIACRITICAL_MARKS.matcher(normalized).replaceAll("");
    }

    /**
     * 2. Làm sạch chuỗi và chuyển đổi thành slug dạng kebab-case.
     * Loại bỏ triệt để các ký tự đặc biệt của hệ điều hành (\ / : * ? " < > |),
     * dấu chấm lửng (...), dấu câu và thay khoảng trắng bằng dấu gạch nối (-).
     *
     * @param text Chuỗi văn bản đầu vào (ví dụ: "do...while?", "Vòng lặp for")
     * @return Chuỗi slug sạch (ví dụ: "do-while", "vong-lap-for")
     */
    public static String slugify(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }

        // Bước 1: Xóa dấu tiếng Việt
        String clean = removeAccents(text).trim();

        // Bước 2: Loại bỏ ký tự cấm của hệ điều hành
        clean = ILLEGAL_OS_CHARS.matcher(clean).replaceAll("");

        // Bước 3: Thay thế các dấu chấm (ví dụ: "do...while" -> "do-while"), khoảng trắng, ký tự không phải chữ/số thành gạch nối
        clean = clean.replaceAll("[^a-zA-Z0-9]+", "-");

        // Bước 4: Thu gọn nhiều dấu gạch nối liên tiếp và cắt bỏ gạch nối ở 2 đầu
        clean = MULTI_HYPHENS.matcher(clean).replaceAll("-");
        clean = clean.replaceAll("^-|-$", "");

        return clean.toLowerCase(Locale.US);
    }

    /**
     * Trích xuất slug thông minh từ tên chủ đề.
     * Nếu tên chủ đề có các tiền tố bài giảng chung như "Vòng lặp do...while?",
     * hàm sẽ trích xuất slug cốt lõi là "do-while".
     *
     * @param topicTitle Tiêu đề chủ đề (ví dụ: "Vòng lặp do...while?")
     * @return Slug cốt lõi (ví dụ: "do-while")
     */
    public static String extractTopicSlug(String topicTitle) {
        if (topicTitle == null || topicTitle.isBlank()) {
            return "";
        }

        String withoutAccents = removeAccents(topicTitle).trim();
        // Kiểm tra và bóc tách các tiền tố thông dụng nếu phần sau vẫn còn nội dung
        String withoutPrefix = COMMON_PREFIXES.matcher(withoutAccents).replaceFirst("").trim();
        if (!withoutPrefix.isBlank()) {
            return slugify(withoutPrefix);
        }

        return slugify(topicTitle);
    }

    /**
     * 3. Sinh tên thư mục Phần lớn dạng PascalCase kết hợp số thứ tự 2 chữ số.
     * Ví dụ:
     *   sectionNo = 1, sectionName = "Lý thuyết" -> "01_LyThuyet"
     *   sectionNo = 2, sectionName = "Thực hành ví dụ" -> "02_ThucHanhViDu"
     *   sectionNo = 3, sectionName = "Bài tập" -> "03_BaiTap"
     *
     * @param sectionNo   Số thứ tự phần (1, 2, 3...)
     * @param sectionName Tên phần lớn tiếng Việt
     * @return Tên thư mục chuẩn (ví dụ: "01_LyThuyet")
     */
    public static String toSectionFolderName(int sectionNo, String sectionName) {
        String clean = removeAccents(sectionName);
        clean = ILLEGAL_OS_CHARS.matcher(clean).replaceAll("");
        // Chỉ giữ chữ và số để ghép PascalCase
        String[] words = clean.trim().split("[^a-zA-Z0-9]+");

        StringBuilder sb = new StringBuilder();
        for (String word : words) {
            if (!word.isBlank()) {
                sb.append(Character.toUpperCase(word.charAt(0)));
                if (word.length() > 1) {
                    sb.append(word.substring(1).toLowerCase(Locale.US));
                }
            }
        }

        String folderSuffix = sb.toString();
        if (folderSuffix.isBlank()) {
            folderSuffix = "Section";
        }

        return String.format(Locale.US, "%02d_%s", sectionNo, folderSuffix);
    }

    /**
     * 4. Sinh tên file bài học con: {topic_no:02d}_{slug}.mp4
     * Chuyển đổi mẫu: 'Vòng lặp do...while?' -> '03_do-while.mp4' (nếu topicNo=3)
     *
     * @param topicNo     Số thứ tự chủ đề (1, 2, 3...)
     * @param slugOrTitle Slug đã có hoặc tiêu đề chủ đề
     * @return Tên file chuẩn (ví dụ: "03_do-while.mp4")
     */
    public static String toTopicFileName(int topicNo, String slugOrTitle) {
        if (slugOrTitle == null || slugOrTitle.isBlank()) {
            return String.format(Locale.US, "%02d_topic.mp4", topicNo);
        }

        // Ưu tiên trích xuất slug thông minh nếu chuỗi chứa tiền tố (như "Vòng lặp do...while?")
        String slug = extractTopicSlug(slugOrTitle);
        if (slug.isBlank()) {
            slug = slugify(slugOrTitle);
        }
        if (slug.isBlank()) {
            slug = "topic";
        }

        return String.format(Locale.US, "%02d_%s.mp4", topicNo, slug);
    }

    /**
     * 5. Tự động sinh cây thư mục phân cấp vật lý bằng Files.createDirectories().
     * An toàn, đệ quy tạo toàn bộ thư mục cha còn thiếu, không lỗi nếu thư mục đã tồn tại.
     *
     * @param dirPath Đường dẫn thư mục cần tạo
     * @return Path của thư mục đã được khởi tạo
     * @throws IOException Nếu không có quyền ghi hoặc lỗi I/O
     */
    public static Path createDirectories(Path dirPath) throws IOException {
        if (dirPath == null) {
            throw new IllegalArgumentException("Đường dẫn thư mục không được null");
        }
        return Files.createDirectories(dirPath);
    }

    /**
     * 6. Hàm tiện ích "All-in-one":
     * Tự động sinh thư mục phần lớn (Files.createDirectories) và trả về đường dẫn file xuất đầy đủ.
     * Ví dụ: baseOutputDir / "01_LyThuyet" / "03_do-while.mp4"
     *
     * @param baseOutputDir Thư mục gốc xuất video của bài giảng
     * @param sectionNo     Số thứ tự phần (1, 2, ...)
     * @param sectionName   Tên phần lớn ("Lý thuyết", ...)
     * @param topicNo       Số thứ tự bài học (1, 2, ...)
     * @param slugOrTitle   Slug hoặc tiêu đề bài học ("Vòng lặp do...while?", ...)
     * @return Path tuyệt đối đầy đủ của video con đã sẵn sàng ghi file
     * @throws IOException Nếu không thể tạo thư mục
     */
    public static Path resolveOutputFile(Path baseOutputDir, int sectionNo, String sectionName, int topicNo, String slugOrTitle) throws IOException {
        if (baseOutputDir == null) {
            throw new IllegalArgumentException("Thư mục gốc không được null");
        }

        String folderName = toSectionFolderName(sectionNo, sectionName);
        Path sectionDir = baseOutputDir.resolve(folderName);
        createDirectories(sectionDir);

        String fileName = toTopicFileName(topicNo, slugOrTitle);
        return sectionDir.resolve(fileName);
    }
}
