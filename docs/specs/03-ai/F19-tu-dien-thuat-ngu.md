# F19 — Từ điển thuật ngữ riêng

| Mục | Giá trị |
|---|---|
| **Mã** | F19 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (Whisper prompt, post-processor) + SV3 (API, DB) + SV4 (màn hình quản lý) |
| **Phụ thuộc** | F01, F02 (biết từ điển thuộc về ai), F13 |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Otter.ai Custom Vocabulary, Descript Transcription Glossary, Google Speech "phrase hints" |

## 1. Bối cảnh & vấn đề

Thuật ngữ hiện đang **viết cứng trong code** và thiên về đúng một khoá học Web3:

- `DEFAULT_TECH_VOCABULARY` ([prompt_builder.py:13](../../../backend/ai/prompt_builder.py)) gồm "Solana", "Polkadot", "DefiLlama", "hacker house"... rồi được nối vào `initial_prompt` của Whisper cho **mọi** video. Với bài giảng Java hoặc Toán, các từ này là nhiễu, làm Whisper dễ "nghe" ra chữ Web3 ở chỗ không có.
- `build_initial_prompt` ([prompt_builder.py:62](../../../backend/ai/prompt_builder.py)) cắt ở 420 ký tự (dòng 84). Thuật ngữ người dùng đứng trước, nhưng đề cương dài sẽ đẩy hết từ điển ra ngoài mà không ai biết.
- `DOMAIN_TERM_MAPPINGS` ([post_processor.py:17](../../../backend/ai/post_processor.py)) là danh sách regex sửa lỗi nghe nhầm ("bởi lúc trên" → "blockchain", "lớp 3" → "Web3"). Quy tắc `"lớp 3" → "Web3"` sẽ **làm hỏng** bài giảng có câu "lớp 3" theo nghĩa thật.
- Muốn thêm một từ mới, hiện phải sửa code Python và triển khai lại.

## 2. Mục tiêu

- Người dùng tự quản lý **từ điển** gồm hai loại mục:
  1. **Thuật ngữ** (term): từ cần Whisper ưu tiên nhận ra, ví dụ `Spring Boot`, `polymorphism`.
  2. **Quy tắc sửa** (replacement): `"xì pring bút" → "Spring Boot"`.
- Từ điển có 3 phạm vi: **hệ thống** (mặc định), **cá nhân**, **theo video**. Khi phân tích, ba phạm vi được gộp lại, phạm vi hẹp hơn được ưu tiên.
- Chuyển nội dung đang viết cứng thành dữ liệu seed, chia theo bộ chủ đề (`web3`, `javascript`, `java`...) thay vì nạp tất cả.

### Ngoài phạm vi

- Không fine-tune (huấn luyện thêm) Whisper.
- Không tự động phát hiện thuật ngữ mới; việc học từ chỉnh sửa thuộc F27.

## 3. User stories

- Là giảng viên môn Java, tôi muốn thêm "JPA, Hibernate, Lombok" để transcript không ra "dê pi ây".
- Là giảng viên, tôi muốn thêm quy tắc "giao va" → "Java" một lần và nó áp dụng cho mọi video của tôi.
- Là người dùng, tôi muốn biết thuật ngữ nào đã bị bỏ khỏi prompt vì quá dài.

## 4. Yêu cầu chức năng

- **FR-1** CRUD (thêm/xem/sửa/xoá) mục từ điển cho phạm vi cá nhân. Admin quản lý phạm vi hệ thống.
- **FR-2** Mục `term`: `text` dài 1–60 ký tự, có trường tuỳ chọn `aliases[]` (các cách đọc sai hay gặp, sinh tự động thành quy tắc sửa).
- **FR-3** Mục `replacement`: `pattern` là chuỗi thường (mặc định) hoặc regex (chỉ Admin được dùng); kèm `replacement` và `case_sensitive`. Pattern dạng chuỗi thường được bọc ranh giới từ `\b...\b`.
- **FR-4** **Bộ chủ đề (pack):** mỗi mục thuộc một `pack` (ví dụ `web3`). Mỗi video chọn 0..n pack khi upload; mặc định lấy theo preset (F28).
- **FR-5** Thứ tự ưu tiên khi dựng `initial_prompt`: thuật ngữ theo video → từ đề cương → cá nhân → pack đã chọn. Bỏ trùng lặp, không phân biệt hoa thường. Cắt tại giới hạn ký tự (`transcript.prompt_max_chars`, mặc định 420); trả về danh sách `dropped_terms`.
- **FR-6** Quy tắc sửa được áp dụng **sau** `clean_hallucination_and_artifacts` và **thay cho** `DOMAIN_TERM_MAPPINGS` viết cứng.
- **FR-7** Nút "Áp dụng lại từ điển" cho video đã bóc băng: chạy lại bước post-process trên transcript có sẵn, không gọi lại Whisper.
- **FR-8** Nhập và xuất từ điển dạng CSV: `type,text,replacement,pack`.

