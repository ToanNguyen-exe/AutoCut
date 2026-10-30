package com.autocut.video;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;

/**
 * Tiện ích đọc luồng tiến trình an toàn bằng bộ đệm.
 * Ngăn chặn nguy cơ deadlock khi pipe buffer của hệ điều hành bị đầy.
 */
public final class StreamUtil {

    private StreamUtil() {}

    /**
     * Đọc toàn bộ nội dung từ InputStream bất đồng bộ bằng BufferedReader.
     *
     * @param inputStream Luồng dữ liệu cần đọc (stdout hoặc stderr của Process)
     * @return CompletableFuture chứa chuỗi kết quả
     */
    public static CompletableFuture<String> readStreamAsync(InputStream inputStream) {
        return CompletableFuture.supplyAsync(() -> {
            if (inputStream == null) {
                return "";
            }
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append(System.lineSeparator());
                }
            } catch (Exception e) {
                // Đóng luồng an toàn khi tiến trình hoàn tất
            }
            return sb.toString();
        });
    }
}
