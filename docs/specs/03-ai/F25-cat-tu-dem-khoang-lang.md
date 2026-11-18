# F25 — Cắt từ đệm, khoảng lặng dài và câu nói lặp

| Mục | Giá trị |
|---|---|
| **Mã** | F25 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (phát hiện) + SV1 (render nhiều khoảng) + SV3 (API, DB) + SV4 (xem trước) |
| **Phụ thuộc** | F00 (`videoId`, `topicId`), F23 (mốc từng từ; FR-1b giữ `words` qua bước refine), F09 (job), F28 (khoá `features.cleanup`), F19 (ngân sách `initial_prompt`). Dùng chung bảng `edit_ranges` và hàm `KeepRanges` với F32 theo AD-13 |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không (dùng ffmpeg `silencedetect` đã có sẵn trong ffmpeg) |
| **Tham khảo** | Descript "Remove filler words" & "Shorten word gaps", Riverside "Smooth silences", Recut |

> **Cập nhật 18/11/2026:** thống nhất với F32 theo AD-13 (một hàm `KeepRanges`, `minKeep` 0,3s, `keep_seconds` chia đều hai bên, padding áp trước, một lệnh FFmpeg `filter_complex`, `PUT` chỉ thay dòng `USER`); phát hiện từ đệm và câu lặp trên `words` thô của Whisper vì bước Gemini refine có thể xoá từ đệm; câu mẫu từ đệm trong prompt tính vào ngân sách 420 ký tự của F19; khoá bật tắt `features.cleanup` (F28); bỏ token `charcoal-muted` (AD-12); quyền theo AD-2.

## 1. Bối cảnh & vấn đề

- Bài giảng quay thật thường có 5–15% thời lượng là "ừm", "à", khoảng lặng khi giảng viên gõ code, và câu nói lại ("cái này… cái này là biến").
- Hệ thống hiện chỉ cắt **một khoảng liên tục** cho mỗi clip: `VideoCutter` dùng lệnh `-ss <start> -to <end>` ([VideoCutter.java:212](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L212)). Không có cách bỏ các khoảng nhỏ **bên trong** một clip.
- `SilenceSnapCut` ([SilenceSnapCut.java](../../../backend/src/main/java/com/autocut/video/SilenceSnapCut.java)) chỉ dùng khoảng lặng để **dịch biên**, không để xoá.
- Whisper có xu hướng **tự bỏ qua** từ đệm khi chép. Ngoài ra `clean_hallucination_and_artifacts` ([post_processor.py:96](../../../backend/ai/post_processor.py)) gộp các từ lặp ≥ 3 lần thành 1. Vì vậy dựa hoàn toàn vào transcript sẽ bỏ sót từ đệm.
- Khi có `GEMINI_API_KEY`, `cli.py` luôn chạy `refine_transcript` ([cli.py:236-238](../../../backend/ai/cli.py)). Bước này viết lại chữ của câu và có thể **xoá luôn** "ừm, à" vì coi là lỗi. Vì vậy chữ của câu sau refine không dùng được để tìm từ đệm. Nguồn đúng là danh sách `words` thô của Whisper, được F23 FR-1b giữ lại qua bước refine.

## 2. Mục tiêu

- Phát hiện 3 loại khoảng thừa: `FILLER` (từ đệm), `SILENCE` (lặng > ngưỡng), `REPEAT` (lặp từ hoặc nói lại).
- Người dùng **xem trước** danh sách, bật/tắt từng mục hoặc từng loại, rồi áp dụng.
- Khi render clip, bỏ các khoảng đã chọn, có làm mềm âm thanh ở chỗ nối để không bị "bụp".
- Không làm hỏng mốc thời gian của transcript, chapters, phụ đề (tất cả tính lại theo trục mới).

### Ngoài phạm vi

- Không tự động áp dụng khi người dùng chưa xác nhận.
- Không xử lý tiếng ồn nền (noise reduction).

## 3. User stories

