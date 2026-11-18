# F18 — Độ tin cậy điểm cắt

| Mục | Giá trị |
|---|---|
| **Mã** | F18 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (chấm điểm, API, DB) + SV2 (tín hiệu từ LLM) + SV4 (tô màu timeline) |
| **Phụ thuộc** | F13 (Flyway), F00 (analyze ghi topic vào DB, `topicId` ổn định). Nên làm sau F10 để có tiến độ analyze |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Opus Clip (điểm "virality" từng clip), Descript (đánh dấu từ AI không chắc) |

> **Cập nhật 18/11/2026:** chuẩn hoá điểm theo AD-14 (mẫu số = điểm tối đa của các tín hiệu đang bật); thêm FR sửa DTO Java (đang `ignoreUnknown` nên mất `analysis_source`/`llm_match`); trần 0,4 khi LLM đoán mã câu; `snap_distance` tính từ mốc LLM gốc; xử lý confidence khi gộp đoạn ngắn; ví dụ JSON theo response thật; bỏ "token cảnh báo" không tồn tại.

## 1. Bối cảnh & vấn đề

Hiện mỗi ranh giới giữa hai câu đã được chấm một **điểm số nguyên** nhưng điểm này chưa tới tay người dùng:

- `CutPointService.calculateCutPoints` ([CutPointService.java:52](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L52)) cộng điểm theo luật: ranh giới +1, im lặng ≥ `pause_threshold` +2, im lặng ≥ 3s +1, câu sau bắt đầu bằng cue phrase +3 (dòng 66–89). Thang điểm 1–7 không chuẩn hoá.
- `Segment` và `SegmentsDTO` đều có `@JsonIgnoreProperties(ignoreUnknown = true)` ([Models.java:68](../../../backend/src/main/java/com/autocut/dto/Models.java#L68), [:83](../../../backend/src/main/java/com/autocut/dto/Models.java#L83)). Vì vậy mọi trường mới mà Python thêm vào (`analysis_source`, `llm_match`…) sẽ **bị Jackson bỏ âm thầm** khi `VideoController` đọc kết quả bằng `treeToValue(..., SegmentsDTO.class)` ([VideoController.java:831](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L831)). Muốn trường mới đi tới frontend thì phải khai báo nó trong DTO.
- Ở bước gộp đoạn ngắn (< `min_duration`) trong `snapAndFilterSegments` ([CutPointService.java:239](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L239)), đoạn sau được gộp vào đoạn trước. Biên cuối của đoạn gộp lấy từ đoạn sau, nên confidence của biên đó cũng phải lấy từ đoạn sau.
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

- **FR-1** Chuẩn hoá điểm thô sang `[0,1]` theo **AD-14**: `norm = min(score, maxScore) / maxScore`, với `maxScore` là tổng điểm tối đa của các tín hiệu đang bật. `CutPointService` tự tính `maxScore` từ cấu hình (hiện tại: ranh giới 1 + khoảng lặng 2 + khoảng lặng dài 1 + từ chuyển ý 3 = **7**; F26 bật tín hiệu slide thì `maxScore` tăng theo). Không viết cứng số 7 trong code.
- **FR-2** Độ tin cậy của một biên được tính như sau:
  ```
  conf = 0.5 * norm(score của cut point được chọn)
       + 0.3 * (1 - min(|snap_distance_s|, 10) / 10)
       + 0.2 * llm_agree
  ```
  - `snap_distance_s` là khoảng cách (giây) giữa **mốc LLM gốc** và mốc sau khi snap. Mốc LLM gốc là thời điểm của câu `start_id`/`end_id` trong transcript (`start` hoặc `end` của câu đó), **không phải** `seg.start`/`seg.end` mà Python gửi sang, vì hai giá trị này có thể đã bị Python kẹp lại.
  - `llm_agree = 1` khi mã câu LLM trả về tồn tại nguyên vẹn; `0.5` khi `resolve_sentence` phải chuẩn hoá padding (ví dụ `S12` → `S0012`); `0` khi phải đoán theo số giây hoặc lấy mặc định.
- **FR-3** Biên đầu của segment đầu tiên (0s) và biên cuối của segment cuối (bằng `duration`) luôn có `conf = 1.0`.
- **FR-4** Trần confidence:
  - `analysis_source = FALLBACK`: mọi biên nội bộ bị giới hạn `conf ≤ 0.3`.
  - Biên có `match_kind ∈ {guessed, default}` (LLM trả mã câu không tồn tại, phải đoán theo giây hoặc lấy mặc định): `conf ≤ 0.4`, tức luôn dưới ngưỡng duyệt 0,5, bất kể điểm khoảng lặng cao tới đâu.
- **FR-4b** Khi gộp đoạn ngắn: đoạn gộp lấy `boundary.start` của đoạn trước và `boundary.end` của đoạn sau; thêm lý do `"Đã gộp đoạn ngắn hơn {min_duration} giây"` vào biên cuối; `needs_review` tính lại theo FR-6.
- **FR-5** Mỗi biên có `reasons[]` bằng tiếng Việt có dấu, ví dụ: `"Khoảng lặng 2,1 giây"`, `"Có từ chuyển ý: 'tiếp theo'"`, `"Đã dịch 6,4 giây so với đề xuất AI"`, `"AI trả mã câu không tồn tại"`.
- **FR-6** Ngưỡng `needs_review` cấu hình được trong `config.yaml`: `cut_points.review_threshold: 0.5`.
- **FR-7** Người dùng sửa tay một biên thì `confidence` của biên đó đặt thành `1.0`, kèm `reasons = ["Đã duyệt thủ công"]`.
- **FR-8 — Đường đi của dữ liệu qua Java.** Khai báo các trường mới trong DTO để Jackson không bỏ:
  - `SegmentsDTO` thêm `@JsonProperty("analysis_source") String analysisSource`.
  - `Segment` thêm `@JsonProperty("llm_match") Map<String,String> llmMatch` (giá trị `exact|normalized|guessed|default` cho `start`/`end`), cùng `confidence`, `needs_review`, `boundary` (FR-2…FR-5).
  - `VideoEntity` thêm `analysisSource` (cột `videos.analysis_source`).
  - Response analyze giữ đúng hình dạng hiện tại `{status, segmentsData:{…, analysis_source, segments:[…]}, transcript, cutPoints}`.

## 5. Yêu cầu phi chức năng

- Tính confidence thêm không quá 50 ms cho transcript 3.000 câu.
- Không làm đổi kết quả snap hiện tại: các test trong `CutPointServiceTest` phải giữ nguyên và vẫn chạy qua.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__add_topic_confidence.sql`:
```sql
ALTER TABLE topics ADD COLUMN IF NOT EXISTS start_confidence DOUBLE PRECISION;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS end_confidence   DOUBLE PRECISION;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS confidence_reasons JSONB;      -- {"start":[...],"end":[...]}
ALTER TABLE topics ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_source VARCHAR(20);   -- LLM | LLM_REPAIRED | FALLBACK
CREATE INDEX IF NOT EXISTS idx_topics_needs_review ON topics(video_id) WHERE needs_review = TRUE;
```
Các cột nằm trên `topics`. Vì topic không bao giờ bị xoá cứng khi lưu (F00, AD-6), dữ liệu confidence không mất sau mỗi lần Lưu.

### 6.2 API

Không thêm endpoint mới. Mở rộng response của `POST /api/video/analyze` (hình dạng thật, [VideoController.java:863-868](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L863-L868)) và `GET /api/v1/videos/{videoId}/segments` của F00 (thêm trường, không đổi trường cũ):

```json
{
  "status": "SUCCESS",
  "videoId": 42,
  "segmentsData": {
  "video": "bai3.mp4", "lesson": "bai3",
  "analysis_source": "LLM_REPAIRED",
  "segments": [
    {
      "id": "3f1c8a2e-6b1d-4c39-9f3e-0b7d2a1c5e90", "topicId": 1187,
      "llm_match": { "start": "guessed", "end": "exact" },
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
  },
  "transcript": { "...": "giữ nguyên" },
  "cutPoints": { "...": "giữ nguyên" }
}
```

Không cần endpoint riêng cho FR-7: khi `PUT /api/v1/videos/{videoId}/segments` (F00) nhận một topic có `start`/`end` khác giá trị trong DB, server đặt confidence của biên đó về 1,0 theo FR-7. Không có quyền xem video thì trả 404, chỉ được xem mà không được sửa thì trả 403 (AD-2).

### 6.3 Backend (Spring Boot)

- `Models.java`: thêm `record BoundaryInfo(double confidence, double snapDistance, List<String> reasons)`. Thêm vào `Segment` các trường **nullable** `Map<String,String> llmMatch`, `Double confidence`, `Boolean needsReview`, `Map<String, BoundaryInfo> boundary`; thêm vào `SegmentsDTO` trường `String analysisSource` (FR-8). `Segment` đang là record có 11 tham số và được khởi tạo bằng `new Segment(...)` ở nhiều chỗ (ví dụ [CutPointService.java:211](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L211)). Thêm constructor phụ 11 tham số gọi constructor đầy đủ với các trường mới là `null`, để không phải sửa mọi chỗ khởi tạo.
- `CutPointService`: tách hàm thuần `static double boundaryConfidence(int score, int maxScore, double snapDistance, String matchKind, boolean fallback)`, áp đủ FR-1, FR-2, FR-4. Thêm `int maxScore()` tính từ cấu hình (AD-14). Trong `snapAndFilterSegments`: tính `snapDistance` so với mốc của câu `startId`/`endId`; khi gộp đoạn ngắn thì áp FR-4b.
- `ConfigService`: thêm `getReviewThreshold()`, mặc định 0.5.
- `SegmentPersistenceService.upsertSegments` (F00): ghi 4 cột mới khi `origin=AI`; khi `origin=USER` thì chỉ cập nhật theo FR-7. Hàm đọc `GET` trả ngược lại.
- `TopicEntity`: thêm 4 trường tương ứng.

### 6.4 AI pipeline (Python)

- `transcript_refiner.py` trong `segment_transcript`: cho `resolve_sentence` trả thêm `match_kind ∈ {"exact","normalized","guessed","default"}`, gắn vào mỗi segment `llm_match: {"start": ..., "end": ...}`.
- Đặt `segments_data["analysis_source"]`: `FALLBACK` khi chạy vào nhánh `_fallback_segment_from_sentences`; `LLM_REPAIRED` khi có ít nhất một `match_kind != "exact"`; ngược lại là `LLM`.
- `cli.py` `run_backend_analysis` ([cli.py:324](../../../backend/ai/cli.py)): nhánh `except Exception` (dòng ~340) **phải log lý do** và đặt `analysis_source = "FALLBACK"`, không được nuốt lỗi.
- Mapping `match_kind → llm_agree`: exact = 1, normalized = 0.5, guessed/default = 0.

### 6.5 Frontend (Next.js)

- `types/index.ts` (`Segment`, dòng 28): thêm `confidence?: number; needs_review?: boolean; boundary?: {...}`.
- `StudioTimeline.tsx`: segment có `needs_review` được viền nét đứt (`border-dashed border-amber-500`) và có biểu tượng `AlertTriangle` (Lucide). `tailwind.config.ts` hiện chỉ có `background`/`foreground` nên dùng class Tailwind chuẩn (AD-12). Chữ giải thích vẫn dùng màu chữ thường (`text-slate-700`), không viết chữ màu vàng.
- `TranscriptScenesPanel.tsx`: thêm badge "Cần duyệt (n)" và nút **"Chỗ cần duyệt tiếp theo"** (phím tắt `N`, phối hợp với F31) để nhảy playhead tới biên có confidence thấp nhất chưa duyệt.
- `SegmentDetailModal.tsx`: thêm khối "Độ tin cậy", hiện % và danh sách `reasons`.
- Khi `analysis_source = FALLBACK`: hiện banner "AI chưa phân tích được nội dung, các đoạn đang được chia đều. Bấm **Phân tích lại** khi có mạng."

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* `maxScore = 7`, hai câu cách nhau 2,0s và câu sau bắt đầu bằng "tiếp theo" (điểm 6), LLM chọn đúng mã câu, snap 0s. *When* tính confidence. *Then* `conf = 0.5*(6/7) + 0.3*1 + 0.2*1 ≈ 0.93`.
- **AC-1b** — *Given* cùng ranh giới đó nhưng bật tín hiệu slide (F26) làm `maxScore = 10`, và ranh giới trùng lúc đổi slide (điểm 6 + 3 = 9). *Then* `conf = 0.5*(9/10) + 0.5 = 0.95`, vẫn ≥ 0,9.
- **AC-2** — *Given* LLM trả `end_id = "S0828"` không tồn tại, phải đoán theo giây, kể cả khi ranh giới đoán được có khoảng lặng dài (điểm 7). *When* analyze. *Then* `analysis_source = "LLM_REPAIRED"`, `llm_match.end = "guessed"`, biên đó có `conf ≤ 0.4`, `reasons` chứa "AI trả mã câu không tồn tại", và `needs_review = true`.
- **AC-2b** — *Given* Python trả `analysis_source` và `llm_match`. *When* backend chuyển tiếp response analyze. *Then* hai trường này vẫn còn trong `segmentsData` (không bị Jackson bỏ).
- **AC-2c** — *Given* đoạn 40s phía sau ngắn hơn `min_duration` nên bị gộp. *Then* biên cuối của đoạn gộp có confidence của đoạn sau và có lý do "Đã gộp đoạn ngắn…".
- **AC-3** — *Given* không có `GEMINI_API_KEY`. *When* analyze. *Then* `analysis_source = "FALLBACK"`, mọi biên nội bộ `≤ 0.3`, UI hiện banner.
- **AC-4** — *Given* segment đang `needs_review = true`. *When* người dùng kéo biên và lưu. *Then* biên đó có `confidence = 1.0`, segment không còn cờ nếu biên kia ≥ ngưỡng.
- **AC-5** — Trên bộ 5 video mẫu đã được duyệt tay (đặt trong `tests/fixtures/f18/`): **≥ 80%** biên mà người duyệt phải sửa (> 3s) có `needs_review = true` (độ phủ), và **≤ 40%** biên bị gắn cờ là biên đúng (báo nhầm).
- **AC-6** — Sau F00, `GET /api/v1/videos/{videoId}/segments` trả đúng các giá trị confidence đã lưu, kể cả sau 3 lần Lưu liên tiếp không đổi biên.

## 8. Kế hoạch kiểm thử (TDD)

JUnit, viết trước:
- `CutPointServiceTest.boundaryConfidence_maxSignals_returnsAbove09()`
- `CutPointServiceTest.maxScore_isSumOfEnabledSignals()` (AD-14)
- `CutPointServiceTest.boundaryConfidence_guessedMatch_cappedAt04()` (AC-2)
- `CutPointServiceTest.snapDistance_measuredFromLlmSentenceNotClampedStart()`
- `CutPointServiceTest.mergeShortSegment_takesEndBoundaryOfLaterSegment()` (AC-2c)
- `ModelsJsonTest.segmentsDto_keepsAnalysisSourceAndLlmMatch()` (AC-2b)
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
| Thêm trường vào record `Segment` làm vỡ JSON cũ | Frontend cũ lỗi | Trường mới nullable; `spring.jackson.default-property-inclusion=non_null` đã bật toàn cục |
| Quên khai báo trường mới trong DTO | Jackson bỏ âm thầm (`ignoreUnknown`) | Test `ModelsJsonTest` (AC-2b) |
| Người dùng tin tuyệt đối vào điểm "xanh" | Bỏ sót lỗi | Chữ trên UI ghi "gợi ý", không ghi "đúng" |

## 10. Câu hỏi mở

- [ ] Ngưỡng 0.5 có hợp lý không, hay cho mỗi giảng viên tự chỉnh?
- [ ] Ai chuẩn bị 5 video "chuẩn vàng" (đã duyệt tay) cho AC-5, và lấy từ khoá học nào?
- [ ] Có hiện điểm % cho người dùng cuối không, hay chỉ hiện 3 mức Cao / Trung bình / Thấp?
