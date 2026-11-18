# F29 — Tự tạo câu hỏi trắc nghiệm cho từng clip

| Mục | Giá trị |
|---|---|
| **Mã** | F29 |
| **Nhóm** | AI |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV2 (prompt, kiểm định) + SV3 (API, DB, xuất định dạng) + SV4 (soạn câu hỏi, hiện trong player) |
| **Phụ thuộc** | **F00 (bắt buộc:** topic không bị xoá cứng khi Lưu, nên khoá ngoại `ON DELETE CASCADE` tới `topics` mới an toàn), F21 (tóm tắt và ý chính làm đầu vào), F09 (job), F15 (`ai_usage`), F41 (hiển thị cho học viên). F42 nếu xuất sang LMS |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Panopto Quizzing, Coursera in-video quiz, Edpuzzle, Moodle GIFT format |

> **Cập nhật 18/11/2026:** ghi rõ phụ thuộc bắt buộc vào F00 (trước F00, mỗi lần Lưu xoá topic nên câu hỏi đã duyệt bị xoá dây chuyền); thêm `model_validator` cho `QuizItem` để ràng buộc số đáp án theo loại câu; định nghĩa cách ghi câu `MULTI` và `TRUE_FALSE` trong CSV; topic bị `DISCARDED` thì ẩn câu hỏi thay vì xoá; quyền theo AD-2, job theo AD-10.

## 1. Bối cảnh & vấn đề

- Sau khi chia clip, giảng viên thường phải tự soạn câu hỏi kiểm tra cho từng đoạn. Việc này mất nhiều thời gian nhất khi số hoá khoá học.
- AutoCut đã có transcript theo câu kèm mốc giờ ([models.py:15](../../../backend/ai/models.py)) và cấu trúc topic ([schema.sql](../../../database/schema.sql) bảng `topics`). Đây là đầu vào đủ tốt để sinh câu hỏi bám nội dung và **dẫn được về đúng giây** chứa đáp án.
- Chưa có bảng hay API nào cho câu hỏi.
- Hiện mỗi lần Lưu, `SegmentPersistenceService` xoá toàn bộ section (kéo theo topic) rồi tạo lại ([SegmentPersistenceService.java:87-92](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L87-L92)). Nếu làm F29 trước F00, mọi câu hỏi (kể cả đã duyệt) sẽ bị xoá dây chuyền sau mỗi lần Lưu. Vì vậy F29 **chỉ được bắt đầu sau khi F00 đã merge**.

## 2. Mục tiêu

- Với mỗi topic, AI sinh 3–5 câu hỏi (mặc định), gồm các loại: `SINGLE` (một đáp án đúng), `MULTI` (nhiều đáp án đúng), `TRUE_FALSE`.
- Mỗi câu hỏi có: đề, 4 lựa chọn (trừ đúng/sai), đáp án, **giải thích**, **mốc câu nguồn** (`source_sentence_ids`) và mức độ (Bloom: nhớ / hiểu / vận dụng).
- Giảng viên duyệt, sửa, xoá, sắp xếp lại. Chỉ câu đã duyệt mới hiện cho học viên.
- Xuất ra **Moodle GIFT**, **Moodle XML**, **CSV** (để nhập vào Google Forms hoặc Kahoot), và JSON.
- (Tuỳ chọn) chèn câu hỏi vào cuối clip trên trang khoá học (F41).

### Ngoài phạm vi

- Câu hỏi tự luận và chấm tự luận bằng AI.
- Chấm điểm và lưu kết quả học viên (thuộc F41/F47).

## 3. User stories

- Là giảng viên, tôi muốn có sẵn 5 câu trắc nghiệm cho clip "Vòng lặp for" để chỉ cần duyệt và sửa nhẹ.
- Là giảng viên, khi thấy một câu hỏi, tôi muốn bấm vào để xem đoạn video chứa đáp án và kiểm tra AI có bịa không.
- Là quản trị LMS, tôi muốn tải tệp GIFT để nhập thẳng vào ngân hàng câu hỏi Moodle.

## 4. Yêu cầu chức năng

