FROM oven/bun:1.4.2 AS bun

FROM node:24.21.0-slim

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# Use the maintained system trust store until Node ships its CA distrust fix.
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates \
    && sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' \
       -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt SSL_CERT_DIR=/etc/ssl/certs

WORKDIR /app

# Copy root workspace config and package files for pnpm workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
# Copy frontend package.json (required for workspace lockfile validation)
COPY packages/frontend/package.json ./packages/frontend/

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

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

WORKDIR /app/packages/api

CMD ["node", "--use-openssl-ca", "--import", "tsx", "src/server.ts"]
