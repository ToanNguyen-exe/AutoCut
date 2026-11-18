# F23 — Phụ đề SRT/VTT và ghi cứng phụ đề

| Mục | Giá trị |
|---|---|
| **Mã** | F23 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (chia dòng, mốc từng từ) + SV1 (ffmpeg burn-in) + SV3 (API) + SV4 (UI) |
| **Phụ thuộc** | F00 (`topicId`, `video_parts` thật), F09/F10 (burn-in chạy trong job cắt), F04 (tải tệp an toàn), F01 (AD-4 nếu cần vé). Phụ thuộc mềm F44 (`video_parts.intro_offset_sec`) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không có thư viện code. Cần **bản ffmpeg có `libass`** để ghi cứng phụ đề (kiểm tra bằng `ffmpeg -filters \| grep subtitles`). Cần một font có đủ dấu tiếng Việt, giấy phép OFL, ví dụ Be Vietnam Pro hoặc Noto Sans |
| **Tham khảo** | YouTube auto-captions, Descript captions, Netflix Timed Text Style Guide (tiếng Việt) |

> **Cập nhật 18/11/2026:** thêm FR giữ mốc từng từ qua bước Gemini refine (đang tách lại câu bằng nội suy ký tự); bỏ FR "tự chuyển `fast` → `accurate`" vì Java chưa đọc `cut_mode` (VideoCutter luôn re-encode); thêm luật bắt buộc ≤ 20 ký tự/giây và cách chia dòng đảm bảo ≤ 42 ký tự; chốt đặt thuật toán chia cue ở Java; quyền theo AD-2, tiền tố chia sẻ theo AD-5.

## 1. Bối cảnh & vấn đề

- Transcript đã có mốc thời gian theo **câu** ([models.py:15](../../../backend/ai/models.py)), nhưng chưa có chức năng xuất phụ đề.
- Câu bài giảng thường dài 20–40 từ. Hiện thời gian của câu con được **nội suy theo độ dài ký tự** (`split_segment_into_timed_sentences`, [post_processor.py:226](../../../backend/ai/post_processor.py)), nên một dòng phụ đề dài 10–15 giây sẽ không đọc kịp và bị lệch tiếng.
- Whisper đang tắt mốc từng từ: `word_timestamps=False` ([whisper_service.py:234](../../../backend/ai/whisper_service.py)). Trường `words` trong `Sentence` bị `exclude=True` (models.py:22) nên không được lưu, dù cột `transcripts.words_json JSONB` đã có sẵn trong [schema.sql](../../../database/schema.sql).
- `VideoCutter` ([VideoCutter.java:212](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L212)) **luôn** re-encode bằng `libx264` (dòng 346). Khoá `output.cut_mode` trong `config.yaml` hiện **không được Java đọc**, nên trên thực tế chưa có chế độ copy stream. Vì vậy có thể chèn filter `subtitles=` vào cùng lượt encode mà không tốn thêm lượt render.
- Khi có `GEMINI_API_KEY`, `cli.py` luôn gọi `refine_transcript` sau Whisper ([cli.py:236-238](../../../backend/ai/cli.py)). Hàm này sửa chữ và **tách lại câu**, rồi chia thời gian cho các câu mới theo tỉ lệ ký tự bằng `_interpolate_sentences` ([transcript_refiner.py:120](../../../backend/ai/transcript_refiner.py)). Kết quả refine được ghi vào cache `cache/<hash>_transcript.json` (dòng ~240). Nếu chỉ bật `word_timestamps` mà không sửa bước này thì `words` vẫn bị mất, và mốc câu vẫn là mốc nội suy.

## 2. Mục tiêu

- Xuất phụ đề `.srt` và `.vtt` cho **video gốc** hoặc **từng clip** (mốc thời gian tính lại theo clip, có cộng padding).
- Mỗi cue (một lần hiện phụ đề) tuân thủ: ≤ 2 dòng, ≤ 42 ký tự/dòng, thời lượng 1–7 giây, tốc độ đọc ≤ 20 ký tự/giây.
- Tuỳ chọn **ghi cứng** phụ đề vào video khi cắt clip.
- Bật mốc từng từ để chia cue chính xác.

### Ngoài phạm vi

- Dịch phụ đề (F24). Phụ đề kiểu "karaoke" tô sáng từng từ (để sau).

## 3. User stories

- Là giảng viên, tôi muốn tải `.srt` để upload kèm video lên YouTube/LMS cho sinh viên khiếm thính.
- Là người làm nội dung, tôi muốn clip 9:16 (F45) có sẵn phụ đề ghi cứng vì người xem điện thoại thường tắt tiếng.

## 4. Yêu cầu chức năng

