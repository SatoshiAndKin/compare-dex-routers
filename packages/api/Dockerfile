FROM node:24-slim

WORKDIR /app

# Copy root workspace config and package files for npm workspaces
COPY package.json package-lock.json ./
COPY packages/api/package.json ./packages/api/
# Create empty placeholder for frontend (required for workspace install)
RUN mkdir -p packages/frontend && echo '{"name":"@compare-dex/frontend","version":"1.0.0"}' > packages/frontend/package.json

# Disable husky git hooks (not applicable in Docker)
ENV HUSKY=0

# Install only API production dependencies
RUN npm ci --workspace=packages/api --omit=dev

# Install tsx globally (it's a devDependency but needed at runtime)
RUN npm install -g tsx

# Copy API source code
COPY packages/api/src/ ./packages/api/src/
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/api/static/ ./packages/api/static/

# Copy root tsconfig (API tsconfig extends it)
COPY tsconfig.json ./

# Copy OpenAPI spec
COPY openapi.yaml ./

ENV NODE_ENV=production

EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["tsx", "packages/api/src/server.ts"]
