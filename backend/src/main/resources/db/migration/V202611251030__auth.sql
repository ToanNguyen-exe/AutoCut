-- F01 — Đăng nhập thật (JWT + BCrypt + Refresh Token + Vé ngắn hạn AD-4)
-- Dùng TIMESTAMP WITH TIME ZONE và VARCHAR(64) để tương thích cả H2 MODE=PostgreSQL và Postgres 16.

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_failed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64)  NOT NULL UNIQUE,
    family_id  UUID         NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    user_agent VARCHAR(255),
    ip         VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS auth_tickets (
    id          BIGSERIAL PRIMARY KEY,
    ticket_hash VARCHAR(64)  NOT NULL UNIQUE,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(10)  NOT NULL CHECK (purpose IN ('SSE','STREAM','DOWNLOAD')),
    resource_id VARCHAR(100) NOT NULL,
    single_use  BOOLEAN      NOT NULL,
    used_at     TIMESTAMP WITH TIME ZONE,
    expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tickets_expires ON auth_tickets(expires_at);
