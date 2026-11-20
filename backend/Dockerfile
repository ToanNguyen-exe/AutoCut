# Stage 1: Build Spring Boot Backend JAR
FROM eclipse-temurin:17-jdk AS build
WORKDIR /build/backend

COPY backend/mvnw backend/pom.xml ./
COPY backend/.mvn ./.mvn
RUN sed -i 's/\r$//' mvnw && chmod +x mvnw && ./mvnw -B dependency:go-offline

COPY backend/src ./src
RUN ./mvnw -B -DskipTests package \
    && find target -maxdepth 1 -name '*.jar' ! -name '*.original' -exec cp {} /build/app.jar \;

# Stage 2: Runtime (Java 17 JRE + Python /opt/venv + FFmpeg)
FROM eclipse-temurin:17-jre
WORKDIR /app

# Cài đặt Python 3, python3-venv và FFmpeg (bao gồm ffprobe)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt thư viện Python AI vào môi trường ảo riêng /opt/venv
COPY requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt

# Biến môi trường chuẩn cho container Linux
ENV AUTOCUT_HOME=/app \
    PYTHON_EXE=/opt/venv/bin/python \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    HF_HOME=/opt/models \
    CACHE_DIR=/app/cache \
    OUTPUT_DIR=/app/output \
    PYTHONIOENCODING=utf-8 \
    PYTHONPATH=/app

# Nạp mã nguồn AI Python, cấu hình và tệp JAR thực thi
COPY --from=build /build/app.jar /app/app.jar
COPY backend/ai /app/backend/ai
COPY config.yaml /app/config.yaml
COPY mock-data /app/mock-data

# Kiểm chứng toàn bộ thư viện AI & FFmpeg ngay lúc build image
RUN /opt/venv/bin/python -m backend.ai.healthcheck --check-deps --skip-http

# Tạo user non-root và phân quyền các thư mục dữ liệu / cache model
RUN groupadd --system autocut && useradd --system --gid autocut --home /app autocut \
    && mkdir -p /app/uploads /app/output /app/cache /app/transcripts /app/segments /app/temp /opt/models \
    && chown -R autocut:autocut /app /opt/models

USER autocut

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD ["/opt/venv/bin/python", "-m", "backend.ai.healthcheck"]

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
