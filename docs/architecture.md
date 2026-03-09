# Architecture

## Overview

```
                         ┌───────────────────────────────────────┐
                         │              Traefik (:80)            │
                         │          path-based routing           │
                         └──────┬────────────────────┬──────────┘
                                │                    │
                   /health, /compare,          all other paths
                   /quote, /chains, ...            (priority 1)
                      (priority 10)                  │
                                │                    │
                    ┌───────────▼──────┐   ┌────────▼─────────┐
                    │   API (:3100)    │   │ Frontend (nginx)  │
                    │  packages/api    │   │ packages/frontend │
                    │  Node.js + tsx   │   │  Svelte 5 SPA     │
                    └──────────────────┘   └──────────────────┘
```

The frontend is a Svelte 5 SPA served by nginx. The API is a Node.js server run with `tsx` (TypeScript without a build step). Traefik sits in front of both and routes by path prefix. API routes get higher priority so they match first; everything else falls through to the SPA.

## Monorepo structure

```
compare-dex-routers/
├── packages/
│   ├── api/           # Backend HTTP server (@compare-dex/api)
│   └── frontend/      # Svelte 5 SPA (@compare-dex/frontend)
├── openapi.yaml       # Shared API contract
├── docker-compose.yml # Local Docker stack (build from source)
├── docker-compose.prod.yml  # Production stack (pre-built images)
├── traefik-proxy/     # Traefik reverse-proxy config
└── package.json       # Root workspace config (npm workspaces)
```

Both packages are managed through npm workspaces. Root-level scripts (`npm run typecheck`, `npm test`, etc.) fan out to each workspace.

## API (`packages/api`)

Plain `node:http` server. Runs via `tsx` so TypeScript files execute directly, no build step.

### Modules

