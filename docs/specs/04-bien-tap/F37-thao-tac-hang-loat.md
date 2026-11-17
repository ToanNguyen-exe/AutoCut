# F37 — Thao tác hàng loạt

| Mục | Giá trị |
|---|---|
| **Mã** | F37 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV4 (Web Studio) — chủ yếu frontend; SV3 hỗ trợ phần render đoạn được chọn |
| **Phụ thuộc** | F31 (`lib/segmentOps.ts`, `commit()` của lịch sử Undo). F33 (đoạn bị bỏ được đánh dấu `DISCARDED`). |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Premiere Pro / DaVinci (chọn nhiều clip trên timeline), Google Sheets (Shift/Ctrl chọn dòng), Descript (bulk delete scenes) |

## 1. Bối cảnh & vấn đề

- Chỉ chọn được **một** đoạn tại một thời điểm, qua `activeSegmentId: string | undefined` ([page.tsx:293](../../../frontend/src/app/page.tsx#L293)).
- `ReviewTable` chỉ thao tác được trên từng dòng: đổi section, sửa tên, xoá kèm `confirm()`, gộp với đoạn kế ([ReviewTable.tsx:47-110](../../../frontend/src/components/ReviewTable.tsx#L47-L110)). Video 2 giờ có khoảng 40 đoạn. Muốn đổi 10 đoạn sang "Bài tập" thì phải bấm 10 lần.
- Logic gộp đoạn bị **viết lặp 3 lần** và mỗi bản cho kết quả khác nhau:
  - `ReviewTable.handleMergeNext` ([:87](../../../frontend/src/components/ReviewTable.tsx#L87)) có cập nhật `end_id`.
  - `page.tsx handleMergeSegments` ([:1406](../../../frontend/src/app/page.tsx#L1406)) **không** cập nhật `end_id`, đổi `id` thành `${s1.id}_merged`, và có đánh lại `topic_no`.
  - Chỗ tách đoạn ở `StudioTimeline` ([:218](../../../frontend/src/components/StudioTimeline.tsx#L218)).
- Tên thư mục section được tính theo hai kiểu khác nhau: `capitalizeFirstLetter(slugify(...))` ở [ReviewTable.tsx:67-69](../../../frontend/src/components/ReviewTable.tsx#L67-L69) và `slugify(...)` ở [TranscriptScenesPanel.tsx:307](../../../frontend/src/components/TranscriptScenesPanel.tsx#L307). Cùng một đoạn có thể ra hai tên thư mục.
- Danh sách section bị viết cứng `SECTION_OPTIONS` ([ReviewTable.tsx:24-32](../../../frontend/src/components/ReviewTable.tsx#L24-L32)), trong khi `config.yaml` đã có `segmentation.section_labels`. Đổi section cũng không cập nhật `section_no`.

## 2. Mục tiêu
- Cho **chọn nhiều đoạn** trên cả `ReviewTable` và `StudioTimeline`. Hai nơi dùng chung một vùng chọn.
- Thanh công cụ hàng loạt gồm: Gộp, Đổi section, Bỏ (discard) / Khôi phục, Dời thời gian, Đánh số lại, Đổi tên theo mẫu, Render đoạn đã chọn, Xuất JSON đoạn đã chọn.
- Gom mọi phép biến đổi segment về `lib/segmentOps.ts` (bắt đầu từ F31) để chỉ còn một nguồn logic.

### Ngoài phạm vi
- Thao tác hàng loạt trên **nhiều video** cùng lúc. F36 có chia sẻ hàng loạt, F46 có thống kê.
- Kéo thả để đổi thứ tự đoạn.

## 3. User stories
- Là trợ giảng, tôi Shift+click chọn đoạn 12 tới 18 rồi chọn "Đổi section → Bài tập".
- Là trợ giảng, tôi chọn 5 đoạn "Ngoài lề" rồi nhấn Delete, cả 5 đoạn bị bỏ cùng lúc và một lần Ctrl+Z khôi phục cả 5.
- Là giảng viên, tôi chỉ muốn render lại 3 đoạn vừa sửa thay vì render cả bài.

## 4. Yêu cầu chức năng
- **FR-1 Mô hình chọn.** `selection: { ids: Set<string>; anchorId: string | null }` đặt ở `page.tsx`. Đoạn "đang hoạt động" (`activeSegmentId`) vẫn giữ để điều khiển playhead.
- **FR-2 Cách chọn** (giống nhau trên bảng và timeline):

| Thao tác | Kết quả |
|---|---|
| Click | Chọn đúng 1 đoạn (bỏ các đoạn khác). Đoạn này thành anchor |
| `Ctrl/⌘+Click` | Thêm hoặc bỏ 1 đoạn khỏi vùng chọn |
| `Shift+Click` | Chọn liên tục từ anchor tới đoạn được click |
| Checkbox ở đầu dòng (bảng) | Giống `Ctrl+Click` |
| Checkbox ở tiêu đề bảng | Chọn hoặc bỏ chọn tất cả đoạn đang hiển thị |
| `Ctrl/⌘+A` (khi focus nằm trong studio) | Chọn tất cả |
| `Esc` | Bỏ chọn |
| `Shift+↑/↓` | Mở rộng vùng chọn |

- **FR-3 Thanh công cụ hàng loạt** hiện khi đã chọn từ 2 đoạn trở lên, nổi ở đáy màn hình, ghi "Đã chọn N đoạn · tổng MM:SS".

| Hành động | Điều kiện | Kết quả | Nhãn Undo |
|---|---|---|---|
| **Gộp** | Các đoạn **liền kề** và cùng section | 1 đoạn từ `min(start)` tới `max(end)`, `start_id` của đoạn đầu, `end_id` của đoạn cuối, tiêu đề là tiêu đề đoạn đầu (sửa được ngay sau khi gộp) | "Gộp N đoạn" |
| **Đổi section** | — | Đặt `section` và `section_no` theo danh sách từ `config.yaml`, tính lại `parts` | "Đổi section N đoạn → Bài tập" |
| **Bỏ** (`Delete`) | — | Đánh dấu bỏ (F33 `DISCARDED`), hiện mờ và gạch ngang. Không xoá khỏi mảng | "Bỏ N đoạn" |
| **Khôi phục** | Có đoạn đang bị bỏ trong vùng chọn | Bỏ đánh dấu | "Khôi phục N đoạn" |
| **Dời thời gian** | — | Hộp thoại nhập ±giây (bước 0,1). Dời cả `start` và `end`. Chặn nếu kết quả < 0, vượt `duration`, hoặc chồng lên đoạn không được chọn | "Dời N đoạn +0,5s" |
| **Đổi tên theo mẫu** | — | Mẫu có biến `{n}` (thứ tự trong vùng chọn), `{topic}` (tên cũ), `{section}`. Ví dụ `Bài tập {n}` | "Đổi tên N đoạn" |
| **Đánh số lại** | — | Đánh lại `topic_no` theo thứ tự thời gian, trong từng section | "Đánh số lại" |
| **Render đã chọn** | Mọi đoạn đã chọn không bị bỏ | Gọi `/cut` chỉ với các đoạn này (6.2) | Không ghi lịch sử |
| **Xuất JSON** | — | Tải `segments_<lesson>_selected.json` | Không ghi lịch sử |

- **FR-4** Mỗi hành động hàng loạt chỉ gọi `commit()` **một lần**, nên một lần Ctrl+Z hoàn tác cả lô.
- **FR-5** Hành động "Bỏ" không hỏi `confirm()` nữa, vì đã có Undo và toast "Đã bỏ 5 đoạn — [Hoàn tác]" hiện trong 6 giây.
- **FR-6** Khi gộp các đoạn không liền kề hoặc khác section, nút Gộp bị tắt và tooltip nêu lý do.
- **FR-7** Section lấy từ `GET /api/video/config` (đã có, [VideoController.java:693](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L693)), trường `segmentation.section_labels`. Nếu không lấy được thì dùng `SECTION_OPTIONS` hiện tại làm dự phòng.

## 5. Yêu cầu phi chức năng
- Mỗi thao tác trên 200 đoạn chạy dưới 50 ms.
- Mọi hàm trong `segmentOps.ts` là **hàm thuần**: không đổi dữ liệu đầu vào và trả mảng mới.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không thay đổi (dùng `topics.status` của F33).

### 6.2 API
Không thêm endpoint mới. Dùng lại `POST /api/video/cut` ([VideoController.java:1540](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1540), `CutRequestDTO` ở [Models.java:130-136](../../../backend/src/main/java/com/autocut/dto/Models.java#L130-L136)) và chỉ gửi các đoạn đã chọn trong `segments`.

**Cần kiểm tra và sửa:** `BatchVideoCutService` không được xoá clip cũ của những đoạn **không** có trong request (nếu hiện đang dọn cả thư mục `outputDir`). Viết test `cut_subset_keepsExistingClipsOfOtherTopics`.

### 6.3 Backend
- **Sửa** (chỉ khi test trên đỏ): `BatchVideoCutService`, chỉ ghi đè tệp của các topic có trong request.

### 6.5 Frontend
**`lib/segmentOps.ts`** (do F31 tạo, F37 bổ sung):
```ts
export function mergeSegments(segs: Segment[], ids: string[]): Segment[];            // throws MergeError
export function setSection(segs: Segment[], ids: string[], label: string, sectionNo: number): Segment[];
export function setDiscarded(segs: Segment[], ids: string[], discarded: boolean): Segment[];
export function shiftSegments(segs: Segment[], ids: string[], deltaSec: number, duration: number): Segment[]; // throws ShiftError
export function renameByTemplate(segs: Segment[], ids: string[], template: string): Segment[];
export function renumberTopics(segs: Segment[]): Segment[];
export function sectionFolderName(sectionNo: number, label: string): string;          // MỘT cách đặt tên duy nhất
export function canMerge(segs: Segment[], ids: string[]): { ok: true } | { ok: false; reason: string };
```
- `types/index.ts`: thêm `Segment.discarded?: boolean`. Khi lưu (F33), trường này được chuyển thành `status`.
- **Mới** `lib/selection.ts`: hàm thuần `applyClick(selection, orderedIds, clickedId, { ctrl, shift }) → Selection`.
- **Mới** `components/BulkActionBar.tsx`, `components/ShiftTimeDialog.tsx`, `components/RenameTemplateDialog.tsx`.
- **Sửa** `ReviewTable.tsx`:
  - Thêm cột checkbox. Props mới `selectedIds`, `onSelectionChange`.
  - Thay `handleMergeNext`, `handleDelete` và logic `sectionFolder` bằng các hàm trong `segmentOps`.
  - Bỏ `SECTION_OPTIONS` viết cứng (FR-7).
- **Sửa** `StudioTimeline.tsx`: nhận `selectedIds`, vẽ viền cho đoạn được chọn, xử lý Ctrl/Shift+Click.
- **Sửa** `TranscriptScenesPanel.tsx` ([:307](../../../frontend/src/components/TranscriptScenesPanel.tsx#L307)): dùng `sectionFolderName`.
- **Sửa** `page.tsx`: `handleMergeSegments` ([:1406](../../../frontend/src/app/page.tsx#L1406)) gọi `mergeSegments`. Đăng ký phím `Ctrl+A`, `Esc`, `Delete` qua keymap của F31.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* có 40 đoạn, *When* click đoạn 12 rồi Shift+Click đoạn 18, *Then* đã chọn 7 đoạn, thanh công cụ ghi "Đã chọn 7 đoạn".
- **AC-2** — *When* chọn "Đổi section → Bài tập", *Then* 7 đoạn có `section="Bài tập"` và `section_no` đúng theo `config.yaml`. Nhấn Ctrl+Z **một lần** thì cả 7 đoạn trở về như cũ.
- **AC-3** — *Given* chọn đoạn 3 và 5 (không liền kề), *Then* nút Gộp bị tắt, tooltip ghi "Chỉ gộp được các đoạn liền kề".
- **AC-4** — *Given* gộp đoạn 3, 4, 5, *Then* đoạn mới có `start_id` của đoạn 3, `end_id` của đoạn 5, và `topic_no` các đoạn sau được đánh lại liên tục.
- **AC-5** — *Given* dời +2 giây làm đoạn cuối vượt `duration`, *Then* hiện lỗi "Đoạn 'Tổng kết' sẽ vượt quá cuối video" và dữ liệu không thay đổi.
- **AC-6** — *When* chọn 3 đoạn rồi bấm "Render đã chọn", *Then* request `/cut` có đúng 3 segments. Clip của các đoạn khác trong thư mục output vẫn còn.
- **AC-7** — Cùng một đoạn, tên thư mục section tính ở `ReviewTable` và `TranscriptScenesPanel` giống hệt nhau.
- **AC-8** — Tìm `grep -rn "recalculateParts(" frontend/src/components` thì chỉ còn kết quả nằm trong `lib/segmentOps.ts` (component không tự tính `parts` nữa).

## 8. Kế hoạch kiểm thử (TDD)
`segmentOps.test.ts`, viết trước:
- `mergeSegments_contiguous_setsStartEndIdsAndRenumbers`
- `mergeSegments_nonContiguous_throws`
- `mergeSegments_differentSection_throws`
- `setSection_updatesSectionNoAndParts`
- `setDiscarded_doesNotRemoveFromArray`
- `shiftSegments_negativeResult_throws`
- `shiftSegments_overlapUnselected_throws`
- `renameByTemplate_replacesNTopicSection`
- `renumberTopics_perSection_sequential`
- `sectionFolderName_isStable` (snapshot test cho 7 nhãn section tiếng Việt)
- `inputNotMutated` (chạy mọi hàm, kiểm tra `Object.freeze` trên input không gây lỗi)

`selection.test.ts`:
- `click_selectsOnly`
- `ctrlClick_toggles`
- `shiftClick_rangeFromAnchor`
- `shiftClick_noAnchor_actsAsClick`

Backend: `BatchVideoCutServiceTest.cut_subset_keepsExistingClipsOfOtherTopics`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Đổi cách đặt tên thư mục section | Clip đã render trước đó nằm ở thư mục cũ, tải ZIP bị thiếu | Ghi rõ trong ghi chú phát hành. Lần render tới tạo thư mục mới, có tuỳ chọn dọn thư mục cũ |
| Ctrl+A chọn toàn bộ chữ trên trang | Gây khó chịu | Chỉ chặn mặc định khi focus nằm trong vùng studio và không phải ô nhập |
| Gộp nhiều đoạn tạo đoạn quá dài | Clip dài bất thường | Cảnh báo (không chặn) khi đoạn sau khi gộp dài hơn `duration.max_duration` nếu cấu hình có giá trị này > 0 |

## 10. Câu hỏi mở
- [ ] Tên đoạn sau khi gộp: giữ tên đoạn đầu (đề xuất) hay nối "A & B" như hiện tại?
- [ ] Cách đặt tên thư mục section chuẩn là kiểu nào: `02_LyThuyet` (ReviewTable) hay `02_ly-thuyet` (TranscriptScenesPanel)? Cần khớp với `output.section_folder_template` trong `config.yaml` và `PathSlugifier.java` ở backend.
- [ ] "Render đã chọn" có cần qua bước duyệt của F35 không?