- **FR-1** Bật `word_timestamps=True` trong `whisper_service.py`. Lưu `words` vào `transcripts.words_json` (bỏ `exclude=True` khi xuất cho backend, giữ một chế độ xuất gọn khi cần).
- **FR-1b — Giữ mốc từng từ qua bước refine.** Trước khi refine, gom toàn bộ `words` của transcript thành một danh sách phẳng theo thời gian. Sau khi Gemini trả về các câu mới (chữ đã sửa):
  1. Thay `_interpolate_sentences` bằng `_align_sentences_to_words(texts, words)` khi có `words`: chia danh sách từ cho các câu theo tỉ lệ số ký tự đã chuẩn hoá (bỏ dấu, bỏ khoảng trắng), sau đó **dịch mỗi biên câu tới ranh giới từ gần nhất**. Mốc `start`/`end` của câu là mốc của từ đầu và từ cuối được chia cho câu đó.
  2. Mỗi câu mới giữ danh sách `words` gốc của Whisper (chữ có thể khác chữ đã sửa; chỉ dùng mốc thời gian).
  3. Không có `words` (Groq không trả, transcript cũ) thì giữ hành vi nội suy hiện tại và đặt `approximate=true`.
  4. Cache `cache/<hash>_transcript.json` lưu cả `words`.
- **FR-2** Thuật toán chia cue (Python, hàm thuần):
  1. Duyệt từ theo thứ tự, gom vào cue hiện tại.
  2. Ngắt cue khi: tổng ký tự > 84, **hoặc** thời lượng > 7s, **hoặc** gặp dấu `.?!` mà cue đã ≥ 1s, **hoặc** khoảng lặng giữa hai từ > 0,8s.
  3. **Chia dòng:** trong cue, chọn khoảng trắng sao cho **cả hai dòng đều ≤ 42 ký tự**; trong các vị trí hợp lệ, ưu tiên ngay sau dấu phẩy, rồi tới vị trí gần giữa nhất. Nếu không có vị trí nào hợp lệ (ví dụ một từ rất dài), chuyển từ cuối của cue sang cue sau rồi thử lại.
  4. **Tốc độ đọc:** nếu `số ký tự / thời lượng > 20`, kéo `end` thêm tối đa tới `min(start + 7, next.start - 0.05)`. Nếu vẫn > 20 ký tự/giây thì tách cue làm đôi tại ranh giới từ gần giữa nhất và kiểm tra lại từng nửa. Cue nào vẫn vượt (người nói quá nhanh) thì giữ nguyên và gắn `fast=true` để thống kê, không làm chậm toàn bộ phụ đề.
  5. Cue < 1s thì kéo `end` tới tối đa `min(start + 1, next.start - 0.05)`.
  6. Mốc của cue lấy từ `words` của câu: vị trí ký tự trong chữ đã sửa được quy đổi theo tỉ lệ sang dãy từ (nội suy tuyến tính từng khúc theo ranh giới từ).
- **FR-3** Nếu không có mốc từng từ (transcript cũ, engine Groq không trả `words`): chia theo ký tự, nội suy thời gian tuyến tính trong câu, gắn cờ `approximate=true`.
- **FR-4** Phụ đề theo clip: chỉ lấy các cue giao với `[paddedStart, paddedEnd]`, trừ mốc đi `paddedStart`, cắt cue ở biên.
- **FR-4b** Clip có intro (F44): sau khi dịch mốc theo FR-4, cộng thêm `video_parts.intro_offset_sec` vào `start`/`end` của **mọi** cue, để phụ đề khớp nội dung thật nằm sau intro. Áp cho cả phụ đề mềm (FR-8), phụ đề ghi cứng (FR-6) và API theo clip. Khi chưa có F44 (giá trị 0 hoặc không có cột) thì hành vi không đổi.
- **FR-5** Phụ đề dùng **transcript đã chỉnh sửa** (sau F32) chứ không dùng bản Whisper gốc.
- **FR-6** Ghi cứng: thêm tuỳ chọn `burnSubtitles: true` và `subtitleStyle` (`default` | `large` | `boxed`) vào `CutRequestDTO`. `VideoCutter` thêm `-vf "subtitles=<file.srt>:fontsdir=<thư mục font>:force_style='FontName=Be Vietnam Pro,FontSize=..'"` vào lệnh hiện có (đã luôn re-encode, nên không cần đổi chế độ cắt).
- **FR-7** (Bỏ.) Spec cũ yêu cầu tự chuyển `cut_mode=fast` sang `accurate`, nhưng Java chưa có chế độ `fast`. Nếu sau này F44/F45 thêm chế độ copy stream, spec đó phải tự áp quy tắc "ghi cứng thì bắt buộc re-encode".
- **FR-8** Xuất phụ đề **mềm** kèm clip: đặt `<clip>.srt` cạnh `<clip>.mp4` trong thư mục output và trong tệp ZIP.

