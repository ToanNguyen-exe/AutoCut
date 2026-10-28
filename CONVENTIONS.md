# BỘ QUY TẮC PHÁT TRIỂN DỰ ÁN AUTOCUT (PROJECT CONVENTIONS & CODING GUIDELINES)

Tài liệu này là quy ước bắt buộc áp dụng chung cho tất cả thành viên trong nhóm (SV1, SV2, SV3, SV4) và AI trợ lý. Mọi Pull Request vi phạm các quy tắc dưới đây sẽ bị từ chối hợp nhất vào nhánh `main`.

---

## 1. PHÂN CÔNG TRÁCH NHIỆM & PHẠM VI (WHO DOES WHAT)

| Thành viên | Phân hệ phụ trách | Ngôn ngữ & Công nghệ | Thư mục làm việc |
| :--- | :--- | :--- | :--- |
| **SV1** | Video Engine | Java (ProcessBuilder), FFmpeg, ffprobe | `backend/src/main/java/com/autocut/engine/` |
| **SV2** | AI Pipeline | Java (HttpClient), Whisper API, Prompting | `backend/src/main/java/com/autocut/ai/` |
| **SV3** | Core & REST API | Spring Boot, Cache, DTO, Config, System Orchestrator | `backend/src/main/java/com/autocut/service/`, `controller/`, `dto/` |
| **SV4** | Web Frontend & QA | Next.js 14, React, TailwindCSS, TypeScript | `frontend/src/` |

---

## 2. QUY TẮC ĐẶT TÊN (NAMING CONVENTIONS)

### 2.1. File và Thư mục mã nguồn
* **Java Class / Record / Interface:** `PascalCase`  
  * *Đúng:* `VideoController.java`, `CacheService.java`, `Models.java`  
  * *Sai:* `video_controller.java`, `cacheService.java`
* **Java Package:** `lowercase` viết liền, không dấu gạch  
  * *Đúng:* `package com.autocut.service;`, `package com.autocut.dto;`
* **React Component & Page:** `PascalCase` cho component, `page.tsx`/`layout.tsx` theo chuẩn Next.js  
  * *Đúng:* `ReviewTable.tsx`, `VideoPlayer.tsx`, `app/page.tsx`  
  * *Sai:* `review_table.tsx`, `table.js`
* **TypeScript Types / Interfaces:** `PascalCase`  
  * *Đúng:* `Segment`, `TranscriptDTO`, `Sentence`
* **File JSON trung gian trao đổi:** `snake_case.json`  
  * *Đúng:* `segments.json`, `transcript.json`, `cut_points.json`

### 2.2. Biến và Hàm
* **Java & TypeScript:** Sử dụng `camelCase` cho biến và phương thức/hàm:  
  * *Đúng:* `computeSha256()`, `videoDuration`, `startSeconds`
* **Hằng số (Constants):** `UPPER_SNAKE_CASE`  
  * *Đúng:* `MAX_DURATION_SECONDS = 420.0;`, `BUFFER_SIZE = 65536;`

### 2.3. Thư mục xuất bản và File video con
* **Thư mục bài học:** `XX_SlugKhongDau/` (số thứ tự 2 chữ số + gạch dưới + tên không dấu viết hoa chữ cái đầu)  
  * *Đúng:* `01_LyThuyet/`, `02_ThucHanhViDu/`, `03_BaiTap/`  
  * *Sai:* `1. Lý Thuyết/`, `Bài Tập/`
* **File video cắt ra:** `XX_Slug_PhanY.mp4`  
  * *Đúng:* `01_for.mp4`, `03_do-while_Phan1.mp4`, `03_do-while_Phan2.mp4`  
  * *Sai:* `bài 1 for.mp4`, `clip(1).mp4`

---

## 3. QUY ƯỚC DỮ LIỆU & RÀNG BUỘC KỸ THUẬT (DATA CONTRACTS)

### 3.1. Đơn vị thời gian
* **Bắt buộc 100% dùng số thực đại diện cho giây (`double` trong Java, `number` trong TypeScript):**  
  * *Đúng:* `730.5` (tức 12 phút 10.5 giây), `420.0`  
  * *Tuyệt đối cấm:* Dùng chuỗi dạng `"12:10"`, `"00:12:10"`, `"12m10s"`. Mọi phép tính toán cắt gọt đều thực hiện trên số giây.

