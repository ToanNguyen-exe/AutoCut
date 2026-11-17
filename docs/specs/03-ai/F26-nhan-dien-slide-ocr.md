# F26 — Nhận diện đổi slide và OCR nội dung slide

| Mục | Giá trị |
|---|---|
| **Mã** | F26 |
| **Nhóm** | AI |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV1 (trích khung hình bằng ffmpeg) + SV2 (OCR, đưa vào điểm cắt) + SV3 (DB, API) |
| **Phụ thuộc** | F09/F10 (job nền), F18 (đưa tín hiệu vào confidence) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | OCR, chọn 1: (A) **Gemini Vision** qua `google-genai` sẵn có, không thêm thư viện nhưng tốn tiền theo ảnh; (B) `paddleocr` (Apache-2.0, hỗ trợ tiếng Việt, chạy offline, nặng ~500 MB). Phát hiện đổi slide dùng ffmpeg `select=gt(scene,x)`, **không cần thư viện mới** |
| **Tham khảo** | Panopto (OCR slide, tìm kiếm chữ trên slide), Kaltura REACH, Yuja |

## 1. Bối cảnh & vấn đề

- Điểm cắt hiện chỉ dựa trên **âm thanh và chữ**: khoảng lặng và từ chuyển ý trong `CutPointService.calculateCutPoints` ([CutPointService.java:52](../../../backend/src/main/java/com/autocut/service/CutPointService.java#L52)), cộng LLM đọc transcript ([transcript_refiner.py:337](../../../backend/ai/transcript_refiner.py)). Hệ thống bỏ qua tín hiệu mạnh nhất của bài giảng có slide: **lúc chuyển slide** thường trùng với lúc chuyển ý.
- Tiêu đề slide ("Chương 3: Vòng lặp") là nguồn tiêu đề topic chính xác hơn nhiều so với để LLM tự đoán.
- Chữ trên slide (code mẫu, công thức) không có trong transcript, nên tìm kiếm (F30) không thấy được.

## 2. Mục tiêu

- Phát hiện các mốc **đổi slide/cảnh** và lưu thumbnail cho mỗi mốc.
- OCR mỗi slide, tách **tiêu đề slide** (dòng đầu, chữ lớn nhất) và **toàn văn**.
- Đưa mốc đổi slide vào chấm điểm điểm cắt (+điểm) và đưa tiêu đề slide vào prompt phân đoạn.
- Chữ OCR được đánh chỉ mục cho F30.

### Ngoài phạm vi

- Không nhận diện chữ viết tay trên bảng.
- Không phân tích hình ảnh hay biểu đồ ngoài phần chữ.

## 3. User stories

- Là giảng viên dạy bằng PowerPoint, tôi muốn mỗi clip bắt đầu đúng lúc slide mới hiện ra.
- Là sinh viên, tôi muốn gõ "HashMap" để tìm cả những chỗ chỉ xuất hiện trên slide mà thầy không đọc ra.

## 4. Yêu cầu chức năng

- **FR-1** Trích mốc đổi cảnh:
  `ffmpeg -i in.mp4 -vf "fps=1,select='gt(scene,0.30)',showinfo" -vsync vfr frames/%05d.jpg`
  Đọc `pts_time` từ stderr. Ngưỡng `slides.scene_threshold` mặc định 0,30, cấu hình được.
- **FR-2** Lọc nhiễu: bỏ các mốc cách nhau < `slides.min_gap` (mặc định 8s), vì giảng viên lướt slide hoặc chuyển cửa sổ nhanh. Với chuỗi mốc dày, chỉ giữ mốc cuối.
- **FR-3** Phân loại khung hình: `SLIDE` (nhiều chữ, nền đồng nhất), `CODE` (màn hình IDE), `CAMERA` (mặt người). Dùng OCR: số ký tự > 30 và tỉ lệ dòng ngắn cao thì là `SLIDE`/`CODE`; ngược lại là `CAMERA`, bỏ qua OCR toàn văn.
- **FR-4** OCR: trả `title` (dòng có bounding box cao nhất trong 30% phía trên ảnh) và `text` (toàn bộ, giữ xuống dòng).
- **FR-5** Chấm điểm: trong `calculateCutPoints`, nếu có mốc đổi slide trong khoảng ±1,5s quanh ranh giới câu thì `score += 3` và thêm `reasons` "ĐỔI_SLIDE". Thang chuẩn hoá của F18 nâng trần từ 7 lên 10.
- **FR-6** Prompt phân đoạn có thêm khối `MỐC SLIDE` dạng `S0123 ~ [412s] Slide: "Vòng lặp for"`, kèm chỉ dẫn "ưu tiên đặt ranh giới topic ở mốc slide có tiêu đề mới".
- **FR-7** Tuỳ chọn bật/tắt theo video (`slides.enabled`) và theo preset (F28). Mặc định bật cho preset `lecture_programming`.

## 5. Yêu cầu phi chức năng

- Trích khung hình cho video 60 phút ≤ 2 phút (fps=1, ảnh JPEG 640px).
- Phương án Gemini Vision: tối đa 150 ảnh/video, gửi theo lô 10 ảnh/lần gọi.
- Ảnh trung gian xoá sau khi xử lý xong (F17), chỉ giữ thumbnail 320px.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_slides.sql`:
```sql
CREATE TABLE video_slides (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    at_time DOUBLE PRECISION NOT NULL,
    frame_kind VARCHAR(10) NOT NULL,     -- SLIDE|CODE|CAMERA
    title VARCHAR(255),
    ocr_text TEXT,
    thumbnail_r2_key VARCHAR(500),
    scene_score DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_slides_video_time ON video_slides(video_id, at_time);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos/{id}/slides:detect` | Chủ video | `202 jobId` |
| GET | `/api/v1/videos/{id}/slides` | Chủ video | Danh sách mốc slide + link thumbnail (presigned) |

```json
[ { "atTime": 412.0, "kind": "SLIDE", "title": "Vòng lặp for", "thumbnailUrl": "https://...", "sceneScore": 0.62 } ]
```

### 6.3 Backend (Spring Boot)

- `video/SceneDetector.java`: chạy ffmpeg theo FR-1, phân tích `showinfo` (`pts_time:`) từ stderr bằng `StreamUtil`; hàm thuần `filterByMinGap(List<Double>, double)`.
- `CutPointService.calculateCutPoints`: thêm overload nhận `List<Double> slideTimes`; overload cũ gọi với danh sách rỗng để giữ nguyên hành vi và các test cũ.
- `service/SlideService.java`: điều phối trích khung → gọi `python -m backend.ai.cli --ocr-slides --frames <dir> --output <json>` → lưu DB, upload thumbnail lên R2 (`CloudflareR2Service`).
- `ConfigService`: `getSceneThreshold()`, `getSlideMinGap()`.

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/slide_ocr.py`:
  ```python
  def ocr_frames(frame_paths: list[Path], engine: Literal["gemini","paddle"]) -> list[SlideOCR]: ...
  def pick_title(lines: list[OcrLine], image_height: int) -> str | None: ...   # hàm thuần
  def classify_frame(lines: list[OcrLine]) -> Literal["SLIDE","CODE","CAMERA"]: ...  # hàm thuần
  ```
- Gemini Vision: prompt "Trích chữ trên ảnh slide bài giảng. Trả JSON {title, text}. Giữ nguyên code." Kết quả có `bbox` chỉ khi dùng PaddleOCR; với Gemini thì `pick_title` dùng luôn `title` mà model trả về.
- `transcript_refiner.segment_transcript`: nhận `slides: list[dict] | None` và chèn khối FR-6 vào prompt.

### 6.5 Frontend (Next.js)

- `StudioTimeline.tsx`: track mới "Slide" hiện thumbnail nhỏ tại các mốc (dùng chung track ảnh với F38).
- `SegmentDetailModal.tsx`: tab "Slide" liệt kê slide trong đoạn và chữ OCR, có nút "Dùng làm tiêu đề".

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* video mẫu 20 phút có 25 lần đổi slide (đã gán nhãn tay). *Then* phát hiện được ≥ 22 mốc (recall ≥ 88%), sai lệch ≤ 1s, và ≤ 5 mốc thừa.
- **AC-2** — *Given* 5 mốc liên tiếp cách nhau 2s. *Then* chỉ giữ 1 mốc (mốc cuối).
- **AC-3** — *Given* ranh giới câu tại 412,3s và có slide đổi ở 411,5s. *Then* cut point đó có `reasons` chứa "ĐỔI_SLIDE" và điểm tăng 3.
- **AC-4** — Trên 30 slide mẫu: tiêu đề OCR đúng (khớp sau khi chuẩn hoá khoảng trắng) ≥ 85%, giữ đúng dấu tiếng Việt.
- **AC-5** — Video quay mặt người (không có slide). *Then* phần lớn khung hình là `CAMERA`, không có mốc nào được cộng điểm, pipeline không lỗi.
- **AC-6** — So sánh trên 3 video có slide, khi bật F26: tỉ lệ biên topic người duyệt phải sửa > 3s giảm ≥ 25% so với khi tắt.

## 8. Kế hoạch kiểm thử (TDD)

JUnit:
- `SceneDetectorTest.parseShowinfo_extractsPtsTimes()`
- `SceneDetectorTest.filterByMinGap_keepsLastOfBurst()`
- `CutPointServiceTest.calculateCutPoints_slideNearBoundary_addsScore()`
- `CutPointServiceTest.calculateCutPoints_noSlides_behavesAsBefore()` (hồi quy)

pytest (`tests/test_f26_slides.py`):
- `test_pick_title_prefers_tallest_line_in_top_area()`
- `test_classify_frame_camera_when_little_text()`
- `test_classify_frame_code_when_many_short_lines_with_symbols()`
- `test_segment_prompt_contains_slide_block()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Video có camera + slide ghép khung (picture-in-picture) làm scene score dao động | Nhiều mốc giả | Có tuỳ chọn crop vùng slide (`slides.crop`) |
| Animation trong slide (hiện từng dòng) bị nhận là đổi slide | Mốc thừa | `min_gap` + so sánh tiêu đề OCR: tiêu đề trùng thì gộp |
| Chi phí Gemini Vision với video dài | Tốn tiền | Giới hạn 150 ảnh; ảnh 640px |

## 10. Câu hỏi mở

- [ ] Chọn OCR Gemini Vision hay PaddleOCR (chạy offline)?
- [ ] Có lưu toàn văn OCR lên DB không, hay chỉ tiêu đề + chỉ mục tìm kiếm (vì dữ liệu nặng)?