- Là giảng viên, tôi muốn rút một video 60 phút còn khoảng 52 phút bằng cách bỏ "ừm à" và chỗ im lặng gõ code dài.
- Là biên tập viên, tôi muốn giữ lại khoảng lặng khi giảng viên đang viết bảng (có hình), chỉ bỏ khoảng lặng "chết".

## 4. Yêu cầu chức năng

- **FR-0** Bật/tắt toàn bộ tính năng bằng khoá `features.cleanup` (cấu trúc khoá chung của F28). Các tham số nằm trong khối `cleanup.*`.
- **FR-1 Từ đệm:** phát hiện trên **`words` thô của Whisper** (không dùng chữ câu đã refine). Danh sách cấu hình `cleanup.fillers` trong `config.yaml`, mặc định: `ừm, ờ, à, ơ, ừ, ầy, kiểu như, nói chung là, thì là, cái này nó`. Chỉ đánh dấu **từ đứng riêng** (có khoảng lặng ≥ 0,15s trước hoặc sau, hoặc nằm đầu hay cuối câu) để không xoá "à" trong "à, ra vậy" mang nghĩa.
- **FR-2** Để Whisper không bỏ từ đệm: khi bật `features.cleanup`, `initial_prompt` có thêm câu mẫu chứa từ đệm ("Ừm, à, hôm nay ờ chúng ta…", ≤ 40 ký tự). Đây là kỹ thuật đã biết với Whisper. Câu mẫu **tính vào** giới hạn `transcript.prompt_max_chars` (420) của F19: `build_initial_prompt` đặt nó lên **đầu** prompt và trừ độ dài của nó khỏi ngân sách trước khi thêm thuật ngữ, nên số thuật ngữ bị bỏ có thể tăng và được báo trong `dropped_terms`. Đo hiệu quả ở AC-5.
- **FR-3 Khoảng lặng:** chạy `ffmpeg -af silencedetect=noise=-35dB:d=<min>` trên audio. Khoảng lặng > `cleanup.silence_min` (mặc định 1,2s) được **rút ngắn về** `cleanup.silence_keep` (mặc định 0,4s), không xoá hẳn. Có tuỳ chọn bỏ qua khoảng lặng mà khung hình thay đổi nhiều (đang gõ code), dùng ffmpeg `select='gt(scene,0.02)'`, mặc định tắt.
- **FR-4 Lặp:** phát hiện n-gram (2–5 từ) lặp liền nhau trên `words` thô (trước `clean_hallucination_and_artifacts`), trong cùng câu hoặc giữa hai câu sát nhau, ví dụ "cái này cái này là". Đề xuất xoá lần xuất hiện **đầu tiên**.
- **FR-5** Mỗi khoảng phát hiện được lưu thành một dòng `edit_ranges` với `source='AUTO'`, `kind ∈ {FILLER, SILENCE, REPEAT}`. Mặc định `enabled=true` cho `FILLER` và `SILENCE`, `false` cho `REPEAT` (dễ sai hơn). Chạy phát hiện lại thì job **xoá các dòng `AUTO` cùng loại** của video rồi chèn dòng mới, trong một transaction; dòng `USER` (F32) không bị đụng tới.
- **FR-6 Render (theo AD-13):** dùng hàm chung `video/KeepRanges.compute(start, end, enabledRanges, minKeep = 0.3)`:
  1. Áp `padding_start`/`padding_end` vào hai đầu topic trước.
  2. Trừ các khoảng bị cắt (`enabled = true`, cả `AUTO` lẫn `USER`). Với `SILENCE`, chỉ cắt phần giữa và giữ `keep_seconds` chia đều hai bên khoảng lặng.
  3. Mảnh giữ lại ngắn hơn `minKeep` thì gộp vào khoảng bị cắt bên cạnh (bỏ mảnh đó).
  4. `VideoCutter` render bằng **một lệnh FFmpeg** `filter_complex` (`trim`/`atrim` + `concat`, `afade` 10 ms ở mỗi mối nối). Bộ lọc được ghi ra tệp và truyền bằng `-filter_complex_script` để không vượt giới hạn độ dài dòng lệnh.
