<coding_guidelines>

# AGENTS.md

## Project Overview

Compare DEX Routers is a monorepo (pnpm workspaces) containing a quote comparison API and a Svelte 5 SPA frontend. The API queries Spandex providers, including Curve Finance, in parallel and returns one ranked quote response. Spandex aggregates across multiple providers (0x, KyberSwap, Nordstern, LiFi, Relay, Velora, Curve).

| Package             | Stack                                        | Dev port |
| ------------------- | -------------------------------------------- | -------- |
| `packages/api`      | TypeScript, Node.js 26, ESM, tsx runtime | 3100     |
| `packages/frontend` | Svelte 5, Vite, openapi-fetch                | 5173     |

## Quick start

```sh
cp env.example .env   # set RPC_URL_<chainId> or ALCHEMY_API_KEY
pnpm install
pnpm run dev           # starts API at :3100 and frontend at :5173
```

## Validation

Run validation from the repo root. Follow the [testing runbook](docs/runbooks/testing.md)
for repository, browser, fork, and rollout checks.

## Application contracts

- API implementation lives in `packages/api/src/`; frontend code lives in
  `packages/frontend/src/`. Read [architecture](docs/architecture.md) for affected flows.
- The browser uses `/api/quote` and the server recommendation. Keep shared quote
  schemas in `quote-response.ts` and generated clients synchronized.

### UI layout

- Keep controls and their click and tap targets in place during loading and
  refreshes. Reserve space for changing content, and update values and status
  in place. Check control positions during a delayed refresh on desktop and
  mobile when changing a panel that updates asynchronously.
- Put action instructions, status, and countdowns beside the control they
  describe. Give icon-only controls an accessible name.

## Environment variables

See `env.example`. Configure `RPC_URL_<chainId>` for each used chain, or `ALCHEMY_API_KEY` as the fallback. Optional: `ZEROX_API_KEY`, `RPC_URL_<chainId>`, `CURVE_ENABLED`, `METRICS_ENABLED`, `SENTRY_DSN`, `LOG_LEVEL`.

## Deployment

- Production: private K3s Helm release, deployed by the Tank worker
- API image: `packages/api/Dockerfile`
- Frontend image: `packages/frontend/Dockerfile` (multi-stage build, nginx)
- Kubernetes readiness, rolling updates, and graceful termination; Compose remains for local validation and retained rollback configuration

## Conventions

Use the tool versions pinned in `.node-version`, `package.json`, and
`.github/workflows/ci.yml`. Bun builds the exact pinned Spandex Git dependency
with `prepack`. Keep its pin and the build allowlist in sync.

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
