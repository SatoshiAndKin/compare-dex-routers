FROM oven/bun:1.4.0 AS bun

# Stage 1: Build
FROM node:24.21.0-slim AS builder

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/frontend/package.json ./packages/frontend/
# Copy API package.json (required for workspace lockfile validation)
COPY packages/api/package.json ./packages/api/

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@12.3.1 --activate

# Disable husky git hooks (not applicable in Docker)
ENV HUSKY=0

# Install frontend dependencies (includes devDeps for build tools)
RUN pnpm install --frozen-lockfile --filter @compare-dex/frontend...

# Copy frontend source
COPY packages/frontend/ ./packages/frontend/

# Build
RUN pnpm --filter @compare-dex/frontend run build

# Stage 2: Serve
FROM nginx:1.30.4-alpine

# Copy built files
COPY --from=builder /app/packages/frontend/dist/ /usr/share/nginx/html/

# Copy nginx config
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1