- **FR-7 Ánh xạ thời gian:** hàm `mapTime(t_source) -> t_output` dùng chung để tính lại phụ đề (F23), chapters (F22) và thống kê.
- **FR-8** Hiện tổng thời lượng tiết kiệm được: "Rút ngắn 7 phút 42 giây (12,8%)".

## 5. Yêu cầu phi chức năng

- Phát hiện cho video 60 phút ≤ 60s (`silencedetect` chạy nhanh, phần còn lại là xử lý chuỗi).
- Render nhiều khoảng không chậm hơn render một khoảng quá 30%.
- Chỗ nối không nghe thấy tiếng "bụp" (kiểm tra bằng tai trên 10 điểm nối ngẫu nhiên).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_edit_ranges.sql` (bảng này **dùng chung với F32**, AD-13):
```sql
-- Định nghĩa chuẩn, giống hệt F32. Spec nào merge trước thì tạo bảng; spec sau chỉ dùng lại.
-- Bản ghi do AI phát hiện thì ghi rõ source = 'AUTO'.
CREATE TABLE IF NOT EXISTS edit_ranges (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    kind VARCHAR(12) NOT NULL DEFAULT 'MANUAL',      -- MANUAL (F32) | FILLER | SILENCE | REPEAT (F25)
    start_time DOUBLE PRECISION NOT NULL,
    end_time DOUBLE PRECISION NOT NULL,
    keep_seconds DOUBLE PRECISION NOT NULL DEFAULT 0, -- SILENCE: giữ lại bao nhiêu giây
    text TEXT,                                        -- đoạn chữ bị bỏ (để hiển thị)
    note VARCHAR(255),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    source VARCHAR(10) NOT NULL DEFAULT 'USER',       -- AUTO (AI phát hiện) | USER (người dùng)
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_edit_range CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_edit_ranges_video ON edit_ranges(video_id, start_time);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos/{videoId}/cleanup:detect` | Sửa video | `{ "types": ["FILLER","SILENCE","REPEAT"], "silenceMin": 1.2 }` → `202 { "jobId": … }` (job `CLEANUP_DETECT`, F09) |
| GET | `/api/v1/videos/{videoId}/edit-ranges?kind=&source=` | Xem video | Danh sách + tổng thời gian tiết kiệm (endpoint chung với F32) |
| PATCH | `/api/v1/videos/{videoId}/edit-ranges` | Sửa video | Bật/tắt hàng loạt `{ "ids": [..], "enabled": false }` hoặc `{ "kind": "REPEAT", "enabled": true }` |
| POST | `/api/video/cut` (mở rộng) | Sửa video | `applyEditRanges: true`; backend đọc `edit_ranges` từ DB theo `videoId` (F00 đã thêm trường này vào `CutRequestDTO`) |

`PUT …/edit-ranges` thuộc F32 và **chỉ thay các dòng `source='USER'`** (AD-13); F25 không có API ghi trực tiếp dòng `AUTO`. Không có quyền xem thì 404, xem được nhưng không sửa được thì 403 `FORBIDDEN_ACTION` (AD-2).

```json
// GET /api/v1/videos/12/edit-ranges
{ "savedSeconds": 462.3, "savedPercent": 12.8,
  "items": [ { "id": 1, "kind": "FILLER", "source": "AUTO", "start": 15.42, "end": 15.81, "text": "ừm", "enabled": true },
             { "id": 2, "kind": "SILENCE", "source": "AUTO", "start": 120.0, "end": 126.5, "keepSeconds": 0.4, "enabled": true } ] }
```

### 6.3 Backend (Spring Boot)

- `video/SilenceDetector.java`: chạy `silencedetect`, đọc stderr bằng `StreamUtil` (đã có), trả `List<double[]>`.
- `video/KeepRanges.java` (hàm thuần, **dùng chung với F32**, spec nào merge trước thì viết): `List<double[]> compute(double start, double end, List<EditRange> enabledRanges, double minKeep)` (FR-6) và `double mapTime(double tSource)`.
- `VideoCutter`: **dùng chung** hàm `cutKeepRanges(File in, File out, List<double[]> keep)` do F32 định nghĩa (1 khoảng giữ thì gọi `cut` hiện có, ≥ 2 khoảng thì một lệnh `filter_complex`). F25 chỉ bổ sung: khi chuỗi bộ lọc dài (nhiều khoảng) thì ghi ra tệp và truyền bằng `-filter_complex_script`. Không viết nhánh render riêng.
- `service/CleanupService.java`: handler của job `CLEANUP_DETECT` (F09), gọi `SilenceDetector` và Python, ghi dòng `AUTO` theo FR-5.
- `controller/EditRangeController.java`: **dùng chung với F32**. F32 tạo controller cùng `GET` và `PUT` (chỉ dòng `USER`); F25 thêm `PATCH` bật/tắt theo `ids` hoặc `kind`. Nếu F25 merge trước F32 thì F25 tạo controller với `GET` + `PATCH`, F32 thêm `PUT` sau.

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/cleanup_detector.py`:
  ```python
  def detect_fillers(sentences: list[Sentence], fillers: list[str], min_gap: float = 0.15) -> list[EditRange]: ...
  def detect_repeats(sentences: list[Sentence], min_n: int = 2, max_n: int = 5) -> list[EditRange]: ...
  ```
  Cả hai chỉ đọc `sentence.words` (chữ thô và mốc thời gian của Whisper, được F23 FR-1b giữ qua bước refine), **không** đọc `sentence.text` đã refine. Thiếu `words` thì chỉ chạy `SILENCE` và in `@@WARN {"code":"CLEANUP_NO_WORDS"}` (vào `jobs.result.warnings`).
- `prompt_builder.build_initial_prompt`: thêm tham số `keep_fillers: bool` (FR-2). Khi `True`, đặt câu mẫu lên đầu và trừ vào ngân sách `max_chars`.
- `post_processor.clean_hallucination_and_artifacts` chỉ sửa `text`, không sửa `words`, nên danh sách `words` vẫn giữ dấu vết lặp cho FR-4. Thêm test để khoá hành vi này.

### 6.5 Frontend (Next.js)

- Panel mới `CleanupPanel.tsx` (tách tệp riêng): ba công tắc theo loại, danh sách mục, bấm một mục để phát thử 2s trước và sau, hiện tổng thời gian tiết kiệm.
- `StudioTimeline.tsx`: tô sọc chéo các khoảng `enabled`. Nút **"Xem trước đã cắt"** cho trình phát tự nhảy qua các khoảng bị xoá (xử lý `timeupdate` phía client, không cần render).
- `TranscriptScenesPanel.tsx`: từ đệm bị đánh dấu hiện gạch ngang (`line-through text-slate-500`), dùng class Tailwind chuẩn (AD-12).

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* câu có từ "ừm" đứng riêng, có lặng 0,3s trước và sau. *Then* tạo `FILLER` đúng mốc của từ (sai số ≤ 0,05s).
- **AC-2** — *Given* câu "à, ra là vậy" (à mang nghĩa, không có lặng). *Then* không tạo `FILLER`.
- **AC-3** — *Given* khoảng lặng 6,5s `[120,0; 126,5]`, `silenceKeep=0.4`. *Then* clip đầu ra ngắn hơn 6,1s (± 0,05s); phần giữ lại là `[120,0; 120,2]` và `[126,3; 126,5]` (chia đều hai bên).
- **AC-4** — *Given* topic 60s, `padding_start = 0,3`, `padding_end = 0,5`, có 10 khoảng bị xoá nằm trong topic, tổng 8s, mọi mảnh giữ lại ≥ 0,3s. *Then* thời lượng clip = 60 + 0,8 − 8 = **52,8s ± 0,1s**; `ffprobe` không báo lỗi; âm thanh và hình khớp nhau (lệch ≤ 40ms ở cuối clip).
- **AC-4b** — *Given* có dòng `USER` (F32) và dòng `AUTO`. *When* chạy phát hiện lại. *Then* dòng `USER` giữ nguyên, chỉ dòng `AUTO` cùng loại được thay.
- **AC-4c** — *Given* Gemini refine đã xoá "ừm" khỏi chữ câu, nhưng `words` vẫn có "ừm". *Then* vẫn tạo `FILLER` cho từ đó.
- **AC-5** — Trên 3 video mẫu đã gán nhãn từ đệm tay: độ phủ (recall) phát hiện `FILLER` ≥ 70%, độ chính xác (precision) ≥ 85%.
- **AC-6** — Phụ đề (F23) của clip đã cắt khớp tiếng sau ánh xạ thời gian: lệch ≤ 0,3s.

## 8. Kế hoạch kiểm thử (TDD)

JUnit:
- `KeepRangesTest` là **bộ test chung với F32**; F25 thêm các case sau:
- `KeepRangesTest.compute_removesInnerRangesAndMergesTiny()` (mảnh < 0,3s bị bỏ)
- `KeepRangesTest.compute_silenceKeepsConfiguredSecondsSplitEvenly()` (AC-3)
- `KeepRangesTest.compute_appliesPaddingBeforeRemovals()` (AC-4)
- `KeepRangesTest.compute_ignoresDisabledRanges()`
- `CleanupServiceTest.redetect_replacesOnlyAutoRowsOfSameKind()` (AC-4b)
- `KeepRangesTest.mapTime_afterRemovals_shiftsCorrectly()`
- `SilenceDetectorTest.parse_ffmpegStderr_extractsRanges()` (dùng chuỗi stderr mẫu)
- `VideoCutterTest.buildCommand_withRemovals_buildsFilterComplexScriptWithAfade()`
- `VideoCutterTest.cutWithRemovals_outputDurationMatches()` (integration, cần ffmpeg, dùng video mẫu 10s tạo bằng `testsrc`)

pytest (`tests/test_f25_cleanup.py`):
- `test_detect_fillers_requires_isolation_gap()`
- `test_detect_fillers_ignores_meaningful_a()`
- `test_detect_repeats_bigram_marks_first_occurrence()`
- `test_detect_without_words_returns_warning()`
- `test_detect_fillers_uses_words_not_refined_text()` (AC-4c)
- `test_build_initial_prompt_filler_sample_counts_toward_budget()` (FR-2)
- `test_clean_hallucination_does_not_touch_words()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Whisper vẫn bỏ từ đệm | Độ phủ thấp | FR-2; có thể bổ sung phát hiện theo năng lượng âm (đề xuất ở phiên bản sau) |
| Cắt quá sát làm mất phụ âm đầu hoặc cuối | Tiếng bị cụt | Mở rộng mỗi khoảng giữ lại 30ms hai đầu; dùng `afade` |
| `filter_complex` quá dài khi có hàng trăm khoảng | ffmpeg lỗi hoặc rất chậm | Truyền bằng `-filter_complex_script` (không giới hạn độ dài dòng lệnh); trước khi dựng lệnh, gộp các khoảng cắt cách nhau < `minKeep`; đo thời gian render ở test integration với 200 khoảng |
| Câu mẫu từ đệm chiếm chỗ của thuật ngữ trong prompt | Thuật ngữ bị bỏ nhiều hơn | Câu mẫu ≤ 40 ký tự; `dropped_terms` (F19) báo cho người dùng |
| Xoá khoảng lặng khi giảng viên đang viết bảng | Mất nội dung hình | Tuỳ chọn phát hiện thay đổi khung hình (FR-3); bắt buộc xem trước |

## 10. Câu hỏi mở

- [ ] Danh sách từ đệm mặc định đã đủ chưa? Có khác nhau theo vùng miền không?
- [ ] Có áp dụng xoá cho bản xem trên trang khoá học (F41) mà không render lại không (phát nhảy qua)?
- [ ] Mặc định tắt hay bật `REPEAT`?
