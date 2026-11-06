-- =============================================================================
-- HỆ THỐNG PHÂN ĐOẠN VIDEO BÀI GIẢNG THÔNG MINH (AUTOCUT AI)
-- DATABASE SCHEMA: NEON LAKEBASE POSTGRESQL
-- BỘ 6 BẢNG CỐT LÕI (CORE ENTERPRISE READY)
-- =============================================================================

-- 1. BẢNG USERS: Quản lý người dùng, phân quyền và hạn ngạch R2
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    storage_limit_bytes BIGINT NOT NULL DEFAULT 2147483648, -- 2GB mặc định
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BẢNG VIDEOS: Quản lý video bài giảng gốc và trạng thái FSM
CREATE TABLE IF NOT EXISTS videos (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    file_size BIGINT NOT NULL,
    duration DOUBLE PRECISION,
    sha256_hash VARCHAR(64) UNIQUE NOT NULL,
    r2_key VARCHAR(500) NOT NULL,
    cloud_url VARCHAR(500) NOT NULL,
    outline_text TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'UPLOADED',
    reviewed BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration nếu bảng videos đã tồn tại từ trước
ALTER TABLE IF EXISTS videos ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE IF EXISTS videos ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);
ALTER TABLE IF EXISTS videos ADD COLUMN IF NOT EXISTS r2_key VARCHAR(500);
ALTER TABLE IF EXISTS videos ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS videos ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE IF EXISTS videos ADD COLUMN IF NOT EXISTS version BIGINT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_videos_sha256 ON videos(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_videos_owner_id ON videos(owner_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

-- 3. BẢNG TRANSCRIPTS: Lời thoại Whisper theo từng câu
CREATE TABLE IF NOT EXISTS transcripts (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    sentence_id VARCHAR(10) NOT NULL, -- Mã định danh chuẩn S0001, S0002...
    speaker VARCHAR(50) DEFAULT 'spk_0',
    start_time DOUBLE PRECISION NOT NULL,
    end_time DOUBLE PRECISION NOT NULL,
    text TEXT NOT NULL,
    words_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_video_sentence ON transcripts(video_id, sentence_id);

-- 4. BẢNG SECTIONS: Phân tầng cấp 1 (Phần lớn theo đề cương bài giảng)
CREATE TABLE IF NOT EXISTS sections (
    id BIGSERIAL PRIMARY KEY,
    video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    section_no INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    label VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sections_video_pos ON sections(video_id, position);

-- 5. BẢNG TOPICS: Phân tầng cấp 2 (Chủ đề bài học con duyệt trên Web SV4)
CREATE TABLE IF NOT EXISTS topics (
    id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    topic_no INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    start_id VARCHAR(10) NOT NULL, -- S0001
    end_id VARCHAR(10) NOT NULL,   -- S0025
    start_time DOUBLE PRECISION NOT NULL,
    end_time DOUBLE PRECISION NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DISCARDED (Xóa mềm phục vụ Undo)
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_topic_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_topics_section_pos ON topics(section_id, position);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);

-- 6. BẢNG VIDEO_PARTS: Quản lý clip vật lý sau khi SV1 (FFmpeg) render xong
CREATE TABLE IF NOT EXISTS video_parts (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    part_no INTEGER NOT NULL DEFAULT 1,
    start_time DOUBLE PRECISION NOT NULL,
    end_time DOUBLE PRECISION NOT NULL,
    r2_key VARCHAR(500) NOT NULL,
    cloud_url VARCHAR(500) NOT NULL,
    file_size BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | RENDERING | COMPLETED | FAILED
    rendered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_topic_part UNIQUE (topic_id, part_no)
);

CREATE INDEX IF NOT EXISTS idx_parts_topic ON video_parts(topic_id);