## 5. Yêu cầu phi chức năng

- Từ điển tối đa 2.000 mục mỗi người. Áp dụng quy tắc cho transcript 3.000 câu mất < 1s.
- Regex do người dùng nhập phải được kiểm tra trước khi lưu và có giới hạn thời gian chạy để tránh ReDoS (regex chạy cực chậm làm treo máy). Chỉ Admin được dùng regex.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__create_glossary.sql`:
```sql
CREATE TABLE glossary_entries (
    id BIGSERIAL PRIMARY KEY,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('SYSTEM','USER','VIDEO')),
    owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    video_id BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    pack VARCHAR(50),
    entry_type VARCHAR(12) NOT NULL CHECK (entry_type IN ('TERM','REPLACEMENT')),
    text VARCHAR(120) NOT NULL,
    replacement VARCHAR(120),
    is_regex BOOLEAN NOT NULL DEFAULT FALSE,
    case_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_glossary_owner ON glossary_entries(owner_id);
CREATE INDEX idx_glossary_video ON glossary_entries(video_id);
CREATE UNIQUE INDEX uq_glossary ON glossary_entries(scope, COALESCE(owner_id,0), COALESCE(video_id,0), entry_type, lower(text));
ALTER TABLE videos ADD COLUMN glossary_packs TEXT[] DEFAULT '{}';
```
Seed: `V<n+1>__seed_glossary_packs.sql` chuyển `DEFAULT_TECH_VOCABULARY` và `DOMAIN_TERM_MAPPINGS` thành các pack `web3`, `javascript`, `general_it`.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/glossary?scope=USER&pack=` | Đăng nhập | Danh sách |
| POST | `/api/v1/glossary` | Đăng nhập (SYSTEM: Admin) | Thêm mục |
| PUT/DELETE | `/api/v1/glossary/{id}` | Chủ sở hữu/Admin | Sửa/xoá |
| POST | `/api/v1/glossary/import` | Đăng nhập | Upload CSV |
| GET | `/api/v1/glossary/export` | Đăng nhập | Tải CSV |
| GET | `/api/v1/glossary/packs` | Đăng nhập | Danh sách pack |
| GET | `/api/v1/videos/{id}/glossary/preview` | Chủ video | Xem trước `initial_prompt` và `dropped_terms` |
| POST | `/api/v1/videos/{id}/glossary/reapply` | Chủ video | FR-7 |

```json
// POST /api/v1/glossary
{ "scope": "USER", "entryType": "REPLACEMENT", "text": "giao va", "replacement": "Java", "pack": "java" }
// 400
{ "error": { "code": "GLOSSARY_INVALID_REGEX", "message": "Biểu thức không hợp lệ", "details": { "field": "text" } } }
```

### 6.3 Backend (Spring Boot)

- `entity/GlossaryEntryEntity.java`, `repository/GlossaryEntryRepository.java`, `controller/GlossaryController.java`, `service/GlossaryService.java` (gộp ba phạm vi).
- Khi gọi Python ở bước analyze/transcribe (`VideoController` dòng ~779 hoặc job F10), Java ghi tệp `cache/<hash>/glossary.json` rồi truyền `--glossary <path>` cho `backend.ai.cli`:
  ```json
  { "terms": ["Spring Boot", "JPA"], "replacements": [{"pattern":"giao va","replacement":"Java","regex":false,"case_sensitive":false}] }
  ```

### 6.4 AI pipeline (Python)

- `prompt_builder.build_initial_prompt(outline_text, glossary_terms: list[str] | None, max_chars=420) -> tuple[str, list[str]]`: trả thêm `dropped_terms`. **Xoá** việc tự nối `DEFAULT_TECH_VOCABULARY`; danh sách này chuyển thành dữ liệu seed.
- `post_processor.py`: thêm `apply_glossary_replacements(text, rules)`. `post_process_sentence` nhận `rules` (mặc định rỗng). Giữ `DOMAIN_TERM_MAPPINGS` thêm **một bản phát hành** dưới cờ `--legacy-terms`, sau đó xoá.
- `cli.py`: thêm tham số `--glossary` và `--reapply-glossary <transcript.json>` cho FR-7.
- Cache Whisper ([whisper_service.py:139](../../../backend/ai/whisper_service.py) `get_cache_path`) hiện chỉ theo hash video. Từ điển đổi thì `initial_prompt` đổi, nên khoá cache phải thêm hash của danh sách term: `<file_hash>_<sha1(terms)[:8]>`.

