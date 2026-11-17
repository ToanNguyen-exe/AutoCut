# F30 — Tìm kiếm trong video và toàn thư viện

| Mục | Giá trị |
|---|---|
| **Mã** | F30 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (DB, API tìm kiếm) + SV4 (UI) + SV2 (giai đoạn 2: embedding) |
| **Phụ thuộc** | F02 (chỉ tìm trong dữ liệu mình được xem), F13. Bổ sung nguồn dữ liệu: F21 (tóm tắt), F26 (chữ trên slide) |
| **Ước lượng** | Giai đoạn 1 (từ khoá): M · Giai đoạn 2 (tìm theo ngữ nghĩa): M |
| **Thư viện mới cần duyệt** | Không có thư viện code. Cần bật **extension Postgres** `unaccent`, `pg_trgm` (giai đoạn 1) và `vector` (pgvector, giai đoạn 2); Neon hỗ trợ cả ba |
| **Tham khảo** | Panopto Smart Search, YouTube "Tìm trong bản chép lời", Descript search, Kaltura REACH |

## 1. Bối cảnh & vấn đề

- Tìm kiếm hiện chỉ chạy **phía trình duyệt** trên dữ liệu đã tải:
  - `TranscriptDrawer.tsx` ([dòng 21-29](../../../frontend/src/components/TranscriptDrawer.tsx)) lọc câu bằng `includes()`: phân biệt có dấu và không dấu ("vong lap" không tìm ra "vòng lặp") và chỉ trong một video.
  - `VideoLibraryDrawer.tsx` ([dòng 36-44](../../../frontend/src/components/VideoLibraryDrawer.tsx)) chỉ lọc theo **tên** video.
- Bảng `transcripts` chỉ có chỉ mục `(video_id, sentence_id)` ([schema.sql](../../../database/schema.sql)), không có chỉ mục full-text (tìm kiếm toàn văn).
- Không có cách trả lời câu hỏi kiểu "Thầy giảng về `try catch` ở video nào, phút thứ mấy?" trên toàn bộ khoá học.

## 2. Mục tiêu

**Giai đoạn 1: tìm theo từ khoá (P1)**
- Tìm **không phân biệt dấu và hoa thường**, chịu được lỗi gõ nhẹ (trigram), trong một video hoặc toàn thư viện của người dùng.
- Nguồn dữ liệu: transcript, tiêu đề topic, tóm tắt và từ khoá (F21), chữ OCR trên slide (F26).
- Kết quả trả **mốc giờ**, đoạn trích có tô sáng; bấm vào là phát ngay tại giây đó.

**Giai đoạn 2: tìm theo ngữ nghĩa (P2)**
- Hỏi bằng câu tự nhiên ("cách xử lý lỗi khi gọi API") vẫn ra đoạn liên quan dù không trùng từ. Dùng embedding (vector biểu diễn nghĩa của câu) + pgvector, xếp hạng kết hợp với từ khoá (hybrid).

### Ngoài phạm vi

- Hỏi đáp có trích dẫn kiểu RAG (sinh câu trả lời). Phần này có thể nối với chatbox `AiAssistantChatPanel` sau, ghi ở Câu hỏi mở.
- Tìm theo hình ảnh.

## 3. User stories

- Là sinh viên, tôi gõ "vong lap for" (không dấu) và thấy mọi chỗ thầy nói "vòng lặp for" trong 12 video, bấm vào là nghe ngay.
- Là giảng viên, tôi muốn tìm "HashMap" và thấy cả slide có chữ HashMap dù tôi không đọc ra.
- Là người dùng, tôi không được thấy kết quả từ video của người khác mà tôi không có quyền xem.

## 4. Yêu cầu chức năng

- **FR-1** Chuẩn hoá văn bản để tìm: `lower(unaccent(text))`, thay `đ` thành `d`. Lưu ở **cột sinh tự động** (generated column) để có chỉ mục.
- **FR-2** Chỉ mục:
  - `tsvector` cấu hình `simple` trên cột đã chuẩn hoá (Postgres không có từ điển tiếng Việt; `simple` tách theo khoảng trắng, đủ dùng).
  - GIN `pg_trgm` cho tìm gần đúng (fuzzy) và tìm chuỗi con (`console.log`).
- **FR-3** Truy vấn:
  - Có dấu ngoặc kép (`"vòng lặp for"`) → tìm cụm chính xác bằng `phraseto_tsquery`.
  - Không có ngoặc kép → `websearch_to_tsquery` (hỗ trợ `OR`, `-loại_trừ`).
  - Không có kết quả → tìm gần đúng bằng trigram với `similarity > 0.3`.
