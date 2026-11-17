# F38 — Sóng âm & ảnh xem trước trên timeline

| Mục | Giá trị |
|---|---|
| **Mã** | F38 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV1 (sinh dữ liệu bằng FFmpeg) + SV4 (vẽ trên timeline) + SV3 (API, lưu R2) |
| **Phụ thuộc** | F09 (hàng đợi job, để sinh dữ liệu chạy nền). Nếu F09 chưa xong thì tạm chạy bằng `BatchVideoCutService.executor` hiện có. F13 (Flyway). |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không. Dùng `ffmpeg` đã có (`autocut.video.ffmpeg-path`) và Canvas 2D của trình duyệt. |
| **Tham khảo** | DaVinci Resolve, Premiere Pro (waveform + thumbnail track), YouTube (ảnh xem trước khi rê chuột trên thanh tua), BBC audiowaveform (định dạng peaks) |

## 1. Bối cảnh & vấn đề

- Sóng âm trên timeline là **giả**. `waveformBars` sinh 90 thanh bằng hàm `sin` và `cos` ([StudioTimeline.tsx:280-294](../../../frontend/src/components/StudioTimeline.tsx#L280-L294)), video nào cũng hiện giống nhau. Người dùng tưởng đang nhìn âm thanh thật và căn điểm cắt theo đó, nên dễ cắt sai.
- Track video chỉ là các khối màu kèm tên đoạn. Không có ảnh khung hình, nên không thấy chỗ đổi slide hay chỗ chuyển sang màn hình code.
- Nút zoom có sẵn (`zoomLevel`, [StudioTimeline.tsx:70](../../../frontend/src/components/StudioTimeline.tsx#L70), [:433-449](../../../frontend/src/components/StudioTimeline.tsx#L433-L449)) nhưng không có dữ liệu chi tiết để hiện khi phóng to.
- Backend đã có `ffprobe`/`ffmpeg` qua `VideoCutter.probeDuration` ([VideoCutter.java:102](../../../backend/src/main/java/com/autocut/video/VideoCutter.java#L102)) và cách gọi tiến trình con ([VideoController.java:424](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L424)). Video gốc được định danh bằng `sha256_hash`, phát qua `/stream/{hash}` ([VideoController.java:531](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L531)).

## 2. Mục tiêu
- Sinh **dữ liệu đỉnh âm (peaks)** thật cho mỗi video một lần, lưu cache theo `sha256`, rồi vẽ trên timeline bằng `<canvas>`. Zoom tới mức 1 giây rộng khoảng 100 px vẫn đủ chi tiết.
- Sinh **sprite ảnh xem trước**: một ảnh lớn ghép nhiều khung hình nhỏ, mỗi khung cách nhau 5 giây. Dùng để hiện dải ảnh trên track video và ảnh nổi khi rê chuột trên thanh tua.
- Nếu dữ liệu chưa sẵn sàng thì hiện khung xương (skeleton) "Đang tạo sóng âm…", **không** hiện sóng giả.

### Ngoài phạm vi
- Phổ âm (spectrogram), đồng hồ đo âm lượng (VU meter).
- Tự đặt điểm cắt từ sóng âm (`SilenceSnapCut` đã lo phần này).
- Ảnh xem trước cho từng clip đã xuất (F43 làm ảnh bìa).

## 3. User stories
- Là biên tập viên, tôi phóng to timeline và thấy rõ khoảng lặng giữa hai câu để kéo điểm cắt vào đúng chỗ.
- Là trợ giảng, tôi nhìn dải ảnh trên timeline và nhận ra đoạn chuyển từ slide sang VS Code.
- Là người dùng, rê chuột trên thanh tua thì tôi thấy ảnh khung hình tại vị trí đó trước khi bấm.

## 4. Yêu cầu chức năng
- **FR-1 Sinh peaks.**
  1. Lệnh: `ffmpeg -v error -i <src> -ac 1 -ar 8000 -f s16le -acodec pcm_s16le pipe:1`.
  2. Java đọc luồng ra và gom mỗi **80 mẫu** (10 ms) thành một cặp `[min, max]` kiểu int8. Kết quả gồm 100 cặp mỗi giây, khoảng 1,44 MB cho video 2 giờ.
  3. Lưu tệp nhị phân `peaks.bin` với header JSON nhỏ (6.3). Sinh thêm bản giảm độ phân giải 10 cặp/giây (`peaks_lo.bin`) để tải nhanh khi chưa zoom.
- **FR-2 Sinh sprite.**
  1. Lệnh: `ffmpeg -v error -i <src> -vf "fps=1/5,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=10x10" -q:v 5 sprite_%03d.jpg`.
  2. Mỗi sprite chứa 100 khung hình, tức 500 giây video. Video 2 giờ cần khoảng 15 tệp, mỗi tệp khoảng 150–300 KB.
  3. Sinh kèm `thumbnails.json` gồm `{ intervalSec: 5, tileW: 160, tileH: 90, cols: 10, rows: 10, sprites: ["sprite_001.jpg", ...] }`.
- **FR-3 Thời điểm sinh:** tự chạy ngay sau khi upload thành công (`/upload-sample`, [VideoController.java:164](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L164)), song song với analyze. Có thêm endpoint để sinh lại thủ công.
- **FR-4 Cache** theo `sha256`: `media/<sha256>/peaks.bin`, `peaks_lo.bin`, `thumbs/…` trên R2, có bản sao cục bộ trong `cache/`. Video trùng hash thì dùng lại, không sinh lại.
- **FR-5 Trạng thái** lưu ở cột `videos.waveform_status` và `videos.thumbs_status`: `PENDING | PROCESSING | READY | FAILED`.
- **FR-6 Vẽ sóng âm:**
  - Một `<canvas>` cho track âm thanh, vẽ cặp min/max dạng thanh dọc, màu `#10b981` (giữ màu hiện tại).
  - Chỉ vẽ **vùng đang nhìn thấy**, vẽ lại khi cuộn hoặc zoom, gom vào `requestAnimationFrame`.
  - Tự chọn độ phân giải: dùng `peaks_lo` khi mật độ < 10 px/giây, dùng `peaks` khi lớn hơn. Tải `peaks.bin` lười, chỉ khi người dùng zoom lần đầu.
  - Vẽ cho màn hình Retina bằng `devicePixelRatio`.
- **FR-7 Dải ảnh** trên track video: các khung 160×90 thu nhỏ theo chiều cao track, đặt nối nhau. Khi zoom ra, bỏ bớt khung để mỗi khung rộng ít nhất 40 px. Vẽ bằng `ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh)`.
- **FR-8 Ảnh nổi khi rê chuột** trên thước thời gian và thanh tiến độ của `VideoCanvasViewport`: hiện khung gần nhất (làm tròn xuống bội số 5 giây) kèm nhãn thời gian `MM:SS`.
- **FR-9 Zoom:** thanh zoom hiện tại chuyển sang đơn vị **px/giây**, từ "vừa màn hình" tới 200 px/giây. `Ctrl+cuộn chuột` để zoom quanh vị trí con trỏ. Thêm phím `+`/`-` vào keymap của F31.
- **FR-10** `FAILED` thì hiện "Không tạo được sóng âm — [Thử lại]". Video không có track âm thanh thì hiện "Video không có âm thanh" (ffmpeg trả lỗi `does not contain any stream`), và đây **không** tính là lỗi.

## 5. Yêu cầu phi chức năng
- Thời gian sinh peaks cho video 2 giờ dưới 60 giây; sprite dưới 3 phút (máy 4 nhân). Hai việc chạy nền, không chặn analyze.
- Vẽ lại canvas khi cuộn dưới 8 ms mỗi khung hình (giữ 60 fps) với 2.000 px chiều ngang.
- Tải xuống ban đầu của timeline (`peaks_lo` + sprite đầu tiên) dưới 500 KB.
- Header cache của tệp tĩnh: `Cache-Control: public, max-age=31536000, immutable`. An toàn vì đường dẫn đã chứa hash.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<n>__media_previews.sql`
```sql
ALTER TABLE videos ADD COLUMN IF NOT EXISTS waveform_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbs_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS has_audio BOOLEAN;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS preview_error TEXT;
```

### 6.2 API (controller mới `MediaPreviewController`, `/api/v1/videos/{videoId}/preview`)
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `` | Xem | Trạng thái + URL |
| POST | `/regenerate` | Biên tập | Đưa lại vào hàng đợi (`{ "kind": "waveform" \| "thumbnails" \| "all" }`) |
| GET | `/peaks?res=lo\|hi` | Xem | Tệp nhị phân, `Content-Type: application/octet-stream`. Nếu có R2 thì trả 302 tới presigned URL |
| GET | `/thumbs/{file}` | Xem | Ảnh sprite (`file` chỉ khớp `^sprite_\d{3}\.jpg$` hoặc `thumbnails.json`, chống path traversal như F04) |

```json
// GET /api/v1/videos/42/preview
{ "waveform": { "status": "READY", "hasAudio": true, "samplesPerSec": { "lo": 10, "hi": 100 },
                "loUrl": "/api/v1/videos/42/preview/peaks?res=lo", "hiUrl": "/api/v1/videos/42/preview/peaks?res=hi" },
  "thumbnails": { "status": "PROCESSING", "manifestUrl": null } }
```

**Định dạng `peaks.bin`** (little-endian):
```
offset 0  : 4 byte magic "ACPK"
offset 4  : uint16 version = 1
offset 6  : uint16 samplesPerSec (10 | 100)
offset 8  : uint32 count (số cặp)
offset 12 : float32 durationSec
offset 16 : count × [int8 min, int8 max]
```

### 6.3 Backend
- **Mới** `video/WaveformGenerator.java`:
  - `PeaksResult generate(Path src, int samplesPerSec)` chạy ffmpeg và đọc luồng `s16le` bằng `DataInputStream` với buffer 64 KB.
  - Hàm thuần `static byte[] toPeaks(short[] pcm, int samplesPerBucket)` để test.
  - Hàm thuần `static byte[] downsample(byte[] peaks, int factor)`.
  - Hàm `static void writeFile(...)`.
- **Mới** `video/ThumbnailSpriteGenerator.java`: `SpriteManifest generate(Path src, Path outDir, int intervalSec)`.
- **Mới** `service/MediaPreviewService.java`:
  - Đưa job vào hàng đợi F09, hoặc tạm dùng `executor`.
  - Kiểm tra cache theo `sha256`, upload R2 qua `CloudflareR2Service` ([CloudflareR2Service.java](../../../backend/src/main/java/com/autocut/service/CloudflareR2Service.java)), cập nhật trạng thái.
  - Giới hạn **1** job preview chạy đồng thời để không tranh CPU với job cắt video.
- **Sửa** luồng upload ([VideoController.java:164](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L164)): sau khi lưu `VideoEntity`, gọi `mediaPreviewService.enqueue(videoId)`.
- Đường dẫn ffmpeg lấy từ `VideoProps`. Mọi lệnh ffmpeg dùng `ProcessBuilder` với danh sách tham số (không ghép chuỗi shell). Đọc stderr để không bị treo vì đầy buffer (dùng `StreamUtil` có sẵn).

### 6.5 Frontend
- **Mới** `lib/peaks.ts`: `parsePeaks(buf: ArrayBuffer) → { samplesPerSec, duration, data: Int8Array }`, `sliceForView(peaks, t0, t1, widthPx) → Array<[min, max]>` (hàm thuần).
- **Mới** `lib/thumbs.ts`: `tileFor(manifest, timeSec) → { spriteIndex, sx, sy }` (hàm thuần).
- **Mới** `hooks/useMediaPreview.ts`: gọi `GET /preview`; khi trạng thái `PROCESSING` thì hỏi lại mỗi 5 giây (hoặc nghe SSE nếu F10 đã có); tải và cache `ArrayBuffer` và `HTMLImageElement`.
- **Mới** `components/timeline/WaveformCanvas.tsx`, `components/timeline/FilmstripCanvas.tsx`, `components/ScrubPreview.tsx`.
- **Sửa** `StudioTimeline.tsx`:
  - Xoá `waveformBars` giả ([:280-294](../../../frontend/src/components/StudioTimeline.tsx#L280-L294)) và khối render tương ứng ([:575-590](../../../frontend/src/components/StudioTimeline.tsx#L575-L590)), thay bằng `WaveformCanvas`.
  - Thêm `FilmstripCanvas` phía sau các khối segment của track video.
  - Đổi `zoomLevel` sang `pxPerSec`.
- **Sửa** `VideoCanvasViewport.tsx`: gắn `ScrubPreview` vào thanh tiến độ.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* upload video 10 phút có tiếng, *When* chờ tối đa 30 giây, *Then* `waveform.status = READY`, và sóng âm trên timeline khác với một video khác (không còn dữ liệu giả).
- **AC-2** — *Given* đoạn im lặng thật từ 120,0 tới 122,0 giây, *When* zoom 100 px/giây, *Then* vùng đó trên canvas có biên độ dưới 5% chiều cao track.
- **AC-3** — *Given* video 2 giờ, *Then* `peaks_lo.bin` nhỏ hơn 200 KB và `peaks.bin` nhỏ hơn 1,6 MB. Thời gian sinh dưới 60 giây.
- **AC-4** — *When* rê chuột trên thanh tua tại 07:23, *Then* ảnh nổi hiện khung hình tại 07:20 với nhãn "07:23".
- **AC-5** — *Given* video không có âm thanh, *Then* `has_audio=false`, `waveform.status=READY`, và track hiện "Video không có âm thanh".
- **AC-6** — *When* gọi `/thumbs/../../.env`, *Then* nhận 400 và không đọc tệp nào.
- **AC-7** — *Given* upload lại đúng tệp đó (cùng sha256), *Then* không chạy ffmpeg lần nữa (log ghi "cache hit").
- **AC-8** — Cuộn timeline liên tục 5 giây ở mức zoom tối đa thì Chrome Performance không có khung hình nào quá 16 ms do vẽ canvas.

## 8. Kế hoạch kiểm thử (TDD)
Backend, viết trước:
- `WaveformGeneratorTest`
  - `toPeaks_silence_allZero`
  - `toPeaks_fullScaleSine_minMaxNear127`
  - `toPeaks_partialLastBucket_included`
  - `downsample_factor10_keepsExtremes`
  - `writeFile_headerFieldsCorrect`
  - `generate_realFixture_countMatchesDuration` (dùng tệp mẫu nhỏ 3 giây đặt trong `src/test/resources`; bỏ qua có điều kiện nếu không có ffmpeg, **không** dùng `@Disabled`)
- `ThumbnailSpriteGeneratorTest`
  - `manifest_spriteCountMatchesDuration`
  - `generate_fixture_producesJpeg160x90Tiles`
- `MediaPreviewServiceTest`
  - `enqueue_sameHash_cacheHitSkipsFfmpeg`
  - `noAudioStream_marksReadyHasAudioFalse`
  - `ffmpegFails_marksFailedWithError`
- `MediaPreviewControllerTest`
  - `thumbs_invalidFileName_returns400`
  - `peaks_returnsOctetStream`

Frontend:
- `peaks.test.ts`: `parsePeaks_badMagic_throws`, `sliceForView_downsamplesToWidth`, `sliceForView_outOfRange_clamps`.
- `thumbs.test.ts`: `tileFor_t0_firstTile`, `tileFor_t505_secondSpriteFirstTile`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Sinh sprite chiếm nhiều CPU khi nhiều người upload cùng lúc | Job cắt video chậm | Giới hạn 1 job preview đồng thời, ưu tiên thấp hơn job cắt (F09 có trường priority) |
| Video có nhiều track âm thanh hoặc kênh 5.1 | Sóng âm sai | `-ac 1` trộn về mono. Chọn track mặc định qua `-map 0:a:0?` |
| Video VFR hoặc có `start_time ≠ 0` | Ảnh lệch so với thời gian | Dùng `-vf fps=1/5`, kiểm tra trên tệp mẫu ghi màn hình OBS |
| R2 chưa cấu hình | Không có chỗ lưu | Phục vụ từ `cache/` cục bộ |
| Video cũ đã upload trước khi có tính năng | Không có preview | Thêm lệnh backfill (sinh bù) chạy một lần cho mọi video có `waveform_status='PENDING'` |

## 10. Câu hỏi mở
- [ ] Khoảng cách giữa các ảnh: 5 giây (đề xuất) hay 2 giây (nét hơn nhưng nặng gấp 2,5 lần)?
- [ ] Sau khi có tính năng này, có backfill toàn bộ video cũ không?
- [ ] Có dùng chung dữ liệu peaks với F25 (phát hiện khoảng lặng) và F26 (phát hiện đổi slide từ sprite) để tránh chạy ffmpeg hai lần không? Đề xuất: có. F25/F26 đọc từ cache của spec này.
