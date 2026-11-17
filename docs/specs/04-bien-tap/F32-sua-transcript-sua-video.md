# F32 — Sửa transcript là sửa video

| Mục | Giá trị |
|---|---|
| **Mã** | F32 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV4 (giao diện) + SV1 (ghép đoạn khi render) + SV3 (API/DB) |
| **Phụ thuộc** | F31 (lịch sử Undo dùng chung), F13 (Flyway), F02 (kiểm tra quyền sở hữu video) |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Descript (Text-based editing), Riverside Magic Editor, Adobe Premiere Text-Based Editing |

## 1. Bối cảnh & vấn đề

- Transcript hiện chỉ để đọc và nhảy tới vị trí. Bấm vào một câu chỉ gọi `onSeek(sent.start)` ([TranscriptScenesPanel.tsx:655-663](../../../frontend/src/components/TranscriptScenesPanel.tsx#L655-L663), [:809](../../../frontend/src/components/TranscriptScenesPanel.tsx#L809)). Người dùng không sửa được câu chữ, cũng không xoá được câu.
- Dữ liệu đã có thời gian đến từng từ: `Sentence.words?: WordInfo[]` ([types/index.ts:1-14](../../../frontend/src/types/index.ts#L1-L14)), cột `transcripts.words_json JSONB` ([schema.sql](../../../database/schema.sql)). Như vậy đủ dữ liệu để biết khi xoá một câu hay một từ thì phải cắt đoạn video nào.
- Mỗi clip hiện chỉ được cắt thành **một khoảng liền** `[start, end]`. `VideoCutter.cut(...)` nhận đúng một cặp start/end ([VideoCutter.java:155-221](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L155-L221)). Muốn bỏ một đoạn ở giữa clip thì phải cắt thành nhiều mảnh rồi ghép lại. `VideoConcat.concat(List<File>, File)` ([VideoConcat.java:44](../../../backend/src/main/java/com/autocut/video/VideoConcat.java#L44)) đã làm được việc ghép.
- `transcripts.text` hiện chứa lỗi chính tả do Whisper. Giảng viên muốn sửa chữ để phụ đề (F23) và tìm kiếm (F30) được đúng.

## 2. Mục tiêu
- **Sửa chữ:** sửa nội dung một câu mà không ảnh hưởng tới video.
- **Xoá câu/từ:** bôi đen một câu hoặc một cụm từ rồi nhấn Delete. Đoạn video tương ứng bị bỏ khỏi clip lúc render. Khi xem trước, player tự nhảy qua đoạn đã bỏ.
- **Khôi phục:** phần đã xoá hiện gạch ngang và khôi phục được. Mọi thao tác Undo được (dùng F31).

### Ngoài phạm vi
- Chèn chữ mới để AI lồng tiếng (Overdub).
- Kéo câu để đổi thứ tự trong video.
- Tự động bỏ từ đệm. F25 làm việc này và sẽ tạo ra cùng loại dữ liệu "khoảng bị bỏ" như spec này.

## 3. User stories
- Là giảng viên, tôi muốn xoá câu "à, chờ thầy mở máy chiếu một chút" trong transcript để clip xuất ra không còn đoạn đó.
- Là biên tập viên, tôi muốn sửa "giây ta" thành "JavaScript" mà video giữ nguyên.
- Là biên tập viên, tôi muốn xem trước clip đã bỏ đoạn thừa mà không phải render.

## 4. Yêu cầu chức năng
- **FR-1 Chế độ "Sửa transcript".** Nút bật/tắt trong `TranscriptScenesPanel`. Khi tắt, panel giữ hành vi hiện tại (bấm vào câu để nhảy tới vị trí).
- **FR-2 Sửa chữ.** Nhấp đúp vào câu để sửa trong ô `textarea`. `Enter` để lưu, `Esc` để huỷ. Nếu số từ sau khi sửa khác số từ ban đầu thì bỏ `words` của câu đó (thời gian đến từng từ không còn đúng) và hiện biểu tượng "đã sửa tay".
- **FR-3 Chọn để xoá.** Bôi đen bằng chuột, có thể kéo qua nhiều câu. Đơn vị chọn nhỏ nhất là **từ** nếu câu có `words`, ngược lại là cả câu. Nhấn `Delete` để tạo một **khoảng bị bỏ (cut range)** `{start, end}`. `start` lấy theo từ đầu tiên, `end` lấy theo từ cuối cùng được chọn.
- **FR-4 Hiển thị.** Chữ thuộc khoảng bị bỏ có gạch ngang, màu `slate-400`, và nút "Khôi phục" khi rê chuột. Trên timeline ([StudioTimeline.tsx](../../../frontend/src/components/StudioTimeline.tsx)), khoảng bị bỏ được tô sọc chéo.
- **FR-5 Xem trước.** Khi phát, nếu `currentTime` rơi vào một khoảng bị bỏ thì player nhảy tới `range.end`. Có công tắc "Phát cả đoạn đã bỏ" để nghe lại.
- **FR-6 Gộp khoảng.** Hai khoảng bị bỏ chồng nhau hoặc cách nhau dưới 0,15 giây thì gộp làm một.
- **FR-7 Render.** Khi render một topic có khoảng bị bỏ nằm trong `[start, end]`:
  1. Tính các khoảng giữ lại (keep ranges) bằng cách lấy `[start, end]` trừ đi các khoảng bị bỏ.
  2. Cắt từng khoảng giữ lại với `cut_mode` hiện có. Padding chỉ áp dụng ở mép ngoài cùng của clip, không áp dụng ở các mép bên trong.
  3. Ghép các mảnh bằng `VideoConcat`.
  4. Bỏ qua mảnh giữ lại ngắn hơn 0,3 giây.
- **FR-8 Lưu.** Khoảng bị bỏ được lưu cùng dự án (API ở 6.2). Chữ đã sửa được lưu vào bảng `transcripts`.
- **FR-9 Undo.** Thao tác sửa chữ, xoá và khôi phục đều đi qua `commit()` của F31. Nhãn ví dụ: "Xoá 12 từ (02:31–02:36)".

## 5. Yêu cầu phi chức năng
- Transcript 2 giờ có khoảng 2.000 câu. Panel phải cuộn mượt nên dùng ảo hoá danh sách (virtualization: chỉ vẽ các câu đang hiện trên màn hình) tự viết. Không thêm thư viện.
- Thời gian nhảy qua đoạn bị bỏ khi xem trước dưới 150 ms. Dùng sự kiện `timeupdate` kết hợp `requestAnimationFrame`.
- Ghép mảnh khi render không được lệch tiếng so với hình quá 40 ms. Dùng chế độ `accurate` (cắt lại bằng libx264) khi topic có từ 2 mảnh trở lên.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<n>__edit_ranges_and_transcript_edit.sql`
```sql
-- Bảng edit_ranges DÙNG CHUNG với F25 (cắt từ đệm/khoảng lặng). Định nghĩa dưới đây là bản chuẩn,
-- giống hệt F25. Spec nào merge trước thì tạo bảng; spec sau chỉ dùng lại, không tạo bảng thứ hai.
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

ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS original_text TEXT;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT FALSE;
```

### 6.2 API (controller mới `TranscriptEditController`, path gốc `/api/v1/videos/{videoId}`)
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/edit-ranges` | Chủ video / Biên tập | Danh sách khoảng bị bỏ |
| PUT | `/edit-ranges` | Chủ video / Biên tập | Thay toàn bộ danh sách (idempotent: gọi nhiều lần cho cùng kết quả) |
| PATCH | `/transcripts/{sentenceId}` | Chủ video / Biên tập | Sửa chữ một câu |

```json
// PUT /api/v1/videos/42/edit-ranges
{ "ranges": [ { "start": 151.32, "end": 156.80, "kind": "MANUAL", "source": "USER", "note": "mở máy chiếu" } ] }
// 200
{ "videoId": 42, "count": 1, "totalRemovedSeconds": 5.48 }
// 422 khi range sai
{ "error": { "code": "EDIT_RANGE_INVALID", "message": "Khoảng cắt có end <= start hoặc vượt thời lượng video", "details": { "index": 0 } } }
```
```json
// PATCH /api/v1/videos/42/transcripts/S0123
{ "text": "Hôm nay ta học JavaScript", "dropWords": true }
// 200
{ "sentenceId": "S0123", "text": "Hôm nay ta học JavaScript", "edited": true, "originalText": "Hôm nay ta học giây ta" }
```

Trong payload render hiện có (`POST /render`, [VideoController.java:1415](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1415)) và `CutRequestDTO` ([Models.java:130](../../../backend/src/main/java/com/autocut/dto/Models.java#L130)), thêm trường tuỳ chọn `editRanges: [{start,end}]`. Nếu không gửi trường này, backend tự đọc từ DB theo `videoId`.

### 6.3 Backend
- **Mới** `entity/EditRangeEntity.java`, `repository/EditRangeRepository.java`.
- **Mới** `service/EditRangeService.java`:
  - `List<double[]> computeKeepRanges(double start, double end, List<EditRange> cuts, double minKeep)`. Hàm thuần, là trọng tâm để viết test. **Dùng chung với F25:** F25 gọi hàm này là `video/KeepRanges.compute`. Chỉ viết **một** hàm ở `video/KeepRanges.java`, đặt tham số `minKeep` có giá trị mặc định; cả hai spec đều gọi hàm đó. Chỉ lấy các khoảng `enabled = true`.
  - `replaceAll(videoId, ranges)`. Kiểm tra `0 ≤ start < end ≤ video.duration`, gộp các khoảng theo FR-6.
- **Sửa** `BatchVideoCutService` ([BatchVideoCutService.java](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java)): với mỗi topic, gọi `computeKeepRanges`. Nếu có từ 2 khoảng giữ lại trở lên thì `cutBatch` từng mảnh vào thư mục tạm rồi `VideoConcat.concat(...)` ra tệp cuối, sau đó xoá các mảnh tạm.
- **Sửa** `VideoCutter.calculatePaddedRange` ([VideoCutter.java:198](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L198)): thêm cờ `applyStart` và `applyEnd` để không thêm padding ở mép bên trong.
- **Sửa** `SegmentPersistenceService.saveTranscriptToDatabase` ([SegmentPersistenceService.java:165](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L165)): hàm này đang xoá hết rồi ghi lại. Phải giữ lại các câu có `edited=true` khi chạy analyze lại, hoặc hỏi người dùng trước khi ghi đè.

### 6.5 Frontend
- **Mới** `lib/editRanges.ts`: `mergeRanges`, `isInCut(t, ranges)`, `nextPlayableTime(t, ranges)`, `rangeFromSelection(sentences, selection)`. Bản TypeScript của `computeKeepRanges` có cùng bộ test với Java.
- **Mới** `components/TranscriptEditor.tsx`: tách phần render transcript ra khỏi `TranscriptScenesPanel.tsx` (tệp này đang 865 dòng). Mỗi từ là một `<span data-start data-end>`. Dùng `window.getSelection()` để biết người dùng chọn từ nào đến từ nào.
- **State:** thêm `editRanges: EditRange[]` vào trạng thái lịch sử của F31, nghĩa là `HistoryState.present` đổi thành `{ segments, editRanges }`.
- **Sửa** `VideoCanvasViewport.tsx` ([:268](../../../frontend/src/components/VideoCanvasViewport.tsx#L268)): trong `onTimeUpdate`, nếu `isInCut` thì đặt `video.currentTime = nextPlayableTime(...)`.
- **Sửa** `StudioTimeline.tsx`: vẽ lớp phủ sọc chéo cho các khoảng bị bỏ.
- **Sửa** `SegmentDetailModal`: hiện "Thời lượng sau khi bỏ: 06:12 (đã bỏ 00:48)".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* topic `[100, 200]` và khoảng bị bỏ `[150, 160]`, *When* render, *Then* tệp mp4 xuất ra dài 90 ± 0,5 giây (đã tính padding hai mép ngoài), và đoạn 150–160 không có trong video.
- **AC-2** — *Given* chế độ Sửa transcript đang bật, *When* bôi đen 3 từ rồi nhấn Delete, *Then* 3 từ đó bị gạch ngang, timeline có sọc chéo đúng vị trí, và Ctrl+Z khôi phục được.
- **AC-3** — *Given* có khoảng bị bỏ `[150, 160]`, *When* phát từ giây 148, *Then* player nhảy tới khoảng giây 160 và không phát tiếng của đoạn 150–160.
- **AC-4** — *When* sửa chữ câu S0123 rồi F5, *Then* chữ mới vẫn còn, có biểu tượng "đã sửa tay", và `original_text` giữ nội dung cũ.
- **AC-5** — *Given* gửi `PUT /edit-ranges` với `end > video.duration`, *Then* nhận 422 `EDIT_RANGE_INVALID`.
- **AC-6** — *Given* câu không có `words`, *When* bôi đen một phần câu, *Then* hệ thống mở rộng vùng chọn ra cả câu và báo "Câu này chưa có thời gian từng từ, sẽ xoá cả câu".
- **AC-7** — Transcript 2.000 câu cuộn không giật trên laptop tầm trung (không có frame nào vẽ quá 50 ms trong Chrome Performance).

## 8. Kế hoạch kiểm thử (TDD)
Backend (JUnit), viết trước:
- `EditRangeServiceTest`
  - `computeKeepRanges_noCuts_returnsWholeRange`
  - `computeKeepRanges_cutInMiddle_returnsTwoRanges`
  - `computeKeepRanges_cutCoversStart_trimsStart`
  - `computeKeepRanges_overlappingCuts_merged`
  - `computeKeepRanges_dropsPiecesShorterThanMinKeep`
  - `replaceAll_endBeyondDuration_throwsInvalid`
- `BatchVideoCutServiceTest`
  - `cutTopic_withInnerCut_callsConcatWithTwoPieces` (mock `VideoCutter`, `VideoConcat`)
  - `cutTopic_innerEdges_haveNoPadding`
- `TranscriptEditControllerTest` (MockMvc)
  - `patchSentence_updatesTextAndKeepsOriginal`
  - `putEditRanges_otherUsersVideo_returns403` (sau khi có F02)
- `SegmentPersistenceServiceTest`
  - `saveTranscript_reanalyze_keepsEditedSentences`

Frontend:
- `editRanges.test.ts`: `mergeRanges_gapUnder150ms_merges`, `nextPlayableTime_insideCut_returnsCutEnd`, `rangeFromSelection_wordLevel`, `rangeFromSelection_noWords_expandsToSentence`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Thời gian từng từ của Whisper lệch 100–300 ms | Cắt lẹm âm đầu/cuối của từ kế bên | Nới mỗi khoảng bị bỏ vào trong 50 ms. Dùng `SilenceSnapCut` để bám vào chỗ im lặng gần nhất |
| Ghép bằng stream copy gây lệch tiếng/hình hoặc khựng ở keyframe | Clip lỗi | Bắt buộc cắt lại (re-encode) khi có từ 2 mảnh trở lên (5. NFR) |
| Analyze lại ghi đè chữ đã sửa | Mất công người dùng | Giữ lại câu có `edited` (6.3), hỏi xác nhận trước |
| Nhảy qua đoạn bị bỏ trên Safari chậm vì phải tìm keyframe | Lọt tiếng 0,2–0,5 giây | Chấp nhận khi xem trước. Ghi chú trong UI "Bản xem trước có thể lọt tiếng" |

## 10. Câu hỏi mở
- [ ] Khoảng bị bỏ gắn theo **video** (dùng chung cho mọi topic) hay theo **topic**? Đề xuất: theo video, vì đơn giản hơn và F25 cũng sinh dữ liệu theo video.
- [ ] Khi topic chỉ còn dưới `duration.min_duration` (30 giây) sau khi bỏ, có cảnh báo hay chặn render?
- [ ] Sửa chữ có cần đẩy lại lên `transcripts/*.json` trong R2 không, hay chỉ cần lưu DB?