- **FR-1** Đầu vào sinh câu hỏi cho một topic: transcript của topic (tối đa 12.000 ký tự, kèm mã câu `S0123`), `summary` và `key_points` (F21), số câu `n` (1–10), tỉ lệ loại câu hỏi, mức độ mong muốn.
- **FR-2** Đầu ra kiểm tra bằng Pydantic:
  ```python
  class QuizItem(BaseModel):
      type: Literal["SINGLE","MULTI","TRUE_FALSE"]
      question: str = Field(min_length=10, max_length=300)
      options: list[str]           # 4 cho SINGLE/MULTI, ["Đúng","Sai"] cho TRUE_FALSE
      correct: list[int]           # chỉ số trong options
      explanation: str = Field(max_length=500)
      source_sentence_ids: list[str] = Field(min_length=1)
      bloom: Literal["REMEMBER","UNDERSTAND","APPLY"]

      @model_validator(mode="after")
      def check_shape(self):
          n = len(self.options)
          if self.type == "TRUE_FALSE":
              assert self.options == ["Đúng", "Sai"] and len(self.correct) == 1
          else:
              assert n == 4
              assert len(self.correct) == (1 if self.type == "SINGLE" else len(self.correct)) and len(self.correct) >= 1
              if self.type == "MULTI":
                  assert 2 <= len(self.correct) <= 3
          assert all(0 <= i < n for i in self.correct) and len(set(self.correct)) == len(self.correct)
          return self
  ```
  Câu sai hình dạng bị Pydantic từ chối ngay khi parse (`ValidationError`), trước bước kiểm định FR-3. (Trong code thật dùng `raise ValueError(...)` thay cho `assert`, vì `assert` bị tắt khi chạy Python với `-O`.)
- **FR-3 Kiểm định tự động** (chạy sau khi sinh, câu không đạt thì loại và sinh bù tối đa 1 lần):
  - `source_sentence_ids` phải nằm trong topic.
  - `SINGLE` có đúng 1 đáp án đúng; `MULTI` có 2–3.
  - Các lựa chọn không trùng nhau (so sánh sau khi chuẩn hoá) và không có "Tất cả các đáp án trên".
  - Đáp án đúng không được luôn ở cùng một vị trí: **trộn thứ tự** lựa chọn phía server.
  - **Kiểm tra bám nguồn:** gọi LLM lần 2 (rẻ) với câu hỏi + câu nguồn: "Đáp án có được câu nguồn ủng hộ không? yes/no". `no` thì loại câu hỏi.
- **FR-4** Trạng thái câu hỏi: `DRAFT` (AI vừa sinh) → `APPROVED` / `REJECTED`. Sửa tay thì `edited=true`.
- **FR-5** Sinh lại cho một topic chỉ thay các câu `DRAFT`; giữ nguyên câu `APPROVED`.
- **FR-6 Xuất:**
  - GIFT: `::Q1:: Vòng lặp for gồm mấy thành phần? {=3 ~2 ~4 ~1 #Giải thích...}`. Phải escape các ký tự `~ = # { } :`.
  - Moodle XML: `<quiz><question type="multichoice">...`
  - CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt): `type,question,option_a,option_b,option_c,option_d,correct,explanation,video_time`.
    - `correct` ghi **chữ cái** của các đáp án đúng, cách nhau bằng dấu `|`: `B` cho `SINGLE`, `A|C` cho `MULTI`.
    - `TRUE_FALSE`: `option_a = Đúng`, `option_b = Sai`, `option_c`/`option_d` để trống, `correct` là `A` hoặc `B`.
    - `video_time` dạng `MM:SS` (hoặc `HH:MM:SS` khi ≥ 1 giờ), là mốc của câu nguồn đầu tiên.
    - Google Forms và Kahoot không nhập trực tiếp được câu `MULTI`; tài liệu hướng dẫn trong giao diện ghi rõ điều này.
- **FR-7** Mỗi câu hỏi có link "Xem đoạn giải thích" tới `start` của câu nguồn đầu tiên.
- **FR-8** Topic chuyển `DISCARDED` (F00) thì câu hỏi của topic **không bị xoá**, chỉ bị ẩn khỏi danh sách và khỏi tệp xuất; khôi phục topic thì câu hỏi hiện lại.

## 5. Yêu cầu phi chức năng

