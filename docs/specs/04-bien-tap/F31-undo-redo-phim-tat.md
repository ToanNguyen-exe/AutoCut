# F31 — Undo/Redo & phím tắt

| Mục | Giá trị |
|---|---|
| **Mã** | F31 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV4 (Web Studio & QA) |
| **Phụ thuộc** | F00 (id segment là UUID ổn định; tách/gộp phải giữ id theo F00 FR-2). Nên xong **trước** F32, F34, F37, vì các tính năng đó đều tạo thay đổi cần hoàn tác. |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | **Vitest** (devDependency, để chạy test frontend; theo AD-11 spec này là nơi xin duyệt đầu tiên). Code chạy thật không thêm thư viện: reducer và hook tự viết bằng React có sẵn. |
| **Tham khảo** | Descript, Premiere Pro (J/K/L, I/O), DaVinci Resolve (phím B để cắt) |

> **Cập nhật 18/11/2026:** sửa tham chiếu vị trí các listener phím (Space/←/→ nằm ở `StudioTimeline.tsx:114-148`), tách/gộp/xoá đoạn theo quy tắc id của F00, ghi Vitest vào mục thư viện cần duyệt (AD-11), chốt các câu hỏi mở.

## 1. Bối cảnh & vấn đề

Dự án đã có Undo/Redo bản sơ khai nhưng còn bốn lỗi:

