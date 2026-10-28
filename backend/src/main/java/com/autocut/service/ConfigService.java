package com.autocut.service;

import io.github.cdimascio.dotenv.Dotenv;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Service
public class ConfigService {

    private static final Logger log = LoggerFactory.getLogger(ConfigService.class);
    private final Dotenv dotenv;
    private Map<String, Object> configMap;

    public ConfigService() {
        this.dotenv = Dotenv.configure().ignoreIfMissing().load();
        loadYamlConfig();
    }

    private void loadYamlConfig() {
        Path configPath = Paths.get("config.yaml");
        if (!Files.exists(configPath)) {
            configPath = Paths.get("../config.yaml");
        }

        if (Files.exists(configPath)) {
            try (InputStream is = Files.newInputStream(configPath)) {
                Yaml yaml = new Yaml();
                this.configMap = yaml.load(is);
                log.info("Đã nạp file cấu hình từ: {}", configPath.toAbsolutePath());
            } catch (IOException e) {
                log.error("Không thể đọc config.yaml: {}", e.getMessage(), e);
                this.configMap = Collections.emptyMap();
            }
        } else {
            log.warn("Không tìm thấy config.yaml tại thư mục gốc.");
            this.configMap = Collections.emptyMap();
        }
    }

    public String getEnv(String key, String defaultValue) {
        String val = dotenv.get(key);
        if (val == null || val.isBlank()) {
            val = System.getenv(key);
        }
        return (val != null && !val.isBlank()) ? val : defaultValue;
    }

    public String getLlmApiKey() {
        return getEnv("LLM_API_KEY", "");
    }

    public String getWhisperApiKey() {
        return getEnv("WHISPER_API_KEY", "");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getSection(String sectionName) {
        if (configMap != null && configMap.get(sectionName) instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return Collections.emptyMap();
    }

    public double getMaxDuration() {
        Object val = getSection("duration").getOrDefault("max_duration", 420.0);
        return ((Number) val).doubleValue();
    }

    public double getMaxOverflow() {
        Object val = getSection("duration").getOrDefault("max_overflow", 10.0);
        return ((Number) val).doubleValue();
    }

    public double getMinDuration() {
        Object val = getSection("duration").getOrDefault("min_duration", 30.0);
        return ((Number) val).doubleValue();
    }

    public double getPauseThreshold() {
        Object val = getSection("cut_points").getOrDefault("pause_threshold", 1.5);
        return ((Number) val).doubleValue();
    }

    public int getSnapWindowSentences() {
        Object val = getSection("cut_points").getOrDefault("snap_window_sentences", 3);
        return ((Number) val).intValue();
    }

    @SuppressWarnings("unchecked")
    public List<String> getCuePhrases() {
        Object val = getSection("cut_points").get("cue_phrases");
        if (val instanceof List<?> list) {
            return (List<String>) list;
        }
        return List.of("tiếp theo", "chuyển sang", "bây giờ chúng ta", "bài tập số");
    }

    public Map<String, Object> getRawConfig() {
        return Collections.unmodifiableMap(configMap != null ? configMap : Collections.emptyMap());
    }

    public Dotenv getDotenv() {
        return dotenv;
    }
}
