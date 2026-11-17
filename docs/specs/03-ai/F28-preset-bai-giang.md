# F28 — Preset (bộ cấu hình mẫu) theo loại bài giảng

| Mục | Giá trị |
|---|---|
| **Mã** | F28 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (nạp cấu hình, API) + SV2 (Python đọc cấu hình) + SV4 (chọn preset khi upload) |
| **Phụ thuộc** | F13. Nên làm **trước** F19, F20, F25, F26 vì các tính năng này đều cần nơi để bật/tắt theo preset |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không (`snakeyaml` và `PyYAML` đã có) |
| **Tham khảo** | Opus Clip "Clip templates", Descript "Templates", Riverside "Magic Clips presets" |

## 1. Bối cảnh & vấn đề

[config.yaml](../../../config.yaml) có nhiều khoá **khai báo nhưng không có code nào đọc**:

| Khoá | Dòng | Thực tế |
|---|---|---|
| `preset: lecture_programming` | 1 | Không nơi nào đọc |
| `segmentation.section_labels` | 10 | Python không đọc; fallback dùng danh sách viết cứng `01_GioiThieu…` ([transcript_refiner.py:568](../../../backend/ai/transcript_refiner.py)) |
| `segmentation.export_sections`, `drop_labels` | 11–12 | Không đọc. Java lọc "ngoài lề" bằng regex viết cứng `OFF_TOPIC_PATTERN` ([CutPointService.java:24](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L24)) |
| `segmentation.max_llm_chars`, `llm_max_retries` | 14–15 | Không đọc; prompt gửi **100%** transcript ([transcript_refiner.py:320-327](../../../backend/ai/transcript_refiner.py)) |
| `outline.mode/strict/text` | 17–20 | Không đọc; `VideoController` không truyền đề cương vào pipeline phân đoạn |

Ngoài ra prompt phân đoạn ([transcript_refiner.py:337](../../../backend/ai/transcript_refiner.py)) viết cứng ví dụ **lập trình JavaScript** ("biến & kiểu dữ liệu, DOM, bất đồng bộ…"), nên không phù hợp với bài giảng Toán, Kinh tế hay hội thảo.

Hiện chỉ có **một** tệp cấu hình toàn cục, đổi là ảnh hưởng mọi người dùng.

## 2. Mục tiêu

- Hệ thống có sẵn **5 preset**: `lecture_programming`, `lecture_math_science`, `lecture_general`, `seminar_panel` (hội thảo, nhiều người nói), `livestream_long` (livestream dài, nhiều ngoài lề).
- Mỗi preset quyết định: nhãn section, section được xuất, nhãn bị bỏ, cue phrases, ngưỡng lặng, thời lượng min/max, ví dụ trong prompt, công tắc của F19/F20/F25/F26.
- Người dùng chọn preset khi upload; có thể **ghi đè từng tham số** cho một video; có thể lưu thành preset cá nhân.
- **Mọi** khoá trong cấu hình phải được code đọc thật. Khoá nào không dùng thì xoá.

### Ngoài phạm vi

- Không tự đoán preset từ nội dung video (có thể làm sau; xem Câu hỏi mở).

## 3. User stories

- Là giảng viên Toán, tôi muốn chọn "Bài giảng Toán/Khoa học" để AI chia theo "Định nghĩa / Định lý / Ví dụ / Bài tập" thay vì "Thực hành code".
- Là người tổ chức hội thảo, tôi muốn preset tự bật nhận diện người nói và tách theo từng diễn giả.

## 4. Yêu cầu chức năng

- **FR-1** Cấu trúc preset (YAML, cùng schema với `config.yaml` hiện tại cộng thêm khối `prompt` và `features`):
  ```yaml
  id: lecture_math_science
  name: "Bài giảng Toán / Khoa học"
  segmentation:
    section_labels: [Giới thiệu, Định nghĩa, Định lý, Ví dụ, Bài tập, Tổng kết]
    export_sections: [Định nghĩa, Định lý, Ví dụ, Bài tập]
    drop_labels: [Ngoài lề]
    max_llm_chars: 60000
    llm_max_retries: 2
  duration: { min_duration: 30, max_duration: 0, split_strategy: none }
  cut_points:
    pause_threshold: 1.5
    cue_phrases: ["định lý", "ví dụ", "bài tập", "chứng minh", "tiếp theo"]
  prompt:
    content_hint: "bài giảng toán học/khoa học"
    topic_examples: ["Định nghĩa giới hạn", "Định lý Rolle", "Ví dụ tính đạo hàm"]
  features: { glossary_packs: [math], diarization: false, cleanup: true, slides: true }
  ```
