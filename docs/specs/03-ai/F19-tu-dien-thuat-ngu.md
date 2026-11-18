# F19 — Từ điển thuật ngữ riêng

| Mục | Giá trị |
|---|---|
| **Mã** | F19 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (Whisper prompt, post-processor) + SV3 (API, DB) + SV4 (màn hình quản lý) |
| **Phụ thuộc** | F01, F02 (biết từ điển thuộc về ai), F13, F00 (`videoId` ở frontend), F09 (job áp dụng lại) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Otter.ai Custom Vocabulary, Descript Transcription Glossary, Google Speech "phrase hints" |

> **Cập nhật 18/11/2026:** bỏ regex khỏi phạm vi (tránh ReDoS và lệch cú pháp Java/Python), chỉ dùng chuỗi thường có ranh giới từ; sửa thiết kế cache (cli đọc transcript trực tiếp, không qua `get_cache_path`): cache giữ bản Whisper thô, quy tắc sửa áp khi đọc; nhập/xuất CSV chuyển sang làm sau (YAGNI); mã lỗi quyền theo AD-2, job theo AD-10.

## 1. Bối cảnh & vấn đề

Thuật ngữ hiện đang **viết cứng trong code** và thiên về đúng một khoá học Web3:

- `DEFAULT_TECH_VOCABULARY` ([prompt_builder.py:13](../../../backend/ai/prompt_builder.py)) gồm "Solana", "Polkadot", "DefiLlama", "hacker house"... rồi được nối vào `initial_prompt` của Whisper cho **mọi** video. Với bài giảng Java hoặc Toán, các từ này là nhiễu, làm Whisper dễ "nghe" ra chữ Web3 ở chỗ không có.
- `build_initial_prompt` ([prompt_builder.py:62](../../../backend/ai/prompt_builder.py)) cắt ở 420 ký tự (dòng 84). Thuật ngữ người dùng đứng trước, nhưng đề cương dài sẽ đẩy hết từ điển ra ngoài mà không ai biết.
- `DOMAIN_TERM_MAPPINGS` ([post_processor.py:17](../../../backend/ai/post_processor.py)) là danh sách regex sửa lỗi nghe nhầm ("bởi lúc trên" → "blockchain", "lớp 3" → "Web3"). Quy tắc `"lớp 3" → "Web3"` sẽ **làm hỏng** bài giảng có câu "lớp 3" theo nghĩa thật.
- Muốn thêm một từ mới, hiện phải sửa code Python và triển khai lại.
- Khi tìm transcript có sẵn, `_find_matching_transcript_or_video` ([cli.py:140-167](../../../backend/ai/cli.py)) đọc **trực tiếp** `transcripts/<tên>_transcript.json` rồi `cache/<hash>_transcript.json`, và **luôn chạy lại** `post_process_transcript` trên kết quả đọc được. Hàm này không đi qua `get_cache_path` của `whisper_service.py`. Vì vậy đổi khoá cache trong `whisper_service` sẽ không có tác dụng gì, nhưng bù lại, quy tắc sửa có thể áp lại mỗi lần đọc mà không cần gọi Whisper.

## 2. Mục tiêu

- Người dùng tự quản lý **từ điển** gồm hai loại mục:
  1. **Thuật ngữ** (term): từ cần Whisper ưu tiên nhận ra, ví dụ `Spring Boot`, `polymorphism`.
  2. **Quy tắc sửa** (replacement): `"xì pring bút" → "Spring Boot"`.
- Từ điển có 3 phạm vi: **hệ thống** (mặc định), **cá nhân**, **theo video**. Khi phân tích, ba phạm vi được gộp lại, phạm vi hẹp hơn được ưu tiên.
- Chuyển nội dung đang viết cứng thành dữ liệu seed, chia theo bộ chủ đề (`web3`, `javascript`, `java`...) thay vì nạp tất cả.

### Ngoài phạm vi

- Không fine-tune (huấn luyện thêm) Whisper.
- Không tự động phát hiện thuật ngữ mới; việc học từ chỉnh sửa thuộc F27.
- **Không hỗ trợ regex** ở bản này: pattern luôn là chuỗi thường. Lý do: regex do người dùng nhập có thể làm treo máy (ReDoS), còn `re` của Python không có timeout; Java và Python lại dùng cú pháp regex khác nhau. Các quy tắc cũ dùng regex trong `DOMAIN_TERM_MAPPINGS` được chuyển thành nhiều quy tắc chuỗi thường khi seed.
- Nhập/xuất từ điển bằng CSV: làm sau, khi có người dùng thật yêu cầu (YAGNI).

## 3. User stories

