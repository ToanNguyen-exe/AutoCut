package com.autocut.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("VideoProps Configuration Tests")
class VideoPropsTest {

    @Test
    @DisplayName("Default paths should be 'ffmpeg' and 'ffprobe' without hardcoded OS paths")
    void testDefaultPaths() {
        VideoProps props = new VideoProps();
        assertEquals("ffmpeg", props.getFfmpegPath());
        assertEquals("ffprobe", props.getFfprobePath());
        assertEquals(20, props.getTimeoutSeconds());
        assertEquals(300, props.getCutTimeoutSeconds());
        assertEquals(0.3, props.getPaddingStart(), 1e-6);
        assertEquals(0.5, props.getPaddingEnd(), 1e-6);
    }

    @Test
    @DisplayName("Custom paths for Linux/Docker environment (e.g. /usr/bin/ffmpeg)")
    void testCustomLinuxDockerPaths() {
        VideoProps props = new VideoProps();
        props.setFfmpegPath("/usr/bin/ffmpeg");
        props.setFfprobePath("/usr/bin/ffprobe");

        assertEquals("/usr/bin/ffmpeg", props.getFfmpegPath());
        assertEquals("/usr/bin/ffprobe", props.getFfprobePath());
    }

    @Test
    @DisplayName("Parameterized constructors should preserve explicit paths")
    void testParameterizedConstructors() {
        VideoProps props1 = new VideoProps("/custom/ffprobe", "/custom/ffmpeg", 15);
        assertEquals("/custom/ffmpeg", props1.getFfmpegPath());
        assertEquals("/custom/ffprobe", props1.getFfprobePath());
        assertEquals(15, props1.getTimeoutSeconds());
        assertEquals(300, props1.getCutTimeoutSeconds());

        VideoProps props2 = new VideoProps("/bin/ffprobe", "/bin/ffmpeg", 30, 600, 0.4, 0.6);
        assertEquals("/bin/ffmpeg", props2.getFfmpegPath());
        assertEquals("/bin/ffprobe", props2.getFfprobePath());
        assertEquals(30, props2.getTimeoutSeconds());
        assertEquals(600, props2.getCutTimeoutSeconds());
        assertEquals(0.4, props2.getPaddingStart(), 1e-6);
        assertEquals(0.6, props2.getPaddingEnd(), 1e-6);
    }
}