- **FR-2** Thứ tự gộp cấu hình (lớp sau ghi đè lớp trước): `config.yaml` (mặc định hệ thống) → preset hệ thống → preset cá nhân → ghi đè theo video. Gộp sâu theo từng khoá; riêng danh sách thì **thay thế cả danh sách** (không nối).
- **FR-3** Khi analyze, Java ghi **cấu hình đã gộp** ra `cache/<hash>/effective_config.json` và truyền `--config <path>` cho Python. Java dùng cùng đối tượng đó cho `CutPointService` và `BatchVideoCutService`. Không chỗ nào được đọc thẳng `config.yaml` nữa.
- **FR-4** Prompt phân đoạn được dựng từ `prompt.content_hint`, `prompt.topic_examples` và `section_labels`. Bỏ ví dụ JavaScript viết cứng.
- **FR-5** `drop_labels` thay cho `OFF_TOPIC_PATTERN`: section hoặc topic có nhãn nằm trong danh sách bị loại. Giữ regex cũ như một **tuỳ chọn** `drop_patterns` để không mất hành vi hiện tại.
- **FR-6** `export_sections`: chỉ cắt clip cho topic thuộc các section này; những section khác vẫn hiện trên timeline với trạng thái "không xuất".
- **FR-7** `max_llm_chars`: transcript vượt giới hạn thì chia cửa sổ có chồng lấp (map), gọi LLM từng phần, rồi ghép kết quả (reduce). Thay cho việc gửi 100% transcript.
- **FR-8** `outline.text` (đề cương do người dùng nhập khi upload) được truyền vào prompt phân đoạn. `outline.mode = guided`: gợi ý cho LLM; `strict`: bắt buộc topic khớp từng mục đề cương.
- **FR-9** Lưu `preset_id` và `config_overrides` trong video để chạy lại cho ra cùng kết quả (tái lập được).
- **FR-10** Kiểm tra schema khi lưu preset: khoá lạ → 400; giá trị ngoài miền (ví dụ `pause_threshold ≤ 0`) → 400.

## 5. Yêu cầu phi chức năng

