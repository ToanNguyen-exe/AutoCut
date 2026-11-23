package com.autocut.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("WaveformGenerator Audio Peaks Extraction Tests")
class WaveformGeneratorTest {

    @Test
    @DisplayName("toPeaks on pure silence should return zero min/max and zero normalized peaks")
    void testToPeaks_Silence_AllZero() {
        short[] silencePcm = new short[800]; // 800 samples = 0.1s at 8000Hz
        int samplesPerBucket = 80; // 10 buckets

        byte[] minMax = WaveformGenerator.toPeaks(silencePcm, samplesPerBucket);
        assertEquals(20, minMax.length); // 10 buckets * 2 (min, max)

        for (byte b : minMax) {
            assertEquals(0, b);
        }

        int[] normalized = WaveformGenerator.toNormalizedPeaks(silencePcm, samplesPerBucket);
        assertEquals(10, normalized.length);
        for (int p : normalized) {
            assertEquals(0, p);
        }
    }

    @Test
    @DisplayName("toPeaks on full scale sine/square wave should approach near max amplitude")
    void testToPeaks_FullScale_MinMaxNear127() {
        short[] loudPcm = new short[160];
        // Tạo sóng vuông cực đại: nửa đầu +32767, nửa sau -32768
        for (int i = 0; i < 80; i++) {
            loudPcm[i] = (i % 2 == 0) ? Short.MAX_VALUE : (short) -32767;
        }
        for (int i = 80; i < 160; i++) {
            loudPcm[i] = (short) (Short.MAX_VALUE / 2); // 50%
        }

        byte[] minMax = WaveformGenerator.toPeaks(loudPcm, 80);
        assertEquals(4, minMax.length); // 2 buckets

        // Bucket 0: cực đại
        byte min0 = minMax[0];
        byte max0 = minMax[1];
        assertTrue(min0 <= -127, "Min should be <= -127, got " + min0);
        assertTrue(max0 >= 127, "Max should be >= 127, got " + max0);

        int[] normalized = WaveformGenerator.toNormalizedPeaks(loudPcm, 80);
        assertEquals(2, normalized.length);
        assertEquals(100, normalized[0], "Bucket 0 should be 100%");
        assertTrue(normalized[1] >= 49 && normalized[1] <= 51, "Bucket 1 should be ~50%, got " + normalized[1]);
    }

    @Test
    @DisplayName("Partial last bucket should still be included in calculation")
    void testToPeaks_PartialLastBucket_Included() {
        short[] pcm = new short[100]; // 80 + 20 samples
        for (int i = 0; i < 100; i++) {
            pcm[i] = 16384; // ~50%
        }

        byte[] minMax = WaveformGenerator.toPeaks(pcm, 80);
        assertEquals(4, minMax.length, "Should contain 2 buckets (one full, one partial)");

        int[] normalized = WaveformGenerator.toNormalizedPeaks(pcm, 80);
        assertEquals(2, normalized.length);
        assertTrue(normalized[0] >= 49 && normalized[0] <= 51);
        assertTrue(normalized[1] >= 49 && normalized[1] <= 51);
    }

    @Test
    @DisplayName("Downsample should reduce peak resolution by given factor")
    void testDownsample() {
        // 4 buckets: [min, max]
        byte[] input = new byte[] {
                -10, 20,
                -30, 40,
                -50, 60,
                -20, 10
        };

        // Downsample factor 2 -> 2 buckets
        byte[] downsampled = WaveformGenerator.downsample(input, 2);
        assertEquals(4, downsampled.length);

        // Bucket 0: min of (-10, -30) is -30, max of (20, 40) is 40
        assertEquals(-30, downsampled[0]);
        assertEquals(40, downsampled[1]);

        // Bucket 1: min of (-50, -20) is -50, max of (60, 10) is 60
        assertEquals(-50, downsampled[2]);
        assertEquals(60, downsampled[3]);
    }

