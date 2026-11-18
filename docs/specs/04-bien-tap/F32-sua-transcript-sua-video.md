# F32 — Sửa transcript là sửa video

| Mục | Giá trị |
|---|---|
| **Mã** | F32 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV4 (giao diện) + SV1 (ghép đoạn khi render) + SV3 (API/DB) |
| **Phụ thuộc** | F00 (videoId ở frontend, job cắt ghi `video_parts`), F31 (lịch sử Undo dùng chung), F13 (Flyway), F02 (kiểm tra quyền), F09 (job cắt). Dùng chung `edit_ranges` + `KeepRanges` với F25 (AD-13) |
| **Ước lượng** | XL (> 2 tuần). Nên chia 3 PR: (1) DB + API + `KeepRanges`; (2) render một lệnh `filter_complex`; (3) giao diện TranscriptEditor + xem trước |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Descript (Text-based editing), Riverside Magic Editor, Adobe Premiere Text-Based Editing |

> **Cập nhật 18/11/2026:** theo AD-13, dùng một hàm `KeepRanges` và render bằng một lệnh `filter_complex` (thay cho cắt từng mảnh rồi ghép); `PUT` chỉ thay các dòng `source='USER'`; render đi qua job cắt với `videoId`/`topicId` (F00) thay vì `/render`; sửa AC-1 cho tính cả padding; xử lý topic có nhiều part; nâng ước lượng lên XL.

## 1. Bối cảnh & vấn đề