### 3.2. Mã câu bóc băng (Transcript Sentence ID)
* Bắt đầu bằng chữ `S` in hoa kèm 4 chữ số tăng dần: `S0001`, `S0002`...  
* Nếu video trên 9.999 câu: dùng 5 chữ số `S10001`.
* **Cấm LLM trả số giây:** Mô hình AI phân chia bài học chỉ được phép trả về mã câu (`start_id`, `end_id`). Việc quy đổi sang số giây do module của SV3 đảm nhiệm dựa trên dữ liệu mốc khoảng lặng âm thanh.

### 3.3. Xử lý tên file vật lý (Slugify)
* Tất cả tên bài học khi đưa vào hệ thống file phải chạy qua hàm chuẩn hóa:
  * Bỏ toàn bộ dấu tiếng Việt (ví dụ: `Vòng lặp` $\to$ `vong-lap`).
  * Xóa toàn bộ ký tự đặc biệt cấm trên hệ điều hành: `/ \ : * ? " < > |`.
  * Thay thế khoảng trắng bằng dấu gạch ngang `-` hoặc gạch dưới `_`.

---

## 4. QUY TRÌNH PHỐI HỢP GIT & LÀM VIỆC NHÓM (GIT WORKFLOW)

### 4.1. Cấu trúc nhánh (Branching Strategy)
* Nhánh `main`: Chỉ chứa mã nguồn ổn định, đã kiểm thử thành công. **Tuyệt đối không push trực tiếp lên main.**
* Mỗi thành viên chỉ làm việc trên nhánh tính năng của mình:
  * SV1: `feature/sv1-video`
  * SV2: `feature/sv2-whisper`
  * SV3: `feature/sv3-core-api`
  * SV4: `feature/sv4-frontend`

### 4.2. Cập nhật mã nguồn mới từ main
Trước khi bắt đầu code mỗi ngày, từng thành viên phải cập nhật code mới nhất từ nhóm:
```bash
git checkout main
git pull origin main
git checkout feature/ten-nhanh-cua-minh
git merge main
```

### 4.3. Quy chuẩn viết Commit (Conventional Commits)
Thông điệp commit phải rõ ràng theo cú pháp: `<tiền_tố>(<phân_hệ>): <nội dung ngắn gọn>`
* `feat(sv1): add ffprobe duration and audio stream validator`
* `feat(sv2): integrate groq whisper api with word timestamps`
* `feat(sv3): implement sha256 video fingerprint cache service`
* `feat(sv4): build review table component with manual time edit`
* `fix(...)`: Sửa lỗi phát sinh
* `test(...)`: Bổ sung bài kiểm thử tự động
* `docs(...)`: Cập nhật tài liệu kỹ thuật

### 4.4. Những thứ CẤM commit lên Git (.gitignore)
* File bí mật chứa API Key: `.env`, `credentials.json`
* File build và dependency: `node_modules/`, `target/`, `.next/`, `dist/`
* File media dung lượng lớn: Video `*.mp4`, `*.mov`, `*.mkv`, Audio `*.mp3`, `*.wav`
* File bộ nhớ đệm: `cache/*.json`

---

## 5. NGUYÊN TẮC BẢO MẬT & CHẤT LƯỢNG CODE (CODE QUALITY)

1. **Không nuốt ngoại lệ (No Silent Exceptions):** Không được viết block `catch` rỗng. Mọi ngoại lệ bắt buộc phải ghi log qua logger (`LoggerFactory.getLogger`) hoặc ném ngoại lệ tường minh.
2. **Không tràn RAM (Stream Processing):** Xử lý file video dung lượng lớn bắt buộc đọc theo luồng (buffer 64KB), không bao giờ nạp toàn bộ mảng byte của file vào bộ nhớ.
3. **Cắt video không đen hình:** Khi gọi FFmpeg cắt clip con, bắt buộc cấu hình re-encode video (`-c:v libx264 -preset fast -crf 22`) tại điểm cắt, không dùng `stream copy (-c copy)` thuần túy để tránh lỗi đứng hình đầu clip do thiếu Keyframe (I-frame).
4. **Giữ chuẩn giao diện API:** Khi có nhu cầu thay đổi bất kỳ trường nào trong các DTO/Model trao đổi, thành viên đề xuất phải thông báo toàn nhóm để SV3 và SV4 cập nhật đồng bộ cả Java và TypeScript.