## 5. Yêu cầu phi chức năng

- Sinh SRT cho video 2 giờ ≤ 2s.
- Ghi cứng làm tăng thời gian encode ≤ 15% so với không ghi cứng.
- Font đóng gói kèm dự án ở `backend/assets/fonts/`, ghi nguồn và giấy phép vào README (theo quy tắc tài nguyên của dự án).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

Không cần bảng mới; dùng `transcripts.words_json`. Nếu cần lưu style mặc định theo người dùng:
`V<yyyyMMddHHmm>__add_subtitle_prefs.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS subtitle_style VARCHAR(20) NOT NULL DEFAULT 'default';`

Cue **không lưu** vào DB: luôn sinh lại từ transcript (đã chỉnh sửa) khi gọi API, vì sinh nhanh (≤ 2s cho 2 giờ). F24 cần cue ổn định để dịch, nên F24 tự lưu cue của bản gốc vào bảng riêng (xem F24).

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{videoId}/subtitles?format=srt\|vtt` | Xem video | Phụ đề video gốc |
| GET | `/api/v1/topics/{topicId}/subtitles?format=srt\|vtt&part=1` | Xem video chứa topic | Phụ đề theo clip |
| POST | `/api/video/cut` (mở rộng, F00 đã thêm `videoId`/`topicId`) | Sửa video | Thêm `burnSubtitles`, `subtitleStyle`, `exportSoftSubtitles` |

Không có quyền xem thì trả 404 (AD-2). Người xem qua link chia sẻ dùng `/api/v1/share/{token}/subtitles?format=vtt` do F40 cung cấp (AD-5), gọi cùng `SubtitleService`.

```json
// POST /api/video/cut (phần thêm)
{ "burnSubtitles": true, "subtitleStyle": "boxed", "exportSoftSubtitles": true }
// GET /api/v1/jobs/{id} khi xong (F09/F10) có thêm, nếu có cue đọc quá nhanh
{ "warnings": [ { "code": "SUBTITLE_FAST_CUES", "message": "Có 4 dòng phụ đề vượt 20 ký tự/giây" } ] }
```

### 6.3 Backend (Spring Boot)

- `service/SubtitleService.java`: đọc câu và `words_json` từ DB, gọi hàm chia cue. Thuật toán chia cue (FR-2) **viết bằng Java** là nguồn duy nhất (hàm thuần `CueBuilder.build(sentences, rules)`, khoảng 150 dòng). Python chỉ cung cấp `words`, không chia cue.
- `controller/SubtitleController.java`.
- `VideoCutter`: thêm tham số `Path subtitleFile` (nullable). Khi có thì chèn `-vf subtitles=...`. Escape đường dẫn: trên Windows phải escape `:` và `\`.
- `BatchVideoCutService`: trước khi cắt mỗi clip, sinh `.srt` cho clip theo FR-4 vào thư mục làm việc của job (F17), truyền cho `VideoCutter`. Ghi cứng là một phần của job cắt sẵn có (AD-10), không tạo job riêng.
- Kiểm tra lúc khởi động: chạy `ffmpeg -filters` để xem có `subtitles` không, lưu kết quả vào một biến cờ. Nếu không có mà người dùng yêu cầu ghi cứng → `422 { code: "FFMPEG_NO_LIBASS" }`.

### 6.4 AI pipeline (Python)

- `whisper_service.py` dòng 234: `word_timestamps=True`. Chuyển `segment.words` thành `Word` cho từng câu.
- `transcript_refiner.py`: thêm `_align_sentences_to_words` (FR-1b, hàm thuần). Trong `refine_transcript`, dùng hàm này thay `_interpolate_sentences` khi transcript có `words`.
- `post_processor.merge_fragmented_segments` ([dòng 273](../../../backend/ai/post_processor.py)): khi gộp hoặc tách câu thì **gộp hoặc tách luôn `words`** theo đúng câu (hiện chỉ nội suy theo text).
- `models.py`: thêm tham số xuất `include_words` (mặc định `False` để file `transcripts/*.json` gọn). `--analyze-backend` xuất có `words`.
- `groq_service.py`: gửi `timestamp_granularities[]=word` nếu API hỗ trợ; không hỗ trợ thì theo FR-3.

### 6.5 Frontend (Next.js)

- `ExportProgressModal.tsx` / popup cắt: thêm ô chọn "Ghi phụ đề vào video", chọn kiểu, và "Kèm tệp .srt".
- `VideoPlayerPreview.tsx`: nút CC bật/tắt phụ đề xem trước. Thẻ `<track>` không gửi được header JWT, nên frontend tải VTT bằng `fetch` (có JWT), tạo `URL.createObjectURL(new Blob([vtt], {type: "text/vtt"}))` rồi gán vào `<track kind="subtitles" src=…>`. Thu hồi URL khi đóng trình phát.
- Menu "Xuất" có thêm mục "Phụ đề (.srt / .vtt)".

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* câu 30 từ dài 12s có mốc từng từ. *When* chia cue. *Then* mọi cue ≤ 7s, ≤ 2 dòng, mỗi dòng ≤ 42 ký tự, và ≤ 20 ký tự/giây (trừ cue gắn `fast=true`).
- **AC-1b** — *Given* cue 80 ký tự mà dấu phẩy nằm ở ký tự 60. *Then* không ngắt dòng tại dấu phẩy (dòng đầu sẽ > 42) mà ngắt tại khoảng trắng gần giữa nhất.
- **AC-1c** — *Given* transcript có mốc từng từ và có `GEMINI_API_KEY`. *When* chạy analyze (có refine). *Then* mọi câu sau refine có `words` không rỗng, và biên của câu trùng biên của một từ Whisper.
- **AC-2** — *Given* clip `[100s, 160s]`, padding 0,3s/0,5s. *Then* cue đầu tiên của `.srt` theo clip có mốc ≥ `00:00:00,000` và cue nằm ngoài khoảng không xuất hiện.
- **AC-3** — Tệp `.srt` được VLC và YouTube Studio nhận không lỗi; tiếng Việt hiển thị đủ dấu.
- **AC-4** — *Given* ghi cứng style `boxed`. *Then* chụp khung hình ở giây 5 thấy phụ đề có nền tối, đủ dấu (kiểm tra thủ công + so sánh ảnh).
- **AC-5** — Độ lệch trung bình giữa `start` của cue và lúc từ đầu tiên thật sự được nói ≤ 0,3s trên 50 cue lấy mẫu (khi có mốc từng từ).
- **AC-6** — *Given* ffmpeg không có libass. *When* yêu cầu ghi cứng. *Then* trả `422 FFMPEG_NO_LIBASS` với thông báo tiếng Việt, phụ đề mềm vẫn xuất được.
- **AC-7** — Người không có quyền xem video gọi API phụ đề thì nhận `404` (AD-2).

## 8. Kế hoạch kiểm thử (TDD)

JUnit (`SubtitleServiceTest`):
- `buildCues_respectsMaxDurationAndChars()`
- `buildCues_breaksOnLongPause()`
- `buildCues_splitsTwoLinesNearMiddlePreferComma()`
- `buildCues_lineSplitNeverExceeds42()` (AC-1b)
- `buildCues_readingSpeedOver20_extendsThenSplits()`
- `buildCues_withoutWords_isApproximate()`
- `clipCues_shiftsByPaddedStartAndClips()`
- `clipCues_addsIntroOffset()` (FR-4b: `intro_offset_sec = 4.0` thì cue đầu bắt đầu ≥ `00:00:04,000`)
- `toSrt_formatsCommaMilliseconds()` / `toVtt_formatsDotMilliseconds()`

`VideoCutterTest`:
- `buildCommand_withSubtitle_addsSubtitlesFilter()`
- `buildCommand_windowsPath_escapesColon()`
- `buildCommand_withSubtitle_addsFontsdir()`

pytest:
- `test_whisper_words_attached_to_sentences()` (mock model)
- `test_refine_keeps_words_and_snaps_boundaries_to_words()` (AC-1c, mock Gemini)
- `test_refine_without_words_marks_approximate()`
- `test_merge_fragmented_segments_keeps_words_aligned()`
- `test_transcript_export_include_words_flag()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bật `word_timestamps` làm Whisper chậm hơn ~10–20% | Analyze lâu hơn | Chấp nhận; đo bằng F15 |
| Bản ffmpeg trong `imageio-ffmpeg` hoặc trên Windows thiếu libass | Không ghi cứng được | Kiểm tra lúc khởi động; ghi rõ yêu cầu trong Docker (F14) |
| Font không có trên máy chủ nên dấu hiện ô vuông | Phụ đề lỗi | Đóng gói font, truyền `fontsdir=` |

## 10. Câu hỏi mở

- Đã chốt: thuật toán chia cue đặt ở Java (`CueBuilder`), Python chỉ cung cấp `words`.
- [ ] Font chính thức dùng gì? Cần trưởng nhóm duyệt nguồn và giấy phép.
- [ ] Có cho người dùng sửa từng cue không, hay chỉ sửa qua transcript (F32)?
