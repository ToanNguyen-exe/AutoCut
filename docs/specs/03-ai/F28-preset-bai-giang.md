# F28 — Preset (bộ cấu hình mẫu) theo loại bài giảng

| Mục | Giá trị |
|---|---|
| **Mã** | F28 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (nạp cấu hình, API) + SV2 (Python đọc cấu hình) + SV4 (chọn preset khi upload) |
| **Phụ thuộc** | F13, F00 (`videoId`), F09/F10 (analyze là job). Nên làm **trước** F19, F20, F25, F26 vì các tính năng này đều đọc khoá `features.*` do spec này định nghĩa |
| **Ước lượng** | L (1–2 tuần): 5 preset, API, gộp cấu hình nhiều lớp, sửa Java và Python đọc cấu hình thật, script kiểm tra khoá trong CI |
| **Thư viện mới cần duyệt** | Không (`snakeyaml` và `PyYAML` đã có) |
| **Tham khảo** | Opus Clip "Clip templates", Descript "Templates", Riverside "Magic Clips presets" |

> **Cập nhật 18/11/2026:** nâng ước lượng lên L; định nghĩa một cấu trúc khoá chuẩn `features.*` + khối tham số riêng, dùng chung cho F19/F20/F25/F26; bỏ map-reduce khỏi phạm vi (YAGNI) và thay bằng giới hạn `max_llm_chars` rộng kèm lỗi rõ ràng khi vượt; tệp cấu hình đã gộp ghi vào thư mục làm việc của job (F17); quyền theo AD-2; tên migration theo quy ước.

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
- Không chia transcript thành nhiều cửa sổ rồi ghép kết quả (map-reduce). Model Gemini Flash đang dùng nhận được ngữ cảnh rất dài, nên với bài giảng thông thường gửi cả transcript là đủ. Chỉ làm map-reduce khi có video thật vượt giới hạn ở FR-7.

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
  glossary: { packs: [math] }
  features: { diarization: false, cleanup: true, slides: true }
  cleanup: { fillers: ["ừm", "ờ", "à"], silence_min: 1.2, silence_keep: 0.4 }
  slides: { scene_threshold: 0.30, min_gap: 8 }
  ```
- **FR-1b — Cấu trúc khoá chuẩn** (các spec khác phải dùng đúng tên này):

  | Khoá | Kiểu | Spec đọc | Ý nghĩa |
  |---|---|---|---|
  | `features.diarization` | bool | F20 | Bật nhận diện người nói |
  | `features.cleanup` | bool | F25 | Bật phát hiện từ đệm / khoảng lặng / câu lặp |
  | `features.slides` | bool | F26, F18 | Bật nhận diện slide và cộng điểm `slide_change` (AD-14) |
  | `glossary.packs` | list | F19 | Pack từ điển mặc định khi upload |
  | `transcript.prompt_max_chars` | int | F19, F25 | Giới hạn `initial_prompt` (mặc định 420) |
  | `cleanup.*` | map | F25 | `fillers`, `silence_min`, `silence_keep` |
  | `slides.*` | map | F26 | `scene_threshold`, `min_gap`, `crop` |
  | `cut_points.weights.slide_change` | number | F26 | Điểm cộng khi trùng lúc đổi slide (mặc định 3) |
  | `cut_points.review_threshold` | number | F18 | Ngưỡng `needs_review` (mặc định 0,5) |

  Không dùng các tên cũ `transcript.diarization`, `slides.enabled`.
- **FR-2** Thứ tự gộp cấu hình (lớp sau ghi đè lớp trước): `config.yaml` (mặc định hệ thống) → preset hệ thống → preset cá nhân → ghi đè theo video. Gộp sâu theo từng khoá; riêng danh sách thì **thay thế cả danh sách** (không nối).
- **FR-3** Khi chạy job analyze (F09/F10), Java ghi **cấu hình đã gộp** ra `effective_config.json` trong thư mục làm việc của job (F17) và truyền `--config <path>` cho Python. Java dùng cùng đối tượng đó cho `CutPointService` và `BatchVideoCutService`. Không chỗ nào được đọc thẳng `config.yaml` nữa.
- **FR-4** Prompt phân đoạn được dựng từ `prompt.content_hint`, `prompt.topic_examples` và `section_labels`. Bỏ ví dụ JavaScript viết cứng.
- **FR-5** `drop_labels` thay cho `OFF_TOPIC_PATTERN`: section hoặc topic có nhãn nằm trong danh sách bị loại. Giữ regex cũ như một **tuỳ chọn** `drop_patterns` để không mất hành vi hiện tại.
- **FR-6** `export_sections`: chỉ cắt clip cho topic thuộc các section này; những section khác vẫn hiện trên timeline với trạng thái "không xuất".
- **FR-7** `max_llm_chars` (mặc định **300.000** ký tự, đủ cho bài giảng khoảng 4–5 giờ): transcript nằm trong giới hạn thì gửi cả transcript như hiện tại. Vượt giới hạn thì job analyze **dừng với lỗi rõ ràng** `TRANSCRIPT_TOO_LONG` ("Bài giảng quá dài để phân tích một lần, hãy tách video"), không âm thầm cắt bớt. Giá trị 60.000 trong `config.yaml` hiện tại sẽ ép hầu hết bài 90 phút vượt giới hạn, nên đổi mặc định.
- **FR-8** `outline.text` (đề cương do người dùng nhập khi upload) được truyền vào prompt phân đoạn. `outline.mode = guided`: gợi ý cho LLM; `strict`: bắt buộc topic khớp từng mục đề cương.
- **FR-9** Lưu `preset_id` và `config_overrides` trong video để chạy lại cho ra cùng kết quả (tái lập được).
- **FR-10** Kiểm tra schema khi lưu preset: khoá lạ → 400; giá trị ngoài miền (ví dụ `pause_threshold ≤ 0`) → 400.

## 5. Yêu cầu phi chức năng

- Preset hệ thống nằm trong `backend/src/main/resources/presets/*.yaml`, được review như code.
- Gộp cấu hình mất ≤ 5ms.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_presets.sql`:
```sql
CREATE TABLE IF NOT EXISTS user_presets (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    base_preset_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    overrides JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS preset_id VARCHAR(60) NOT NULL DEFAULT 'lecture_programming';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS config_overrides JSONB NOT NULL DEFAULT '{}';
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/presets` | Đăng nhập | Preset hệ thống + cá nhân |
| GET | `/api/v1/presets/{id}` | Đăng nhập | Chi tiết (đã gộp) |
| POST | `/api/v1/presets` | Đăng nhập | Tạo preset cá nhân `{ "basePresetId": "...", "name": "...", "overrides": {...} }` |
| PUT | `/api/v1/videos/{videoId}/config` | Sửa video | `{ "presetId": "...", "overrides": {...} }` |
| GET | `/api/v1/videos/{videoId}/config/effective` | Xem video | Cấu hình đã gộp |

Không có quyền xem video thì 404, xem được nhưng không sửa được thì 403 `FORBIDDEN_ACTION` (AD-2). Preset cá nhân của người khác: 404. Khoá lạ hoặc giá trị sai: `422 PRESET_INVALID` với `details.key`.

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
  - FR-7: kiểm tra tổng ký tự trước khi gọi LLM; vượt `max_llm_chars` thì ném `TranscriptTooLongError`, cli in lỗi có mã `TRANSCRIPT_TOO_LONG` để job runner (F10) ghi vào job.
  - `_fallback_segment_from_sentences` dùng `cfg.segmentation.section_labels` thay cho danh sách viết cứng.
- Thêm `PROMPT_VERSION` (dùng chung với F27).

### 6.5 Frontend (Next.js)

- `AddVideoModal.tsx`: bước "Loại bài giảng" hiện thẻ preset (tên, mô tả, các nhãn section), ô nhập đề cương (`outline.text`), mục "Tuỳ chỉnh nâng cao" (ngưỡng lặng, cue phrases, các công tắc tính năng).
- `StudioHeader.tsx`: hiện preset đang dùng; nút "Đổi preset & phân tích lại".

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* preset `lecture_math_science`. *When* analyze. *Then* prompt gửi LLM chứa "Định lý" trong danh sách nhãn và **không** chứa "DOM".
- **AC-2** — *Given* video ghi đè `cut_points.pause_threshold = 2.5`. *Then* `calculateCutPoints` dùng 2,5 (thấy trong `reasons`).
- **AC-3** — *Given* `drop_labels: [Ngoài lề]` và LLM trả section "Ngoài lề". *Then* topic đó không được cắt clip; hành vi tương đương với regex cũ.
- **AC-4** — *Given* transcript 150.000 ký tự, `max_llm_chars` mặc định. *Then* gọi LLM đúng 1 lần cho bước phân đoạn. *Given* `max_llm_chars = 60000`. *Then* job `FAILED` với mã `TRANSCRIPT_TOO_LONG`, không gọi LLM.
- **AC-5** — *Given* lưu preset có khoá `foo: 1`. *Then* nhận `422 PRESET_INVALID` với `details.key = "foo"`.
- **AC-7** — *Given* preset bật `features.slides` và `features.cleanup`. *Then* job analyze của F26 và F25 đọc được giá trị đó từ `effective_config.json`; tên khoá cũ `slides.enabled` bị từ chối khi lưu preset.
- **AC-6** — Kiểm tra tĩnh: script `tests/check_config_keys.py` liệt kê mọi khoá trong preset; mỗi khoá phải xuất hiện ở ít nhất một chỗ đọc trong code Java hoặc Python. CI thất bại nếu có khoá không dùng.

## 8. Kế hoạch kiểm thử (TDD)

JUnit:
- `PresetServiceTest.merge_listsAreReplacedNotAppended()`
- `PresetServiceTest.merge_nestedMapsDeepMerged()`
- `PresetServiceTest.validate_unknownKeyRejected()`
- `PresetServiceTest.validate_negativePauseThresholdRejected()`
- `CutPointServiceTest.snapAndFilter_usesDropLabelsFromConfig()`
- `PresetControllerTest.putVideoConfig_byViewer_returns403()` và `putVideoConfig_withoutAccess_returns404()` (AD-2)
- `PresetServiceTest.validate_legacyKeySlidesEnabledRejected()` (AC-7)

pytest (`tests/test_f28_presets.py`):
- `test_aiconfig_loads_effective_config_json()`
- `test_segment_prompt_uses_preset_labels_and_examples()`
- `test_segment_raises_too_long_over_max_llm_chars()` (AC-4)
- `test_fallback_uses_config_section_labels()`
- `test_outline_strict_mode_included_in_prompt()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Có video thật dài hơn `max_llm_chars` | Không phân tích được | Lỗi rõ ràng gợi ý tách video; nếu xảy ra thường xuyên thì mở spec riêng cho map-reduce |
| Đổi API cấu hình làm vỡ frontend đang gọi `/api/video/config` | Lỗi UI | Giữ endpoint cũ ít nhất 1 bản phát hành |
| Quá nhiều tuỳ chỉnh làm người dùng bối rối | UX kém | Ẩn trong mục "Nâng cao"; preset mặc định đủ tốt |

## 10. Câu hỏi mở

- [ ] Danh sách 5 preset và nhãn section cụ thể: giảng viên các bộ môn cần duyệt.
- [ ] Có làm "tự đoán preset" bằng LLM từ 2 phút đầu transcript không?
- [ ] `outline.strict = true` xử lý thế nào khi giảng viên dạy khác thứ tự trong đề cương?
