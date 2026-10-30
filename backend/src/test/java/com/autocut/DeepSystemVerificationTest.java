package com.autocut;

import com.autocut.controller.VideoController;
import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.dto.Models.TranscriptDTO;
import com.autocut.entity.VideoEntity;
import com.autocut.repository.VideoRepository;
import com.autocut.service.CacheService;
import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Map;
import java.util.UUID;

@SpringBootTest
public class DeepSystemVerificationTest {

    @Autowired
    private VideoController videoController;

    @Autowired
    private VideoRepository videoRepository;

    @Autowired
    private CacheService cacheService;

    @Autowired
    private ConfigService configService;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("1. Kiểm tra cấu hình config.yaml và .env nạp đầy đủ")
    void testConfigIntegrity() {
        Assertions.assertNotNull(configService.getRawConfig(), "Config Map không được null");
        Assertions.assertTrue(configService.getMaxDuration() > 0, "Max duration phải > 0");
        Assertions.assertNotNull(configService.getDotenv(), "Dotenv không được null");
        Assertions.assertFalse(configService.getDotenv().get("DATABASE_URL", "").isBlank(), "DATABASE_URL phải tồn tại");
    }

    @Test
    @DisplayName("2. Kiểm tra API getMockSegments cấu trúc chuẩn SegmentsDTO")
    void testMockSegmentsContract() {
        ResponseEntity<SegmentsDTO> response = videoController.getMockSegments();
        Assertions.assertEquals(200, response.getStatusCode().value());

        SegmentsDTO dto = response.getBody();
        Assertions.assertNotNull(dto);
        Assertions.assertFalse(dto.segments().isEmpty(), "Segments không được rỗng");
        dto.segments().forEach(s -> {
            Assertions.assertNotNull(s.id());
            Assertions.assertNotNull(s.section());
            Assertions.assertNotNull(s.topic());
            Assertions.assertNotNull(s.slug());
            Assertions.assertNotNull(s.startId());
            Assertions.assertNotNull(s.endId());
            Assertions.assertTrue(s.end() > s.start(), "Thời gian kết thúc phải lớn hơn bắt đầu");
        });
    }

    @Test
    @DisplayName("3. Kiểm tra API getMockTranscript cấu trúc chuẩn TranscriptDTO")
    void testMockTranscriptContract() {
        ResponseEntity<TranscriptDTO> response = videoController.getMockTranscript();
        Assertions.assertEquals(200, response.getStatusCode().value());

        TranscriptDTO dto = response.getBody();
        Assertions.assertNotNull(dto);
        Assertions.assertFalse(dto.sentences().isEmpty(), "Sentences không được rỗng");
        dto.sentences().forEach(sent -> {
            Assertions.assertTrue(sent.id().matches("^S\\d{4}$"), "Sentence ID phải đúng chuẩn Sxxxx: " + sent.id());
            Assertions.assertTrue(sent.end() >= sent.start(), "Thời gian câu kết thúc >= bắt đầu");
            Assertions.assertNotNull(sent.text(), "Lời thoại câu không được null");
        });
    }

    @Test
    @DisplayName("4. Kiểm tra Cache HIT / MISS chặt chẽ")
    void testCacheLookup() throws Exception {
        // Cache MISS với hash lạ
        ResponseEntity<?> missResp = videoController.checkCache("non_existent_hash_1234567890");
        Assertions.assertEquals(200, missResp.getStatusCode().value());
        Map<?, ?> missBody = (Map<?, ?>) missResp.getBody();
        Assertions.assertNotNull(missBody);
        Assertions.assertEquals("MISS", missBody.get("status"));
        Assertions.assertEquals(false, missBody.get("cached"));

        // Tạo cache giả định và test Cache HIT
        String dummyHash = "test_deep_hash_" + UUID.randomUUID().toString().replace("-", "");
        TranscriptDTO dummyDto = new TranscriptDTO("test.mp4", 100.0, java.util.List.of());
        cacheService.saveTranscriptCache(dummyHash, dummyDto);

        ResponseEntity<?> hitResp = videoController.checkCache(dummyHash);
        Assertions.assertEquals(200, hitResp.getStatusCode().value());
        Map<?, ?> hitBody = (Map<?, ?>) hitResp.getBody();
        Assertions.assertNotNull(hitBody);
        Assertions.assertEquals("HIT", hitBody.get("status"));
        Assertions.assertEquals(true, hitBody.get("cached"));
        Assertions.assertNotNull(hitBody.get("transcript"));

        // Dọn dẹp cache test
        Path cacheFile = Paths.get("cache", dummyHash + "_transcript.json");
        Files.deleteIfExists(cacheFile);
    }