| Module | Responsibility |
|---|---|
| `server.ts` | HTTP request routing, response handling, token-list loading, quote orchestration |
| `config.ts` | Chain definitions (7 chains), Spandex router setup with providers (0x, Fabric, KyberSwap, Odos, LiFi, Relay, Velora), viem public clients, token metadata helpers |
| `quote.ts` | Query-parameter parsing and validation (`chainId`, `from`, `to`, `amount`, `slippageBps`, `sender`, `mode`) |
| `curve.ts` | Curve Finance SDK integration via `@curvefi/api` (all 7 supported chains) |
| `gas-price.ts` | Gas-price fallback with per-block caching; fetches from RPC when Spandex omits `gas_price_gwei` |
| `analytics.ts` | In-memory quote event tracking — success rates, latency, top pairs and chains |
| `error-insights.ts` | Error pattern aggregation — counts, deduplication, and threshold alerting |
| `metrics.ts` | Prometheus-compatible metrics (request counts, durations, errors, uptime) |
| `feature-flags.ts` | Environment-based feature flags (`CURVE_ENABLED`, `COMPARE_ENABLED`, `METRICS_ENABLED`) |
| `logger.ts` | Structured logging via pino with sensitive-value scrubbing (API keys, private keys, tokens) |
| `sentry.ts` | Sentry error-tracking initialization and helpers (`captureException`, `captureMessage`) |
| `tracing.ts` | `x-request-id` propagation — reads or generates a UUID per request |
| `env.ts` | `.env` file loader (imported first, before any other module reads `process.env`) |

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/chains` | Supported chains list |
| `GET` | `/config` | Feature flags and runtime config |
| `GET` | `/compare` | Compare quotes from Spandex and Curve side-by-side |
| `GET` | `/quote` | Single quote from Spandex |
| `GET` | `/quote-curve` | Single quote from Curve |
| `GET` | `/tokenlist` | Token lists |
| `GET` | `/tokenlist/proxy` | Proxy to external token lists |
| `GET` | `/token-metadata` | On-chain token metadata lookup |
| `GET` | `/metrics` | Prometheus-compatible metrics |
| `GET` | `/analytics` | Quote analytics summary |
| `GET` | `/errors` | Error pattern insights |
| `GET` | `/docs` | API documentation UI (Swagger) |
| `GET` | `/openapi.yaml` | OpenAPI spec |
| `GET` | `/.well-known/farcaster.json` | Farcaster frame manifest |

## Frontend (`packages/frontend`)

A Svelte 5 SPA built with Vite. In production it is served as static files by nginx.

### Components (`src/lib/components/`)

| Component | Purpose |
|---|---|
| `CompareForm.svelte` | Main form — ties together chain, token, and amount inputs |
| `ChainSelector.svelte` | Chain picker dropdown |
| `TokenInput.svelte` | Token address input with metadata lookup |
| `AmountFields.svelte` | Swap amount and mode (exactIn / targetOut) |
| `SlippagePresets.svelte` | Slippage tolerance selector |
| `QuoteResults.svelte` | Container for quote comparison results |
| `QuoteCard.svelte` | Individual quote summary card |
| `QuoteDetails.svelte` | Expanded quote details (gas, calldata, approvals) |
| `WalletButton.svelte` | Wallet connect/disconnect button |
| `WalletProviderMenu.svelte` | Wallet provider selection menu |
| `SwapConfirmationModal.svelte` | Swap confirmation dialog |
| `MevModal.svelte` | MEV protection information modal |
| `SettingsModal.svelte` | User preferences modal (slippage, theme, advanced) |
| `UnrecognizedTokenModal.svelte` | Warning for unknown token addresses |
| `ChainMismatchWarning.svelte` | Warning when wallet chain differs from selected chain |
| `AutoRefreshIndicator.svelte` | Visual indicator for auto-refresh countdown |
| `ThemeToggle.svelte` | Light/dark theme toggle |

### Stores (`src/lib/stores/`)

All stores use Svelte 5 runes (`$state`, `$derived`).

| Store | Purpose |
|---|---|
| `comparisonStore.svelte.ts` | Quote comparison state — fetching, results, errors |
| `formStore.svelte.ts` | Form input values (chain, tokens, amount) |
| `tokensStore.svelte.ts` | Selected token metadata |
| `tokenListStore.svelte.ts` | Token list loading and search |
| `balanceStore.svelte.ts` | On-chain token balance fetching |
| `walletStore.svelte.ts` | Wallet connection state and provider management |
| `transactionStore.svelte.ts` | Swap transaction lifecycle (submit, confirm, error) |
| `settingsStore.svelte.ts` | User settings (slippage, MEV protection) |
| `preferencesStore.svelte.ts` | Persisted user preferences (localStorage) |
| `themeStore.svelte.ts` | Theme state (light/dark) |
| `autoRefreshStore.svelte.ts` | Auto-refresh timer for quotes |
| `configStore.svelte.ts` | Backend feature-flag state |
| `urlSync.svelte.ts` | Two-way URL ↔ form state synchronization |

### API client

`openapi-fetch` with types generated from `openapi.yaml`. All backend calls go through a typed client in `src/lib/api.ts`. In development Vite proxies API requests to the local server; in production Traefik routes them.

## Request flow

1. **Browser** loads the SPA from nginx (the frontend container).
2. The SPA renders the compare form. User selects a chain, token pair, and amount.
3. The SPA calls the API (same origin — Traefik routes `/compare`, `/quote`, etc. to the API container).
4. The API parses parameters (`quote.ts`), resolves chain config and viem clients (`config.ts`).
5. For `/quote` — Spandex aggregates across providers and returns the best route.
6. For `/compare` — Spandex and Curve are queried in parallel; results are returned side-by-side.
7. The SPA displays results in `QuoteResults` → `QuoteCard` → `QuoteDetails`.
8. If the user has a wallet connected, they can execute the swap via `SwapConfirmationModal`.

## Deployment

Three containers behind Traefik, defined across two compose files:

| Service | Image / Build | Port | Memory limit |
|---|---|---|---|
| **Traefik** | `traefik:v3` | `:80` (HTTP), `:8080` (dashboard) | — |
| **API** | `packages/api/Dockerfile` (tsx runtime) | `:3100` | 512 MB |
| **Frontend** | `packages/frontend/Dockerfile` (multi-stage: Vite build → nginx) | `:80` | 128 MB |

- `traefik-proxy/docker-compose.yml` — runs Traefik with Docker provider, exposes port 80.
- `docker-compose.yml` — builds API and frontend from source (local development).
- `docker-compose.prod.yml` — pulls pre-built images from `ghcr.io/satoshiandkin/compare-dex-routers-{api,frontend}`.

Traefik routing:
- API routes (`/health`, `/chains`, `/config`, `/compare`, `/quote`, `/quote-curve`, `/tokenlist`, `/tokenlist/proxy`, `/token-metadata`, `/metrics`, `/analytics`, `/errors`, `/docs`, `/openapi.yaml`, `/.well-known`) match at priority 10.
- The frontend catches everything else at priority 1 (SPA fallback).

All three services share the external `traefik` Docker network.

## Data flow

Token metadata is fetched on-demand from chain via viem `readContract`. Spandex quotes come from `@spandex/core`, which aggregates across 0x, Fabric, KyberSwap, Odos, LiFi, Relay, and Velora. Curve quotes come from `@curvefi/api`. Gas prices are returned by Spandex when available, otherwise fetched from RPC with per-block caching (`gas-price.ts`). Token lists are loaded from bundled JSON files and served to the frontend via `/tokenlist`. The `/compare` endpoint queries Spandex and Curve in parallel and returns both results.
