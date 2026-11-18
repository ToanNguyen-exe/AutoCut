# F33 — Lịch sử phiên bản & chống ghi đè

| Mục | Giá trị |
|---|---|
| **Mã** | F33 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (Core API/DB) + SV4 (giao diện) |
| **Phụ thuộc** | **F00** (upsert theo `client_id`, `PUT /segments`, xoá mềm `DISCARDED`, `STALE`), F01, F02 (biết ai lưu, có quyền gì), F13 (Flyway). F32 (để snapshot có `editRanges`). F34 (Tự lưu) xây trên spec này |
| **Ước lượng** | M (3–5 ngày). Phần upsert đã chuyển sang F00 |
| **Thư viện mới cần duyệt** | Không (test dùng Postgres theo AD-7; Testcontainers do F13 xin duyệt) |
| **Tham khảo** | Google Docs (Version history), Figma (Version history), Descript (Project versions) |

> **Cập nhật 18/11/2026:** bỏ phần upsert/`client_id` (đã chuyển sang F00); `project_versions` cho phép lưu bản tách rời (`version_no` NULL) để giải quyết lựa chọn "Lưu thành phiên bản riêng"; snapshot và khôi phục gồm cả `editRanges` (dòng USER); quyền theo AD-1/AD-2; test dùng Postgres (AD-7).

## 1. Bối cảnh & vấn đề