    @Test
    @DisplayName("Non-existent video file should return WaveformResult with hasAudio=false")
    void testGenerate_NonExistentFile() {
        WaveformGenerator generator = new WaveformGenerator(new VideoProps());
        WaveformResult result = generator.extractPeaks(Paths.get("non_existent_video_12345.mp4"), 10);

        assertNotNull(result);
        assertFalse(result.hasAudio());
        assertEquals(0, result.peaks().length);
        assertEquals(0.0, result.durationSec());
    }

    @Test
    @DisplayName("Empty or null path should safely return empty result")
    void testGenerate_NullPath() {
        WaveformGenerator generator = new WaveformGenerator(new VideoProps());
        WaveformResult result = generator.extractPeaks(null, 10);

        assertNotNull(result);
        assertFalse(result.hasAudio());
        assertEquals(0, result.peaks().length);
    }

    @Test
    @DisplayName("savePeaksToFile and readPeaksFromFile should serialize and deserialize peaks.json correctly")
    void testSaveAndReadPeaksFile(@org.junit.jupiter.api.io.TempDir Path tempDir) throws Exception {
        WaveformGenerator generator = new WaveformGenerator();
        WaveformResult sampleResult = new WaveformResult(true, 12.5, 10, new int[]{10, 20, 50, 80, 40}, new byte[]{-10, 20, -30, 40});

        Path peaksFile = tempDir.resolve("peaks.json");
        Path savedPath = generator.savePeaksToFile(sampleResult, "TestLesson", peaksFile);

        assertTrue(java.nio.file.Files.exists(savedPath));
        assertEquals(peaksFile.toAbsolutePath(), savedPath.toAbsolutePath());

        WaveformResult loaded = generator.readPeaksFromFile(savedPath);
        assertNotNull(loaded);
        assertTrue(loaded.hasAudio());
        assertEquals(12.5, loaded.durationSec(), 1e-4);
        assertEquals(10, loaded.samplesPerSec());
        assertArrayEquals(new int[]{10, 20, 50, 80, 40}, loaded.peaks());
    }

    @Test
    @DisplayName("savePeaksNextToSegments should create peaks.json in the same directory as segments.json")
    void testSavePeaksNextToSegments(@org.junit.jupiter.api.io.TempDir Path tempDir) throws Exception {
        WaveformGenerator generator = new WaveformGenerator();
        WaveformResult sampleResult = new WaveformResult(true, 5.0, 10, new int[]{0, 25, 75, 100, 30}, new byte[]{});

        Path segmentsFile = tempDir.resolve("segments.json");
        java.nio.file.Files.writeString(segmentsFile, "[]");

        Path peaksFile = generator.savePeaksNextToSegments(sampleResult, "SampleLesson", segmentsFile);

        assertNotNull(peaksFile);
        assertTrue(java.nio.file.Files.exists(peaksFile));
        assertEquals("peaks.json", peaksFile.getFileName().toString());
        assertEquals(segmentsFile.getParent(), peaksFile.getParent());
    }

    @Test
    @DisplayName("extractPeaksWithCache should return cached result without calling ffmpeg if peaks.json already exists")
    void testExtractPeaksWithCache_ReadsFromExistingPeaksFile(@org.junit.jupiter.api.io.TempDir Path tempDir) throws Exception {
        WaveformGenerator generator = new WaveformGenerator();
        Path peaksFile = tempDir.resolve("peaks.json");
        WaveformResult expectedResult = new WaveformResult(true, 10.0, 10, new int[]{99, 88, 77}, new byte[]{});
        generator.savePeaksToFile(expectedResult, "LessonCached", peaksFile);

        // Gọi extractPeaksWithCache trỏ tới file video không tồn tại nhưng file cache đích peaksFile ĐÃ TỒN TẠI
        Path nonExistentVideo = tempDir.resolve("does_not_exist.mp4");
        WaveformResult cachedResult = generator.extractPeaksWithCache(nonExistentVideo, 10, peaksFile, null, "LessonCached");

        assertNotNull(cachedResult);
        assertTrue(cachedResult.hasAudio());
        assertEquals(10.0, cachedResult.durationSec());
        assertArrayEquals(new int[]{99, 88, 77}, cachedResult.peaks());
    }
}