    @Test
    @DisplayName("5. Kiểm tra API Upload từ chối file rỗng (Edge case)")
    void testUploadEmptyFile() {
        MockMultipartFile emptyFile = new MockMultipartFile("file", "empty.mp4", "video/mp4", new byte[0]);
        ResponseEntity<?> resp = videoController.uploadSampleVideo(emptyFile);
        Assertions.assertEquals(400, resp.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) resp.getBody();
        Assertions.assertNotNull(body);
        Assertions.assertEquals("File video rỗng!", body.get("error"));
    }

    @Test
    @DisplayName("6. Kiểm tra ràng buộc CHECK (end_time > start_time) trên Neon Postgres")
    void testDatabaseCheckConstraint() throws Exception {
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            // Tạo video & section tạm
            stmt.execute("INSERT INTO videos (file_name, file_size, sha256_hash, r2_key, cloud_url, status) " +
                    "VALUES ('chk_test.mp4', 100, 'chk_hash_" + System.currentTimeMillis() + "', 'k', 'u', 'UPLOADED') RETURNING id;");
            ResultSet rs = stmt.getResultSet();
            rs.next();
            long vidId = rs.getLong(1);

            stmt.execute("INSERT INTO sections (video_id, section_no, label) VALUES (" + vidId + ", 1, 'Test Section') RETURNING id;");
            rs = stmt.getResultSet();
            rs.next();
            long secId = rs.getLong(1);

            // Cố ý chèn topic có end_time < start_time (Phải vi phạm chk_topic_time)
            Assertions.assertThrows(Exception.class, () -> {
                stmt.execute("INSERT INTO topics (section_id, topic_no, title, slug, start_id, end_id, start_time, end_time) " +
                        "VALUES (" + secId + ", 1, 'Bad Topic', 'bad', 'S0001', 'S0002', 100.0, 50.0);");
            }, "Database phải chặn đứng topic có end_time <= start_time qua ràng buộc CHECK!");

            // Dọn dẹp
            stmt.execute("DELETE FROM videos WHERE id = " + vidId);
        }
    }

    @Test
    @DisplayName("7. Kiểm tra ràng buộc UNIQUE sha256_hash trên Neon Postgres")
    void testDuplicateSha256Constraint() {
        String uniqueHash = "unique_hash_" + System.currentTimeMillis();

        VideoEntity v1 = new VideoEntity("v1.mp4", uniqueHash, "UPLOADED", 1000L);
        v1.setCloudUrl("http://url1");
        v1.setR2Key("k1");
        videoRepository.saveAndFlush(v1);

        VideoEntity v2 = new VideoEntity("v2.mp4", uniqueHash, "UPLOADED", 2000L);
        v2.setCloudUrl("http://url2");
        v2.setR2Key("k2");

        Assertions.assertThrows(DataIntegrityViolationException.class, () -> {
            videoRepository.saveAndFlush(v2);
        }, "Database phải ném lỗi khi lưu trùng sha256_hash!");

        // Dọn dẹp
        videoRepository.delete(v1);
    }

    @Test
    @DisplayName("8. Kiểm tra cơ chế khóa phiên bản lạc quan (@Version Optimistic Locking)")
    void testOptimisticLocking() {
        String testHash = "opt_hash_" + System.currentTimeMillis();
        VideoEntity entity = new VideoEntity("opt.mp4", testHash, "UPLOADED", 500L);
        entity.setCloudUrl("http://opt");
        entity.setR2Key("opt_k");
        entity = videoRepository.saveAndFlush(entity);

        Long initialVersion = entity.getVersion();
        Assertions.assertNotNull(initialVersion, "Version ban đầu không được null");

        // Cập nhật entity
        entity.setStatus("SEGMENTING");
        VideoEntity updated = videoRepository.saveAndFlush(entity);

        Assertions.assertTrue(updated.getVersion() > initialVersion, "Version phải tự động tăng sau khi cập nhật!");

        // Dọn dẹp
        videoRepository.delete(updated);
    }
}
