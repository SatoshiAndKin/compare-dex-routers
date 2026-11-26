FROM oven/bun:1.4.5 AS bun

FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# Use the maintained system trust store until Node ships its CA distrust fix.
ARG DEBIAN_ARCHIVE_SNAPSHOT
ARG DEBIAN_SECURITY_SNAPSHOT

COPY packages/api/debian.sources /tmp/debian-snapshot.sources
RUN if [ -n "${DEBIAN_ARCHIVE_SNAPSHOT}${DEBIAN_SECURITY_SNAPSHOT}" ]; then \
        test -n "$DEBIAN_ARCHIVE_SNAPSHOT" && test -n "$DEBIAN_SECURITY_SNAPSHOT" \
        && sed -e "s/@ARCHIVE@/$DEBIAN_ARCHIVE_SNAPSHOT/g" -e "s/@SECURITY@/$DEBIAN_SECURITY_SNAPSHOT/g" \
            /tmp/debian-snapshot.sources > /etc/apt/sources.list.d/debian.sources; \
    fi \
    && rm /tmp/debian-snapshot.sources \
    && apt-get update --error-on=any && apt-get install --no-install-recommends -y ca-certificates \
    && sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' \
       -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt SSL_CERT_DIR=/etc/ssl/certs

WORKDIR /app

# Copy root workspace config and package files for pnpm workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools/openapi/package.json ./tools/openapi/
COPY packages/api/package.json ./packages/api/
# Copy frontend package.json (required for workspace lockfile validation)
COPY packages/frontend/package.json ./packages/frontend/

# Install the workspace's pinned package manager. Node 26 does not ship Corepack.
RUN npm install --global --allow-scripts=pnpm "$(node -p 'require("./package.json").packageManager')"

# Disable husky git hooks (not applicable in Docker)
ENV HUSKY=0

# Install only API production dependencies
RUN pnpm install --frozen-lockfile --filter @compare-dex/api... --prod

# Copy API source code
COPY packages/api/src/ ./packages/api/src/
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/api/static/ ./packages/api/static/

ARG SENTRY_RELEASE=
ENV NODE_ENV=production SENTRY_RELEASE=${SENTRY_RELEASE}

EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

WORKDIR /app/packages/api

CMD ["node", "--use-openssl-ca", "--import", "tsx", "src/server.ts"]