- Là giảng viên môn Java, tôi muốn thêm "JPA, Hibernate, Lombok" để transcript không ra "dê pi ây".
- Là giảng viên, tôi muốn thêm quy tắc "giao va" → "Java" một lần và nó áp dụng cho mọi video của tôi.
- Là người dùng, tôi muốn biết thuật ngữ nào đã bị bỏ khỏi prompt vì quá dài.

## 4. Yêu cầu chức năng

- **FR-1** CRUD (thêm/xem/sửa/xoá) mục từ điển cho phạm vi cá nhân. Admin quản lý phạm vi hệ thống.
- **FR-2** Mục `term`: `text` dài 1–60 ký tự, có trường tuỳ chọn `aliases[]` (các cách đọc sai hay gặp, sinh tự động thành quy tắc sửa).
- **FR-3** Mục `replacement`: `pattern` là **chuỗi thường** (ký tự đặc biệt được escape, ví dụ bằng `re.escape`), kèm `replacement` và `case_sensitive`. Khi so khớp, pattern được bọc ranh giới từ theo kiểu hiểu Unicode tiếng Việt: `(?<!\w)…(?!\w)` với cờ `re.UNICODE`, vì `\b` không xử lý đúng chữ có dấu ở mọi trường hợp. Chỉ Python chạy quy tắc; Java chỉ kiểm tra độ dài và ký tự rỗng.
- **FR-4** **Bộ chủ đề (pack):** mỗi mục thuộc một `pack` (ví dụ `web3`). Mỗi video chọn 0..n pack khi upload; mặc định lấy theo preset (F28).
- **FR-5** Thứ tự ưu tiên khi dựng `initial_prompt`: thuật ngữ theo video → từ đề cương → cá nhân → pack đã chọn. Bỏ trùng lặp, không phân biệt hoa thường. Cắt tại giới hạn ký tự (`transcript.prompt_max_chars`, mặc định 420); trả về danh sách `dropped_terms`.
- **FR-6** Quy tắc sửa được áp dụng **sau** `clean_hallucination_and_artifacts` và **thay cho** `DOMAIN_TERM_MAPPINGS` viết cứng. Quy tắc được áp **mỗi lần đọc** transcript trong `post_process_transcript` (đã được gọi ở cả hai nhánh đọc của `_find_matching_transcript_or_video`). Cache chỉ lưu bản Whisper **thô**, chưa áp quy tắc.
- **FR-7** Nút "Áp dụng lại từ điển" cho video đã bóc băng tạo một job `GLOSSARY_REAPPLY` (F09, AD-10). Job chạy lại bước post-process trên transcript thô có sẵn, không gọi lại Whisper, rồi ghi transcript mới vào DB.
- **FR-7b** Đổi **thuật ngữ** (term) chỉ có tác dụng ở lần bóc băng sau, vì term nằm trong `initial_prompt` của Whisper. Giao diện có nút riêng "Bóc băng lại với từ điển mới" (job `TRANSCRIBE` với cờ `force=true`, bỏ qua cache). Không tự động bóc băng lại khi từ điển đổi.

## 5. Yêu cầu phi chức năng

- Từ điển tối đa 2.000 mục mỗi người. Áp dụng quy tắc cho transcript 3.000 câu mất < 1s.
- Không có regex do người dùng nhập, nên không có rủi ro ReDoS (regex chạy cực chậm làm treo máy). Mọi pattern đều được escape trước khi biên dịch.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<yyyyMMddHHmm>__create_glossary.sql`:
```sql
CREATE TABLE IF NOT EXISTS glossary_entries (
    id BIGSERIAL PRIMARY KEY,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('SYSTEM','USER','VIDEO')),
    owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    video_id BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    pack VARCHAR(50),
    entry_type VARCHAR(12) NOT NULL CHECK (entry_type IN ('TERM','REPLACEMENT')),
    text VARCHAR(120) NOT NULL,
    replacement VARCHAR(120),
    case_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_glossary_owner ON glossary_entries(owner_id);
