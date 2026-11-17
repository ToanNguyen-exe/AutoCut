# F25 — Cắt từ đệm, khoảng lặng dài và câu nói lặp

| Mục | Giá trị |
|---|---|
| **Mã** | F25 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (phát hiện) + SV1 (render nhiều khoảng) + SV3 (API, DB) + SV4 (xem trước) |
| **Phụ thuộc** | F23 (mốc từng từ), F09 (job), F32 (dùng chung mô hình "khoảng bị xoá") |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không (dùng ffmpeg `silencedetect` đã có sẵn trong ffmpeg) |
| **Tham khảo** | Descript "Remove filler words" & "Shorten word gaps", Riverside "Smooth silences", Recut |

## 1. Bối cảnh & vấn đề

- Bài giảng quay thật thường có 5–15% thời lượng là "ừm", "à", khoảng lặng khi giảng viên gõ code, và câu nói lại ("cái này… cái này là biến").
- Hệ thống hiện chỉ cắt **một khoảng liên tục** cho mỗi clip: `VideoCutter` dùng lệnh `-ss <start> -to <end>` ([VideoCutter.java:212](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L212)). Không có cách bỏ các khoảng nhỏ **bên trong** một clip.
- `SilenceSnapCut` ([SilenceSnapCut.java](../../../backend/src/main/java/com/autocut/video/SilenceSnapCut.java)) chỉ dùng khoảng lặng để **dịch biên**, không để xoá.
- Whisper có xu hướng **tự bỏ qua** từ đệm khi chép. Ngoài ra `clean_hallucination_and_artifacts` ([post_processor.py:96](../../../backend/ai/post_processor.py)) gộp các từ lặp ≥ 3 lần thành 1. Vì vậy dựa hoàn toàn vào transcript sẽ bỏ sót từ đệm.

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

- **FR-1 Từ đệm:** danh sách cấu hình `cleanup.fillers` trong `config.yaml`, mặc định: `ừm, ờ, à, ơ, ừ, ầy, kiểu như, nói chung là, thì là, cái này nó`. Chỉ đánh dấu **từ đứng riêng** (có khoảng lặng ≥ 0,15s trước hoặc sau, hoặc nằm đầu hay cuối câu) để không xoá "à" trong "à, ra vậy" mang nghĩa.
- **FR-2** Để Whisper không bỏ từ đệm: khi bật F25, `initial_prompt` có thêm câu mẫu chứa từ đệm ("Ừm, à, hôm nay ờ chúng ta…"). Đây là kỹ thuật đã biết với Whisper. Đo hiệu quả ở AC-5.
- **FR-3 Khoảng lặng:** chạy `ffmpeg -af silencedetect=noise=-35dB:d=<min>` trên audio. Khoảng lặng > `cleanup.silence_min` (mặc định 1,2s) được **rút ngắn về** `cleanup.silence_keep` (mặc định 0,4s), không xoá hẳn. Có tuỳ chọn bỏ qua khoảng lặng mà khung hình thay đổi nhiều (đang gõ code), dùng ffmpeg `select='gt(scene,0.02)'`, mặc định tắt.
- **FR-4 Lặp:** phát hiện n-gram (2–5 từ) lặp liền nhau trong cùng câu hoặc giữa hai câu sát nhau, ví dụ "cái này cái này là". Đề xuất xoá lần xuất hiện **đầu tiên**.
- **FR-5** Mỗi khoảng phát hiện được có dạng `{ id, type, start, end, text, enabled }`. Mặc định `enabled=true` cho `FILLER` và `SILENCE`, `false` cho `REPEAT` (dễ sai hơn).
- **FR-6 Render:** `VideoCutter` nhận thêm danh sách khoảng bị xoá trong `[start, end]`. Dựng danh sách khoảng **giữ lại**, rồi dùng `filter_complex` với `trim/atrim` + `concat`, thêm `afade` 10ms ở mỗi chỗ nối. Khoảng giữ lại < 0,1s thì gộp với khoảng bên cạnh.
- **FR-7 Ánh xạ thời gian:** hàm `mapTime(t_source) -> t_output` dùng chung để tính lại phụ đề (F23), chapters (F22) và thống kê.
- **FR-8** Hiện tổng thời lượng tiết kiệm được: "Rút ngắn 7 phút 42 giây (12,8%)".

## 5. Yêu cầu phi chức năng

- Phát hiện cho video 60 phút ≤ 60s (`silencedetect` chạy nhanh, phần còn lại là xử lý chuỗi).
- Render nhiều khoảng không chậm hơn render một khoảng quá 30%.
- Chỗ nối không nghe thấy tiếng "bụp" (kiểm tra bằng tai trên 10 điểm nối ngẫu nhiên).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_edit_ranges.sql` (bảng này **dùng chung với F32**):
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
| POST | `/api/v1/videos/{id}/cleanup:detect` | Chủ video | `{ "types": ["FILLER","SILENCE","REPEAT"], "silenceMin": 1.2 }` → `202 jobId` |
| GET | `/api/v1/videos/{id}/edit-ranges?kind=` | Chủ video | Danh sách + tổng thời gian tiết kiệm |
| PATCH | `/api/v1/videos/{id}/edit-ranges` | Chủ video | Bật/tắt hàng loạt `{ "ids": [..], "enabled": false }` hoặc `{ "kind": "REPEAT", "enabled": true }` |
| POST | `/api/video/cut` (mở rộng) | Chủ video | `applyEditRanges: true` |

```json
// GET /api/v1/videos/12/edit-ranges
{ "savedSeconds": 462.3, "savedPercent": 12.8,
  "items": [ { "id": 1, "kind": "FILLER", "start": 15.42, "end": 15.81, "text": "ừm", "enabled": true },
             { "id": 2, "kind": "SILENCE", "start": 120.0, "end": 126.5, "keepSeconds": 0.4, "enabled": true } ] }
