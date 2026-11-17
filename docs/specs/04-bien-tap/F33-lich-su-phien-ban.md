# F33 — Lịch sử phiên bản & chống ghi đè

| Mục | Giá trị |
|---|---|
| **Mã** | F33 |
| **Nhóm** | Biên tập |
| **Ưu tiên** | P1 |
| **Người phụ trách gợi ý** | SV3 (Core API/DB) + SV4 (giao diện) |
| **Phụ thuộc** | F01, F02 (biết ai lưu, có quyền gì), F13 (Flyway). F34 (Tự lưu) xây trên spec này. |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | Không |
| **Tham khảo** | Google Docs (Version history), Figma (Version history), Descript (Project versions) |

## 1. Bối cảnh & vấn đề

1. **Lưu là xoá sạch rồi ghi lại.** `SegmentPersistenceService.saveSegmentsToDatabase` xoá toàn bộ `sections` của video ([SegmentPersistenceService.java:87-92](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L87-L92)) rồi tạo mới. Các bảng con bị xoá dây chuyền (cascade) theo, nên:
   - `topics.id` thay đổi sau mỗi lần lưu. Mọi thứ trỏ tới topic (bình luận F35, thống kê F47) sẽ bị gãy.
   - `video_parts` của các clip **đã render** bị xoá rồi tạo lại với `status='COMPLETED'` và `file_size=0` lấy từ dữ liệu frontend gửi lên ([:131-140](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L131-L140)). Trạng thái render thật bị mất.
