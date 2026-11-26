FROM oven/bun:1.4.5 AS bun

# Stage 1: Build
FROM node:26.13.1-slim AS builder

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools/openapi/package.json ./tools/openapi/
COPY packages/frontend/package.json ./packages/frontend/
# Copy API package.json (required for workspace lockfile validation)
COPY packages/api/package.json ./packages/api/

# Install the workspace's pinned package manager. Node 26 does not ship Corepack.
RUN npm install --global --allow-scripts=pnpm "$(node -p 'require("./package.json").packageManager')"

# Disable husky git hooks (not applicable in Docker)
ENV HUSKY=0

# Install frontend dependencies (includes devDeps for build tools)
RUN pnpm install --frozen-lockfile --filter @compare-dex/frontend...

# Copy frontend source
COPY packages/frontend/ ./packages/frontend/

# Build
ARG CDR_BROWSER_PACKAGE_INVENTORY
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_RELEASE
RUN pnpm --filter @compare-dex/frontend run build

# Stage 2: Serve
FROM nginx:1.31.9-trixie@sha256:84f7876d21d154885f99554d7ae325d8c2213f9169726ea7ab60642f2573a787

# Copy built files
COPY --from=builder /app/packages/frontend/dist/ /usr/share/nginx/html/

# Copy nginx config
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["curl", "-fsSI", "-o", "/dev/null", "http://localhost/"]