- Sinh cho 20 topic ≤ 2 phút (song song 2 lô).
- Tỉ lệ câu bị loại ở bước kiểm định được ghi log; > 40% thì cảnh báo cho người vận hành (dấu hiệu prompt có vấn đề).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_quiz.sql`:
```sql
CREATE TABLE IF NOT EXISTS quiz_questions (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    q_type VARCHAR(12) NOT NULL CHECK (q_type IN ('SINGLE','MULTI','TRUE_FALSE')),
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    correct JSONB NOT NULL,            -- [0] hoặc [0,2]
    explanation TEXT,
    source_sentence_ids TEXT[] NOT NULL,
    bloom VARCHAR(12),
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','REJECTED')),
    edited BOOLEAN NOT NULL DEFAULT FALSE,
    model VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_topic ON quiz_questions(topic_id, position);
```
`ON DELETE CASCADE` tới `topics` an toàn sau F00, vì topic chỉ bị xoá mềm khi Lưu (AD-6); topic chỉ bị xoá cứng khi cả video bị xoá hẳn (F17).

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/v1/videos/{videoId}/quiz:generate` | Sửa video | `{ "perTopic": 5, "types": {"SINGLE":3,"TRUE_FALSE":2} }` → `202 { "jobId": … }` (job `QUIZ_GENERATE`) |
| POST | `/api/v1/topics/{topicId}/quiz:generate` | Sửa video chứa topic | Một topic → `202 { "jobId": … }` |
| GET | `/api/v1/topics/{topicId}/quiz?status=` | Xem video chứa topic | Danh sách. Người chỉ có quyền `VIEWER` chỉ thấy `APPROVED` |
| PATCH | `/api/v1/quiz/{qid}` | Sửa video chứa câu hỏi | Sửa, đổi trạng thái |
| DELETE | `/api/v1/quiz/{qid}` | Sửa video chứa câu hỏi | Xoá |
| GET | `/api/v1/videos/{videoId}/quiz/export?format=gift\|moodle_xml\|csv\|json&status=APPROVED` | Sửa video | Tải tệp |

Không có quyền xem thì 404, xem được nhưng không sửa được thì 403 `FORBIDDEN_ACTION` (AD-2). Học viên trên trang khoá học (F41) đọc câu `APPROVED` qua API của F41 (`/api/v1/share/**` nếu là khoá công khai, AD-5).

```json
// GET /api/v1/topics/88/quiz
[ { "id": 501, "type": "SINGLE", "question": "Vòng lặp for trong JavaScript gồm mấy thành phần trong ngoặc tròn?",
    "options": ["2", "3", "4", "1"], "correct": [1],
    "explanation": "Gồm khởi tạo, điều kiện và bước nhảy.",
    "source": [ { "id": "S0142", "start": 431.2 } ], "bloom": "REMEMBER", "status": "DRAFT" } ]
```

### 6.3 Backend (Spring Boot)

- `entity/QuizQuestionEntity.java`, `repository/QuizQuestionRepository.java`, `controller/QuizController.java`.
- `service/QuizExportService.java`: các hàm thuần `toGift(List<Q>)`, `toMoodleXml`, `toCsv`, có escape đúng chuẩn.
- `service/QuizService.java`: handler của job `QUIZ_GENERATE` (F09). Gọi `python -m backend.ai.cli --generate-quiz --input ... --output ...` qua job runner F10, rồi nạp kết quả và trộn lựa chọn (FR-3). Bỏ qua topic đã `DISCARDED`.

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/quiz_generator.py`:
  ```python
  def generate_quiz(topic: TopicInput, n: int, type_mix: dict[str,int]) -> list[QuizItem]: ...
  def validate_structure(items: list[QuizItem], allowed_ids: set[str]) -> tuple[list[QuizItem], list[str]]: ...  # hàm thuần
  def verify_grounding(item: QuizItem, source_texts: list[str]) -> bool: ...
  ```
- Prompt nhấn mạnh: "Chỉ hỏi về kiến thức có trong transcript. Mỗi câu phải dẫn ít nhất một mã câu nguồn. Phương án nhiễu phải hợp lý, cùng loại, không vô lý. Viết tiếng Việt có dấu."
- Dùng `_generate_with_fallback` (đã bật JSON mode). In `@@USAGE {json}` cho mỗi lần gọi để ghi `ai_usage` (F15), kể cả lần gọi kiểm tra bám nguồn.

### 6.5 Frontend (Next.js)

- `SegmentDetailModal.tsx`: tab "Câu hỏi" gồm danh sách thẻ câu hỏi, nút Duyệt / Bỏ, sửa trực tiếp, kéo thả để sắp xếp, nút ▶ nhảy tới câu nguồn.
- Menu Xuất: "Câu hỏi trắc nghiệm" → chọn định dạng.
- Trang khoá học (F41): hiện các câu `APPROVED` sau khi clip kết thúc. Không lưu điểm trong bản này.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* topic 5 phút. *When* sinh 5 câu. *Then* trả 5 câu qua được `validate_structure`, mỗi câu có ≥ 1 `source_sentence_ids` thuộc topic.
- **AC-2** — *Given* 100 câu `SINGLE` vừa sinh. *Then* đáp án đúng nằm ở mỗi vị trí A/B/C/D với tỉ lệ 15–35%.
- **AC-3** — *Given* LLM trả câu dẫn mã `S9999` không thuộc topic. *Then* câu đó bị loại và được sinh bù.
- **AC-4** — Tệp GIFT xuất ra nhập vào Moodle 4.x không lỗi (kiểm tra thủ công trên Moodle sandbox), tiếng Việt hiển thị đúng.
- **AC-5** — *Given* đã duyệt 3/5 câu. *When* sinh lại. *Then* 3 câu `APPROVED` giữ nguyên, 2 câu `DRAFT` được thay.
- **AC-6** — Chất lượng: giảng viên chấm 50 câu từ 3 môn: ≥ 80% "dùng được, không sửa hoặc sửa nhẹ"; ≤ 2% câu có đáp án sai so với bài giảng.
- **AC-7** — *Given* topic có 3 câu `APPROVED`. *When* người dùng đổi tiêu đề và kéo biên topic rồi Lưu 3 lần. *Then* 3 câu vẫn còn (F00).
- **AC-8** — *Given* topic bị bỏ (`DISCARDED`). *Then* câu hỏi của topic không xuất hiện trong `GET` và tệp xuất; khôi phục topic thì câu hỏi hiện lại.
- **AC-9** — *Given* 1 câu `MULTI` đáp án A và C. *When* xuất CSV. *Then* cột `correct` là `A|C`.

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f29_quiz.py`):
- `test_quiz_item_rejects_single_with_two_correct()` (dựa vào `model_validator`)
- `test_quiz_item_rejects_true_false_with_four_options()`
- `test_quiz_item_rejects_correct_index_out_of_range()`
- `test_validate_structure_drops_out_of_topic_sources()`
- `test_validate_structure_drops_duplicate_options()`
- `test_validate_structure_drops_all_of_the_above()`
- `test_generate_quiz_refills_once_after_drop()` (mock LLM)
- `test_verify_grounding_false_drops_item()`

