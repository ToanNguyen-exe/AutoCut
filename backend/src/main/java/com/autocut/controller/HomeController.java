package com.autocut.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HomeController {

    @GetMapping("/")
    public ResponseEntity<Map<String, Object>> index() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "AutoCut AI Backend",
                "message", "Backend is running successfully!",
                "endpoints", Map.of(
                        "mock_segments", "/api/video/mock-segments",
                        "mock_transcript", "/api/video/mock-transcript",
                        "upload_sample", "/api/video/upload-sample"
                )
        ));
    }
}

