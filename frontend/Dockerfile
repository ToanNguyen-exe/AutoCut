# ==============================================================================
# AutoCut - Frontend Dockerfile (Next.js 14 Standalone Multi-stage Build)
# Tuân thủ đặc tả F14 (docs/specs/02-ha-tang/F14-docker-ci.md - FR-2)
# ==============================================================================

# 1. Tầng cài đặt dependencies (deps)
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy tệp định nghĩa dependencies để tận dụng Docker layer cache
COPY package.json package-lock.json* ./
RUN npm ci

# 2. Tầng build mã nguồn (builder)
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args cho phép cấu hình URL backend linh hoạt khi build
ARG NEXT_PUBLIC_API_URL=/api/video
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1

RUN npm run build

# 3. Tầng runtime thực thi (runner)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Bảo mật: Chạy dưới quyền user non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy tài nguyên static và standalone output đã được Next.js tối ưu hóa
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
