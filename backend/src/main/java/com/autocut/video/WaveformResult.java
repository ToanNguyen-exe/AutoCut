package com.autocut.video;

/**
 * Kết quả trích xuất biên độ âm thanh thật (Waveform Peaks) từ video bằng ffmpeg.
 *
 * @param hasAudio Có track âm thanh hay không (false nếu video im lặng / không track audio)
 * @param durationSec Thời lượng âm thanh tính bằng giây
 * @param samplesPerSec Tần số lấy mẫu đỉnh (peaks/giây, ví dụ: 10 hoặc 100)
 * @param peaks Mảng biên độ đỉnh chuẩn hoá 0 - 100 cho Frontend vẽ sóng âm
 * @param minMaxPairs Mảng byte cặp [min, max] kiểu int8 (-128..127) chuẩn theo spec F38
 */
public record WaveformResult(
        boolean hasAudio,
        double durationSec,
        int samplesPerSec,
        int[] peaks,
        byte[] minMaxPairs
) {
    public static WaveformResult empty() {
        return new WaveformResult(false, 0.0, 0, new int[0], new byte[0]);
    }
}
