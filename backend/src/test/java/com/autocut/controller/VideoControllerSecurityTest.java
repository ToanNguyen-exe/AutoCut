package com.autocut.controller;

import com.autocut.repository.VideoRepository;
import com.autocut.service.CacheService;
import com.autocut.service.CloudflareR2Service;
import com.autocut.service.ConfigService;
import com.autocut.video.ConcatResult;
import com.autocut.video.VideoConcat;
import com.autocut.video.VideoCutter;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * F04 — Kiểm tra bốn lỗ hổng đường dẫn qua đúng tầng HTTP.
 *
 * <p>Test gọi MockMvc nên đi qua đúng chuỗi: tham số → Spring → controller →
 * {@code SafePaths}. Không mock {@code SafePaths} để tránh trường hợp test xanh
 * mà lỗ hổng vẫn còn.
 */
class VideoControllerSecurityTest {

    @TempDir
    Path tmp;

    private Path outputRoot;
    private Path uploadsRoot;
    private VideoConcat videoConcat;
    private MockMvc mvc;

    @BeforeEach
    void setUp(@TempDir Path tempDir) throws Exception {
        tmp = tempDir;
        outputRoot = Files.createDirectories(tempDir.resolve("output"));
        uploadsRoot = Files.createDirectories(tempDir.resolve("uploads"));

        ConfigService config = Mockito.mock(ConfigService.class);
        Mockito.when(config.getEnv(Mockito.anyString(), Mockito.any()))
                .thenReturn(null);
        Mockito.when(config.getEnv(Mockito.eq("STORAGE_OUTPUT_DIR"), Mockito.any()))
                .thenReturn(outputRoot.toString());
        Mockito.when(config.getEnv(Mockito.eq("STORAGE_UPLOADS_DIR"), Mockito.any()))
                .thenReturn(uploadsRoot.toString());

        videoConcat = Mockito.mock(VideoConcat.class);
        Mockito.when(videoConcat.concat(Mockito.anyList(), Mockito.any(File.class), Mockito.anyBoolean()))
                .thenAnswer(call -> ConcatResult.success(
                        List.of(),
                        ((File) call.getArgument(1)).getAbsolutePath(),
                        1L,
                        10L));

        VideoController controller = new VideoController(
                Mockito.mock(CacheService.class),
                config,
                Mockito.mock(CloudflareR2Service.class),
                Mockito.mock(VideoRepository.class),
                Mockito.mock(VideoCutter.class),
                videoConcat);

        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    // ------------------------------------------------ 1. download-clip (đọc tuỳ ý)

    @Test
    @DisplayName("download-clip từ chối mọi đường dẫn thoát khỏi thư mục output")
    void downloadClipRejectsEscapingPaths() throws Exception {
        String sep = java.io.File.separator;
        String[] vectors = {
                ".." + sep + ".env",
                ".." + sep + ".." + sep + ".env",
                "/etc/passwd",
                "\\\\server\\share\\key.txt"
        };
        for (String path : vectors) {
            mvc.perform(get("/api/video/download-clip").param("path", path))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    @DisplayName("download-clip chặn cả dạng URL-encode (?path=..%2F.env)")
    void downloadClipRejectsUrlEncodedTraversal() throws Exception {
        // MockMvc không giải mã %2F trong query string, còn Tomcat thật thì chặn
        // encoded slash trước khi vào controller. Vì vậy ở đây chỉ khẳng định
        // điều quan trọng nhất: không bao giờ trả về 200 cho dạng này.
        // Dạng đã giải mã ("../.env") được phủ bởi test tham số ở trên.
        mvc.perform(get("/api/video/download-clip?path=..%2F.env"))
                .andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("download-clip không trả tệp .env dù nó nằm trong thư mục output")
    void downloadClipRejectsNonWhitelistedExtension() throws Exception {
        Files.writeString(outputRoot.resolve(".env"), "GEMINI_API_KEY=bi-mat");

        mvc.perform(get("/api/video/download-clip").param("path", ".env"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("AC-8: clip hợp lệ trong thư mục output vẫn tải được")
    void downloadClipStillServesValidClip() throws Exception {
        Files.write(outputRoot.resolve("clip_01.mp4"), new byte[]{1, 2, 3});

        mvc.perform(get("/api/video/download-clip").param("path", "clip_01.mp4"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("AC-8: frontend cũ gửi đường dẫn tuyệt đối trong output vẫn chạy")
    void downloadClipAcceptsAbsolutePathInsideRoot() throws Exception {
        Path clip = Files.write(outputRoot.resolve("clip_02.mp4"), new byte[]{1, 2, 3});

        mvc.perform(get("/api/video/download-clip").param("path", clip.toAbsolutePath().toString()))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------ 2. download-zip (nén dự án)

    @ParameterizedTest(name = "download-zip chặn lesson: {0}")
    @ValueSource(strings = {"../..", "../../", "..\\..", "a/b", "."})
    @DisplayName("download-zip từ chối lesson không phải slug")
    void downloadZipRejectsTraversalLesson(String lesson) throws Exception {
        mvc.perform(get("/api/video/download-zip").param("lesson", lesson))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("download-zip vẫn nén được bài học bình thường")
    void downloadZipStillWorksForValidLesson() throws Exception {
        Path lessonDir = Files.createDirectories(outputRoot.resolve("Bai05_VongLap"));
        Files.write(lessonDir.resolve("clip_01.mp4"), new byte[]{1, 2, 3});

        mvc.perform(get("/api/video/download-zip").param("lesson", "Bai05_VongLap"))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------ 3+4. ghép video (đọc & ghi)

    @Test
    @DisplayName("concat từ chối clip nằm ngoài thư mục output")
    void concatRejectsClipOutsideRoot() throws Exception {
        String body = "{\"clips\":[\"../../../etc/passwd\"]}";

        mvc.perform(post("/api/video/concat")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("concat bỏ qua 'output' do client gửi, không ghi đè tệp ngoài")
    void concatIgnoresClientSuppliedOutputPath() throws Exception {
        Path clip = Files.write(outputRoot.resolve("clip_01.mp4"), new byte[]{1, 2, 3});
        Path target = tmp.resolve("bi-ghi-de.mp4");

        String body = "{\"clips\":[\"" + clip.toString().replace("\\", "\\\\") + "\"],"
                + "\"output\":\"" + target.toString().replace("\\", "\\\\") + "\"}";

        mvc.perform(post("/api/video/concat")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        Assertions.assertFalse(Files.exists(target),
                "Không được ghi vào đường dẫn client chỉ định: " + target);

        ArgumentCaptor<File> captured = ArgumentCaptor.forClass(File.class);
        Mockito.verify(videoConcat)
                .concat(Mockito.anyList(), captured.capture(), Mockito.anyBoolean());

        Assertions.assertTrue(captured.getValue().toPath().startsWith(outputRoot),
                "Tệp ghép phải nằm trong thư mục output, thực tế: " + captured.getValue());
    }

    // ------------------------------------------------ 5. stream theo mã băm

    @ParameterizedTest(name = "stream chặn hash: ''{0}''")
    @ValueSource(strings = {
            "a",
            "abc",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
    })
    @DisplayName("stream từ chối mã hash không đúng 64 ký tự hex")
    void streamRejectsInvalidHash(String hash) throws Exception {
        mvc.perform(get("/api/video/stream/" + hash))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("stream phát được tệp đã upload theo định dạng <hash>_<ten_file>.mp4")
    void streamServesUploadedVideoWithHashPrefixFilename() throws Exception {
        String validHash = "0f1b867ff583f404f58fbfc305eb0dfbf4dc544c812351393d5e0bb526f175b8";
        Files.write(uploadsRoot.resolve(validHash + "_download.mp4"), new byte[]{0, 1, 2, 3});

        mvc.perform(get("/api/video/stream/" + validHash))
                .andExpect(status().isOk());

        String otherHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        mvc.perform(get("/api/video/stream/" + otherHash))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------ 6. render (ghi theo lesson)

    @Test
    @DisplayName("render từ chối lesson chứa đường dẫn")
    void renderRejectsTraversalLesson() throws Exception {
        String body = "{\"lesson\":\"../../pwn\",\"video\":\"x.mp4\",\"segments\":[]}";

        mvc.perform(post("/api/video/render")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }
}