1. **Ctrl+Z bị xử lý 2 lần.** Có hai nơi cùng lắng nghe sự kiện `keydown` cho Ctrl+Z/Ctrl+Y:
   - [page.tsx:565-582](../../../frontend/src/app/page.tsx#L565-L582)
   - [StudioTimeline.tsx:134-146](../../../frontend/src/components/StudioTimeline.tsx#L134-L146), nằm trong listener chung ở dòng 114-148. Component này nhận `onUndo={handleUndo}` từ [page.tsx:1617](../../../frontend/src/app/page.tsx#L1617).

   Nhấn Ctrl+Z một lần sẽ gọi `handleUndo` hai lần. Hai lần gọi dùng chung closure `undoStack` nên kết quả khó đoán: có lúc lùi 1 bước, có lúc mất bước.
2. **Có thao tác không đi qua lịch sử Undo.** `handleMergeSegments` ([page.tsx:1406](../../../frontend/src/app/page.tsx#L1406)) gọi thẳng `setData`, bỏ qua `handleUpdateSegments` ([page.tsx:524](../../../frontend/src/app/page.tsx#L524)). Hệ quả: gộp đoạn bằng Trợ lý AI xong thì không Undo được.
3. **Lịch sử nằm rải rác.** `undoStack` và `redoStack` là hai `useState` riêng ([page.tsx:301-302](../../../frontend/src/app/page.tsx#L301-L302)). Mỗi stack giới hạn 30 bước bằng `slice(-30)` và không ghi lại tên thao tác, nên toast chỉ hiện "Đã quay lại bước trước".
4. **Thiếu phím tắt biên tập phổ biến.** Hiện chỉ có:
   - Space, ←/→, Shift+←/→ và Ctrl+Z/Y trong [StudioTimeline.tsx:114-148](../../../frontend/src/components/StudioTimeline.tsx#L114-L148).
   - Ctrl+Z/Y lặp lại ở [page.tsx:565-582](../../../frontend/src/app/page.tsx#L565-L582).
   - Ctrl+S trong một listener thứ ba ở [page.tsx:685-694](../../../frontend/src/app/page.tsx#L685-L694).

   Tức là có **3 listener** `keydown` riêng lẻ. Chưa có phím cắt tại playhead, đặt điểm vào/ra, xoá đoạn, J/K/L, và chưa có bảng hướng dẫn phím tắt.

## 2. Mục tiêu
- Gom toàn bộ chỉnh sửa segment về **một luồng lịch sử duy nhất**. Mỗi bước có nhãn (ví dụ "Tách đoạn", "Gộp 2 đoạn").
- Toàn trang chỉ có **một nơi** xử lý phím tắt, dựa trên bảng cấu hình phím (keymap) khai báo tập trung.
- Bổ sung bộ phím tắt chuẩn của trình dựng video và hộp thoại "Phím tắt" (mở bằng phím `?`).

### Ngoài phạm vi
- Undo cho thao tác phía máy chủ như render hay xoá video. Phần này thuộc F33 (phiên bản).
- Cho người dùng tự đổi phím tắt.
- Undo cho phần sửa chữ transcript. F32 sẽ dùng lại hook của spec này.

## 3. User stories
- Là biên tập viên, tôi muốn nhấn Ctrl+Z để quay lại **đúng một** thao tác gần nhất, kể cả thao tác gộp đoạn do AI đề xuất.
- Là biên tập viên, tôi muốn nhấn `S` để cắt đoạn tại vị trí đầu phát, không phải với chuột tìm nút.
- Là người mới, tôi muốn nhấn `?` để xem toàn bộ phím tắt.

## 4. Yêu cầu chức năng
- **FR-1** Mọi thay đổi `data.segments` phải đi qua hàm `commit(nextSegments, label)` của hook `useEditHistory`. Cấm gọi `setData(...segments...)` trực tiếp ở nơi khác. Đưa vào checklist khi review code.
- **FR-2** Lịch sử giữ tối đa **100 bước**, bước cũ nhất bị bỏ. Khi người dùng làm thao tác mới sau khi đã Undo thì xoá hết nhánh Redo.
- **FR-3** Toast Undo/Redo hiện nhãn thao tác, ví dụ: "Đã hoàn tác: Tách đoạn tại 03:12".
- **FR-4** Lịch sử bị xoá khi đổi sang video khác (giữ hành vi hiện tại ở [page.tsx:586-587](../../../frontend/src/app/page.tsx#L586-L587)).
- **FR-5** Nút Undo/Redo trên header và timeline bị vô hiệu (disabled) khi không còn bước. Tooltip ghi nhãn của bước kế tiếp.
- **FR-6** Phím tắt **không** hoạt động khi đang gõ trong `input`, `textarea`, `contentEditable` hoặc khi một modal đang mở. Riêng `Esc` vẫn đóng được modal.
- **FR-7** Phím tắt dùng `e.code` để không phụ thuộc bàn phím tiếng Việt (Telex/VNI). Trên macOS dùng `metaKey` thay cho `ctrlKey`.
- **FR-8** Bảng phím tắt:

| Phím | Hành động | Ghi chú |
|---|---|---|
| `Space` hoặc `K` | Phát / Tạm dừng | Đã có Space |
| `J` / `L` | Tua lùi / tiến. Nhấn liên tiếp tăng tốc 1x → 2x → 4x | `L` khi đang dừng thì phát 1x |
| `←` / `→` | Lùi / tiến 2 giây | Đã có |
| `Shift+←` / `Shift+→` | Lùi / tiến 10 giây | Đã có |
| `,` / `.` | Lùi / tiến 1 khung hình (1/30 giây) | Khi đang dừng |
| `S` | Tách đoạn tại playhead | Dùng chung logic với `handleSplitAtPlayhead` ([StudioTimeline.tsx:218](../../../frontend/src/components/StudioTimeline.tsx#L218)). Nửa đầu giữ `id` cũ, nửa sau nhận `crypto.randomUUID()` (F00 FR-2) |
| `I` / `O` | Đặt điểm bắt đầu / kết thúc của đoạn đang chọn bằng playhead | |
| `Delete` / `Backspace` | Bỏ đoạn đang chọn: xoá khỏi danh sách segment đang hoạt động | Undo được. Khi lưu, backend đặt topic vắng mặt thành `DISCARDED` (F00 FR-5), nên không mất dữ liệu |
| `M` | Gộp đoạn đang chọn với đoạn kế tiếp | Đoạn bên trái giữ `id`, đoạn bên phải bị bỏ (F00 FR-2) |
| `↑` / `↓` | Chọn đoạn trước / sau và nhảy playhead tới đầu đoạn | |
| `Ctrl/⌘+Z` | Hoàn tác | |
| `Ctrl/⌘+Shift+Z`, `Ctrl/⌘+Y` | Làm lại | |
| `Ctrl/⌘+S` | Lưu dự án | Đã có |
| `?` | Mở hộp thoại phím tắt | |
| `Esc` | Đóng modal / bỏ chọn | |

## 5. Yêu cầu phi chức năng
- Một bước lịch sử lưu cả mảng `Segment[]`. Với 100 bước × khoảng 50 segment, dung lượng vẫn dưới 2 MB RAM, chấp nhận được. Không cần tối ưu thành diff.
- Phản hồi phím tắt dưới 50 ms. Không render lại cả trang khi chỉ nhấn phím di chuyển.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không thay đổi.

### 6.2 API
Không thay đổi.

### 6.3 Backend
Không thay đổi.

### 6.5 Frontend
**Tệp mới `frontend/src/lib/editHistory.ts`**: reducer thuần, không phụ thuộc React, nên dễ viết unit test.

```ts
export interface HistoryEntry { segments: Segment[]; label: string; at: number }
export interface HistoryState { past: HistoryEntry[]; present: Segment[]; future: HistoryEntry[] }

export type HistoryAction =
  | { type: "commit"; segments: Segment[]; label: string }
  | { type: "undo" } | { type: "redo" }
  | { type: "reset"; segments: Segment[] };

export const HISTORY_LIMIT = 100;
export function historyReducer(s: HistoryState, a: HistoryAction): HistoryState;
```

**Tệp mới `frontend/src/hooks/useEditHistory.ts`**: bọc `useReducer(historyReducer)`. Trả về:
`{ segments, commit, undo, redo, reset, canUndo, canRedo, undoLabel, redoLabel }`.

**Tệp mới `frontend/src/lib/keymap.ts`**: khai báo bảng FR-8 dạng dữ liệu:
```ts
export interface KeyBinding { id: string; code: string; ctrl?: boolean; shift?: boolean; label: string; group: "Phát" | "Biên tập" | "Chung" }
export const KEYMAP: KeyBinding[];
export function matchBinding(e: KeyboardEvent, isMac: boolean): KeyBinding | undefined;
```

**Tệp mới `frontend/src/hooks/useHotkeys.ts`**: chỉ đăng ký **một** `keydown` listener ở `page.tsx`. Hook kiểm tra FR-6, rồi gọi `handlers[binding.id]`.

**Tệp mới `frontend/src/components/ShortcutHelpModal.tsx`**: hiện bảng phím tắt theo nhóm, mở bằng phím `?`.

**Sửa:**
- `page.tsx`:
  - Bỏ `undoStack`/`redoStack` và hai listener ở dòng 565 và 685. Mọi phím (kể cả Ctrl+S) chuyển về `useHotkeys`.
  - `data.segments` lấy từ `useEditHistory`. Các trường còn lại của `data` giữ trong `useState`.
  - `handleUpdateSegments(newSegs, label)` gọi `commit`.
  - `handleMergeSegments` chuyển sang dùng `commit(..., "Gộp 2 đoạn")`.
- `StudioTimeline.tsx`:
  - Xoá listener ở dòng 114-148. Chỉ giữ prop `onUndo`/`onRedo` cho nút bấm.
  - Tách `handleSplitAtPlayhead` thành hàm thuần `splitSegmentAt(segments, time)` đặt trong `lib/segmentOps.ts` để phím `S` dùng lại.
- **Tệp mới `lib/segmentOps.ts`**: các hàm thuần `splitSegmentAt`, `mergeWithNext`, `setSegmentBoundary(seg, "start" | "end", t)`, `discardSegment`. Mọi hàm đánh lại `topic_no`, gọi `recalculateParts`, và giữ/sinh `id` theo F00 FR-2. F37 sẽ dùng lại tệp này.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* timeline có 5 đoạn, *When* nhấn `S` tại 03:12 rồi nhấn Ctrl+Z **một lần**, *Then* còn đúng 5 đoạn và toast ghi "Đã hoàn tác: Tách đoạn tại 03:12".
- **AC-2** — *Given* Trợ lý AI vừa gộp đoạn 2 và 3, *When* nhấn Ctrl+Z, *Then* đoạn 2 và 3 trở lại như cũ (id, start, end, topic khớp trạng thái trước).
- **AC-2b** — *Given* đoạn có id `A`, *When* nhấn `S` để tách, *Then* nửa đầu vẫn có id `A`, nửa sau có id mới dạng UUID. *When* nhấn `M` để gộp lại, *Then* đoạn kết quả có id `A`.
- **AC-3** — *Given* đã thực hiện 105 thao tác, *When* nhấn Ctrl+Z 105 lần, *Then* chỉ lùi được 100 bước và nút Undo bị vô hiệu.
- **AC-4** — *Given* đang gõ tên chủ đề trong ô input, *When* nhấn `S` hoặc `Space`, *Then* ký tự được gõ vào ô, timeline không bị cắt và video không phát.
- **AC-5** — *Given* bộ gõ tiếng Việt Telex đang bật, *When* nhấn `S`, *Then* đoạn vẫn được tách (vì so khớp bằng `e.code === "KeyS"`).
- **AC-6** — *When* nhấn `?`, *Then* hộp thoại hiện đủ 15 dòng của bảng FR-8. `Esc` đóng hộp thoại.
- **AC-7** — *Given* đã Undo 2 bước, *When* thực hiện một thao tác mới, *Then* nút Redo bị vô hiệu.
- **AC-8** — Tìm `grep -n "setData(" frontend/src/app/page.tsx` thì không còn chỗ nào gán `segments` ngoài hook lịch sử.

## 8. Kế hoạch kiểm thử (TDD)
Frontend hiện chưa có công cụ chạy test. Spec này xin duyệt **Vitest** (AD-11); F34 và F37 dùng lại. Nếu chưa được duyệt, viết test cho các hàm thuần và chạy bằng `node --test` với `tsx`.

Viết **trước**, các test sau phải đỏ:
- `editHistory.test.ts`
  - `commit_pushesPresentToPast_andClearsFuture`
  - `undo_onEmptyPast_returnsSameState`
  - `undo_thenRedo_restoresIdenticalSegments`
  - `commit_over100_dropsOldest`
  - `reset_clearsPastAndFuture`
- `segmentOps.test.ts`
  - `splitSegmentAt_middle_createsTwoSegmentsWithContiguousTimes`
  - `splitSegmentAt_within1sOfEdge_returnsUnchanged` (giữ ngưỡng 1.0 giây hiện có)
  - `splitSegmentAt_keepsLeftId_newUuidForRight`
  - `mergeWithNext_keepsLeftId`
  - `mergeWithNext_renumbersTopicNo`
  - `setSegmentBoundary_endBeforeStart_throwsOrRejects`
- `keymap.test.ts`
  - `matchBinding_KeyS_returnsSplit`
  - `matchBinding_metaZ_onMac_returnsUndo`
  - `matchBinding_ctrlShiftZ_returnsRedo`
- E2E thủ công (SV4 QA): chạy lại AC-1 đến AC-7 trên Chrome và Safari.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Sót một chỗ `setData` cập nhật segments | Thao tác đó không Undo được | AC-8, kèm checklist review |
| Phím `S`/`M` đụng phím tắt của trình duyệt hoặc tiện ích | Gây khó chịu | Chỉ xử lý khi focus nằm trong vùng studio. `preventDefault` có chọn lọc |
| Đổi cấu trúc state làm hỏng phần khôi phục session từ localStorage ([page.tsx:356](../../../frontend/src/app/page.tsx#L356)) | Mất phiên làm việc | Khi khôi phục session thì `reset(segments)`, không đưa vào lịch sử |
| J/L tăng tốc không chạy trên Safari với `playbackRate` âm | Không tua lùi được | Tua lùi bằng cách trừ dần `currentTime` qua `requestAnimationFrame` |

## 10. Câu hỏi mở
- [ ] Có duyệt thêm Vitest vào devDependencies không? (Bắt buộc phải chốt theo AD-11.)
- [x] Phím `Delete` xoá hẳn hay đánh dấu? **Đã chốt theo AD-6/F00:** phía frontend bỏ đoạn khỏi danh sách đang hoạt động; khi lưu, backend xoá mềm (`DISCARDED`). Khôi phục đoạn đã lưu là việc của F37 (qua `includeDiscarded`).
- [ ] Có cần lưu lịch sử Undo qua F5 không? Đề xuất: không, để đơn giản.
