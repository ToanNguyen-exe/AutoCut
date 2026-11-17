# F34 — Tự động lưu

| Mục | Giá trị |
|---|---|
| **Mã** | F34 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV4 (Web Studio) |
| **Phụ thuộc** | F33 (API `PUT /segments` có `baseVersion` và `source=AUTOSAVE`), F31 (một nguồn state lịch sử duy nhất) |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Google Docs, Notion, Descript ("Saved" / "Saving…" / "Offline") |

## 1. Bối cảnh & vấn đề

- Hiện có **hai cơ chế lưu tách rời**:
  1. **Lưu tạm vào trình duyệt.** Mỗi khi `data`, `transcript`, `activeSegmentId` hoặc `currentTime` thay đổi, toàn bộ phiên làm việc được ghi vào `localStorage["autocut_active_session"]` ([page.tsx:494-522](../../../frontend/src/app/page.tsx#L494-L522)). Vì phụ thuộc vào `currentTime`, khi video đang phát hiệu ứng này chạy **vài lần mỗi giây** và mỗi lần `JSON.stringify` cả transcript. Transcript dài làm trang giật, và có thể vượt giới hạn khoảng 5 MB của localStorage (lỗi chỉ được ghi `console.warn`).
  2. **Lưu lên máy chủ thủ công** bằng Ctrl+S hoặc nút Lưu ([page.tsx:651-694](../../../frontend/src/app/page.tsx#L651-L694)).
- Người dùng không biết thay đổi đã lên máy chủ hay chưa. Không có cảnh báo khi đóng tab lúc còn thay đổi chưa lưu.
- Lưu thất bại vẫn hiện toast "Đã lưu dự án vào bộ nhớ cục bộ" (xem F33 §1 mục 5).

## 2. Mục tiêu
- Tự lưu lên máy chủ sau khi người dùng ngừng thao tác 3 giây (debounce: chờ người dùng ngừng thao tác một lúc mới chạy).
- Hiện rõ **trạng thái lưu** ở header: "Đã lưu lúc 14:32" / "Đang lưu…" / "Chưa lưu" / "Mất kết nối — đã giữ bản tạm" / "Xung đột".
- Bản tạm trong trình duyệt chỉ là **lưới an toàn** khi mất mạng. Khi mở lại trang, hệ thống đề nghị khôi phục nếu bản tạm mới hơn bản trên máy chủ.
- Cảnh báo khi đóng tab lúc còn thay đổi chưa lưu.

### Ngoài phạm vi
- Đồng bộ thời gian thực giữa nhiều tab hoặc nhiều người (F36).
- Tự lưu tiến độ render.

## 3. User stories
- Là giảng viên, tôi sửa xong rồi đóng máy luôn, hôm sau mở lại vẫn thấy đúng bản đã sửa.
- Là trợ giảng làm ở quán cà phê mạng chập chờn, tôi muốn biết lúc nào thay đổi chưa lên được máy chủ.

## 4. Yêu cầu chức năng
- **FR-1 Thế nào là "bẩn" (dirty).** Có thay đổi chưa lưu khi `historyState.present` (F31) khác `lastSavedSnapshot`, so sánh bằng tham chiếu đối tượng. Thay đổi `currentTime`, `activeSegmentId`, âm lượng **không** tính là bẩn.
- **FR-2 Debounce.** Khi dirty, chờ **3 giây** không có commit mới thì gọi `PUT /segments` với `source="AUTOSAVE"`. Đang soạn liên tục quá **30 giây** thì vẫn lưu (max wait).
- **FR-3 Một yêu cầu tại một thời điểm.** Đang có request lưu thì không gửi request khác. Khi request xong mà vẫn còn dirty thì lên lịch lưu tiếp.
- **FR-4 Ctrl+S** gọi lưu ngay với `source="MANUAL"`, huỷ hẹn giờ debounce.
- **FR-5 Thử lại.** Lỗi mạng hoặc 5xx thì thử lại sau 2, 4, 8, 16, 30 giây, tối đa 30 giây mỗi lần. Lỗi 4xx (khác 409) thì không thử lại, hiện lỗi.
- **FR-6 Xung đột.** Nhận 409 thì dừng tự lưu, chuyển trạng thái "Xung đột" và mở `ConflictDialog` của F33.
- **FR-7 Bản tạm cục bộ.** Mỗi lần dirty, ghi `{ videoId, baseVersion, present, savedAt }` vào **IndexedDB** (đã có [lib/videoStorage.ts](../../../frontend/src/lib/videoStorage.ts) dùng IndexedDB), key `draft:<videoId>`, debounce 1 giây. Lưu máy chủ thành công thì xoá bản tạm.
- **FR-8 Khôi phục bản tạm.** Khi mở video, nếu có bản tạm và `draft.savedAt` mới hơn `serverSavedAt` thì hiện banner "Có thay đổi chưa lưu từ 14:20 hôm qua — [Khôi phục] [Bỏ]". Nếu `draft.baseVersion` khác version trên máy chủ thì nút Khôi phục đưa vào luồng xung đột.
- **FR-9 Đóng tab.** Còn dirty hoặc đang lưu thì gắn `beforeunload` để trình duyệt hỏi xác nhận.
- **FR-10 Trạng thái phiên** (video đang mở, vị trí playhead, segment đang chọn) vẫn lưu vào `localStorage`, nhưng **chỉ** ghi khi tạm dừng video hoặc mỗi 5 giây, và **không** lưu `transcript` hay `segments` ở đây nữa.
- **FR-11** Có công tắc "Tự động lưu" trong menu tài khoản, mặc định bật, nhớ bằng localStorage.

## 5. Yêu cầu phi chức năng
- Khi video đang phát, không có tác vụ lưu nào chạy quá 16 ms trên main thread (đo bằng Chrome Performance).
- Mỗi người dùng gửi không quá 1 request tự lưu mỗi 3 giây. F06 (rate limit) phải cho phép mức này.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
Không thay đổi. Dùng `project_versions` của F33.

### 6.2 API
Dùng `PUT /api/v1/videos/{id}/segments` của F33 với `source: "AUTOSAVE"`. Thêm header tuỳ chọn `X-Client-Session: <uuid>` để F36 biết tab nào lưu.

### 6.5 Frontend
**Mới `frontend/src/hooks/useAutosave.ts`**
```ts
type SaveStatus =
  | { kind: "saved"; at: Date }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "offline"; retryInMs: number }
  | { kind: "conflict"; details: ConflictDetails }
  | { kind: "error"; message: string };

export function useAutosave(opts: {
  videoId: number | null;
  present: EditorSnapshot;           // { segments, cutRanges } từ F31
  serverVersion: number;
  onSaved: (v: number) => void;
  enabled: boolean;
  debounceMs?: number;               // 3000
  maxWaitMs?: number;                // 30000
}): { status: SaveStatus; saveNow: () => Promise<void> };
```
- Logic hẹn giờ viết thành **máy trạng thái thuần** trong `lib/autosaveMachine.ts`, gồm `next(state, event) → { state, effects }`. Hook chỉ thực thi các effect (đặt timer, gọi fetch), nhờ vậy test được mà không cần trình duyệt.

**Mới `frontend/src/lib/draftStore.ts`** (dùng IndexedDB qua tiện ích sẵn có ở `videoStorage.ts`): `putDraft`, `getDraft`, `deleteDraft`.

**Mới `components/SaveStatusIndicator.tsx`**, gắn vào `StudioHeader.tsx` cạnh nút Lưu:

| Trạng thái | Biểu tượng (lucide) | Chữ |
|---|---|---|
| saved | `CheckCircle2` | Đã lưu lúc HH:mm |
| dirty | `Circle` | Chưa lưu |
| saving | `Loader2` (xoay) | Đang lưu… |
| offline | `CloudOff` | Mất kết nối — thử lại sau Ns |
| conflict | `AlertTriangle` | Xung đột phiên bản |
| error | `XCircle` | Lỗi lưu — bấm để xem |

**Mới `components/DraftRestoreBanner.tsx`.**

**Sửa `page.tsx`:**
- Xoá hiệu ứng ở dòng 494-522 và thay bằng FR-10.
- Ctrl+S gọi `saveNow()`.
- Thêm `useEffect` cho `beforeunload`.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* sửa tên một topic, *When* chờ 3 giây, *Then* đúng **1** request `PUT /segments` với `source=AUTOSAVE` được gửi, và header hiện "Đã lưu lúc …".
- **AC-2** — *Given* thao tác liên tục mỗi giây trong 40 giây, *Then* có ít nhất 1 lần lưu ở khoảng giây thứ 30 (max wait).
- **AC-3** — *Given* tắt mạng (DevTools Offline), *When* sửa, *Then* header hiện "Mất kết nối", bản tạm có trong IndexedDB. Bật mạng lại thì tự lưu thành công trong vòng 30 giây.
- **AC-4** — *Given* có bản tạm chưa lên máy chủ, *When* F5, *Then* banner khôi phục hiện ra. Bấm "Khôi phục" thì timeline giống trước F5.
- **AC-5** — *Given* đang dirty, *When* đóng tab, *Then* trình duyệt hỏi xác nhận.
- **AC-6** — *Given* video đang phát 60 giây và không sửa gì, *Then* không có request lưu nào và không ghi IndexedDB.
- **AC-7** — *Given* máy chủ trả 409, *Then* tự lưu dừng hẳn (không gửi thêm request) cho tới khi giải quyết xong xung đột.

## 8. Kế hoạch kiểm thử (TDD)
`autosaveMachine.test.ts` (dùng fake timer), viết trước:
- `dirty_thenIdle3s_emitsSave`
- `continuousEdits_emitsSaveAtMaxWait30s`
- `saveInFlight_newEdit_queuesOneMoreSave`
- `networkError_backsOff_2_4_8_16_30`
- `conflict409_stopsAutosave`
- `http400_noRetry_setsError`
- `manualSave_cancelsDebounce`

`draftStore.test.ts` (dùng `fake-indexeddb` nếu được duyệt, nếu không thì test thủ công):
- `put_get_delete_roundtrip`

QA thủ công: chạy AC-3, AC-4, AC-5 trên Chrome, Safari và Firefox.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Tự lưu tạo quá nhiều version | DB phình | F33 FR-4 chỉ giữ 50 bản AUTOSAVE |
| Hai tab cùng tự lưu | 409 liên tục | FR-6 dừng tự lưu khi có 409. F36 cảnh báo khi có tab khác đang mở |
| IndexedDB bị chặn (chế độ ẩn danh Safari) | Không có lưới an toàn | Bọc `try/catch`, ghi log, hiện nhắc "Trình duyệt không cho lưu tạm" một lần (không được để catch rỗng) |
| `beforeunload` bị trình duyệt bỏ qua | Vẫn mất thay đổi | Đã có bản tạm IndexedDB bù lại |

## 10. Câu hỏi mở
- [ ] Debounce 3 giây và max wait 30 giây có hợp lý với tải máy chủ hiện tại (Neon gói free) không?
- [ ] Có cho tắt tự lưu không, hay luôn bật? Đề xuất: cho tắt nhưng mặc định bật.
- [ ] Có duyệt thêm `fake-indexeddb` (chỉ dùng trong devDependencies) để test không?