JUnit:
- `QuizExportServiceTest.toGift_escapesSpecialChars()`
- `QuizExportServiceTest.toGift_multiAnswer_usesPercentWeights()`
- `QuizExportServiceTest.toMoodleXml_isWellFormed()`
- `QuizExportServiceTest.toCsv_quotesCommasAndNewlines()`
- `QuizExportServiceTest.toCsv_multiUsesPipeSeparatedLetters()` (AC-9)
- `QuizExportServiceTest.toCsv_trueFalseLeavesCAndDEmpty()`
- `QuizServiceTest.import_shufflesOptionsAndRemapsCorrect()`
- `QuizServiceTest.regenerate_keepsApproved()`
- `QuizControllerTest.viewer_seesOnlyApproved()` (phụ thuộc F02)
- `QuizControllerTest.withoutAccess_returns404()` (AD-2)
- `QuizPersistenceTest.approvedQuestionsSurviveRepeatedSave()` (AC-7)
- `QuizServiceTest.discardedTopic_hidesQuestions()` (AC-8)

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| AI bịa đáp án sai | Học viên học sai | Kiểm tra bám nguồn (FR-3); bắt buộc giảng viên duyệt (FR-4) |
| Phương án nhiễu quá dễ đoán | Câu hỏi vô giá trị | Prompt yêu cầu nhiễu cùng loại; giảng viên đánh giá |
| Transcript bị lỗi nhận dạng thuật ngữ nên câu hỏi sai thuật ngữ | Sai nội dung | Làm F19 trước; giảng viên duyệt |

## 10. Câu hỏi mở

- [ ] Có cần lưu kết quả làm bài của học viên ngay trong bản đầu không (chạm F41/F47)?
- [ ] Định dạng xuất nào ưu tiên nhất: Moodle hay Google Forms?
- [ ] Số câu mặc định cho mỗi topic: 3 hay 5?
