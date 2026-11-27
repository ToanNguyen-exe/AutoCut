package com.autocut.video;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Kiểm tra việc chọn bộ mã hoá cho bước cắt chính xác: NVENC (GPU) hay libx264 (CPU).
 */
class VideoEncoderSelectionTest {

    private VideoProps props;
    private VideoCutter cutter;
    private File input;
    private File output;

    @BeforeEach
    void setUp() {
        props = new VideoProps();
        cutter = new VideoCutter(props);
        input = Path.of("input", "in.mp4").toFile();
        output = Path.of("output", "out.mp4").toFile();
    }

    @Test
    @DisplayName("buildCommandWithEncoder: NVENC dùng h264_nvenc + -rc vbr + -cq, không có libx264")
    void testNvencCommand() {
        List<String> cmd = cutter.buildCommandWithEncoder(input.getAbsolutePath(), output, "1.000", "5.000", "h264_nvenc");

        assertTrue(cmd.contains("h264_nvenc"), "Phải dùng encoder h264_nvenc");
        assertFalse(cmd.contains("libx264"), "Không được trộn libx264 khi đã chọn NVENC");
        assertTrue(cmd.contains("-rc"), "NVENC cần tham số -rc");
        assertTrue(cmd.contains("vbr"), "NVENC dùng chế độ vbr");
        assertTrue(cmd.contains("-cq"), "NVENC dùng -cq thay cho -crf");
        assertTrue(cmd.contains("-movflags") && cmd.contains("+faststart"), "Vẫn phải có +faststart");
        assertTrue(cmd.contains("aac"), "Audio vẫn re-encode sang aac");
    }

    @Test
    @DisplayName("buildCommandWithEncoder: libx264 giữ nguyên lệnh cũ")
    void testLibx264Command() {
        List<String> cmd = cutter.buildCommandWithEncoder(input.getAbsolutePath(), output, "1.000", "5.000", "libx264");

        assertTrue(cmd.contains("libx264"));
        assertFalse(cmd.contains("h264_nvenc"));
        assertTrue(cmd.contains("+faststart"));
    }

    @Test
    @DisplayName("resolveVideoEncoder: cấu hình ép libx264 thì không dò GPU")
    void testResolveForceCpu() {
        props.setEncoder("libx264");
        assertEquals("libx264", cutter.resolveVideoEncoder());
    }

    @Test
    @DisplayName("resolveVideoEncoder: cấu hình ép nvenc thì dùng GPU")
    void testResolveForceGpu() {
        props.setEncoder("nvenc");
        assertEquals("h264_nvenc", cutter.resolveVideoEncoder());
    }

    @Test
    @DisplayName("resolveVideoEncoder: giá trị lạ rơi về nhánh auto")
    void testResolveUnknownFallsBackToAuto() {
        props.setEncoder("something-weird");
        String encoder = cutter.resolveVideoEncoder();
        assertTrue("h264_nvenc".equals(encoder) || "libx264".equals(encoder),
            "Chế độ auto chỉ được trả về một trong hai encoder hợp lệ, nhận: " + encoder);
    }

    @Test
    @DisplayName("NVENC dùng preset và cq từ cấu hình")
    void testNvencUsesConfiguredPresetAndCq() {
        props.setNvencPreset("p1");
        props.setNvencCq(20);

        List<String> cmd = cutter.buildCommandWithEncoder(input.getAbsolutePath(), output, "0", "3", "h264_nvenc");

        assertTrue(cmd.contains("p1"), "Phải dùng preset từ cấu hình");
        assertTrue(cmd.contains("20"), "Phải dùng cq từ cấu hình");
    }
}
