# Architecture

Architectural decisions and patterns for the monorepo split.

**What belongs here:** Monorepo structure decisions, package boundaries, API contract decisions, Svelte patterns discovered.

---

## Monorepo Structure

```
packages/
  api/          - OpenAPI backend (Node.js + tsx, port 3100)
  frontend/     - Svelte 5 SPA (Vite, port 5173)
```

Root npm workspaces. Shared types generated from openapi.yaml via openapi-typescript.

## API Contract

- OpenAPI spec (openapi.yaml) is the single source of truth
- Frontend consumes via openapi-fetch with generated types
- /config endpoint replaces window.__config injection
- CORS: Access-Control-Allow-Origin: * (all origins)

## Frontend Patterns

- Svelte 5 runes ($state, $derived, $effect)
- Class-based stores in .svelte.ts files
- openapi-fetch for type-safe API calls
- WalletConnect + Farcaster via CDN ESM imports (not npm bundled)