### 6.5 Frontend (Next.js)

- Trang mới `app/glossary/page.tsx`: bảng mục từ điển, lọc theo pack, có nút Nhập CSV / Xuất CSV.
- `AddVideoModal.tsx`: thêm bước "Thuật ngữ" để chọn pack và gõ nhanh các thuật ngữ riêng của video. Ô xem trước hiển thị `initial_prompt` và cảnh báo "12 thuật ngữ bị bỏ vì quá dài".
- `TranscriptScenesPanel.tsx`: bôi đen một cụm từ, chọn "Thêm quy tắc sửa…" sẽ mở popup với `text` đã điền sẵn.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* từ điển cá nhân có quy tắc `"giao va" → "Java"`. *When* bóc băng video có câu "học giao va cơ bản". *Then* transcript lưu "học Java cơ bản".
- **AC-2** — *Given* video môn Toán, không chọn pack `web3`. *When* dựng prompt. *Then* `initial_prompt` không chứa "Solana", "DefiLlama".
- **AC-3** — *Given* câu "học sinh lớp 3" và pack `web3` **không** được chọn. *When* post-process. *Then* câu giữ nguyên "lớp 3".
- **AC-4** — *Given* 200 thuật ngữ. *When* gọi API preview. *Then* `initial_prompt` ≤ 420 ký tự và `dropped_terms` liệt kê đủ các từ bị bỏ.
- **AC-5** — *Given* regex `(a+)+$` do người dùng thường gửi. *Then* trả `403`. Nếu Admin gửi regex sai cú pháp thì trả `400 GLOSSARY_INVALID_REGEX`.
- **AC-6** — Trên 3 video mẫu môn Java có transcript chuẩn (tham chiếu), việc thêm từ điển 30 thuật ngữ làm **tỉ lệ thuật ngữ nhận đúng** (term recall) tăng ≥ 20 điểm % so với không có từ điển.
- **AC-7** — Bấm "Áp dụng lại từ điển" thì không gọi Whisper (kiểm bằng log) và hoàn tất trong < 5s với transcript 3.000 câu.

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f19_glossary.py`):
- `test_build_initial_prompt_without_default_web3_vocab()`; sửa `test_initial_prompt_builder` hiện có ([tests/test_sv2_week1.py:58](../../../tests/test_sv2_week1.py)) theo hành vi mới và ghi lý do trong PR (CONSTRAINTS §1)
- `test_build_initial_prompt_priority_order()`
- `test_build_initial_prompt_returns_dropped_terms()`
- `test_apply_glossary_plain_text_uses_word_boundary()`
- `test_apply_glossary_case_insensitive_default()`
- `test_cli_reapply_glossary_does_not_call_whisper()`
- `test_cache_key_changes_when_glossary_changes()`

JUnit:
- `GlossaryServiceTest.merge_videoScopeOverridesUserScope()`
- `GlossaryServiceTest.validateRegex_rejectsCatastrophicPatternForNonAdmin()`
- `GlossaryControllerTest.import_csv_createsEntries()`
- `GlossaryControllerTest.otherUser_cannotEditMyEntry()` (phụ thuộc F02)

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Quy tắc sửa quá rộng làm hỏng câu đúng | Transcript sai nghĩa | Bắt buộc `\b`; có xem trước "n câu bị ảnh hưởng" trước khi lưu |
| Prompt dài làm Whisper ảo giác lặp lại thuật ngữ | Văn bản rác | Giới hạn 420 ký tự; giữ `clean_hallucination_and_artifacts` |
| Đổi khoá cache làm bóc băng lại toàn bộ video cũ | Tốn thời gian và tiền API | Chỉ áp khoá cache mới cho lần bóc băng mới; video cũ dùng "Áp dụng lại" (FR-7) |

## 10. Câu hỏi mở

- [ ] Người dùng thường có được dùng regex không, hay chỉ Admin?
- [ ] Có cần từ điển cấp tổ chức (đi cùng F49) ngay bây giờ không?
- [ ] Groq Whisper API có trường `prompt` với giới hạn khác faster-whisper không? Nếu khác, cần kiểm tra lại giới hạn 420 ký tự cho cả hai engine.