- **FR-4** Xếp hạng: `ts_rank_cd` × hệ số theo nguồn (tiêu đề topic 3,0 · từ khoá 2,0 · tóm tắt 1,5 · slide 1,2 · transcript 1,0). Có bộ lọc theo video, theo khoảng ngày, theo nguồn.
- **FR-5** Kết quả gom theo video: mỗi video hiện tối đa 5 hit, kèm "xem thêm". Mỗi hit gồm `videoId, topicId, sentenceId, start, snippet` (đoạn trích ±1 câu, dùng `ts_headline` với `<mark>`).
- **FR-6** Phân quyền: chỉ trả video mà người dùng sở hữu, được chia sẻ (F36) hoặc công khai qua khoá học (F41). Điều kiện quyền **nằm trong câu SQL**, không lọc sau khi đã lấy dữ liệu.
- **FR-7** Tìm trong một video (ô tìm trong Studio): gọi cùng API với `videoId`; UI tô sáng các câu trùng trên transcript, đánh dấu vạch trên timeline, có nút ↑/↓ để nhảy giữa các kết quả.
- **FR-8 (Giai đoạn 2)** Embedding theo **khối 3–5 câu** (chunk ~400 ký tự, chồng lấp 1 câu), lưu `vector(768)`. Truy vấn hybrid: `0.6 * điểm_ngữ_nghĩa + 0.4 * điểm_từ_khoá`, cả hai đã chuẩn hoá về `[0,1]`. Model embedding chọn ở Câu hỏi mở.
- **FR-9** Đánh chỉ mục lại tự động khi transcript bị sửa (F32), khi metadata đổi (F21) hoặc khi OCR xong (F26). Với embedding thì xếp job F09.

## 5. Yêu cầu phi chức năng

- p95 (95% truy vấn) ≤ 300ms với 500 video × 1.500 câu (≈ 750.000 dòng) trên Neon gói hiện tại.
- Giới hạn tốc độ 30 truy vấn/phút/người (F06).
- Truy vấn rỗng hoặc < 2 ký tự → `400`.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__search_fulltext.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent không IMMUTABLE nên cần hàm bọc để dùng trong generated column / index
CREATE OR REPLACE FUNCTION vn_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(t,''))), 'đ', 'd') $$;

ALTER TABLE transcripts ADD COLUMN text_norm TEXT GENERATED ALWAYS AS (vn_norm(text)) STORED;
ALTER TABLE transcripts ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', vn_norm(text))) STORED;
CREATE INDEX idx_transcripts_tsv  ON transcripts USING GIN (tsv);
CREATE INDEX idx_transcripts_trgm ON transcripts USING GIN (text_norm gin_trgm_ops);