- Preset hệ thống nằm trong `backend/src/main/resources/presets/*.yaml`, được review như code.
- Gộp cấu hình mất ≤ 5ms.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_presets.sql`:
```sql
CREATE TABLE user_presets (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    base_preset_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    overrides JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE videos ADD COLUMN preset_id VARCHAR(60) DEFAULT 'lecture_programming';
ALTER TABLE videos ADD COLUMN config_overrides JSONB NOT NULL DEFAULT '{}';
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/presets` | Đăng nhập | Preset hệ thống + cá nhân |
| GET | `/api/v1/presets/{id}` | Đăng nhập | Chi tiết (đã gộp) |
| POST | `/api/v1/presets` | Đăng nhập | Tạo preset cá nhân `{ "basePresetId": "...", "name": "...", "overrides": {...} }` |
| PUT | `/api/v1/videos/{id}/config` | Chủ video | `{ "presetId": "...", "overrides": {...} }` |
| GET | `/api/v1/videos/{id}/config/effective` | Chủ video | Cấu hình đã gộp |

`GET /api/video/config` hiện có ([VideoController.java:693](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L693)) giữ lại nhưng chuyển sang trả preset mặc định; đánh dấu deprecated (sắp bỏ).

### 6.3 Backend (Spring Boot)

- `service/PresetService.java`: nạp YAML từ `resources/presets`, `merge(base, overrides)` (hàm thuần), `validate(map)`.
- `record EffectiveConfig(...)`: các getter có kiểu cụ thể (`pauseThreshold()`, `cuePhrases()`, `dropLabels()`…). `ConfigService` giữ nguyên để đọc `.env`; các getter cấu hình chuyển sang nhận `EffectiveConfig`.
- `CutPointService.calculateCutPoints(TranscriptDTO, EffectiveConfig)` (overload); `snapAndFilterSegments` dùng `dropLabels`.
- `controller/PresetController.java`.

### 6.4 AI pipeline (Python)

- `config_loader.AIConfig`: nhận `--config <json>`, thêm các thuộc tính `segmentation`, `prompt`, `features`. Bỏ phụ thuộc vào biến toàn cục `default_ai_config` trong các hàm mới.
- `transcript_refiner.segment_transcript(..., cfg: AIConfig, outline_text: str | None)`:
  - Dựng prompt từ `cfg.prompt` (FR-4).
  - FR-7: `_windowed_segment(sentences, max_chars)`: cửa sổ chồng lấp 20 câu; khi ghép, biên ở vùng chồng lấp lấy theo cửa sổ sau.
  - `_fallback_segment_from_sentences` dùng `cfg.segmentation.section_labels` thay cho danh sách viết cứng.
- Thêm `PROMPT_VERSION` (dùng chung với F27).

### 6.5 Frontend (Next.js)

- `AddVideoModal.tsx`: bước "Loại bài giảng" hiện thẻ preset (tên, mô tả, các nhãn section), ô nhập đề cương (`outline.text`), mục "Tuỳ chỉnh nâng cao" (ngưỡng lặng, cue phrases, các công tắc tính năng).
- `StudioHeader.tsx`: hiện preset đang dùng; nút "Đổi preset & phân tích lại".

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* preset `lecture_math_science`. *When* analyze. *Then* prompt gửi LLM chứa "Định lý" trong danh sách nhãn và **không** chứa "DOM".
- **AC-2** — *Given* video ghi đè `cut_points.pause_threshold = 2.5`. *Then* `calculateCutPoints` dùng 2,5 (thấy trong `reasons`).
- **AC-3** — *Given* `drop_labels: [Ngoài lề]` và LLM trả section "Ngoài lề". *Then* topic đó không được cắt clip; hành vi tương đương với regex cũ.
- **AC-4** — *Given* transcript 150.000 ký tự, `max_llm_chars = 60000`. *Then* gọi LLM ≥ 3 lần, kết quả liên tục (không hở, không chồng), topic đầu bắt đầu ở câu đầu và topic cuối kết thúc ở câu cuối.
- **AC-5** — *Given* lưu preset có khoá `foo: 1`. *Then* nhận `400 PRESET_UNKNOWN_KEY`.
- **AC-6** — Kiểm tra tĩnh: script `tests/check_config_keys.py` liệt kê mọi khoá trong preset; mỗi khoá phải xuất hiện ở ít nhất một chỗ đọc trong code Java hoặc Python. CI thất bại nếu có khoá không dùng.

## 8. Kế hoạch kiểm thử (TDD)

JUnit:
- `PresetServiceTest.merge_listsAreReplacedNotAppended()`
- `PresetServiceTest.merge_nestedMapsDeepMerged()`
- `PresetServiceTest.validate_unknownKeyRejected()`
- `PresetServiceTest.validate_negativePauseThresholdRejected()`
- `CutPointServiceTest.snapAndFilter_usesDropLabelsFromConfig()`
- `PresetControllerTest.putVideoConfig_requiresOwnership()`

pytest (`tests/test_f28_presets.py`):
- `test_aiconfig_loads_effective_config_json()`
- `test_segment_prompt_uses_preset_labels_and_examples()`
- `test_windowed_segment_continuity_over_max_chars()`
- `test_fallback_uses_config_section_labels()`
- `test_outline_strict_mode_included_in_prompt()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Ghép kết quả các cửa sổ (map-reduce) tạo biên lệch ở vùng chồng lấp | Topic bị cắt đôi | Snap (`CutPointService`) chạy sau; test AC-4 |
| Đổi API cấu hình làm vỡ frontend đang gọi `/api/video/config` | Lỗi UI | Giữ endpoint cũ ít nhất 1 bản phát hành |
| Quá nhiều tuỳ chỉnh làm người dùng bối rối | UX kém | Ẩn trong mục "Nâng cao"; preset mặc định đủ tốt |

## 10. Câu hỏi mở

- [ ] Danh sách 5 preset và nhãn section cụ thể: giảng viên các bộ môn cần duyệt.
- [ ] Có làm "tự đoán preset" bằng LLM từ 2 phút đầu transcript không?
- [ ] `outline.strict = true` xử lý thế nào khi giảng viên dạy khác thứ tự trong đề cương?
