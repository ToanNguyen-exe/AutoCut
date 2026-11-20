# =============================================================================
# Image backend AutoCut — Java 17 + Python 3.12 + ffmpeg, chạy chung một container.
#
# Vì sao chung một container: VideoController gọi Python bằng
#   pb.directory(projectRoot) + PYTHONPATH=. + java -m backend.ai.cli
# nên backend Java và module AI phải nằm cùng cây thư mục, cùng tiến trình cha.
# Tách thành service HTTP riêng là việc của F10, ngoài phạm vi F14.
#
# Build context là GỐC repo (cần backend/pom.xml, backend/src, backend/ai,
# config.yaml, requirements.txt ở gốc). Xem .dockerignore.
#
#   docker build -f backend/Dockerfile -t autocut-backend .
# =============================================================================

# ------------------------------------------------------------------ tầng build
# Dùng image maven chính thức thay vì eclipse-temurin + ./mvnw như spec F14 ghi.
# Lý do: wrapper trong repo là loại "only-script" (không kèm maven-wrapper.jar),
# nên mỗi lần build phải tải Apache Maven 3.9.9 từ mạng — chậm và thêm một điểm
# có thể hỏng. Image maven đã có sẵn Maven, cùng JDK 17 temurin.
FROM maven:3.9-eclipse-temurin-17 AS build

WORKDIR /build

# Tách pom.xml trước để tầng tải dependency được cache: chỉ khi pom.xml đổi
# thì Docker mới tải lại toàn bộ thư viện.
# Không copy .mvn vì tầng này dùng lệnh `mvn` của image, không dùng ./mvnw.
COPY backend/pom.xml ./pom.xml
# `dependency:go-offline` hay hỏng vì plugin phụ thuộc vòng tròn; cho phép lỗi
# để chỉ mất phần cache, không làm chết build.
RUN mvn -B -q dependency:go-offline || echo "go-offline lỗi — bỏ qua, sẽ tải khi package"

# Copy mã nguồn sau cùng — sửa code không làm mất cache dependency ở trên.
COPY backend/src ./src
# Test chạy ở CI (F14 FR-7), không chạy trong lúc build image.
RUN mvn -B -q -DskipTests package && \
    cp target/backend-*.jar /build/app.jar

# ---------------------------------------------------------------- tầng runtime
# -noble = Ubuntu 24.04, có python3.12 trong kho chính thức.
# Image mặc định (jammy) chỉ có python3.10, không đáp ứng FR-1.
# ffmpeg đi kèm trên noble là 6.1.1 — ghi lại để kết quả cắt video tái lập được.
FROM eclipse-temurin:17-jre-noble AS runtime

LABEL org.opencontainers.image.title="autocut-backend" \
      org.opencontainers.image.description="AutoCut AI backend: Spring Boot + Python AI + ffmpeg" \
      org.opencontainers.image.source="https://github.com/ToanNguyen-exe/AutoCut"

# curl: HEALTHCHECK cần (image temurin jre không kèm sẵn)
# python3-venv: tạo môi trường ảo riêng cho AI
# ffmpeg: cắt và kiểm tra video
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-pip \
        ffmpeg \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    ffmpeg -version | head -1 > /opt/ffmpeg-version.txt && \
    python3 --version > /opt/python-version.txt

# Ghi phiên bản thực tế vào log build để đối chiếu khi kết quả cắt khác nhau
RUN cat /opt/ffmpeg-version.txt /opt/python-version.txt

# User không phải root (AC-5). UID cố định để volume mount không lệch quyền.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin autocut

# Thư mục ghi được: work (tệp tạm khi cắt) và models (cache Whisper/HuggingFace).
# Không dùng /root/.cache vì user autocut không ghi được vào đó.
RUN mkdir -p /app/work /opt/models /opt/venv && \
    chown -R autocut:autocut /app /opt/models /opt/venv

# --- Thư viện Python, cài trước khi copy mã nguồn để cache theo requirements.txt
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

WORKDIR /app

# --- Mã nguồn và cấu hình
# QUAN TRỌNG: phải giữ đúng đường dẫn backend/ai/... vì:
#   • Java chạy: python -m backend.ai.cli với cwd=/app và PYTHONPATH=.
#   • PythonRuntime.resolveProjectRoot() nhận diện dự án qua backend/ai/cli.py
# Copy thành /app/ai/... sẽ làm ModuleNotFoundError.
COPY --chown=autocut:autocut backend/ai ./backend/ai
COPY --chown=autocut:autocut config.yaml ./config.yaml
COPY --from=build --chown=autocut:autocut /build/app.jar ./app.jar

USER autocut

# --- Biến môi trường: hợp đồng với PythonRuntime (F14 FR-4, FR-5)
ENV PYTHON_EXE=/opt/venv/bin/python \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    AUTOCUT_HOME=/app \
    HF_HOME=/opt/models \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# Healthcheck dùng GET / có sẵn ở HomeController.
# Khi F15 merge thì đổi sang /actuator/health/liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fs http://localhost:8080/ || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
