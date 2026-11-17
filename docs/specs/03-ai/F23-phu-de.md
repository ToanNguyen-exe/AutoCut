# F23 — Phụ đề SRT/VTT và ghi cứng phụ đề

| Mục | Giá trị |
|---|---|
| **Mã** | F23 |
| **Nhóm** | AI |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV2 (chia dòng, mốc từng từ) + SV1 (ffmpeg burn-in) + SV3 (API) + SV4 (UI) |
| **Phụ thuộc** | F09/F10 (burn-in chạy nền), F04 (tải tệp an toàn) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không có thư viện code. Cần **bản ffmpeg có `libass`** để ghi cứng phụ đề (kiểm tra bằng `ffmpeg -filters \| grep subtitles`). Cần một font có đủ dấu tiếng Việt, giấy phép OFL, ví dụ Be Vietnam Pro hoặc Noto Sans |
| **Tham khảo** | YouTube auto-captions, Descript captions, Netflix Timed Text Style Guide (tiếng Việt) |

## 1. Bối cảnh & vấn đề

- Transcript đã có mốc thời gian theo **câu** ([models.py:15](../../../backend/ai/models.py)), nhưng chưa có chức năng xuất phụ đề.
- Câu bài giảng thường dài 20–40 từ. Hiện thời gian của câu con được **nội suy theo độ dài ký tự** (`split_segment_into_timed_sentences`, [post_processor.py:226](../../../backend/ai/post_processor.py)), nên một dòng phụ đề dài 10–15 giây sẽ không đọc kịp và bị lệch tiếng.
- Whisper đang tắt mốc từng từ: `word_timestamps=False` ([whisper_service.py:234](../../../backend/ai/whisper_service.py)). Trường `words` trong `Sentence` bị `exclude=True` (models.py:22) nên không được lưu, dù cột `transcripts.words_json JSONB` đã có sẵn trong [schema.sql](../../../database/schema.sql).
- `VideoCutter` ([VideoCutter.java:212](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L212)) re-encode bằng `libx264` (dòng 346), nên có thể chèn thêm filter `subtitles=` vào cùng lượt encode mà không tốn thêm lượt render.

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
- **FR-2** Thuật toán chia cue (Python, hàm thuần):
  1. Duyệt từ theo thứ tự, gom vào cue hiện tại.
  2. Ngắt cue khi: tổng ký tự > 84, **hoặc** thời lượng > 7s, **hoặc** gặp dấu `.?!` mà cue đã ≥ 1s, **hoặc** khoảng lặng giữa hai từ > 0,8s.
  3. Trong cue, chia 2 dòng tại khoảng trắng gần giữa nhất, ưu tiên ngắt sau dấu phẩy.
  4. Cue < 1s thì kéo `end` tới tối đa `min(start + 1, next.start - 0.05)`.
- **FR-3** Nếu không có mốc từng từ (transcript cũ, engine Groq không trả `words`): chia theo ký tự, nội suy thời gian tuyến tính trong câu, gắn cờ `approximate=true`.
- **FR-4** Phụ đề theo clip: chỉ lấy các cue giao với `[paddedStart, paddedEnd]`, trừ mốc đi `paddedStart`, cắt cue ở biên.
- **FR-5** Phụ đề dùng **transcript đã chỉnh sửa** (sau F32) chứ không dùng bản Whisper gốc.
- **FR-6** Ghi cứng: thêm tuỳ chọn `burnSubtitles: true` và `subtitleStyle` (`default` | `large` | `boxed`) vào `CutRequestDTO`. `VideoCutter` thêm `-vf "subtitles=<file.srt>:force_style='FontName=Be Vietnam Pro,FontSize=..'"` vào lệnh hiện có.
- **FR-7** Khi `cut_mode = fast` (copy stream, không re-encode) mà người dùng chọn ghi cứng → tự chuyển sang `accurate` và trả cảnh báo.
- **FR-8** Xuất phụ đề **mềm** kèm clip: đặt `<clip>.srt` cạnh `<clip>.mp4` trong thư mục output và trong tệp ZIP.

## 5. Yêu cầu phi chức năng

- Sinh SRT cho video 2 giờ ≤ 2s.
- Ghi cứng làm tăng thời gian encode ≤ 15% so với không ghi cứng.
- Font đóng gói kèm dự án ở `backend/assets/fonts/`, ghi nguồn và giấy phép vào README (theo quy tắc tài nguyên của dự án).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