2. **Không chống ghi đè.** Hai người, hoặc hai tab, cùng sửa một video thì người lưu sau ghi đè người lưu trước mà không có cảnh báo. Cột `videos.version` đã có `@Version` ([VideoEntity.java:53-55](../../../backend/src/main/java/com/autocut/entity/VideoEntity.java#L53-L55)), `topics.version` cũng có, nhưng API `/save` ([VideoController.java:1145](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1145)) không nhận và không kiểm tra version nào.
3. **Lưu luôn đánh dấu "đã duyệt".** Mỗi lần lưu đều đặt `video.setReviewed(true)` ([SegmentPersistenceService.java:152](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L152)), kể cả lần lưu nháp.
4. **Tìm video theo tên gần đúng.** `/save` tìm video bằng `findVideo(videoTarget)`, nếu không thấy thì thử `findVideo(safeLesson)` ([VideoController.java:1192-1196](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1192-L1196)), nên có thể ghi nhầm sang video khác.
5. **Báo lỗi sai.** Frontend lưu lỗi nhưng vẫn báo "Đã lưu dự án vào bộ nhớ cục bộ" ([page.tsx:669-678](../../../frontend/src/app/page.tsx#L669-L678), [api.ts:457-479](../../../frontend/src/lib/api.ts#L457-L479)). Người dùng tưởng đã lưu thành công.
6. **Không có lịch sử.** Muốn quay lại bản phân đoạn của AI sau khi đã sửa tay thì không có cách nào.

## 2. Mục tiêu
- Mỗi lần lưu tạo một **phiên bản (snapshot)**. Người dùng xem được danh sách phiên bản, xem trước và khôi phục.
- **Khoá lạc quan (optimistic locking):** lưu phải gửi kèm `baseVersion`. Nếu `baseVersion` lệch với bản trên máy chủ thì trả 409 để client xử lý xung đột.
- Lưu theo kiểu **cập nhật tại chỗ (upsert) theo id ổn định** thay cho xoá rồi tạo lại, để giữ `topics.id` và `video_parts`.

### Ngoài phạm vi
- Nhiều người sửa cùng lúc theo thời gian thực (CRDT/OT, kiểu Google Docs). F36 chỉ hiển thị ai đang sửa.
- Tự động trộn hai bản xung đột (3-way merge). Client chọn giữ bản nào.

## 3. User stories
- Là giảng viên, tôi muốn quay lại bản phân đoạn gốc do AI tạo sau khi trợ giảng sửa hỏng.
- Là trợ giảng, nếu đồng nghiệp vừa lưu trước tôi, tôi muốn được báo để không vô tình xoá công của họ.
- Là biên tập viên, tôi muốn đặt tên cho một phiên bản, ví dụ "Bản gửi thầy duyệt".

## 4. Yêu cầu chức năng
- **FR-1** Mỗi segment có **id ổn định** do client tạo (UUID v4, lưu ở `Segment.id`). Backend lưu vào cột `topics.client_id`. Các segment cũ dạng `seg_01` được giữ nguyên làm `client_id`.
- **FR-2** `PUT /segments` nhận `{ baseVersion, segments, label?, source }`, xử lý trong một transaction:
  1. Khoá dòng video bằng `SELECT ... FOR UPDATE`, hoặc dùng `@Version` của JPA.
  2. Nếu `baseVersion != videos.version` thì trả **409** `VERSION_CONFLICT`, kèm `currentVersion`, người lưu gần nhất và thời điểm lưu.
  3. Upsert topic theo `client_id`. Topic không còn trong payload thì đặt `status='DISCARDED'` (xoá mềm, khớp `schema.sql`), **không xoá hẳn**.
  4. Không đụng tới `video_parts` có `status` khác `PENDING`. Nếu `start`/`end` của topic thay đổi thì các part tương ứng chuyển sang `STALE` (trạng thái mới, nghĩa là cần render lại).
  5. Tăng `videos.version` và ghi một dòng vào `project_versions`.
- **FR-3** Nguồn của phiên bản (`source`): `AI_ANALYZE` (sau khi analyze), `MANUAL` (Ctrl+S), `AUTOSAVE` (F34), `RESTORE`.
- **FR-4** Giữ **tất cả** phiên bản `MANUAL`, `AI_ANALYZE`, `RESTORE`. Phiên bản `AUTOSAVE` chỉ giữ 50 bản gần nhất mỗi video. Một job hằng ngày dọn phần cũ.
- **FR-5** Bảng "Lịch sử phiên bản" (drawer bên phải) hiện danh sách gồm thời gian, người lưu, nguồn, nhãn, số đoạn và tổng thời lượng. Bấm vào một bản để **xem trước** ở chế độ chỉ đọc. Timeline tô màu đoạn thêm (xanh), đoạn xoá (đỏ), đoạn đổi biên (vàng) so với bản hiện tại.
- **FR-6** "Khôi phục bản này" tạo ra một phiên bản **mới** có nội dung giống bản cũ (`source=RESTORE`). Không xoá lịch sử.
- **FR-7** Đặt hoặc sửa nhãn cho một phiên bản (tối đa 100 ký tự).
- **FR-8** Khi gặp 409, frontend hiện hộp thoại ba lựa chọn:
  - "Tải bản mới nhất": bỏ thay đổi của mình.
  - "Ghi đè bằng bản của tôi": gửi lại với `baseVersion = currentVersion`. Chỉ người có quyền Biên tập trở lên.
  - "Lưu bản của tôi thành phiên bản riêng": lưu snapshot, không áp dụng vào video.
- **FR-9** Bỏ việc tự đặt `reviewed=true` khi lưu. Trạng thái duyệt do F35 quản lý.
- **FR-10** Frontend chỉ báo "Đã lưu" khi máy chủ trả 2xx. Lỗi mạng thì báo "Chưa lưu được — đang giữ bản tạm trên máy này", không dùng chữ "Đã lưu".

## 5. Yêu cầu phi chức năng
- `PUT /segments` với 200 segment hoàn thành trong dưới 500 ms (p95).
- Một snapshot khoảng 50–200 KB JSON. Ước tính 1.000 video × 60 bản ≈ 6–12 GB. Nén bằng TOAST (Postgres tự nén JSONB lớn) là đủ. Theo dõi qua F15.

## 6. Thiết kế kỹ thuật
### 6.1 Cơ sở dữ liệu
`V<n>__project_versions.sql`
```sql
ALTER TABLE topics ADD COLUMN IF NOT EXISTS client_id VARCHAR(64);
UPDATE topics SET client_id = 'legacy_' || id WHERE client_id IS NULL;
ALTER TABLE topics ALTER COLUMN client_id SET NOT NULL;
-- client_id là duy nhất trong phạm vi 1 video (join qua section)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS video_id BIGINT REFERENCES videos(id) ON DELETE CASCADE;
UPDATE topics t SET video_id = s.video_id FROM sections s WHERE t.section_id = s.id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_video_client ON topics(video_id, client_id);

CREATE TABLE IF NOT EXISTS project_versions (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    version_no BIGINT NOT NULL,              -- = videos.version sau khi lưu
    source VARCHAR(20) NOT NULL,             -- AI_ANALYZE | MANUAL | AUTOSAVE | RESTORE
    label VARCHAR(100),
    snapshot JSONB NOT NULL,                 -- { segments: [...], cutRanges: [...] }
    segment_count INTEGER NOT NULL,
    total_duration DOUBLE PRECISION NOT NULL,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_video_version UNIQUE (video_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_pv_video_created ON project_versions(video_id, created_at DESC);

-- Mở rộng trạng thái video_parts: PENDING | RENDERING | COMPLETED | FAILED | STALE
```

### 6.2 API (controller mới `ProjectVersionController`, path gốc `/api/v1/videos/{videoId}`)
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/segments` | Xem | Bản hiện tại + `version` |
| PUT | `/segments` | Biên tập | Lưu, kiểm tra `baseVersion` |
| GET | `/versions?limit=50&before=<id>` | Xem | Danh sách phiên bản (không có snapshot) |
| GET | `/versions/{versionId}` | Xem | Chi tiết, có snapshot |
| PATCH | `/versions/{versionId}` | Biên tập | Đổi nhãn |
| POST | `/versions/{versionId}/restore` | Biên tập | Khôi phục (tạo bản mới) |

```json
// PUT /api/v1/videos/42/segments
{ "baseVersion": 17, "source": "MANUAL", "label": null,
  "segments": [ { "id": "7f1c…", "section_no": 2, "section": "Lý thuyết", "topic_no": 1,
                  "topic": "Vòng lặp for", "slug": "vong_lap_for", "start_id": "S0010", "end_id": "S0042",
                  "start": 61.2, "end": 245.8, "parts": [] } ] }
// 200
{ "videoId": 42, "version": 18, "versionId": 311, "savedAt": "2026-11-17T08:12:03Z",
  "staleParts": 2 }
// 409
{ "error": { "code": "VERSION_CONFLICT", "message": "Dự án đã được người khác lưu sau khi bạn mở",
  "details": { "currentVersion": 19, "savedBy": "Trần Quang Minh", "savedAt": "2026-11-17T08:11:40Z" } } }
```

Endpoint cũ `POST /api/video/save` và `POST /api/video/{id}/segments` giữ một thời gian để tương thích, gắn `@Deprecated`, và trả header `Deprecation: true`. Sau 1 sprint thì xoá.

### 6.3 Backend
- **Mới** `entity/ProjectVersionEntity.java`, `repository/ProjectVersionRepository.java`.
- **Mới** `service/ProjectVersionService.java`:
  - `SaveResult save(Long videoId, long baseVersion, List<Segment> segs, String source, String label, Long userId)`
  - `List<VersionSummary> list(...)`, `VersionDetail get(...)`, `SaveResult restore(...)`
- **Sửa** `SegmentPersistenceService.saveSegmentsToDatabase`: thay "xoá hết rồi tạo lại" bằng `upsertSegments(video, segs)`:
  - Map `client_id → TopicEntity`. Cập nhật topic đã có, tạo topic mới, đặt `DISCARDED` cho topic vắng mặt.
  - Section: upsert theo `(video_id, label)`.
  - Chuyển part sang `STALE` khi biên topic lệch quá 0,05 giây.
- **Sửa** `getSegmentsFromDatabase` ([:201](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L201)): lọc bỏ topic `DISCARDED`, trả thêm `version`.
- **Sửa** `TopicEntity`: thêm `clientId` và `videoId`.
- Bắt `ObjectOptimisticLockingFailureException` rồi chuyển thành 409, đặt trong `@RestControllerAdvice` chung (cũng dùng cho định dạng lỗi chung trong README).
- Job dọn dẹp `@Scheduled(cron = "0 30 3 * * *")`: xoá bản `AUTOSAVE` cũ hơn bản thứ 50.

### 6.5 Frontend
- `types/index.ts`: thêm `SegmentsData.version?: number`. `Segment.id` bắt buộc dùng UUID cho segment mới (`crypto.randomUUID()`) ở mọi nơi tạo segment: split, AI analyze, thêm thủ công.
- `lib/api.ts`: thêm `saveSegments(videoId, body)` trả về `{ ok, data } | { conflict } | { error }`, **không** tự lùi về localStorage. Thêm `listVersions`, `getVersion`, `restoreVersion`, `renameVersion`.
- **Mới** `components/VersionHistoryDrawer.tsx`, `components/ConflictDialog.tsx`.
- **Mới** `lib/segmentDiff.ts`: `diffSegments(a, b) → { added, removed, changed }` theo `id`.
- `page.tsx`: giữ `serverVersion` trong state và cập nhật sau mỗi lần lưu thành công. Thêm nút "Lịch sử" vào `StudioHeader`.

## 7. Tiêu chí chấp nhận
- **AC-1** — *Given* video có topic id=101 đã render (part COMPLETED), *When* sửa tên topic rồi lưu, *Then* topic vẫn là id=101 và part vẫn COMPLETED.
- **AC-2** — *Given* đổi `end` của topic 101 từ 245,8 thành 250,0, *When* lưu, *Then* part của topic 101 chuyển `STALE` và response có `staleParts: 1`.
- **AC-3** — *Given* tab A và B cùng mở ở version 17, A lưu thành 18, *When* B lưu với `baseVersion=17`, *Then* B nhận 409 và hộp thoại xung đột hiện tên người dùng của A.
- **AC-4** — *When* khôi phục bản 12 trong khi hiện tại là 18, *Then* tạo bản 19 với `source=RESTORE`, nội dung segments giống bản 12 (so sánh JSON bỏ qua trường `parts`), và các bản 13–18 vẫn còn.
- **AC-5** — *Given* backend tắt, *When* nhấn Ctrl+S, *Then* toast **không** chứa chữ "Đã lưu".
- **AC-6** — *When* lưu, *Then* `videos.reviewed` không bị đổi.
- **AC-7** — *Given* topic vắng mặt trong payload, *Then* trong DB topic đó có `status='DISCARDED'` và không xuất hiện ở `GET /segments`.

## 8. Kế hoạch kiểm thử (TDD)
- `ProjectVersionServiceTest` (H2 hoặc Testcontainers Postgres):
  - `save_withStaleBaseVersion_throwsConflict`
  - `save_incrementsVersionAndCreatesSnapshot`
  - `save_keepsTopicIdForSameClientId`
  - `save_missingClientId_marksDiscarded`
  - `save_changedBoundary_marksPartsStale`
  - `save_doesNotTouchReviewedFlag`
  - `restore_createsNewVersionWithOldSnapshot`
  - `cleanup_keepsLatest50Autosaves_andAllManual`
- `ProjectVersionControllerTest` (MockMvc): `put_conflict_returns409WithDetails`, `get_versions_paginates`.
- Sửa `SegmentPersistenceServiceTest` hiện có cho đúng hành vi mới. Theo CONSTRAINTS §1, khi đổi assertion phải ghi lý do trong PR.
- Frontend: `segmentDiff.test.ts` gồm `diff_detectsAddedRemovedChanged`, `diff_ignoresPartsField`.

## 9. Rủi ro & failure modes
| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Migration `client_id` trên dữ liệu cũ | Trùng `client_id` trong một video | Gán `legacy_<id>` trước khi tạo unique index |
| Frontend cũ vẫn gọi `/save` | Không có kiểm tra version | Giữ endpoint cũ nhưng log cảnh báo. Đặt thời hạn xoá |
| Snapshot phình to | Tốn dung lượng DB | Giới hạn bản AUTOSAVE (FR-4), theo dõi bằng F15 |
| Người dùng chọn "Ghi đè" quá dễ dàng | Mất công người khác | Ghi đè phải xác nhận lần 2 và được ghi vào audit log (F08) |

## 10. Câu hỏi mở
- [ ] Có giữ thư mục `output/users/<user>/<lesson>/project.json` và đồng bộ R2 ở `/save` không, hay DB là nguồn sự thật duy nhất? Đề xuất: DB là nguồn sự thật. R2 chỉ để sao lưu, chạy nền.
- [ ] Ai được phép "Ghi đè" khi xung đột: chỉ chủ video hay mọi Biên tập viên?
- [ ] Giới hạn 50 bản AUTOSAVE có phù hợp không?