ALTER TABLE topics ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', vn_norm(title)), 'A') ||
  setweight(to_tsvector('simple', vn_norm(coalesce(summary,''))), 'B')
) STORED;   -- cột summary có sau F21; nếu F21 chưa xong thì chỉ dùng title
CREATE INDEX idx_topics_tsv ON topics USING GIN (tsv);
```
Giai đoạn 2, `V<n>__search_vectors.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE transcript_chunks (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_sentence_id VARCHAR(10) NOT NULL,
    end_sentence_id VARCHAR(10) NOT NULL,
    start_time DOUBLE PRECISION NOT NULL,
    text TEXT NOT NULL,
    embedding vector(768) NOT NULL,
    model VARCHAR(50) NOT NULL
);
CREATE INDEX idx_chunks_embedding ON transcript_chunks USING hnsw (embedding vector_cosine_ops);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/search?q=&videoId=&sources=transcript,topic,slide&from=&to=&page=&mode=keyword\|hybrid` | Đăng nhập | Tìm kiếm |

```json
// GET /api/v1/search?q=vong lap for
{
  "query": "vong lap for", "mode": "keyword", "total": 37, "tookMs": 42,
  "groups": [
    { "videoId": 12, "videoTitle": "Bài 5 - Vòng lặp", "hitCount": 14,
      "hits": [
        { "source": "topic", "topicId": 88, "start": 412.35, "snippet": "<mark>Vòng lặp for</mark>: cú pháp và ví dụ" },
        { "source": "transcript", "sentenceId": "S0142", "start": 431.2,
          "snippet": "...bây giờ chúng ta sang <mark>vòng lặp for</mark>, nó gồm ba phần..." }
      ] }
  ]
}
```
Lỗi: `400 SEARCH_QUERY_TOO_SHORT`.

### 6.3 Backend (Spring Boot)

- `controller/SearchController.java`, `service/SearchService.java`. Dùng native query qua `JdbcTemplate` (hoặc `@Query(nativeQuery=true)`) vì JPA không hỗ trợ `tsvector`.
- Truy vấn mẫu (transcript):
  ```sql
  SELECT t.video_id, t.sentence_id, t.start_time,
         ts_headline('simple', t.text, q, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=25') AS snippet,
         ts_rank_cd(t.tsv, q) AS rank
  FROM transcripts t
  JOIN videos v ON v.id = t.video_id,
       websearch_to_tsquery('simple', vn_norm(:q)) q
  WHERE t.tsv @@ q AND v.owner_id = :userId      -- mở rộng theo F02/F36
  ORDER BY rank DESC LIMIT 200;
  ```
  Chú ý: `ts_headline` chạy trên `text` gốc (có dấu) với query đã bỏ dấu sẽ **không tô sáng được**. Cách xử lý: tự tô sáng trong Java bằng cách so khớp vị trí trên `text_norm` rồi ánh xạ ngược về `text`; vị trí ký tự được giữ nguyên nếu chuẩn hoá theo từng ký tự. Viết hàm thuần `Highlighter.highlight(original, normalized, terms)`.
- Gom nhóm và nhân hệ số (FR-4, FR-5) trong service.

### 6.4 AI pipeline (Python), chỉ giai đoạn 2

- `backend/ai/embedder.py`: `embed_chunks(chunks: list[str]) -> list[list[float]]`, gọi API embedding theo lô 100. Lệnh CLI `--embed-video <transcript.json> --output <chunks.json>`.
- Hàm thuần `make_chunks(sentences, max_chars=400, overlap=1)`.

### 6.5 Frontend (Next.js)

- Thanh tìm kiếm toàn cục trong `StudioHeader.tsx` (phím tắt `Ctrl/Cmd + K`) mở trang/khung kết quả `components/SearchResults.tsx`, gom theo video, bấm hit thì mở video tại `start`.
- `TranscriptDrawer.tsx`: thay `includes()` bằng gọi API khi có `videoId` (giữ lọc cục bộ khi đang offline hoặc chưa lưu DB). Thêm nút ↑/↓ và đếm "3/14".
- `StudioTimeline.tsx`: hiện vạch đánh dấu vị trí các hit.
- Đoạn trích chỉ cho phép thẻ `<mark>`; mọi HTML khác bị escape để tránh XSS (chèn mã độc vào trang).

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* câu "Bây giờ sang vòng lặp for". *When* tìm `vong lap for`, `VÒNG LẶP FOR` hoặc `vòng lặp for`. *Then* cả ba đều trả câu đó.
- **AC-2** — *Given* tìm `"vòng lặp for"` có ngoặc kép. *Then* không trả câu "vòng lặp while … for each" (không đúng cụm).
- **AC-3** — *Given* gõ sai `vong lapp`. *Then* vẫn ra kết quả nhờ trigram.
- **AC-4** — *Given* người dùng B tìm từ chỉ có trong video của A. *Then* `total = 0`.
- **AC-5** — Hiệu năng: tập dữ liệu sinh giả 750.000 câu, chạy 100 truy vấn ngẫu nhiên → p95 ≤ 300ms (đo bằng `EXPLAIN ANALYZE` và log `tookMs`).
- **AC-6** — Đoạn trích tô sáng đúng từ khớp trong văn bản **có dấu**; chuỗi `<script>` trong transcript hiển thị dạng text.
- **AC-7 (Giai đoạn 2)** — Bộ 30 câu hỏi tự nhiên có đáp án gán tay: hybrid đạt Recall@5 ≥ 80%, cao hơn chỉ dùng từ khoá ≥ 15 điểm %.
- **AC-8** — Sửa câu transcript (F32) thì tìm được ngay nội dung mới (không cần chạy lại chỉ mục, nhờ generated column).

## 8. Kế hoạch kiểm thử (TDD)

JUnit (integration với Testcontainers Postgres, hoặc Neon branch test; H2 **không** hỗ trợ `tsvector`):
- `SearchServiceIT.unaccentedQuery_matchesAccentedText()`
- `SearchServiceIT.quotedPhrase_requiresExactSequence()`
- `SearchServiceIT.typo_fallsBackToTrigram()`
- `SearchServiceIT.otherUsersVideos_areExcluded()`
- `SearchServiceIT.topicTitleHit_ranksAboveTranscriptHit()`

Unit:
- `HighlighterTest.highlight_mapsNormalizedMatchBackToAccentedText()`
- `HighlighterTest.highlight_escapesHtml()`
- `SearchControllerTest.shortQuery_returns400()`

pytest (giai đoạn 2):
- `test_make_chunks_overlap_and_max_chars()`
- `test_embed_chunks_batches_of_100()` (mock)

E2E (SV4): Ctrl+K → gõ từ → bấm hit → player ở đúng `start ± 0,5s`.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Testcontainers cần Docker trên máy dev | Test khó chạy | Dùng Neon branch riêng cho CI (F14) |
| `unaccent` xử lý chưa đủ một số ký tự tiếng Việt tổ hợp (NFD) | Lọt kết quả | Chuẩn hoá NFC khi ghi transcript; test có ký tự tổ hợp |
| Chi phí embedding cho cả thư viện | Tốn tiền | Giai đoạn 2 chỉ chạy cho video đã duyệt; cache theo hash chunk |
| Rò rỉ dữ liệu qua tìm kiếm | Lộ nội dung | FR-6 trong SQL; test AC-4 |

## 10. Câu hỏi mở

- [ ] Dùng model embedding nào cho giai đoạn 2 (Gemini `text-embedding-004` 768 chiều hay model mã nguồn mở)? Đổi model thì số chiều đổi theo.
- [ ] Chạy test tích hợp bằng Testcontainers (cần Docker) hay Neon branch?
- [ ] Có nối kết quả tìm kiếm vào chatbox AI (RAG có trích dẫn mốc giờ) ở bản sau không?
