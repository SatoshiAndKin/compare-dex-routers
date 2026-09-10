<coding_guidelines>

# AGENTS.md

## Project Overview

Compare DEX Routers is a monorepo (pnpm workspaces) containing a quote comparison API and a Svelte 5 SPA frontend. The API queries multiple DEX routers (Spandex and Curve Finance) and returns quotes for side-by-side comparison. Spandex aggregates across multiple providers (0x, Fabric, KyberSwap, Nordstern, LiFi, Relay, Velora).

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

## Architecture

### `packages/api`

Node.js HTTP server (no framework). Source files in `packages/api/src/`:

| File                | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `server.ts`         | HTTP server, request routing, response handling                       |
| `config.ts`         | Chain config, router setup, viem clients, token metadata              |
| `quotes.ts`         | Spandex/Curve quote selection, shared formatting, and recommendations |
| `quote-response.ts` | Shared response schemas and types                                     |
| `redaction.ts`      | Credential removal at reporting boundaries                            |
| `quote.ts`          | Query parameter parsing and validation                                |
| `env.ts`            | `.env` file loader (imported first in server.ts)                      |
| `logger.ts`         | Structured logging with pino and log scrubbing                        |
| `sentry.ts`         | Sentry error tracking integration                                     |
| `tracing.ts`        | Request ID propagation for distributed tracing                        |
| `metrics.ts`        | Prometheus-compatible metrics collection                              |
| `feature-flags.ts`  | Environment-based feature flag system                                 |
| `gas-price.ts`      | Gas price fetching with caching                                       |
| `analytics.ts`      | Quote analytics tracking and summary                                  |
| `error-insights.ts` | Error pattern tracking and insights                                   |

### `packages/frontend`

Svelte 5 SPA built with Vite. Source files in `packages/frontend/src/`:

- **Components** (`src/lib/components/`) — `CompareForm`, `QuoteResults`, `QuoteCard`, `QuoteDetails`, `TokenInput`, `ChainSelector`, `AmountFields`, `SlippagePresets`, `SettingsModal`, `SwapConfirmationModal`, `UnrecognizedTokenModal`, `WalletButton`, `WalletProviderMenu`, `ThemeToggle`, `AutoRefreshIndicator`, `ChainMismatchWarning`
- **Stores** (`src/lib/stores/`) — Svelte 5 runes-based stores: `comparisonStore`, `tokenListStore`, `walletStore`, `transactionStore`, `balanceStore`, `settingsStore`, `preferencesStore`, `autoRefreshStore`, `themeStore`, `formStore`, `configStore`, `tokensStore`, `urlSync`
- **API client** (`src/lib/api.ts`) — Generated from OpenAPI spec via `openapi-fetch`
- **Tests** (`src/__tests__/`) — Component and store tests using `@testing-library/svelte`

## API endpoints

| Method | Path                          | Description                                          |
| ------ | ----------------------------- | ---------------------------------------------------- |
| `GET`  | `/health`                     | Health check                                         |
| `GET`  | `/chains`                     | Supported chains list                                |
| `GET`  | `/config`                     | Client configuration (chains, tokens, feature flags) |
| `GET`  | `/compare`                    | Compare quotes from Spandex and Curve                |
| `GET`  | `/quote`                      | Single quote from Spandex router                     |
| `GET`  | `/quote-curve`                | Single quote from Curve router                       |
| `GET`  | `/tokenlist`                  | Aggregated token list                                |
| `GET`  | `/token-metadata`             | On-chain token metadata lookup                       |
| `GET`  | `/metrics`                    | Prometheus-compatible metrics                        |
| `GET`  | `/analytics`                  | Quote analytics summary                              |
| `GET`  | `/errors`                     | Error insights dashboard                             |
| `GET`  | `/docs`                       | API documentation UI                                 |
| `GET`  | `/openapi.json`               | OpenAPI specification (also at `/openapi.yaml`)      |
| `GET`  | `/.well-known/farcaster.json` | Farcaster frame manifest                             |

## Environment variables

See `env.example`. Configure `RPC_URL_<chainId>` for each used chain, or `ALCHEMY_API_KEY` as the fallback. Optional: `ZEROX_API_KEY`, `FABRIC_API_KEY`, `RPC_URL_<chainId>`, `CURVE_ENABLED`, `COMPARE_ENABLED`, `METRICS_ENABLED`, `SENTRY_DSN`, `LOG_LEVEL`.

## Testing

- **API tests:** `packages/api/src/__tests__/` — Vitest with mocked external dependencies (viem, @spandex/core). Coverage threshold is 80%.
- **Frontend tests:** `packages/frontend/src/__tests__/` — Vitest with `@testing-library/svelte` and jsdom.
- Run `pnpm test` from the root to execute tests across all workspaces.

## Deployment

- Docker Compose with Traefik reverse proxy (`docker-compose.prod.yml`)
- API image: `packages/api/Dockerfile`
- Frontend image: `packages/frontend/Dockerfile` (multi-stage build, nginx)
- `docker-rollout` for zero-downtime deploys

## Conventions

Use Node.js 24.21.0, pnpm 12.3.1, and Bun 1.4.0. Bun builds the exact pinned Spandex Git dependency with `prepack`; keep its pin and the build allowlist in sync. The browser uses `/api/compare` and the server recommendation. All quote endpoints share `quote-response.ts`.

### Git workflow

**All work must be done on feature branches.** Use the `/commit-push-pr` command to create commits and PRs. **Never commit directly to main.** This ensures all changes are reviewed before merging.

- **NEVER truncate addresses.** Always display full 0x addresses in the UI and API responses. No `0xABCD...1234` patterns.
- API source files in `packages/api/src/`, frontend source files in `packages/frontend/src/`
- Test files in respective `__tests__/` directories
- ESLint with TypeScript strict rules, Prettier formatting
- Pre-commit hooks enforce linting and formatting via Husky + lint-staged
- Structured logging with pino (JSON in production, pretty in development)
- No direct `console.log` in source code; use the logger from `packages/api/src/logger.ts`
- Feature flags configured via environment variables (`packages/api/src/feature-flags.ts`)
- Request tracing via `x-request-id` header propagation
- Architecture docs in `docs/architecture.md`, runbooks in `docs/runbooks/`
  </coding_guidelines>