1. **Không chống ghi đè.** Hai người, hoặc hai tab, cùng sửa một video thì người lưu sau ghi đè người lưu trước mà không có cảnh báo.
   - Cột `videos.version` đã có `@Version` ([VideoEntity.java:53-55](../../../backend/src/main/java/com/autocut/entity/VideoEntity.java#L53-L55)), và `topics.version` cũng có.
   - Nhưng API `/save` ([VideoController.java:1145](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1145)) không nhận và không kiểm tra version nào.
   - F00 đã chuyển việc lưu sang `PUT /api/v1/videos/{id}/segments`, nhưng F00 chưa kiểm tra xung đột.
2. **Lưu luôn đánh dấu "đã duyệt".** Mỗi lần lưu đều đặt `video.setReviewed(true)` ([SegmentPersistenceService.java:152](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L152)). F00 FR-5 đã bỏ hành vi này; trạng thái duyệt do F35 quản lý.
3. **Báo lỗi sai.** Frontend lưu lỗi nhưng vẫn báo "Đã lưu dự án vào bộ nhớ cục bộ" ([page.tsx:669-678](../../../frontend/src/app/page.tsx#L669-L678), [api.ts:457-479](../../../frontend/src/lib/api.ts#L457-L479)). Người dùng tưởng đã lưu thành công.
4. **Không có lịch sử.** Muốn quay lại bản phân đoạn của AI sau khi đã sửa tay thì không có cách nào.

> Vấn đề "lưu là xoá sạch rồi ghi lại" và "tìm video theo tên gần đúng" đã được **F00** giải quyết. Spec này giả định F00 đã xong.

## 2. Mục tiêu
- Mỗi lần lưu tạo một **phiên bản (snapshot)**. Người dùng xem được danh sách phiên bản, xem trước và khôi phục.
- **Khoá lạc quan (optimistic locking):** lưu phải gửi kèm `baseVersion`. Nếu `baseVersion` lệch với bản trên máy chủ thì trả 409 để client xử lý xung đột.

### Ngoài phạm vi
- Upsert theo id ổn định: thuộc F00.
- Nhiều người sửa cùng lúc theo thời gian thực (CRDT/OT, kiểu Google Docs). F36 chỉ hiển thị ai đang sửa.
- Tự động trộn hai bản xung đột (3-way merge). Client chọn giữ bản nào.

## 3. User stories
- Là giảng viên, tôi muốn quay lại bản phân đoạn gốc do AI tạo sau khi trợ giảng sửa hỏng.
- Là trợ giảng, nếu đồng nghiệp vừa lưu trước tôi, tôi muốn được báo để không vô tình xoá công của họ.
- Là biên tập viên, tôi muốn đặt tên cho một phiên bản, ví dụ "Bản gửi thầy duyệt".

## 4. Yêu cầu chức năng
- **FR-1** `PUT /api/v1/videos/{videoId}/segments` của F00 nhận thêm `{ baseVersion, source, label? }`. Trong cùng transaction với upsert của F00:
  1. Khoá dòng video bằng `SELECT ... FOR UPDATE`.
  2. Nếu `baseVersion != videos.version` thì trả **409** `VERSION_CONFLICT`, kèm `currentVersion`, người lưu gần nhất và thời điểm lưu. Không ghi gì vào DB.
  3. Gọi `SegmentPersistenceService.upsertSegments` (F00).
  4. Tăng `videos.version` và ghi một dòng `project_versions` với `version_no = videos.version` mới, `snapshot = { segments, editRanges }`. `editRanges` chỉ gồm các dòng `source='USER'` (F32); các dòng AUTO do F25 tự sinh lại được.
  5. Nếu payload giống hệt bản hiện tại (F00 trả `saved` nhưng không có thay đổi nào) thì **không** tăng version và không tạo snapshot. Ngoại lệ: `source=AI_ANALYZE` (FR-2) và `source=MANUAL` có `label` thì **luôn** tạo snapshot.
- **FR-2** Nguồn của phiên bản (`source`):
  - `AI_ANALYZE`: **mỗi lần** analyze xong (luồng F00 FR-4 ghi DB), luôn tạo đúng một phiên bản này, kể cả khi kết quả giống lần trước. F46 dựa vào bản này để so sánh kết quả AI gốc với bản người dùng duyệt.
  - `MANUAL`: Ctrl+S.
  - `AUTOSAVE`: F34.
  - `RESTORE`: khôi phục.
  - `DETACHED`: bản tách rời, xem FR-8.
- **FR-3** Giữ **tất cả** phiên bản `MANUAL`, `AI_ANALYZE`, `RESTORE`, `DETACHED`. Phiên bản `AUTOSAVE` chỉ giữ 50 bản gần nhất mỗi video. Việc dọn chạy theo lịch (job hằng ngày, AD-10).
- **FR-4** Bảng "Lịch sử phiên bản" (drawer bên phải) hiện danh sách gồm thời gian, người lưu, nguồn, nhãn, số đoạn và tổng thời lượng. Bấm vào một bản để **xem trước** ở chế độ chỉ đọc. Timeline tô màu đoạn thêm (xanh), đoạn xoá (đỏ), đoạn đổi biên (vàng) so với bản hiện tại. So sánh theo `id` (client_id).
- **FR-5** "Khôi phục bản này" (bản `DETACHED` cũng khôi phục được):
  1. Gửi snapshot `segments` qua upsert của F00. Topic có `id` cũ đang `DISCARDED` sẽ trở lại `ACTIVE` với **cùng `topicId`** và giữ nguyên các bảng con. Topic không có trong snapshot chuyển `DISCARDED`.
  2. Thay các dòng `edit_ranges` có `source='USER'` bằng `snapshot.editRanges`, dùng `EditRangeService.replaceUserRanges` của F32.
  3. Tạo phiên bản **mới** `source=RESTORE`. Không xoá lịch sử. Có kiểm tra `baseVersion` như FR-1.
- **FR-6** Đặt hoặc sửa nhãn cho một phiên bản (tối đa 100 ký tự).
- **FR-7** Khi gặp 409, frontend hiện hộp thoại ba lựa chọn:
  - "Tải bản mới nhất": bỏ thay đổi của mình.
  - "Ghi đè bằng bản của tôi": gửi lại với `baseVersion = currentVersion`. Chỉ `OWNER` (theo `video_access`, AD-1) được chọn; phải xác nhận lần hai và được ghi vào audit log (F08).
  - "Lưu bản của tôi thành phiên bản riêng": xem FR-8.
- **FR-8** **Phiên bản tách rời.** `POST /versions` lưu snapshot với `source='DETACHED'`, `version_no = NULL`, **không** áp dụng vào video và **không** tăng `videos.version`. Bản này hiện trong danh sách với nhãn "Bản riêng của <tên>".
- **FR-9** Frontend chỉ báo "Đã lưu" khi máy chủ trả 2xx. Lỗi mạng thì báo "Chưa lưu được — đang giữ bản tạm trên máy này" (bản tạm do F34 giữ), không dùng chữ "Đã lưu".

## 5. Yêu cầu phi chức năng
- `PUT /segments` với 200 segment, kể cả bước tạo snapshot, hoàn thành trong dưới 500 ms (p95).
- Một snapshot khoảng 50–200 KB JSON. Ước tính 1.000 video × 60 bản ≈ 6–12 GB. Postgres tự nén JSONB lớn (TOAST) là đủ. Theo dõi qua F15.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<yyyyMMddHHmm>__project_versions.sql` (các cột `topics.client_id`, `topics.video_id`, `video_parts.status='STALE'` do F00 tạo):
```sql
CREATE TABLE IF NOT EXISTS project_versions (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    version_no BIGINT,                       -- = videos.version sau khi lưu; NULL với bản DETACHED
    source VARCHAR(20) NOT NULL
        CHECK (source IN ('AI_ANALYZE','MANUAL','AUTOSAVE','RESTORE','DETACHED')),
    label VARCHAR(100),
    snapshot JSONB NOT NULL,                 -- { "segments": [...], "editRanges": [...] }
    segment_count INTEGER NOT NULL,
    total_duration DOUBLE PRECISION NOT NULL,
    restored_from BIGINT REFERENCES project_versions(id) ON DELETE SET NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_detached_no_version CHECK ((source = 'DETACHED') = (version_no IS NULL))
);
-- Duy nhất chỉ với các bản đã áp dụng (version_no khác NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pv_video_version
    ON project_versions(video_id, version_no) WHERE version_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pv_video_created ON project_versions(video_id, created_at DESC);
```

### 6.2 API (controller mới `ProjectVersionController`, path gốc `/api/v1/videos/{videoId}`)
| Method | Path | Quyền (AD-1) | Mô tả |
|---|---|---|---|
| GET | `/segments` | Xem | Của F00; thêm trường `version` |
| PUT | `/segments` | `OWNER` / `EDITOR` | Của F00; thêm kiểm tra `baseVersion` (FR-1) |
| GET | `/versions?limit=50&before=<id>` | Xem | Danh sách phiên bản (không có snapshot) |
| GET | `/versions/{versionId}` | Xem | Chi tiết, có snapshot |
| POST | `/versions` | `OWNER` / `EDITOR` | Lưu bản tách rời (FR-8) |
| PATCH | `/versions/{versionId}` | `OWNER` / `EDITOR` | Đổi nhãn |
| POST | `/versions/{versionId}/restore` | `OWNER` / `EDITOR` | Khôi phục, body `{ "baseVersion": 18 }` |

Theo AD-2: không có quyền xem video thì trả 404; chỉ có quyền xem mà gọi API ghi thì trả 403 `FORBIDDEN_ACTION`. `versionId` thuộc video khác cũng trả 404.

```json
// PUT /api/v1/videos/42/segments
{ "baseVersion": 17, "source": "MANUAL", "label": null,
  "segments": [ { "id": "7f1c…", "section_no": 2, "section": "Lý thuyết", "topic_no": 1,
                  "topic": "Vòng lặp for", "slug": "vong_lap_for", "start_id": "S0010", "end_id": "S0042",
                  "start": 61.2, "end": 245.8 } ] }
// 200 (các trường của F00 + version)
{ "videoId": 42, "version": 18, "versionId": 311, "savedAt": "2026-11-17T08:12:03Z",
  "saved": 12, "discarded": 1, "restored": 0, "staleParts": 2 }
// 409
{ "error": { "code": "VERSION_CONFLICT", "message": "Dự án đã được người khác lưu sau khi bạn mở",
  "details": { "currentVersion": 19, "savedBy": "Trần Quang Minh", "savedAt": "2026-11-17T08:11:40Z" } } }
```

Endpoint cũ `/save` và `POST /{id}/segments` theo F00 FR-8 (gọi chung hàm upsert, không kiểm tra version). Sau khi frontend chuyển xong thì xoá.

### 6.3 Backend
- **Mới** `entity/ProjectVersionEntity.java`, `repository/ProjectVersionRepository.java`.
- **Mới** `service/ProjectVersionService.java`:
  - `SaveResult save(Long videoId, long baseVersion, List<Segment> segs, String source, String label, Long userId)`: khoá video, kiểm tra version, gọi `upsertSegments` (F00), tạo snapshot.
  - `VersionSummary saveDetached(...)`, `List<VersionSummary> list(...)`, `VersionDetail get(...)`, `SaveResult restore(videoId, versionId, baseVersion, userId)`.
- Luồng analyze (F00 FR-4) gọi `save(..., source="AI_ANALYZE")` với `baseVersion` hiện tại.
- Bắt `ObjectOptimisticLockingFailureException` rồi chuyển thành 409, đặt trong `@RestControllerAdvice` chung (cũng dùng cho định dạng lỗi chung trong README).
- Job dọn AUTOSAVE: một dòng `jobs` (F09, AD-10) lên lịch hằng ngày lúc 03:30, xoá các bản `AUTOSAVE` cũ hơn bản thứ 50 của mỗi video.

### 6.5 Frontend
- `types/index.ts`: thêm `SegmentsData.version?: number`. `videoId` lấy từ state dự án (F00 FR-1).
- `lib/api.ts`: `saveSegments(videoId, body)` (của F00) trả về `{ ok, data } | { conflict } | { error }`, **không** tự lùi về `localStorage`. Thêm `listVersions`, `getVersion`, `saveDetachedVersion`, `restoreVersion`, `renameVersion`.
- **Mới** `components/VersionHistoryDrawer.tsx`, `components/ConflictDialog.tsx`.
- **Mới** `lib/segmentDiff.ts`: `diffSegments(a, b) → { added, removed, changed }` theo `id`.
- `page.tsx`: giữ `serverVersion` trong state và cập nhật sau mỗi lần lưu thành công. Thêm nút "Lịch sử" vào `StudioHeader`. Sau khi khôi phục thì `reset()` lịch sử Undo (F31), vì nội dung đổi từ phía máy chủ.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* tab A và B cùng mở ở version 17, A lưu thành 18, *When* B lưu với `baseVersion=17`, *Then* B nhận 409, hộp thoại xung đột hiện tên người dùng của A, và DB không thay đổi.
- **AC-2** — *When* khôi phục bản 12 trong khi hiện tại là 18, *Then*:
  - Tạo bản 19 với `source=RESTORE` và `restored_from` trỏ tới bản 12.
  - Danh sách topic ACTIVE giống bản 12 (so sánh theo `id`, bỏ qua `parts`).
  - Các bản 13–18 vẫn còn.
- **AC-3** — *Given* topic T (topicId=101) có trong bản 12 nhưng đã bị bỏ ở bản 15, *When* khôi phục bản 12, *Then* T trở lại ACTIVE với **topicId=101** và các bảng con của T vẫn còn.
- **AC-4** — *Given* bản 12 có 2 khoảng bị bỏ USER, hiện tại có 5 khoảng USER và 30 khoảng AUTO, *When* khôi phục bản 12, *Then* còn 2 khoảng USER và 30 khoảng AUTO.
- **AC-5** — *Given* nhận 409, *When* chọn "Lưu bản của tôi thành phiên bản riêng", *Then* có thêm một dòng `source=DETACHED`, `version_no IS NULL`, và `videos.version` không đổi.
- **AC-6** — *Given* backend tắt, *When* nhấn Ctrl+S, *Then* toast **không** chứa chữ "Đã lưu".
- **AC-7** — *When* lưu cùng một payload hai lần với `source=AUTOSAVE`, *Then* lần thứ hai không tạo snapshot và không tăng version.
- **AC-8** — *Given* user có `video_access=VIEWER`, *When* gọi `POST /versions/{id}/restore`, *Then* nhận 403 `FORBIDDEN_ACTION`.
- **AC-9** — *Given* video đã analyze 1 lần, *When* chạy analyze lại và AI trả kết quả y hệt, *Then* vẫn có thêm đúng một dòng `project_versions` với `source='AI_ANALYZE'`.

## 8. Kế hoạch kiểm thử (TDD)
- `ProjectVersionServiceTest` (Postgres qua Testcontainers hoặc `TEST_DATABASE_URL`, AD-7):
  - `save_withStaleBaseVersion_throwsConflictAndWritesNothing`
  - `save_incrementsVersionAndCreatesSnapshotWithEditRanges`
  - `save_identicalAutosave_noNewVersion`
  - `analyze_alwaysCreatesAiAnalyzeVersion_evenIfIdentical`
  - `saveDetached_versionNoNull_videoVersionUnchanged`
  - `restore_reactivatesDiscardedTopicWithSameId`
  - `restore_replacesOnlyUserEditRanges`
  - `restore_createsNewVersionWithRestoredFrom`
  - `cleanup_keepsLatest50Autosaves_andAllOthers`
- `ProjectVersionControllerTest` (MockMvc): `put_conflict_returns409WithDetails`, `get_versions_paginates`, `restore_viewer_returns403`, `getVersion_otherVideo_returns404`.
- `ProjectVersionsMigrationTest`: hai bản `DETACHED` cùng video không vi phạm unique; bản `MANUAL` có `version_no` NULL thì bị CHECK chặn.
- Frontend: `segmentDiff.test.ts` gồm `diff_detectsAddedRemovedChanged`, `diff_ignoresPartsField`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Frontend cũ vẫn gọi `/save` | Không có kiểm tra version | Giữ endpoint cũ nhưng log cảnh báo (F00 FR-8). Đặt thời hạn xoá |
| Snapshot phình to | Tốn dung lượng DB | Giới hạn bản AUTOSAVE (FR-3), theo dõi bằng F15 |
| Người dùng chọn "Ghi đè" quá dễ dàng | Mất công người khác | Chỉ `OWNER`, xác nhận lần 2, ghi audit log (F08) |
| Khôi phục một bản rất cũ có topic mà clip đã bị dọn | Clip thiếu | Part của topic đó ở trạng thái `STALE`, giao diện báo "Cần render lại" |

## 10. Câu hỏi mở
- [ ] Có giữ thư mục `output/users/<user>/<lesson>/project.json` và đồng bộ R2 ở `/save` không, hay DB là nguồn sự thật duy nhất? Đề xuất: DB là nguồn sự thật. R2 chỉ để sao lưu, chạy nền.
- [x] Ai được phép "Ghi đè" khi xung đột? **Đã chốt theo AD-1:** chỉ `OWNER` của video (hoặc `ORG_ADMIN`).
- [ ] Giới hạn 50 bản AUTOSAVE có phù hợp không?
