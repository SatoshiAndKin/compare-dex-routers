# Stage 1: Build
FROM node:24-slim AS builder

WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json ./
COPY packages/frontend/package.json ./packages/frontend/
# Create empty API placeholder (required for workspace install)
RUN mkdir -p packages/api && echo '{"name":"@compare-dex/api","version":"1.0.0"}' > packages/api/package.json

# Disable husky git hooks (not applicable in Docker)
ENV HUSKY=0

# Install frontend dependencies (includes devDeps for build tools)
RUN npm ci --workspace=packages/frontend

# Copy frontend source
COPY packages/frontend/ ./packages/frontend/

# Build
RUN npm run build --workspace=packages/frontend

# Stage 2: Serve
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/packages/frontend/dist/ /usr/share/nginx/html/

# Copy nginx config
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1