- Transcript hiện chỉ để đọc và nhảy tới vị trí. Bấm vào một câu chỉ gọi `onSeek(sent.start)` ([TranscriptScenesPanel.tsx:655-663](../../../frontend/src/components/TranscriptScenesPanel.tsx#L655-L663), [:809](../../../frontend/src/components/TranscriptScenesPanel.tsx#L809)). Người dùng không sửa được câu chữ, cũng không xoá được câu.
- Dữ liệu đã có thời gian đến từng từ: `Sentence.words?: WordInfo[]` ([types/index.ts:1-14](../../../frontend/src/types/index.ts#L1-L14)), cột `transcripts.words_json JSONB` ([schema.sql](../../../database/schema.sql)). Như vậy đủ dữ liệu để biết khi xoá một câu hay một từ thì phải cắt đoạn video nào.
- Mỗi clip hiện chỉ được cắt thành **một khoảng liền** `[start, end]`:
  - `VideoCutter.cut(...)` nhận đúng một cặp start/end ([VideoCutter.java:155-221](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L155-L221)).
  - Lệnh FFmpeg được dựng trong `buildCommand` ([VideoCutter.java:337](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L337)) và **luôn mã hoá lại** bằng libx264. Java **chưa đọc** `output.cut_mode` trong `config.yaml`.

  Muốn bỏ một đoạn ở giữa clip thì phải dựng lệnh có nhiều khoảng.
- Có hai đường render, cả hai đều **không có `videoId`**:
  - `POST /render` ([VideoController.java:1414](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1414)) nhận `Map`, tìm video theo tên và tự cắt.
  - `POST /cut` dùng `CutRequestDTO` ([Models.java:130](../../../backend/src/main/java/com/autocut/dto/Models.java#L130)) và đi qua `BatchVideoCutService`.

  Vì vậy backend không biết đọc `edit_ranges` của video nào. F00 FR-7 bổ sung `videoId` và `topicId` vào `CutRequestDTO`.
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
- **FR-3 Chọn để xoá.** Bôi đen bằng chuột, có thể kéo qua nhiều câu. Đơn vị chọn nhỏ nhất là **từ** nếu câu có `words`, ngược lại là cả câu. Nhấn `Delete` để tạo một **khoảng bị bỏ** (dòng `edit_ranges` với `kind='MANUAL'`, `source='USER'`):
  - `start` lấy theo từ đầu tiên, `end` lấy theo từ cuối cùng được chọn.
  - Khoảng bị bỏ gắn theo **video**, không theo topic (đã chốt theo AD-13).
- **FR-4 Hiển thị.** Chữ thuộc khoảng bị bỏ có gạch ngang, màu `slate-400`, và nút "Khôi phục" khi rê chuột. Trên timeline ([StudioTimeline.tsx](../../../frontend/src/components/StudioTimeline.tsx)), khoảng bị bỏ được tô sọc chéo.
  - Panel hiện cả các khoảng `source='AUTO'` do F25 tạo (khác màu), nhưng spec này **không** sửa chúng. Người dùng bật/tắt các khoảng đó bằng `PATCH` của F25.
- **FR-5 Xem trước.** Khi phát, nếu `currentTime` rơi vào một khoảng bị bỏ thì player nhảy tới `range.end`. Có công tắc "Phát cả đoạn đã bỏ" để nghe lại.
- **FR-6 Gộp khoảng.** Hai khoảng bị bỏ chồng nhau hoặc cách nhau dưới 0,15 giây thì gộp làm một.
- **FR-7 Render (theo AD-13).** Render chạy trong job cắt (F09, AD-10) với `videoId` và `topicId` (F00 FR-7). Với mỗi **part** của topic (topic có thể có nhiều part khi bật `split_strategy`; mỗi part xử lý độc lập trên khoảng `[part.start, part.end]` của nó):
  1. Áp padding `padding_start`/`padding_end` vào **hai đầu part** trước, ra `[ps, pe]`.
  2. Gọi `KeepRanges.compute(ps, pe, enabledRanges, minKeep=0.3)` với **mọi** khoảng `enabled=true` của video (cả USER lẫn AUTO). Hàm này:
     - Trả về các khoảng giữ lại.
     - Với `SILENCE` thì giữ `keep_seconds` chia đều hai bên.
     - Mảnh giữ lại ngắn hơn `minKeep` thì gộp vào khoảng bị cắt bên cạnh.
  3. Nếu chỉ có 1 khoảng giữ lại thì dùng lệnh cắt như hiện tại. Nếu có từ 2 khoảng trở lên thì `VideoCutter` dựng **một lệnh** `filter_complex`: mỗi khoảng một cặp `trim`/`atrim` + `setpts`/`asetpts`, có `afade` 10 ms ở mỗi mối nối, rồi `concat=n=K:v=1:a=1`. Mã hoá lại bằng libx264 + aac (giống `buildCommand` hiện tại). Không cắt nhiều tệp rồi ghép.
- **FR-8 Lưu.** Khoảng bị bỏ được lưu qua `PUT /edit-ranges` (6.2). `PUT` **chỉ thay các dòng `source='USER'`** của video; các dòng `source='AUTO'` (F25) giữ nguyên. Chữ đã sửa được lưu vào bảng `transcripts`.
- **FR-10 Clip cũ.** Khi danh sách khoảng bị bỏ thay đổi trong phạm vi một topic đã render, các `video_parts` của topic đó chuyển `STALE` (F00).
- **FR-9 Undo.** Thao tác sửa chữ, xoá và khôi phục đều đi qua `commit()` của F31. Nhãn ví dụ: "Xoá 12 từ (02:31–02:36)".

## 5. Yêu cầu phi chức năng
- Transcript 2 giờ có khoảng 2.000 câu. Panel phải cuộn mượt nên dùng ảo hoá danh sách (virtualization: chỉ vẽ các câu đang hiện trên màn hình) tự viết. Không thêm thư viện.
- Thời gian nhảy qua đoạn bị bỏ khi xem trước dưới 150 ms. Dùng sự kiện `timeupdate` kết hợp `requestAnimationFrame`.
- Mối nối khi render không được lệch tiếng so với hình quá 40 ms. Dùng một lệnh `filter_complex` mã hoá lại (AD-13) để đảm bảo điều này. Một topic có 20 khoảng bị bỏ vẫn chỉ chạy một tiến trình FFmpeg.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__edit_ranges_and_transcript_edit.sql`
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
| GET | `/edit-ranges` | Xem video (`video_access` bất kỳ) | Danh sách khoảng bị bỏ, cả USER lẫn AUTO |
| PUT | `/edit-ranges` | `OWNER` / `EDITOR` | Thay toàn bộ các dòng **`source='USER'`** của video (idempotent). Không đụng dòng AUTO |
| PATCH | `/transcripts/{sentenceId}` | `OWNER` / `EDITOR` | Sửa chữ một câu |

`PATCH /edit-ranges` (bật/tắt theo `ids` hoặc `kind`) do F25 định nghĩa, dùng chung controller.

Theo AD-2: người không có quyền xem video thì nhận 404 `VIDEO_NOT_FOUND`; người chỉ có quyền xem (`VIEWER`/`REVIEWER`) gọi `PUT`/`PATCH` thì nhận 403 `FORBIDDEN_ACTION`.

```json
// PUT /api/v1/videos/42/edit-ranges
{ "ranges": [ { "start": 151.32, "end": 156.80, "note": "mở máy chiếu" } ] }
// Backend tự gán kind='MANUAL', source='USER'. Gửi kind/source khác sẽ bị bỏ qua.
// 200
{ "videoId": 42, "userRanges": 1, "autoRangesKept": 37, "totalRemovedSeconds": 5.48, "staleParts": 1 }
// 422 khi range sai
{ "error": { "code": "EDIT_RANGE_INVALID", "message": "Khoảng cắt có end <= start hoặc vượt thời lượng video", "details": { "index": 0 } } }
```
```json
// PATCH /api/v1/videos/42/transcripts/S0123
{ "text": "Hôm nay ta học JavaScript", "dropWords": true }
// 200
{ "sentenceId": "S0123", "text": "Hôm nay ta học JavaScript", "edited": true, "originalText": "Hôm nay ta học giây ta" }
```

Render: job cắt (`POST /cut`, `CutRequestDTO` đã có `videoId`/`topicId` theo F00 FR-7) **luôn đọc `edit_ranges` từ DB** theo `videoId`. Payload không gửi kèm khoảng bị bỏ, để tránh hai nguồn sự thật. `POST /render` cũ ([VideoController.java:1414](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1414)) **không** hỗ trợ khoảng bị bỏ; frontend chuyển sang `/cut`.

### 6.3 Backend
- **Mới** `entity/EditRangeEntity.java`, `repository/EditRangeRepository.java`.
- **Mới** `video/KeepRanges.java` (dùng chung với F25, AD-13; spec nào merge trước thì tạo):
  - `List<double[]> compute(double start, double end, List<EditRange> enabledRanges, double minKeep)`. Hàm thuần, là trọng tâm để viết test. Xử lý `keep_seconds` của `SILENCE`, gộp khoảng chồng nhau hoặc cách nhau dưới 0,15 giây (FR-6), gộp mảnh giữ lại ngắn hơn `minKeep` vào khoảng cắt bên cạnh.
- **Mới** `service/TranscriptEditService.java` (cho `PATCH /transcripts/{sentenceId}`): sau khi lưu chữ mới trong transaction, gọi hai hook phụ thuộc mềm (chưa có spec tương ứng thì bỏ qua, dùng `ObjectProvider`):
  - `TranslationService.markStale(videoId, changedSentenceIds)` của F24, để đánh dấu bản dịch của câu đó là cũ.
  - Ghi sự kiện `TRANSCRIPT_EDITED` vào `edit_events` của F27 bằng `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`, với `dedupe_key = 'TRANSCRIPT_EDITED:' || videoId || ':' || sentenceId || ':' || sha256(text_mới)` (AD-8).
- **Mới** `service/EditRangeService.java`: `replaceUserRanges(videoId, ranges)`. Kiểm tra `0 ≤ start < end ≤ video.duration`, chuẩn hoá theo FR-6. Trong một transaction: `DELETE FROM edit_ranges WHERE video_id=? AND source='USER'` rồi `INSERT` danh sách mới. Sau đó đánh dấu `STALE` các part bị ảnh hưởng (FR-10).
- **Sửa** `BatchVideoCutService` ([BatchVideoCutService.java](../../../backend/src/main/java/com/autocut/service/BatchVideoCutService.java)): với mỗi part, tính `[ps, pe]` có padding rồi gọi `KeepRanges.compute`. Truyền danh sách khoảng giữ lại cho `VideoCutter`.
- **Sửa** `VideoCutter`: thêm `cutKeepRanges(File in, File out, List<double[]> keep)`. Nếu `keep.size()==1` thì gọi `cut` hiện có, ngược lại dựng lệnh `filter_complex` (FR-7). Ví dụ với 2 khoảng giữ:
  ```
  ffmpeg -y -i in.mp4 -filter_complex \
   "[0:v]trim=start=99.7:end=150,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=99.7:end=150,asetpts=PTS-STARTPTS,afade=t=out:st=50.29:d=0.01[a0];\
    [0:v]trim=start=160:end=200.5,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=160:end=200.5,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01[a1];\
    [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
   -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 22 -c:a aac -movflags +faststart out.mp4
  ```
  Lưu ý: dùng `-i` không kèm `-ss` khi có `trim` để mốc thời gian tính từ đầu tệp. Với video dài, đặt `-ss` ở trước `-i` bằng `ps - 1` rồi trừ tương ứng trong `trim` để tua nhanh. Hàm `buildKeepRangesCommand` là hàm thuần để test.
- **Sửa** `SegmentPersistenceService.saveTranscriptToDatabase` ([SegmentPersistenceService.java:165](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L165)): hàm này đang xoá hết rồi ghi lại. Phải giữ lại các câu có `edited=true` khi chạy analyze lại, hoặc hỏi người dùng trước khi ghi đè.

### 6.5 Frontend
- **Mới** `lib/editRanges.ts`: `mergeRanges`, `isInCut(t, ranges)`, `nextPlayableTime(t, ranges)`, `rangeFromSelection(sentences, selection)`. Bản TypeScript của `computeKeepRanges` có cùng bộ test với Java.
- **Mới** `components/TranscriptEditor.tsx`: tách phần render transcript ra khỏi `TranscriptScenesPanel.tsx` (tệp này đang 865 dòng). Mỗi từ là một `<span data-start data-end>`. Dùng `window.getSelection()` để biết người dùng chọn từ nào đến từ nào.
- **State:** thêm `editRanges: EditRange[]` (chỉ các dòng `source='USER'`) vào trạng thái lịch sử của F31, nghĩa là `HistoryState.present` đổi thành `{ segments, editRanges }`. Các dòng AUTO giữ trong state riêng, không vào lịch sử. Tên trường thống nhất là `editRanges` ở mọi spec (F33, F34).
- **videoId:** lấy từ state dự án theo F00 FR-1.
- **Sửa** `VideoCanvasViewport.tsx` ([:268](../../../frontend/src/components/VideoCanvasViewport.tsx#L268)): trong `onTimeUpdate`, nếu `isInCut` thì đặt `video.currentTime = nextPlayableTime(...)`.
- **Sửa** `StudioTimeline.tsx`: vẽ lớp phủ sọc chéo cho các khoảng bị bỏ.
- **Sửa** `SegmentDetailModal`: hiện "Thời lượng sau khi bỏ: 06:12 (đã bỏ 00:48)".

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* topic `[100, 200]`, `padding_start=0.3`, `padding_end=0.5` và khoảng bị bỏ `[150, 160]`, *When* render, *Then* tệp mp4 dài **90,8 ± 0,3 giây** (khoảng giữ `[99,7; 150]` + `[160; 200,5]`), đoạn 150–160 không có trong video, và FFmpeg chỉ chạy **một** lần cho clip này.
- **AC-2** — *Given* chế độ Sửa transcript đang bật, *When* bôi đen 3 từ rồi nhấn Delete, *Then* 3 từ đó bị gạch ngang, timeline có sọc chéo đúng vị trí, và Ctrl+Z khôi phục được.
- **AC-3** — *Given* có khoảng bị bỏ `[150, 160]`, *When* phát từ giây 148, *Then* player nhảy tới khoảng giây 160 và không phát tiếng của đoạn 150–160.
- **AC-4** — *When* sửa chữ câu S0123 rồi F5, *Then* chữ mới vẫn còn, có biểu tượng "đã sửa tay", và `original_text` giữ nội dung cũ.
- **AC-5** — *Given* gửi `PUT /edit-ranges` với `end > video.duration`, *Then* nhận 422 `EDIT_RANGE_INVALID`.
- **AC-8** — *Given* video có 37 khoảng `source='AUTO'` của F25 và 2 khoảng USER, *When* `PUT` một danh sách 1 khoảng, *Then* còn 37 AUTO + 1 USER.
- **AC-9** — *Given* user có `video_access` = `VIEWER`, *When* gọi `PUT /edit-ranges`, *Then* nhận 403 `FORBIDDEN_ACTION`. *Given* user không có quyền gì trên video, *Then* nhận 404.
- **AC-10** — *Given* topic có 2 part `[100,160]` và `[160,220]`, khoảng bị bỏ `[150,170]`, *When* render, *Then* part 1 là `[ps,150]`, part 2 là `[170,pe]`, mỗi part một tệp.
- **AC-6** — *Given* câu không có `words`, *When* bôi đen một phần câu, *Then* hệ thống mở rộng vùng chọn ra cả câu và báo "Câu này chưa có thời gian từng từ, sẽ xoá cả câu".
- **AC-7** — Transcript 2.000 câu cuộn không giật trên laptop tầm trung (không có frame nào vẽ quá 50 ms trong Chrome Performance).

## 8. Kế hoạch kiểm thử (TDD)
Backend (JUnit), viết trước:
- `KeepRangesTest` (bộ test chung với F25)
  - `noCuts_returnsWholeRange`
  - `cutInMiddle_returnsTwoRanges`
  - `cutCoversStart_trimsStart`
  - `overlappingCuts_merged`
  - `pieceShorterThanMinKeep_mergedIntoAdjacentCut`
  - `silence_keepSecondsSplitEvenly`
  - `disabledRange_ignored`
- `EditRangeServiceTest`
  - `replaceUserRanges_endBeyondDuration_throwsInvalid`
  - `replaceUserRanges_keepsAutoRows`
  - `replaceUserRanges_marksAffectedPartsStale`
- `VideoCutterTest`
  - `buildKeepRangesCommand_twoRanges_singleFilterComplexWithConcatN2`
  - `cutKeepRanges_oneRange_usesExistingCut`
- `BatchVideoCutServiceTest`
  - `cutPart_withInnerCut_paddingOnlyAtPartEdges`
  - `cutTopic_twoParts_eachPartComputedIndependently`
- `TranscriptEditControllerTest` (MockMvc)
  - `patchSentence_updatesTextAndKeepsOriginal`
  - `patchSentence_callsMarkStaleAndRecordsEditEventOnce` (gửi 2 lần cùng nội dung chỉ tạo 1 sự kiện)
  - `putEditRanges_viewer_returns403`
  - `putEditRanges_noAccess_returns404` (AD-2)
- `SegmentPersistenceServiceTest`
  - `saveTranscript_reanalyze_keepsEditedSentences`

Frontend:
- `editRanges.test.ts`: `mergeRanges_gapUnder150ms_merges`, `nextPlayableTime_insideCut_returnsCutEnd`, `rangeFromSelection_wordLevel`, `rangeFromSelection_noWords_expandsToSentence`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Thời gian từng từ của Whisper lệch 100–300 ms | Cắt lẹm âm đầu/cuối của từ kế bên | Nới mỗi khoảng bị bỏ vào trong 50 ms. Dùng `SilenceSnapCut` để bám vào chỗ im lặng gần nhất |
| Mối nối gây tiếng "bụp" | Nghe khó chịu | `afade` 10 ms ở mỗi mối nối (FR-7) |
| Chuỗi `filter_complex` quá dài khi có hàng trăm khoảng | FFmpeg lỗi | Nếu > 100 khoảng giữ thì ghi `filter_complex` ra tệp và dùng `-filter_complex_script` |
| Analyze lại ghi đè chữ đã sửa | Mất công người dùng | Giữ lại câu có `edited` (6.3), hỏi xác nhận trước |
| Nhảy qua đoạn bị bỏ trên Safari chậm vì phải tìm keyframe | Lọt tiếng 0,2–0,5 giây | Chấp nhận khi xem trước. Ghi chú trong UI "Bản xem trước có thể lọt tiếng" |

## 10. Câu hỏi mở
- [x] Khoảng bị bỏ gắn theo video hay topic? **Đã chốt theo AD-13:** theo video.
- [ ] Khi topic chỉ còn dưới `duration.min_duration` (30 giây) sau khi bỏ, có cảnh báo hay chặn render?
- [ ] Sửa chữ có cần đẩy lại lên `transcripts/*.json` trong R2 không, hay chỉ cần lưu DB?
