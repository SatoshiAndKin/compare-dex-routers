FROM node:24-slim

WORKDIR /app

# Copy root workspace config and package files for pnpm workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
# Copy frontend package.json (required for workspace lockfile validation)
COPY packages/frontend/package.json ./packages/frontend/

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

# Disable husky git hooks (not applicable in Docker)
ENV HUSKY=0

# Install only API production dependencies
RUN pnpm install --frozen-lockfile --filter @compare-dex/api... --prod

# Copy API source code
COPY packages/api/src/ ./packages/api/src/
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/api/static/ ./packages/api/static/

ENV NODE_ENV=production

EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node_modules/.bin/tsx", "packages/api/src/server.ts"]
