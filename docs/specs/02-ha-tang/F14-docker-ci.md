# F14 — Docker Compose + CI

| Mục | Giá trị |
|---|---|
| **Mã** | F14 |
| **Nhóm** | Hạ tầng |
| **Ưu tiên** | P0 |
| **Người phụ trách gợi ý** | SV3 (chính), SV1 (image có ffmpeg), SV2 (image Python), SV4 (frontend và CI lint) |
| **Phụ thuộc** | F13 (Flyway, bỏ H2, Testcontainers, `DatabaseConfig` không thêm `sslmode` cho host cục bộ). **Không** phụ thuộc F15: `HEALTHCHECK` dùng `GET /` có sẵn ([HomeController.java:12](../../../backend/src/main/java/com/autocut/controller/HomeController.java#L12)), khi có F15 thì đổi sang `/actuator/health/liveness`. |
| **Ước lượng** | M (3–5 ngày) |
| **Thư viện mới cần duyệt** | Không có thư viện code mới (Testcontainers đã được đề nghị duyệt ở F13; container MinIO cho test dùng `GenericContainer` có sẵn trong Testcontainers). Cần duyệt **công cụ**: Docker/Docker Compose, GitHub Actions (miễn phí với repo public, 2.000 phút/tháng với repo private), image `minio/minio` cho môi trường dev và test. |
| **Tham khảo** | Cấu trúc Docker Compose trong repo Supabase và Plausible; GitHub Actions starter workflows cho Maven, Node, Python |

> **Cập nhật 18/11/2026:** Bỏ phụ thuộc vòng với F15 (healthcheck dùng `GET /`); kết nối Postgres trong Compose không dùng SSL (AD-7, do `DatabaseConfig` của F13 xử lý); cache model chuyển ra `/opt/models` cho user không phải root; smoke test tự tạo video mẫu bằng ffmpeg; test R2 chạy trên MinIO thay vì R2 thật, không gắn tag loại khỏi CI.

## 1. Bối cảnh & vấn đề

- Lệnh chạy backend chỉ dùng được trên Windows: `"backend": "cd backend && .\\mvnw.cmd spring-boot:run"` ([package.json](../../../package.json)).
- Đường dẫn Python được **viết cứng theo máy của một thành viên**: `AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe` và `AppData/Local/Programs/Python/Python312/python.exe` ([VideoController.java:1804-1821](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L1804)). Trên Linux hoặc máy chủ chỉ còn cách dự phòng `"python"`, mà lệnh này có thể không tồn tại hoặc là Python 2.
- ffmpeg và ffprobe được giả định có sẵn trong `PATH` (`autocut.video.ffmpeg-path=${FFMPEG_PATH:ffmpeg}` ở [application.properties:19-20](../../../backend/src/main/resources/application.properties#L19)). Phiên bản ffmpeg khác nhau giữa các máy cho kết quả cắt khác nhau.
- Backend chạy Python bằng `pb.directory(projectRoot)` và `PYTHONPATH=.` ([VideoController.java:424-430](../../../backend/src/main/java/com/autocut/controller/VideoController.java#L424)), nên backend Java và AI Python **phải nằm trên cùng một máy, cùng cây thư mục**.
- `.github/` chỉ có `modernize/java-upgrade/hooks` (script của công cụ nâng cấp Java), **không có workflow CI nào**. PR được merge mà không ai chạy test tự động. Ví dụ commit `f776136 revert(frontend)...` cho thấy đã từng phải revert tay.
- Frontend không có script test; chỉ có `lint` ([frontend/package.json](../../../frontend/package.json)).
- Python có `pytest` trong [requirements.txt](../../../requirements.txt) và [tests/test_sv2_week1.py](../../../tests/test_sv2_week1.py), nhưng không ai chạy tự động.

## 2. Mục tiêu

- Một lệnh `docker compose up` dựng đủ môi trường dev: Postgres, MinIO (giả lập R2), backend (kèm Python, ffmpeg), frontend.
- Image production cho backend và frontend, có thể deploy lên bất kỳ VPS nào.
- CI trên GitHub Actions chạy với mọi PR: build và test backend, pytest, lint và build frontend. PR chỉ được merge khi CI xanh.

### Ngoài phạm vi

- Kubernetes, tự động scale.
- Tự động deploy (CD). Chỉ build image và đẩy lên GHCR; deploy vẫn làm tay theo runbook.
- Tách AI Python thành service HTTP riêng. Đã có `fastapi` trong requirements nhưng để sau; bản này vẫn gọi Python qua CLI, chung container với backend.

## 3. User stories

- Là thành viên mới, tôi muốn clone repo và chạy `docker compose up` là có hệ thống chạy được trong ≤ 15 phút.
- Là trưởng nhóm, tôi muốn PR làm hỏng test bị chặn merge.
- Là người vận hành, tôi muốn deploy bằng cách kéo image mới về rồi khởi động lại.

## 4. Yêu cầu chức năng

- **FR-1** `backend/Dockerfile` nhiều tầng (multi-stage):
  - Tầng `build`: `eclipse-temurin:17-jdk` chạy `./mvnw -B -DskipTests package`. Test chạy ở CI, không chạy trong lúc build image.
  - Tầng `runtime`: `eclipse-temurin:17-jre` + `python3.12` + `ffmpeg` (cài qua apt, ghi rõ phiên bản), cài `requirements.txt` vào `/opt/venv`, copy `backend/ai/`, `config.yaml` và jar.
  - Biến môi trường: `PYTHON_EXE=/opt/venv/bin/python`, `FFMPEG_PATH=/usr/bin/ffmpeg`, `FFPROBE_PATH=/usr/bin/ffprobe`, `AUTOCUT_HOME=/app`, `HF_HOME=/opt/models` (cache model Whisper/HuggingFace).
  - Chạy bằng user không phải root (`USER autocut`). Tạo sẵn `/app/work` và `/opt/models` rồi `chown autocut:autocut`, để volume mount vào vẫn ghi được. Không dùng `/root/.cache`, vì user `autocut` không ghi được vào đó.
  - `HEALTHCHECK` gọi `curl -fs http://localhost:8080/` (endpoint có sẵn ở `HomeController`). Khi F15 merge thì đổi sang `/actuator/health/liveness`.
- **FR-2** `frontend/Dockerfile`: dùng `output: "standalone"` của Next.js trong `next.config.mjs`; runtime là `node:20-alpine`. `NEXT_PUBLIC_API_URL` truyền qua build arg.
- **FR-3** `docker-compose.yml` ở gốc repo:
  - `postgres:16` (volume `pgdata`), `minio/minio` (volume `miniodata`) + service `minio-init` tạo bucket `autocut` và cấu hình CORS.
  - `backend` (build từ `backend/Dockerfile`, build context là gốc repo, mount volume `workdir:/app/work` cho tệp tạm và `models:/opt/models` cho model). `DATABASE_URL` trỏ tới host `postgres` không có SSL. `DatabaseConfig` (F13, AD-7) nhận ra host `postgres` nên không thêm `sslmode=require`.
  - `frontend`.
  - Biến môi trường lấy từ `.env`; `.env.example` cập nhật đủ biến.
- **FR-4** Sửa `resolvePythonExecutable()`: thứ tự ưu tiên là `PYTHON_EXE` → `python3` → `python`. **Xoá** các đường dẫn `AppData/...` viết cứng. Nếu không tìm thấy Python thì ứng dụng báo lỗi rõ ràng khi khởi động (thêm vào health check).
- **FR-5** Sửa `resolveProjectRoot()` để ưu tiên biến `AUTOCUT_HOME` nếu có.
- **FR-6** `package.json` gốc: thêm `"backend": "cd backend && ./mvnw spring-boot:run"` và `"backend:win": "cd backend && .\\mvnw.cmd spring-boot:run"`; thêm `"up": "docker compose up --build"`.
- **FR-7** `.github/workflows/ci.yml`, chạy khi có `pull_request` vào `main` và `push` lên `main`. Gồm 3 job chạy song song:
  - `backend`: setup Java 17 (temurin), cache `~/.m2`, cài `ffmpeg` (apt), chạy `./mvnw -B verify`. Postgres và MinIO cho test do **Testcontainers** tự dựng (runner `ubuntu-latest` có sẵn Docker), theo AD-7 và F13. Không cần service container, không cần `TEST_DATABASE_URL`, không cần secret.
  - `ai`: setup Python 3.12, cache pip, `pip install -r requirements.txt`, `pytest -q tests/`. Các test gọi API Gemini/Groq thật phải gắn marker `@pytest.mark.external` và bị bỏ qua trong CI bằng `-m "not external"`.
  - `frontend`: setup Node 20, `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- **FR-8** `.github/workflows/docker.yml`: khi push tag `v*` thì build và đẩy image `ghcr.io/<org>/autocut-backend:<tag>` và `autocut-frontend:<tag>`.
- **FR-9** Branch protection trên `main`: bắt buộc 3 check CI xanh và ≥ 1 người review. Trưởng nhóm cấu hình trên GitHub.
- **FR-10** CI không được có secret production. Test chỉ dùng Postgres và MinIO do Testcontainers dựng.
- **FR-12** `CloudflareR2ServiceTest` (hiện upload thật lên R2: [CloudflareR2ServiceTest.java:18-33](../../../backend/src/test/java/com/autocut/service/CloudflareR2ServiceTest.java#L18)) chuyển sang chạy trên container `minio/minio` (`GenericContainer`) ở profile `test`: `R2_ENDPOINT` trỏ tới MinIO, bucket được tạo trong `@BeforeAll`. Không xoá test, không `@Disabled`, không gắn tag loại khỏi CI (CONSTRAINTS §1). Kiểm tra với R2 thật chỉ làm thủ công trong checklist release.
- **FR-11** Tệp `docs/DEPLOY.md`: runbook deploy lên VPS (cài Docker, tạo `.env`, `docker compose -f docker-compose.prod.yml up -d`, cách xem log, cách lùi về phiên bản trước).

## 5. Yêu cầu phi chức năng

- CI mỗi PR chạy ≤ 10 phút (có cache).
- Image backend ≤ 1,5 GB (faster-whisper và ctranslate2 khá nặng); image frontend ≤ 200 MB.
- `docker compose up` lần đầu trên máy 4 nhân, mạng 50 Mbps xong trong ≤ 15 phút.
- Model Whisper **không** đóng gói vào image; tải về khi chạy lần đầu, cache ở volume `models`.

## 6. Thiết kế kỹ thuật

### 6.1 Cơ sở dữ liệu

Không thay đổi schema. Container Postgres tự chạy migration nhờ Flyway (F13).

### 6.2 API

Không có API mới.

### 6.3 Tệp cần tạo hoặc sửa

| Tệp | Hành động |
|---|---|
| `backend/Dockerfile` | Tạo mới |
| `frontend/Dockerfile` | Tạo mới |
| `.dockerignore` (gốc) và `frontend/.dockerignore` | Tạo mới: bỏ `node_modules`, `target`, `.next`, `uploads`, `output`, `cache`, `.env` |
| `docker-compose.yml` | Tạo mới (dev) |
| `docker-compose.prod.yml` | Tạo mới (không có MinIO, dùng R2 và Neon thật) |
| `.github/workflows/ci.yml`, `docker.yml` | Tạo mới |
| `frontend/next.config.mjs` | Thêm `output: "standalone"` |
| `backend/.../VideoController.java` | Sửa `resolvePythonExecutable`, `resolveProjectRoot` (FR-4, FR-5). Nên chuyển hai hàm này sang lớp `com.autocut.pipeline.PythonRunner` của F10 nếu F10 đã merge. |
| `package.json` (gốc) | Thêm script (FR-6) |
| `.env.example` | Bổ sung `PYTHON_EXE`, `AUTOCUT_HOME`, `HF_HOME`, `R2_SECRET_ACCESS_KEY` (hiện đang thiếu), `SPRING_PROFILES_ACTIVE`. Không thêm `R2_PUBLIC_URL` vì bucket là private (AD-3) |
| `docs/DEPLOY.md` | Tạo mới |
| `README.md` (gốc) | Thêm mục "Chạy nhanh bằng Docker" |

Ví dụ phần `backend` trong `docker-compose.yml`:

```yaml
backend:
  build: { context: ., dockerfile: backend/Dockerfile }
  env_file: .env
  environment:
    SPRING_PROFILES_ACTIVE: dev
    DATABASE_URL: postgres://autocut:autocut@postgres:5432/autocut
    R2_ENDPOINT: http://minio:9000
    R2_BUCKET_NAME: autocut
    PYTHON_EXE: /opt/venv/bin/python
  depends_on:
    postgres: { condition: service_healthy }
    minio-init: { condition: service_completed_successfully }
  volumes: [ "workdir:/app/work", "models:/opt/models" ]
  ports: [ "8080:8080" ]
```

Bộ khung `ci.yml`:

```yaml
name: CI
on: { pull_request: { branches: [main] }, push: { branches: [main] } }
jobs:
  backend:
    runs-on: ubuntu-latest   # có sẵn Docker cho Testcontainers (Postgres 16 + MinIO)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '17', cache: maven }
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: cd backend && ./mvnw -B verify
  ai:      # setup-python 3.12 → pip install → pytest -m "not external"
  frontend: # setup-node 20 → npm ci → lint → tsc --noEmit → build
```

### 6.5 Frontend

Chỉ có `next.config.mjs` và `Dockerfile`. Gọi API qua `NEXT_PUBLIC_API_URL` như hiện tại ([api.ts:3](../../../frontend/src/lib/api.ts#L3)).

## 7. Tiêu chí chấp nhận

- **AC-1** — *Given* một máy Linux hoặc macOS sạch, chỉ có Docker, *When* chạy `cp .env.example .env && docker compose up --build`, *Then* trong ≤ 15 phút mở được `http://localhost:3000`, upload một video mẫu 1 phút và nhận transcript.
- **AC-2** — *Given* một PR làm hỏng 1 test JUnit, *When* push, *Then* job `backend` đỏ và nút Merge bị khoá.
- **AC-3** — *Given* một PR có lỗi TypeScript, *Then* job `frontend` đỏ.
- **AC-4** — Grep `AppData` trong `backend/src/main` không còn kết quả.
- **AC-5** — *Given* container backend, *When* chạy `docker compose exec backend whoami`, *Then* kết quả khác `root`; và sau lần bóc băng đầu tiên, `/opt/models` có tệp model (user `autocut` ghi được).
- **AC-9** — *Given* `docker compose up`, *Then* backend kết nối được `postgres:5432` không qua SSL, Flyway chạy xong, `GET /` trả 200.
- **AC-6** — *Given* push tag `v0.2.0`, *Then* GHCR có 2 image gắn tag `v0.2.0`.
- **AC-7** — CI cho một PR trung bình (có cache) chạy ≤ 10 phút.
- **AC-8** — Log CI không chứa chuỗi nào trùng với secret trong `.env` production (CI không có secret production).

## 8. Kế hoạch kiểm thử (TDD)

- `PythonRunnerTest.resolveExecutable_prefersEnvVar` / `_fallsBackToPython3` / `_noPython_throwsClearError` (viết trước khi sửa hàm)
- `ProjectRootTest.autocutHomeEnv_takesPrecedence`
- `CloudflareR2ServiceTest` chạy trên MinIO (FR-12).
- Smoke test trong CI (job thứ 4, chỉ chạy trên `main`). `mock-data/` chỉ có tệp JSON, không có video, nên tự tạo video mẫu ngay trong CI:
  ```bash
  ffmpeg -f lavfi -i testsrc=duration=5:size=640x360:rate=25 \
         -f lavfi -i sine=frequency=440:duration=5 \
         -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/sample.mp4
  ```
  Các bước: `docker compose up -d` → chờ `GET /` trả 200 (hoặc `/actuator/health/liveness` khi có F15) → đăng nhập bằng tài khoản admin khởi tạo từ biến môi trường của F01 để lấy JWT → `curl -F file=@/tmp/sample.mp4` tới `POST /api/v1/videos` (F10) → kiểm HTTP 202. Nếu F10 chưa merge thì dùng endpoint cũ `/api/video/upload-sample`.
- Python: gắn marker `external` cho các test gọi API thật trong `tests/test_sv2_week1.py`. Không xoá test. Các test này được chạy định kỳ (job `nightly-external`, chạy tay hoặc theo lịch, có secret của tài khoản test riêng), để không có test nào bị bỏ hẳn.

## 9. Rủi ro & failure modes

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Image backend quá nặng do faster-whisper/torch | Build và kéo image chậm | Dùng `ctranslate2` bản CPU, không cài torch; cache layer pip |
| Phiên bản ffmpeg trên apt khác với máy dev | Test cắt video cho kết quả khác | Ghi phiên bản trong Dockerfile; test so sánh theo khoảng sai số ±0,1 giây |
| MinIO khác R2 ở vài điểm (CORS, presign) | Dev chạy được nhưng production lỗi | Có bước kiểm thử bằng R2 thật trong checklist release |
| Test hiện tại phụ thuộc mạng hoặc Neon (`NeonDatabaseTest`, `CloudflareR2ServiceTest`) | CI đỏ ngẫu nhiên | `NeonDatabaseTest` chạy trên Postgres của Testcontainers (F13 FR-7b); `CloudflareR2ServiceTest` chạy trên MinIO (FR-12). Không loại test nào khỏi CI |
| Hết 2.000 phút miễn phí/tháng (repo private) | CI ngừng chạy | Cache; chỉ chạy smoke test trên `main` |

## 10. Câu hỏi mở

- [ ] Repo trên GitHub là public hay private (ảnh hưởng hạn mức phút CI)?
- [ ] Máy chủ production là gì (VPS nào, bao nhiêu CPU/RAM, có GPU không)?
- [ ] Có dùng GHCR không, hay Docker Hub?
- [ ] Có tách AI Python thành service FastAPI riêng ngay bây giờ không? Đề xuất: chưa, để sau F10.
