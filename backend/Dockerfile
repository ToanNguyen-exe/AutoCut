# ==========================================
# Stage 1: Build Java Application
# ==========================================
FROM eclipse-temurin:17-jdk AS builder

WORKDIR /build

# Copy Maven wrapper và pom.xml trước để tận dụng Docker cache
COPY backend/.mvn/ .mvn/
COPY backend/mvnw ./mvnw
COPY backend/pom.xml ./pom.xml

RUN chmod +x ./mvnw

# Copy source code backend
COPY backend/src/ src/

# Build JAR file, bỏ qua tests ở bước build image (tests chạy độc lập trên CI)
RUN ./mvnw -B clean package -DskipTests

# ==========================================
# Stage 2: Runtime Container
# ==========================================
FROM eclipse-temurin:17-jre

LABEL maintainer="AutoCut Team - SV1"
LABEL description="AutoCut Backend with FFmpeg, Python AI runtime and non-root execution"

ENV DEBIAN_FRONTEND=noninteractive

# 1. Cài đặt ffmpeg, ffprobe, python3, venv và curl
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        python3-venv \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Kiểm tra đường dẫn ffmpeg và đảm bảo có thể thực thi
RUN which ffmpeg && /usr/bin/ffmpeg -version

# 2. Cấu hình biến môi trường chuẩn (theo Spec F14 và yêu cầu đường dẫn /usr/bin/ffmpeg)
ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    AUTOCUT_HOME=/app \
    PYTHON_EXE=/opt/venv/bin/python \
    HF_HOME=/opt/models \
    AUTOCUT_MODEL_DIR=/opt/models \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# 3. Cài đặt Python requirements vào môi trường ảo riêng biệt
# Model Whisper (~1.5GB) KHÔNG tải ở bước này để tránh làm phình to image
COPY requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt

# 4. Tạo người dùng không phải root (autocut) và cấp quyền thư mục
# /opt/models được chuẩn bị sẵn làm volume riêng cho Whisper models
RUN groupadd -r autocut && \
    useradd -r -g autocut -d /app autocut && \
    mkdir -p /app/work /app/output /app/uploads /opt/models && \
    chown -R autocut:autocut /app /opt/models /opt/venv

# 5. Copy file JAR đã build và tài nguyên cần thiết
COPY --from=builder /build/target/*.jar /app/app.jar
COPY backend/ai/ /app/ai/
COPY config.yaml /app/config.yaml

RUN chown -R autocut:autocut /app/ai /app/config.yaml /app/app.jar

# Khai báo volume cho model Whisper và thư mục làm việc để lưu trữ ngoài image
VOLUME ["/opt/models", "/app/work", "/app/output"]

USER autocut

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fs http://localhost:8080/ || exit 1

# Mặc định chạy ứng dụng backend Spring Boot, cho phép override lệnh dễ dàng (VD: ffmpeg -version)
CMD ["java", "-jar", "/app/app.jar"]