```

### 6.3 Backend (Spring Boot)

- `video/SilenceDetector.java`: chạy `silencedetect`, đọc stderr bằng `StreamUtil` (đã có), trả `List<double[]>`.
- `video/KeepRanges.java` (hàm thuần): `List<double[]> compute(double start, double end, List<EditRange> removed)` và `double mapTime(double t)`.
- `VideoCutter`: thêm nhánh `cutWithRemovals(...)` dựng `filter_complex`. Giữ nhánh cũ không đổi khi danh sách rỗng.
- `service/CleanupService.java`, `controller/EditRangeController.java`.

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/cleanup_detector.py`:
  ```python
  def detect_fillers(sentences: list[Sentence], fillers: list[str], min_gap: float = 0.15) -> list[EditRange]: ...
  def detect_repeats(sentences: list[Sentence], min_n: int = 2, max_n: int = 5) -> list[EditRange]: ...
  ```
  Cả hai cần `words` (F23). Thiếu `words` thì chỉ chạy `SILENCE` và trả cảnh báo.
- `prompt_builder.build_initial_prompt`: thêm tham số `keep_fillers: bool` (FR-2).
- `post_processor.clean_hallucination_and_artifacts`: **không** gộp các từ lặp khi chạy chế độ `keep_fillers`. Phải giữ dấu vết lặp để F25 phát hiện; transcript hiển thị vẫn có thể ẩn chúng.

### 6.5 Frontend (Next.js)

- Panel mới `CleanupPanel.tsx` (tách tệp riêng): ba công tắc theo loại, danh sách mục, bấm một mục để phát thử 2s trước và sau, hiện tổng thời gian tiết kiệm.
- `StudioTimeline.tsx`: tô sọc chéo các khoảng `enabled`. Nút **"Xem trước đã cắt"** cho trình phát tự nhảy qua các khoảng bị xoá (xử lý `timeupdate` phía client, không cần render).
- `TranscriptScenesPanel.tsx`: từ đệm bị đánh dấu hiện gạch ngang, màu `charcoal-muted`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* câu có từ "ừm" đứng riêng, có lặng 0,3s trước và sau. *Then* tạo `FILLER` đúng mốc của từ (sai số ≤ 0,05s).
- **AC-2** — *Given* câu "à, ra là vậy" (à mang nghĩa, không có lặng). *Then* không tạo `FILLER`.
- **AC-3** — *Given* khoảng lặng 6,5s, `silenceKeep=0.4`. *Then* clip đầu ra ngắn hơn 6,1s (± 0,05s).
- **AC-4** — *Given* clip 60s có 10 khoảng bị xoá, tổng 8s. *Then* thời lượng clip = 52s ± 0,1s; `ffprobe` không báo lỗi; âm thanh và hình khớp nhau (lệch ≤ 40ms ở cuối clip).
- **AC-5** — Trên 3 video mẫu đã gán nhãn từ đệm tay: độ phủ (recall) phát hiện `FILLER` ≥ 70%, độ chính xác (precision) ≥ 85%.
- **AC-6** — Phụ đề (F23) của clip đã cắt khớp tiếng sau ánh xạ thời gian: lệch ≤ 0,3s.

## 8. Kế hoạch kiểm thử (TDD)

JUnit:
- `KeepRangesTest.compute_removesInnerRangesAndMergesTiny()`
- `KeepRangesTest.compute_silenceKeepsConfiguredSeconds()`
- `KeepRangesTest.mapTime_afterRemovals_shiftsCorrectly()`
- `SilenceDetectorTest.parse_ffmpegStderr_extractsRanges()` (dùng chuỗi stderr mẫu)
- `VideoCutterTest.buildCommand_withRemovals_buildsFilterComplexWithAfade()`
- `VideoCutterTest.cutWithRemovals_outputDurationMatches()` (integration, cần ffmpeg, dùng video mẫu 10s tạo bằng `testsrc`)

pytest (`tests/test_f25_cleanup.py`):
- `test_detect_fillers_requires_isolation_gap()`
- `test_detect_fillers_ignores_meaningful_a()`
- `test_detect_repeats_bigram_marks_first_occurrence()`
- `test_detect_without_words_returns_warning()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Whisper vẫn bỏ từ đệm | Độ phủ thấp | FR-2; có thể bổ sung phát hiện theo năng lượng âm (đề xuất ở phiên bản sau) |
| Cắt quá sát làm mất phụ âm đầu hoặc cuối | Tiếng bị cụt | Mở rộng mỗi khoảng giữ lại 30ms hai đầu; dùng `afade` |
| `filter_complex` quá dài khi có hàng trăm khoảng | ffmpeg lỗi hoặc rất chậm | > 150 khoảng/clip: tách thành nhiều đoạn nhỏ rồi ghép bằng `VideoConcat` |
| Xoá khoảng lặng khi giảng viên đang viết bảng | Mất nội dung hình | Tuỳ chọn phát hiện thay đổi khung hình (FR-3); bắt buộc xem trước |

## 10. Câu hỏi mở

- [ ] Danh sách từ đệm mặc định đã đủ chưa? Có khác nhau theo vùng miền không?
- [ ] Có áp dụng xoá cho bản xem trên trang khoá học (F41) mà không render lại không (phát nhảy qua)?
- [ ] Mặc định tắt hay bật `REPEAT`?
