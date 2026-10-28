package com.autocut.controller;

import com.autocut.dto.Models.SegmentsDTO;
import com.autocut.service.CacheService;
import com.autocut.service.ConfigService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Collections;
import java.util.Map;

class VideoControllerTest {

    @Test
    void testGetMockSegments() {
        ConfigService configService = new ConfigService();
        CacheService cacheService = new CacheService();
        VideoController controller = new VideoController(cacheService, configService);

        ResponseEntity<SegmentsDTO> response = controller.getMockSegments();
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertFalse(response.getBody().segments().isEmpty());
    }

    @Test
    void testGetConfig() {
        ConfigService configService = new ConfigService();
        CacheService cacheService = new CacheService();
        VideoController controller = new VideoController(cacheService, configService);

        ResponseEntity<Map<String, Object>> response = controller.getConfig();
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
        Assertions.assertNotNull(response.getBody());
    }

    @Test
    void testRenderSegments() {
        ConfigService configService = new ConfigService();
        CacheService cacheService = new CacheService();
        VideoController controller = new VideoController(cacheService, configService);

        SegmentsDTO dto = new SegmentsDTO("test.mp4", "test_lesson", "guided", true, Collections.emptyList());
        ResponseEntity<?> response = controller.renderSegments(dto);
        Assertions.assertEquals(HttpStatus.OK, response.getStatusCode());
    }
}
