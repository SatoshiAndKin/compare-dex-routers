<coding_guidelines>

# AGENTS.md

## Project Overview

Compare DEX Routers is a monorepo (pnpm workspaces) containing a quote comparison API and a Svelte 5 SPA frontend. The API queries Spandex providers, including Curve Finance, in parallel and returns one ranked quote response. Spandex aggregates across multiple providers (0x, KyberSwap, Nordstern, LiFi, Relay, Velora, Curve).

| Package             | Stack                                        | Dev port |
| ------------------- | -------------------------------------------- | -------- |
| `packages/api`      | TypeScript, Node.js 24 LTS, ESM, tsx runtime | 3100     |
| `packages/frontend` | Svelte 5, Vite, openapi-fetch                | 5173     |

## Quick start

```sh
cp env.example .env   # set RPC_URL_<chainId> or ALCHEMY_API_KEY
pnpm install
pnpm run dev           # starts API at :3100 and frontend at :5173
```

## Commands

All commands run from the repo root and delegate to workspaces.

| Command                  | Description                                |
| ------------------------ | ------------------------------------------ |
| `pnpm run dev`           | Start API and frontend in parallel         |
| `pnpm run typecheck`     | Type-check all workspaces                  |
| `pnpm run lint`          | Lint all workspaces with ESLint            |
| `pnpm run lint:fix`      | Lint and auto-fix all workspaces           |
| `pnpm run format`        | Format all workspaces with Prettier        |
| `pnpm run format:check`  | Check formatting without writing           |
| `pnpm test`              | Run tests across all workspaces (Vitest)   |
| `pnpm run test:coverage` | Run tests with coverage                    |
| `pnpm run dead-code`     | Detect dead code and unused exports (knip) |
| `pnpm run duplicates`    | Detect duplicate code (jscpd)              |
| `pnpm run dead-flags`    | Detect unused feature flags                |

## Application contracts

- API implementation lives in `packages/api/src/`; frontend code lives in
  `packages/frontend/src/`. Read [architecture](docs/architecture.md) for affected flows.
- The browser uses `/api/quote` and the server recommendation. Keep shared quote
  schemas in `quote-response.ts` and generated clients synchronized.

## Environment variables

See `env.example`. Configure `RPC_URL_<chainId>` for each used chain, or `ALCHEMY_API_KEY` as the fallback. Optional: `ZEROX_API_KEY`, `RPC_URL_<chainId>`, `CURVE_ENABLED`, `METRICS_ENABLED`, `SENTRY_DSN`, `LOG_LEVEL`.

## Testing

- **API tests:** `packages/api/src/__tests__/` — Vitest with mocked external dependencies (viem, @spandex/core). Coverage threshold is 80%.
- **Frontend tests:** `packages/frontend/src/__tests__/` — Vitest with `@testing-library/svelte` and jsdom.
- Run `pnpm test` from the root to execute tests across all workspaces.

## Deployment

- Production: private K3s Helm release, deployed by the Tank worker
- API image: `packages/api/Dockerfile`
- Frontend image: `packages/frontend/Dockerfile` (multi-stage build, nginx)
- Kubernetes readiness, rolling updates, and graceful termination; Compose remains for local validation and retained rollback configuration

## Conventions

Use Node.js 24.22.1, pnpm 12.5.1, and Bun 1.4.2. Bun builds the exact pinned Spandex Git dependency with `prepack`; keep its pin and the build allowlist in sync. The browser uses `/api/quote` and the server recommendation. The quote endpoint uses `quote-response.ts`.

### Git workflow

Use a feature branch, push it, and open a PR. Do not commit directly to `main`.

- **NEVER truncate addresses.** Always display full 0x addresses in the UI and API responses. No `0xABCD...1234` patterns.
- Pre-commit hooks enforce linting and formatting via Husky + lint-staged
- Structured logging with pino (JSON in production, pretty in development)
- No direct `console.log` in source code; use the logger from `packages/api/src/logger.ts`
- Feature flags configured via environment variables (`packages/api/src/feature-flags.ts`)
- Request tracing via `x-request-id` header propagation
- Architecture docs in `docs/architecture.md`, runbooks in `docs/runbooks/`
  </coding_guidelines>
