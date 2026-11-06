package com.autocut.controller;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;

class HomeControllerTest {

    @Test
    void testIndexReturnsUpStatus() {
        HomeController homeController = new HomeController();
        ResponseEntity<Map<String, Object>> response = homeController.index();

        Assertions.assertEquals(200, response.getStatusCode().value());
        Assertions.assertNotNull(response.getBody());
        Assertions.assertEquals("UP", response.getBody().get("status"));
        Assertions.assertNotNull(response.getBody().get("endpoints"));
    }
}