CREATE INDEX IF NOT EXISTS idx_glossary_video ON glossary_entries(video_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_glossary ON glossary_entries(scope, COALESCE(owner_id,0), COALESCE(video_id,0), entry_type, lower(text));
ALTER TABLE videos ADD COLUMN IF NOT EXISTS glossary_packs TEXT[] NOT NULL DEFAULT '{}';
```
Seed: `V<yyyyMMddHHmm>__seed_glossary_packs.sql` chuyển `DEFAULT_TECH_VOCABULARY` và `DOMAIN_TERM_MAPPINGS` thành các pack `web3`, `javascript`, `general_it`. Quy tắc regex cũ được viết lại thành các quy tắc chuỗi thường tương đương; quy tắc nào không viết lại được thì bỏ và liệt kê trong PR.

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/glossary?scope=USER&pack=` | Đăng nhập | Danh sách |
| POST | `/api/v1/glossary` | Đăng nhập (SYSTEM: Admin) | Thêm mục |
| PUT/DELETE | `/api/v1/glossary/{id}` | Chủ sở hữu/Admin | Sửa/xoá. Mục của người khác: 404 (AD-2) |
| GET | `/api/v1/glossary/packs` | Đăng nhập | Danh sách pack |
| GET | `/api/v1/videos/{videoId}/glossary/preview` | Xem video | Xem trước `initial_prompt` và `dropped_terms` |
| POST | `/api/v1/videos/{videoId}/glossary/reapply` | Sửa video | FR-7, trả `202 { "jobId": … }` |

```json
// POST /api/v1/glossary
{ "scope": "USER", "entryType": "REPLACEMENT", "text": "giao va", "replacement": "Java", "pack": "java" }
// 422
{ "error": { "code": "GLOSSARY_INVALID", "message": "Nội dung từ điển không hợp lệ", "details": { "field": "text", "reason": "EMPTY_OR_TOO_LONG" } } }
// 403 khi người dùng thường tạo mục scope SYSTEM
{ "error": { "code": "FORBIDDEN_ACTION", "message": "Chỉ Admin được sửa từ điển hệ thống", "details": {} } }
```

### 6.3 Backend (Spring Boot)

- `entity/GlossaryEntryEntity.java`, `repository/GlossaryEntryRepository.java`, `controller/GlossaryController.java`, `service/GlossaryService.java` (gộp ba phạm vi).
- Khi job TRANSCRIBE/ANALYZE/GLOSSARY_REAPPLY (F09, F10) gọi Python, Java ghi tệp vào thư mục làm việc riêng của job (F17) `…/glossary.json`, rồi truyền `--glossary <path>` cho `backend.ai.cli`:
  ```json
  { "terms": ["Spring Boot", "JPA"], "replacements": [{"pattern":"giao va","replacement":"Java","case_sensitive":false}] }
  ```

### 6.4 AI pipeline (Python)

- `prompt_builder.build_initial_prompt(outline_text, glossary_terms: list[str] | None, max_chars=420) -> tuple[str, list[str]]`: trả thêm `dropped_terms`. **Xoá** việc tự nối `DEFAULT_TECH_VOCABULARY`; danh sách này chuyển thành dữ liệu seed.
- `post_processor.py`: thêm `apply_glossary_replacements(text, rules)`. Mỗi rule được biên dịch một lần: `re.compile(r'(?<!\w)' + re.escape(pattern) + r'(?!\w)', flags)`. `post_process_transcript` và `post_process_sentence` nhận `rules` (mặc định rỗng). Giữ `DOMAIN_TERM_MAPPINGS` thêm **một bản phát hành** dưới cờ `--legacy-terms`, sau đó xoá.
- `cli.py`:
  - Thêm tham số `--glossary <path>`. Truyền `rules` vào **cả hai** lời gọi `post_process_transcript` trong `_find_matching_transcript_or_video` (dòng ~151 và ~162) và vào nhánh bóc băng mới.
  - Thêm `--force-transcribe` (FR-7b) để bỏ qua bước 1 và 2 của `_find_matching_transcript_or_video`.
  - Thêm `--reapply-glossary` (FR-7): chỉ đọc transcript thô, áp `rules`, in kết quả.
- **Cache:** giữ nguyên khoá cache theo hash video. Bản lưu cache phải là transcript **trước** khi áp quy tắc từ điển (sửa `save_to_dedicated_transcripts_folder` để lưu bản thô; chỉ kết quả trả về mới được áp quy tắc). Không đổi khoá cache trong `whisper_service.get_cache_path`, vì cli không đi qua hàm đó.

### 6.5 Frontend (Next.js)

- Trang mới `app/glossary/page.tsx`: bảng mục từ điển, lọc theo pack, có nút Nhập CSV / Xuất CSV.
- `AddVideoModal.tsx`: thêm bước "Thuật ngữ" để chọn pack và gõ nhanh các thuật ngữ riêng của video. Ô xem trước hiển thị `initial_prompt` và cảnh báo "12 thuật ngữ bị bỏ vì quá dài".
- Trang chi tiết video: hai nút "Áp dụng lại quy tắc sửa" (FR-7, nhanh) và "Bóc băng lại với từ điển mới" (FR-7b, có hộp xác nhận ghi rõ sẽ tốn thời gian và chi phí API).
- `TranscriptScenesPanel.tsx`: bôi đen một cụm từ, chọn "Thêm quy tắc sửa…" sẽ mở popup với `text` đã điền sẵn.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* từ điển cá nhân có quy tắc `"giao va" → "Java"`. *When* bóc băng video có câu "học giao va cơ bản". *Then* transcript lưu "học Java cơ bản".
- **AC-2** — *Given* video môn Toán, không chọn pack `web3`. *When* dựng prompt. *Then* `initial_prompt` không chứa "Solana", "DefiLlama".
- **AC-3** — *Given* câu "học sinh lớp 3" và pack `web3` **không** được chọn. *When* post-process. *Then* câu giữ nguyên "lớp 3".
- **AC-4** — *Given* 200 thuật ngữ. *When* gọi API preview. *Then* `initial_prompt` ≤ 420 ký tự và `dropped_terms` liệt kê đủ các từ bị bỏ.
- **AC-5** — *Given* người dùng lưu quy tắc có pattern `(a+)+$`. *Then* lưu thành công như chuỗi thường; câu "aaaaaaaaaaaaaaaaaaaaaaaa!" được xử lý trong < 10 ms và không bị thay; chỉ đúng chuỗi `(a+)+$` mới khớp. Người dùng không phải Admin tạo mục `scope=SYSTEM` thì nhận `403 FORBIDDEN_ACTION`.
- **AC-5b** — *Given* quy tắc `"giao va" → "Java"`. *Then* câu "giao vang" và "Đôgiao va" không bị thay (ranh giới từ với chữ có dấu).
- **AC-6** — Trên 3 video mẫu môn Java có transcript chuẩn (tham chiếu), việc thêm từ điển 30 thuật ngữ làm **tỉ lệ thuật ngữ nhận đúng** (term recall) tăng ≥ 20 điểm % so với không có từ điển.
- **AC-7** — Bấm "Áp dụng lại quy tắc sửa" thì không gọi Whisper (kiểm bằng log) và job hoàn tất trong < 5s với transcript 3.000 câu.
- **AC-8** — *Given* video đã có cache transcript, *When* thêm quy tắc mới rồi chạy analyze, *Then* quy tắc mới được áp mà không bóc băng lại; tệp cache vẫn là bản thô (chưa áp quy tắc).

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f19_glossary.py`):
- `test_build_initial_prompt_without_default_web3_vocab()`; sửa `test_initial_prompt_builder` hiện có ([tests/test_sv2_week1.py:58](../../../tests/test_sv2_week1.py)) theo hành vi mới và ghi lý do trong PR (CONSTRAINTS §1)
- `test_build_initial_prompt_priority_order()`
- `test_build_initial_prompt_returns_dropped_terms()`
- `test_apply_glossary_plain_text_uses_word_boundary()`
- `test_apply_glossary_vietnamese_boundary_not_inside_word()` (AC-5b)
- `test_apply_glossary_special_chars_are_literal()` (AC-5)
- `test_find_matching_transcript_applies_rules_on_cache_hit()` (AC-8)
- `test_cache_file_stores_raw_transcript()` (AC-8)
- `test_apply_glossary_case_insensitive_default()`
- `test_cli_reapply_glossary_does_not_call_whisper()`
- `test_force_transcribe_skips_cache()` (FR-7b)

JUnit:
- `GlossaryServiceTest.merge_videoScopeOverridesUserScope()`
- `GlossaryControllerTest.nonAdmin_createSystemEntry_returns403()`
- `GlossaryControllerTest.otherUser_editMyEntry_returns404()` (AD-2, phụ thuộc F02)
- `GlossaryControllerTest.reapply_createsJob_returns202()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Quy tắc sửa quá rộng làm hỏng câu đúng | Transcript sai nghĩa | Bắt buộc `\b`; có xem trước "n câu bị ảnh hưởng" trước khi lưu |
| Prompt dài làm Whisper ảo giác lặp lại thuật ngữ | Văn bản rác | Giới hạn 420 ký tự; giữ `clean_hallucination_and_artifacts` |
| Cache cũ đã lưu bản transcript **đã** áp `DOMAIN_TERM_MAPPINGS` | Không gỡ được quy tắc sai cũ khi áp lại | Chấp nhận cho dữ liệu cũ; video quan trọng thì dùng "Bóc băng lại" (FR-7b) |
| Người dùng muốn regex cho trường hợp phức tạp | Thiếu tính năng | Thêm nhiều quy tắc chuỗi thường; xem lại khi có nhu cầu thật |

## 10. Câu hỏi mở

- Đã chốt: không hỗ trợ regex ở bản này (xem Ngoài phạm vi).
- [ ] Có cần từ điển cấp tổ chức (đi cùng F49) ngay bây giờ không? Đề xuất: chưa (AD-9 chỉ nói về hạn mức).
- [ ] Groq Whisper API có trường `prompt` với giới hạn khác faster-whisper không? Nếu khác, cần kiểm tra lại giới hạn 420 ký tự cho cả hai engine.