Không cần bảng mới; dùng `transcripts.words_json`. Nếu cần lưu style mặc định theo người dùng:
`V<n>__add_subtitle_prefs.sql`: `ALTER TABLE users ADD COLUMN subtitle_style VARCHAR(20) DEFAULT 'default';`

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/subtitles?format=srt\|vtt` | Chủ video / link chia sẻ | Phụ đề video gốc |
| GET | `/api/v1/topics/{id}/subtitles?format=srt\|vtt&part=1` | như trên | Phụ đề theo clip |
| POST | `/api/video/cut` (mở rộng) | Chủ video | Thêm `burnSubtitles`, `subtitleStyle`, `exportSoftSubtitles` |

```json
// POST /api/video/cut (phần thêm)
{ "burnSubtitles": true, "subtitleStyle": "boxed", "exportSoftSubtitles": true }
// response job status có thêm
{ "warnings": [ "Đã chuyển sang chế độ cắt chính xác để ghi phụ đề" ] }
```

### 6.3 Backend (Spring Boot)

- `service/SubtitleService.java`: đọc câu và `words_json` từ DB, gọi hàm chia cue. Đề xuất **viết bằng Java** để khỏi gọi Python (hàm thuần, ~150 dòng). Nếu nhóm muốn giữ một nguồn ở Python, gọi `cli --export-subtitles`. Xem Câu hỏi mở.
- `controller/SubtitleController.java`.
- `VideoCutter`: thêm tham số `Path subtitleFile` (nullable). Khi có thì chèn `-vf subtitles=...`. Escape đường dẫn: trên Windows phải escape `:` và `\`.
- `BatchVideoCutService`: trước khi cắt mỗi clip, sinh `.srt` cho clip theo FR-4 vào thư mục tạm, truyền cho `VideoCutter`.
- Kiểm tra lúc khởi động: chạy `ffmpeg -filters` để xem có `subtitles` không, lưu kết quả vào một biến cờ. Nếu không có mà người dùng yêu cầu ghi cứng → `422 { code: "FFMPEG_NO_LIBASS" }`.

### 6.4 AI pipeline (Python)

- `whisper_service.py` dòng 234: `word_timestamps=True`. Chuyển `segment.words` thành `Word` cho từng câu.
- `post_processor.merge_fragmented_segments` ([dòng 273](../../../backend/ai/post_processor.py)): khi gộp hoặc tách câu thì **gộp hoặc tách luôn `words`** theo đúng câu (hiện chỉ nội suy theo text).
- `models.py`: thêm tham số xuất `include_words` (mặc định `False` để file `transcripts/*.json` gọn). `--analyze-backend` xuất có `words`.
- `groq_service.py`: gửi `timestamp_granularities[]=word` nếu API hỗ trợ; không hỗ trợ thì theo FR-3.

### 6.5 Frontend (Next.js)

- `ExportProgressModal.tsx` / popup cắt: thêm ô chọn "Ghi phụ đề vào video", chọn kiểu, và "Kèm tệp .srt".
- `VideoPlayerPreview.tsx`: nút CC bật/tắt phụ đề xem trước bằng `<track kind="subtitles" src="/api/v1/videos/{id}/subtitles?format=vtt">`.
- Menu "Xuất" có thêm mục "Phụ đề (.srt / .vtt)".

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* câu 30 từ dài 12s có mốc từng từ. *When* chia cue. *Then* mọi cue ≤ 7s, ≤ 2 dòng, ≤ 42 ký tự/dòng.
- **AC-2** — *Given* clip `[100s, 160s]`, padding 0,3s/0,5s. *Then* cue đầu tiên của `.srt` theo clip có mốc ≥ `00:00:00,000` và cue nằm ngoài khoảng không xuất hiện.
- **AC-3** — Tệp `.srt` được VLC và YouTube Studio nhận không lỗi; tiếng Việt hiển thị đủ dấu.
- **AC-4** — *Given* ghi cứng style `boxed`. *Then* chụp khung hình ở giây 5 thấy phụ đề có nền tối, đủ dấu (kiểm tra thủ công + so sánh ảnh).
- **AC-5** — Độ lệch trung bình giữa `start` của cue và lúc từ đầu tiên thật sự được nói ≤ 0,3s trên 50 cue lấy mẫu (khi có mốc từng từ).
- **AC-6** — *Given* ffmpeg không có libass. *When* yêu cầu ghi cứng. *Then* trả `422 FFMPEG_NO_LIBASS` với thông báo tiếng Việt, phụ đề mềm vẫn xuất được.

## 8. Kế hoạch kiểm thử (TDD)

JUnit (`SubtitleServiceTest`):
- `buildCues_respectsMaxDurationAndChars()`
- `buildCues_breaksOnLongPause()`
- `buildCues_splitsTwoLinesNearMiddlePreferComma()`
- `buildCues_withoutWords_isApproximate()`
- `clipCues_shiftsByPaddedStartAndClips()`
- `toSrt_formatsCommaMilliseconds()` / `toVtt_formatsDotMilliseconds()`

`VideoCutterTest`:
- `buildCommand_withSubtitle_addsSubtitlesFilter()`
- `buildCommand_windowsPath_escapesColon()`
- `fastModeWithBurn_switchesToAccurate()`

pytest:
- `test_whisper_words_attached_to_sentences()` (mock model)
- `test_merge_fragmented_segments_keeps_words_aligned()`
- `test_transcript_export_include_words_flag()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Bật `word_timestamps` làm Whisper chậm hơn ~10–20% | Analyze lâu hơn | Chấp nhận; đo bằng F15 |
| Bản ffmpeg trong `imageio-ffmpeg` hoặc trên Windows thiếu libass | Không ghi cứng được | Kiểm tra lúc khởi động; ghi rõ yêu cầu trong Docker (F14) |
| Font không có trên máy chủ nên dấu hiện ô vuông | Phụ đề lỗi | Đóng gói font, truyền `fontsdir=` |

## 10. Câu hỏi mở

- [ ] Thuật toán chia cue đặt ở Java hay Python (tránh có hai bản)?
- [ ] Font chính thức dùng gì? Cần trưởng nhóm duyệt nguồn và giấy phép.
- [ ] Có cho người dùng sửa từng cue không, hay chỉ sửa qua transcript (F32)?
