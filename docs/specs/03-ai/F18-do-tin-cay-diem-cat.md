# F18 — Độ tin cậy điểm cắt

| Mục | Giá trị |
|---|---|
| **Mã** | F18 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (chấm điểm, API, DB) + SV2 (tín hiệu từ LLM) + SV4 (tô màu timeline) |
| **Phụ thuộc** | F13 (Flyway). Nên làm sau F10 để có tiến độ analyze |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Opus Clip (điểm "virality" từng clip), Descript (đánh dấu từ AI không chắc) |

## 1. Bối cảnh & vấn đề

Hiện mỗi ranh giới giữa hai câu đã được chấm một **điểm số nguyên** nhưng điểm này chưa tới tay người dùng:

- `CutPointService.calculateCutPoints` ([CutPointService.java:52](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L52)) cộng điểm theo luật: ranh giới +1, im lặng ≥ `pause_threshold` +2, im lặng ≥ 3s +1, câu sau bắt đầu bằng cue phrase +3 (dòng 66–89). Thang điểm 1–7 không chuẩn hoá.
- Bản ghi `CutPoint(afterId, time, score, reasons)` ([Models.java:32](../../../backend/src/main/java/com/autocut/dto/Models.java#L32)) chỉ được ghi ra `cut_points.json` ở gốc dự án, không lưu DB và không gắn với từng `Segment`.
- `snapAndFilterSegments` ([CutPointService.java:174](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L174)) dịch biên của segment do LLM đề xuất về điểm cắt tốt nhất trong cửa sổ ±`snap_window_sentences`. Nhưng người dùng không biết biên nào đã được dịch, dịch xa bao nhiêu, và biên nào không tìm được điểm tốt.
- Phía Python, khi LLM trả mã câu sai, `resolve_sentence` ([transcript_refiner.py:451](../../../backend/ai/transcript_refiner.py)) lặng lẽ đoán theo số giây hoặc lấy câu mặc định. Khi Gemini lỗi, hệ thống rơi vào `_fallback_segment_from_sentences` ([transcript_refiner.py:552](../../../backend/ai/transcript_refiner.py)), tức là chia đều theo số câu. **Cả hai trường hợp đều không báo cho người dùng biết**, và kết quả trông giống hệt một lần phân đoạn tốt.

Hệ quả là người duyệt phải xem lại **toàn bộ** video thay vì chỉ những chỗ đáng ngờ.

## 2. Mục tiêu

- Mỗi **biên** (đầu và cuối) của mỗi segment có một giá trị `confidence ∈ [0, 1]` kèm danh sách lý do dễ đọc.
- Mỗi segment có `confidence = min(conf_start, conf_end)` và cờ `needs_review` khi `confidence < 0.5`.
- Kết quả phân tích có thêm `analysis_source`: `LLM`, `LLM_REPAIRED` (có mã câu phải sửa) hoặc `FALLBACK`.
- Giao diện tô màu các segment cần duyệt và có nút "Đi tới chỗ cần duyệt tiếp theo".

### Ngoài phạm vi

- Không huấn luyện mô hình riêng; công thức là heuristic (chọn theo kinh nghiệm), có thể tinh chỉnh ở F27.
- Không tính độ tin cậy cho từng từ trong transcript.

## 3. User stories

- Là giảng viên, tôi muốn thấy ngay đoạn nào AI không chắc để chỉ duyệt 3–4 chỗ thay vì xem cả video 90 phút.
- Là biên tập viên, tôi muốn biết vì sao một điểm cắt bị đánh giá thấp (ví dụ "cắt giữa câu, không có khoảng lặng").
- Là trưởng nhóm, tôi muốn biết video nào đã bị phân đoạn bằng chế độ dự phòng để chạy lại khi Gemini hoạt động trở lại.

## 4. Yêu cầu chức năng

- **FR-1** Chuẩn hoá điểm thô sang `[0,1]`: `norm = min(score, 7) / 7`.
- **FR-2** Độ tin cậy của một biên được tính như sau:
  ```
  conf = 0.5 * norm(score của cut point được chọn)
       + 0.3 * (1 - min(|snap_distance_s|, 10) / 10)
       + 0.2 * llm_agree
  ```
  - `snap_distance_s` là khoảng cách (giây) giữa mốc LLM đề xuất và mốc sau khi snap.
  - `llm_agree = 1` khi mã câu LLM trả về tồn tại nguyên vẹn; `0.5` khi `resolve_sentence` phải chuẩn hoá padding (ví dụ `S12` → `S0012`); `0` khi phải đoán theo số giây hoặc lấy mặc định.
- **FR-3** Biên đầu của segment đầu tiên (0s) và biên cuối của segment cuối (bằng `duration`) luôn có `conf = 1.0`.
- **FR-4** Khi `analysis_source = FALLBACK`, mọi biên nội bộ bị giới hạn trần `conf ≤ 0.3`.
- **FR-5** Mỗi biên có `reasons[]` bằng tiếng Việt có dấu, ví dụ: `"Khoảng lặng 2,1 giây"`, `"Có từ chuyển ý: 'tiếp theo'"`, `"Đã dịch 6,4 giây so với đề xuất AI"`, `"AI trả mã câu không tồn tại"`.
- **FR-6** Ngưỡng `needs_review` cấu hình được trong `config.yaml`: `cut_points.review_threshold: 0.5`.
- **FR-7** Người dùng sửa tay một biên thì `confidence` của biên đó đặt thành `1.0`, kèm `reasons = ["Đã duyệt thủ công"]`.

## 5. Yêu cầu phi chức năng

- Tính confidence thêm không quá 50 ms cho transcript 3.000 câu.
- Không làm đổi kết quả snap hiện tại: các test trong `CutPointServiceTest` phải giữ nguyên và vẫn chạy qua.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__add_topic_confidence.sql`:
```sql
ALTER TABLE topics ADD COLUMN start_confidence DOUBLE PRECISION;
ALTER TABLE topics ADD COLUMN end_confidence   DOUBLE PRECISION;
ALTER TABLE topics ADD COLUMN confidence_reasons JSONB;      -- {"start":[...],"end":[...]}
ALTER TABLE topics ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE videos ADD COLUMN analysis_source VARCHAR(20);   -- LLM | LLM_REPAIRED | FALLBACK
CREATE INDEX idx_topics_needs_review ON topics(needs_review) WHERE needs_review = TRUE;
```

### 6.2 API

Không thêm endpoint mới. Mở rộng response của `POST /api/video/analyze` và `GET /api/video/{id}/segments` (thêm trường, không đổi trường cũ):

```json
{
  "analysis_source": "LLM_REPAIRED",
  "segments": [
    {
      "id": "seg_ai_03",
      "topic": "Vòng lặp for",
      "start": 412.35, "end": 780.1,
      "confidence": 0.42,
      "needs_review": true,
      "boundary": {
        "start": { "confidence": 0.42, "snap_distance": 6.4,
                   "reasons": ["Đã dịch 6,4 giây so với đề xuất AI", "Không có khoảng lặng"] },
        "end":   { "confidence": 0.86, "snap_distance": 0.3,
                   "reasons": ["Khoảng lặng 2,1 giây", "Có từ chuyển ý: 'tiếp theo'"] }
      }
    }
  ]
}
```

`PATCH /api/v1/topics/{id}/boundary` (đi cùng F31/F33): khi người dùng sửa biên, server đặt lại confidence theo FR-7.

### 6.3 Backend (Spring Boot)

- `Models.java`: thêm `record BoundaryInfo(double confidence, double snapDistance, List<String> reasons)`. Thêm vào `Segment` các trường **nullable** `Double confidence`, `Boolean needsReview`, `Map<String, BoundaryInfo> boundary`. Vì `Segment` đang là record có 11 tham số, tạo factory `Segment.withConfidence(...)` để không phải sửa mọi chỗ khởi tạo.
- `CutPointService`: tách hàm thuần `static double boundaryConfidence(int score, double snapDistance, double llmAgree)`. Trong `snapAndFilterSegments`, ghi nhận `snapDistance` và cut point được chọn cho từng biên.
- `ConfigService`: thêm `getReviewThreshold()`, mặc định 0.5.
- `SegmentPersistenceService.saveSegmentsToDatabase` ([dòng 75](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L75)): ghi 4 cột mới; `getSegmentsFromDatabase` đọc ngược lại.
- `TopicEntity`: thêm 4 trường tương ứng.

### 6.4 AI pipeline (Python)

- `transcript_refiner.py` trong `segment_transcript`: cho `resolve_sentence` trả thêm `match_kind ∈ {"exact","normalized","guessed","default"}`, gắn vào mỗi segment `llm_match: {"start": ..., "end": ...}`.
- Đặt `segments_data["analysis_source"]`: `FALLBACK` khi chạy vào nhánh `_fallback_segment_from_sentences`; `LLM_REPAIRED` khi có ít nhất một `match_kind != "exact"`; ngược lại là `LLM`.
- `cli.py` `run_backend_analysis` ([cli.py:324](../../../backend/ai/cli.py)): nhánh `except Exception` (dòng ~340) **phải log lý do** và đặt `analysis_source = "FALLBACK"`, không được nuốt lỗi.
- Mapping `match_kind → llm_agree`: exact = 1, normalized = 0.5, guessed/default = 0.

### 6.5 Frontend (Next.js)

- `types/index.ts` (`Segment`, dòng 28): thêm `confidence?: number; needs_review?: boolean; boundary?: {...}`.
- `StudioTimeline.tsx`: segment có `needs_review` được viền nét đứt và có biểu tượng `AlertTriangle` (Lucide). Màu lấy từ token cảnh báo hiện có trong `tailwind.config.ts`, không tự đặt mã màu mới.
- `TranscriptScenesPanel.tsx`: thêm badge "Cần duyệt (n)" và nút **"Chỗ cần duyệt tiếp theo"** (phím tắt `N`, phối hợp với F31) để nhảy playhead tới biên có confidence thấp nhất chưa duyệt.
- `SegmentDetailModal.tsx`: thêm khối "Độ tin cậy", hiện % và danh sách `reasons`.
- Khi `analysis_source = FALLBACK`: hiện banner "AI chưa phân tích được nội dung, các đoạn đang được chia đều. Bấm **Phân tích lại** khi có mạng."

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* hai câu cách nhau 2,0s và câu sau bắt đầu bằng "tiếp theo", LLM chọn đúng mã câu, snap 0s. *When* tính confidence. *Then* `conf = 0.5*(6/7) + 0.3*1 + 0.2*1 ≈ 0.93`.
- **AC-2** — *Given* LLM trả `end_id = "S0828"` không tồn tại, phải đoán theo giây. *When* analyze. *Then* `analysis_source = "LLM_REPAIRED"`, biên đó có `reasons` chứa "AI trả mã câu không tồn tại" và `needs_review = true`.
- **AC-3** — *Given* không có `GEMINI_API_KEY`. *When* analyze. *Then* `analysis_source = "FALLBACK"`, mọi biên nội bộ `≤ 0.3`, UI hiện banner.
- **AC-4** — *Given* segment đang `needs_review = true`. *When* người dùng kéo biên và lưu. *Then* biên đó có `confidence = 1.0`, segment không còn cờ nếu biên kia ≥ ngưỡng.
- **AC-5** — Trên bộ 5 video mẫu đã được duyệt tay (đặt trong `tests/fixtures/f18/`): **≥ 80%** biên mà người duyệt phải sửa (> 3s) có `needs_review = true` (độ phủ), và **≤ 40%** biên bị gắn cờ là biên đúng (báo nhầm).
- **AC-6** — Sau F13, `GET /api/video/{id}/segments` trả đúng các giá trị confidence đã lưu.

## 8. Kế hoạch kiểm thử (TDD)

JUnit, viết trước:
- `CutPointServiceTest.boundaryConfidence_maxSignals_returnsAbove09()`
- `CutPointServiceTest.boundaryConfidence_largeSnapDistance_isPenalized()`
- `CutPointServiceTest.snapAndFilter_firstAndLastBoundary_haveConfidenceOne()`
- `CutPointServiceTest.snapAndFilter_fallbackSource_capsAt03()`
- `CutPointServiceTest.snapAndFilter_belowThreshold_setsNeedsReview()`
- `SegmentPersistenceServiceTest.saveAndLoad_roundTripsConfidenceFields()`

pytest (`tests/test_f18_confidence.py`):
- `test_resolve_sentence_exact_match_kind()`
- `test_resolve_sentence_seconds_as_id_is_guessed()`
- `test_segment_transcript_without_api_key_sets_fallback_source()` (mock `_generate_with_fallback` ném lỗi)
- `test_segment_transcript_repaired_ids_sets_llm_repaired()`

E2E (SV4): mở video mẫu có biên cần duyệt, bấm `N` thì playhead nhảy đúng tới biên.

Đo chất lượng: script `tests/eval/eval_confidence.py` tính độ phủ và tỉ lệ báo nhầm của AC-5, in bảng kết quả.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Trọng số 0.5/0.3/0.2 chưa hợp lý | Gắn cờ quá nhiều hoặc quá ít | Đưa trọng số vào `config.yaml`; chỉnh theo AC-5; dùng dữ liệu F27 để tinh chỉnh |
| Thêm trường vào record `Segment` làm vỡ JSON cũ | Frontend cũ lỗi | Trường mới nullable; `@JsonInclude(NON_NULL)` đã bật toàn cục |
| Người dùng tin tuyệt đối vào điểm "xanh" | Bỏ sót lỗi | Chữ trên UI ghi "gợi ý", không ghi "đúng" |

## 10. Câu hỏi mở

- [ ] Ngưỡng 0.5 có hợp lý không, hay cho mỗi giảng viên tự chỉnh?
- [ ] Ai chuẩn bị 5 video "chuẩn vàng" (đã duyệt tay) cho AC-5, và lấy từ khoá học nào?
- [ ] Có hiện điểm % cho người dùng cuối không, hay chỉ hiện 3 mức Cao / Trung bình / Thấp?
