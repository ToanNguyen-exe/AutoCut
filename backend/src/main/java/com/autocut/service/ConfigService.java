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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ConfigService {

    private static final Logger log = LoggerFactory.getLogger(ConfigService.class);
    private final Dotenv dotenv;
    private final Map<String, String> fallbackEnvMap = new HashMap<>();
    private Map<String, Object> configMap;

    public ConfigService() {
        Dotenv loaded = null;
        try {
            loaded = Dotenv.configure().ignoreIfMissing().load();
            if (loaded.get("R2_ACCESS_KEY_ID") == null && loaded.get("LLM_API_KEY") == null) {
                loaded = Dotenv.configure().directory("../").ignoreIfMissing().load();
            }
        } catch (Exception e) {
            log.warn("Dotenv load bị gián đoạn ({}), chuyển sang đọc dự phòng file .env...", e.getMessage());
            loadManualEnv(Paths.get(".env"));
            loadManualEnv(Paths.get("../.env"));
        }
        this.dotenv = loaded;
        loadYamlConfig();
    }

    private void loadManualEnv(Path envPath) {
        if (!Files.exists(envPath)) return;
        try {
            List<String> lines = Files.readAllLines(envPath);
            for (String line : lines) {
                String trimmed = line.trim();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                int eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    String key = trimmed.substring(0, eqIdx).trim();
                    String val = trimmed.substring(eqIdx + 1).trim();
                    fallbackEnvMap.put(key, val);
                }
            }
            log.info("Đã nạp thủ công file .env từ: {}", envPath.toAbsolutePath());
        } catch (Exception ex) {
            log.warn("Không thể đọc file .env thủ công: {}", ex.getMessage());
        }
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
        String val = null;
        if (dotenv != null) {
            try {
                val = dotenv.get(key);
            } catch (Exception ignored) {
                // Ignore Dotenv lookup error
            }
        }
        if (val == null || val.isBlank()) {
            val = fallbackEnvMap.get(key);
        }
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

    public double getPaddingStart() {
        Object val = getSection("output").getOrDefault("padding_start", 0.3);
        return ((Number) val).doubleValue();
    }

    public double getPaddingEnd() {
        Object val = getSection("output").getOrDefault("padding_end", 0.5);
        return ((Number) val).doubleValue();
    }

    public Map<String, Object> getRawConfig() {
        return Collections.unmodifiableMap(configMap != null ? configMap : Collections.emptyMap());
    }

    public Dotenv getDotenv() {
        return dotenv;
    }
}
