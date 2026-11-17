# F20 — Nhận diện người nói (Speaker Diarization)

| Mục | Giá trị |
|---|---|
| **Mã** | F20 |
| **Nhóm** | AI |
| **Ưu tiên** | P2 |
| **Người phụ trách gợi ý** | SV2 (pipeline) + SV3 (lưu DB) + SV4 (hiển thị) |
| **Phụ thuộc** | F10 (job bất đồng bộ, vì bước này chậm), F13 |
| **Ước lượng** | L (1–2 tuần) |
| **Thư viện mới cần duyệt** | **Có, chọn 1 trong 2:** (A) `pyannote.audio` 3.x (MIT, cần token HuggingFace, chạy chậm trên CPU); (B) dùng API có diarization sẵn (AssemblyAI / Deepgram, trả phí theo phút). Trưởng nhóm chọn, xem Câu hỏi mở |
| **Tham khảo** | Otter.ai, Riverside, Descript "Speaker labels" |

## 1. Bối cảnh & vấn đề

- Bảng `transcripts` đã có cột `speaker VARCHAR(50) DEFAULT 'spk_0'` ([schema.sql](../../../database/schema.sql), bảng 3), và `TranscriptEntity.speaker` ([TranscriptEntity.java:24](../../../backend/src/main/java/com/autocut/entity/TranscriptEntity.java#L24)) cũng mặc định `spk_0`. Tuy vậy, **không có bước nào ghi giá trị khác**.
- Model Python `Sentence` ([models.py:15](../../../backend/ai/models.py)) chưa có trường speaker. `whisper_service.py` đặt `word_timestamps=False` (dòng 234), nên không có mốc từng từ để căn người nói chính xác.
- `config.yaml` có nhãn section "Hỏi đáp" (dòng 10), nhưng LLM chỉ đoán phần hỏi đáp dựa trên chữ. Thông tin "ai đang nói" sẽ giúp phân đoạn và cắt bỏ phần sinh viên nói chuyện riêng chính xác hơn.

## 2. Mục tiêu

- Mỗi câu transcript có `speaker` (`spk_0`, `spk_1`...) và, nếu được, một tên hiển thị do người dùng đặt ("Giảng viên", "Sinh viên").
- Tự động gợi ý người nói nhiều nhất là "Giảng viên".
- LLM phân đoạn nhận thêm thông tin người nói để nhận ra phần Hỏi đáp.
- Người dùng có thể lọc transcript theo người nói và gộp hai nhãn khi AI tách nhầm một người thành hai.

### Ngoài phạm vi

- Không nhận dạng danh tính bằng giọng nói (voice ID) xuyên video.
- Không tách các giọng nói chồng lên nhau (overlap).

## 3. User stories

- Là giảng viên, tôi muốn thấy câu nào là sinh viên hỏi để giữ lại hoặc cắt bỏ phần hỏi đáp.
- Là biên tập viên, tôi muốn đổi `spk_1` thành "Bạn Minh" một lần và áp cho cả video.

## 4. Yêu cầu chức năng

- **FR-1** Bật/tắt bằng `transcript.diarization: true|false` trong `config.yaml` và theo preset (F28). Mặc định `false`.
- **FR-2** Pipeline: chạy diarization trên audio đã tách (dùng lại `extract_audio_if_needed` ở [gemini_transcriber.py:32](../../../backend/ai/gemini_transcriber.py)) → ra danh sách khoảng `(start, end, speaker)` → gán cho mỗi câu người nói có **thời gian chồng lấp lớn nhất**.
- **FR-3** Hai nhãn bị coi là cùng một người khi người dùng chọn "Gộp người nói". Thao tác này cập nhật mọi câu của video.
- **FR-4** Đổi tên hiển thị: bảng `video_speakers(video_id, speaker_key, display_name, role)`, trong đó `role ∈ {LECTURER, STUDENT, OTHER}`.
- **FR-5** Truyền vào prompt phân đoạn ([transcript_refiner.py:337](../../../backend/ai/transcript_refiner.py)) dòng câu dạng `S0123 [412.0s-415.2s] (SV): ...`, kèm chỉ dẫn "Các đoạn có nhiều câu (SV) xen kẽ thường là phần Hỏi đáp".
- **FR-6** Câu nằm trong khoảng mà diarization không trả kết quả thì giữ `spk_0` và gắn `speaker_confidence = 0`.

## 5. Yêu cầu phi chức năng

- Phương án A (pyannote, CPU) cho video 60 phút phải xong ≤ 1,5 lần thời lượng video. Nếu không đạt thì bắt buộc dùng GPU hoặc chuyển sang phương án B.
- Diarization lỗi **không được** làm hỏng cả job analyze: ghi log, gán `spk_0` cho mọi câu và chạy tiếp (cảnh báo hiển thị trên UI).
- Token HuggingFace hoặc API key để trong `.env`, không commit (F07).

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

`V<n>__add_speakers.sql`:
```sql
ALTER TABLE transcripts ADD COLUMN speaker_confidence DOUBLE PRECISION;
CREATE TABLE video_speakers (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    speaker_key VARCHAR(50) NOT NULL,
    display_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'OTHER',
    talk_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT uq_video_speaker UNIQUE (video_id, speaker_key)
);
```

### 6.2 API

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/v1/videos/{id}/speakers` | Chủ video | Danh sách người nói + tổng thời lượng nói |
| PUT | `/api/v1/videos/{id}/speakers/{key}` | Chủ video | Đổi `display_name`, `role` |
| POST | `/api/v1/videos/{id}/speakers/merge` | Chủ video | `{ "from": "spk_2", "into": "spk_0" }` |

```json
// GET /api/v1/videos/12/speakers
[
  { "key": "spk_0", "displayName": "Giảng viên", "role": "LECTURER", "talkSeconds": 4980.2 },
  { "key": "spk_1", "displayName": null, "role": "STUDENT", "talkSeconds": 140.5 }
]
```

`GET /api/video/{id}/transcripts` trả thêm `speaker` trong mỗi câu (`Models.Sentence` thêm trường nullable `speaker`).

### 6.3 Backend (Spring Boot)

- `entity/VideoSpeakerEntity.java`, `repository/VideoSpeakerRepository.java`, `controller/SpeakerController.java`.
- `SegmentPersistenceService.saveTranscriptToDatabase` ([dòng 165](../../../backend/src/main/java/com/autocut/service/SegmentPersistenceService.java#L165)): ghi `speaker`, `speaker_confidence` lấy từ JSON và dựng `video_speakers` (tính `talk_seconds`, gợi ý `LECTURER` cho người nói lâu nhất).
- Merge chạy trong một transaction: `UPDATE transcripts SET speaker=:into WHERE video_id=:id AND speaker=:from`, sau đó xoá dòng `from` trong `video_speakers`.

### 6.4 AI pipeline (Python)

- Tệp mới `backend/ai/diarization.py`:
  ```python
  def diarize(audio_path: Path, min_speakers: int = 1, max_speakers: int = 4) -> list[SpeakerTurn]: ...
  def assign_speakers(sentences: list[Sentence], turns: list[SpeakerTurn]) -> list[Sentence]: ...
  ```
  `assign_speakers` là hàm thuần (không gọi mạng, không đọc tệp) nên test được mà không cần model.
- `models.py`: `Sentence` thêm `speaker: Optional[str] = None`, `speaker_confidence: Optional[float] = None`, **không** đặt `exclude`.
- `cli.py`: thêm cờ `--diarize`. Trong `run_backend_analysis`, gọi sau bước transcript, trước `segment_transcript`.
- `transcript_refiner.segment_transcript`: khi câu có `speaker`, thêm nhãn `(GV)` / `(SV)` vào dòng định dạng (dòng ~327) và thêm chỉ dẫn FR-5 vào prompt.
- Cache kết quả diarization theo hash audio: `cache/<hash>_diar.json`.

### 6.5 Frontend (Next.js)

- `TranscriptScenesPanel.tsx`: mỗi câu có chip tên người nói, màu lấy theo thứ tự từ một bảng token sẵn có. Có bộ lọc "Chỉ hiện: Giảng viên / Sinh viên".
- Popup "Quản lý người nói": đổi tên, chọn vai trò, gộp nhãn.
- `types/index.ts` `Sentence`: thêm `speaker?: string`.

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* hai lượt nói `[0–10s spk_0]`, `[10–20s spk_1]` và câu `[8–14s]`. *When* `assign_speakers`. *Then* câu được gán `spk_1` (chồng lấp 4s > 2s).
- **AC-2** — *Given* video mẫu 10 phút có 2 người nói đã gán nhãn tay. *When* chạy diarization. *Then* tỉ lệ câu gán đúng người nói ≥ 85%.
- **AC-3** — *Given* thư viện diarization ném lỗi. *When* analyze. *Then* job vẫn `COMPLETED`, mọi câu là `spk_0` và response có `warnings: ["Không nhận diện được người nói"]`.
- **AC-4** — *Given* gộp `spk_2` vào `spk_0`. *Then* không còn câu nào là `spk_2` và `talk_seconds` của `spk_0` được cộng thêm.
- **AC-5** — *Given* `diarization: false`. *Then* pipeline không import thư viện diarization (kiểm bằng test import).

## 8. Kế hoạch kiểm thử (TDD)

pytest (`tests/test_f20_diarization.py`):
- `test_assign_speakers_max_overlap()`
- `test_assign_speakers_no_overlap_defaults_spk0_with_zero_confidence()`
- `test_sentence_model_serializes_speaker()`
- `test_run_backend_analysis_diarization_failure_falls_back()` (mock `diarize` ném lỗi)
- `test_segment_prompt_includes_speaker_tags_when_present()`

JUnit:
- `SegmentPersistenceServiceTest.saveTranscript_persistsSpeakerAndBuildsSpeakerTable()`
- `SpeakerControllerTest.merge_updatesAllSentences()`
- `SpeakerControllerTest.rename_requiresOwnership()`

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| pyannote nặng (torch ~2 GB), chậm trên CPU | Job rất lâu, image Docker phình to | Tách thành worker riêng có tuỳ chọn GPU; hoặc chọn phương án B |
| Mic giảng viên to, mic sinh viên nhỏ nên không bắt được | Bỏ sót người hỏi | Chấp nhận; cho người dùng gán tay từng câu |
| Gửi audio ra API bên ngoài (phương án B) | Quyền riêng tư nội dung bài giảng | Ghi rõ trong điều khoản; có tuỳ chọn tắt theo tổ chức |

## 10. Câu hỏi mở

- [ ] Chọn phương án A (pyannote, tự chạy) hay B (API trả phí)? Máy chủ có GPU không?
- [ ] Có bật mặc định cho preset "hội thảo / tọa đàm" (F28) không?
- [ ] Có cần nút "cắt bỏ mọi đoạn của người nói X" (kết hợp F25) không?
