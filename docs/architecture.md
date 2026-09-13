# Architecture

## Overview

```
                         ┌───────────────────────────────────────┐
                         │              Traefik (:80)            │
                         │          path-based routing           │
                         └──────┬────────────────────┬──────────┘
                                │                    │
                   /api/*, manifest            all other paths
                   strip /api                     (priority 1)
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
├── scripts/generate-api-types.ts  # Generates frontend types from API spec
├── docker-compose.yml # Local Docker stack (build from source)
├── docker-compose.prod.yml  # Production stack (pre-built images)
├── traefik-proxy/     # Traefik reverse-proxy config
└── package.json       # Root workspace config (pnpm workspaces)
```

Both packages are managed through pnpm workspaces. Root-level scripts (`pnpm run typecheck`, `pnpm test`, etc.) fan out to each workspace.

## API (`packages/api`)

Plain `node:http` server. Runs via `tsx` so TypeScript files execute directly, no build step.

### Modules

| Module              | Responsibility                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts`         | HTTP request routing, response handling, token-list loading, quote orchestration                                                                                       |
| `config.ts`         | Chain definitions (7 chains), Spandex router setup with providers (0x, Fabric, KyberSwap, Nordstern, LiFi, Relay, Velora), viem public clients, token metadata helpers |
| `quote.ts`          | Query-parameter parsing and validation (`chainId`, `from`, `to`, `amount`, `slippageBps`, `sender`, `mode`)                                                            |
| `quotes.ts`         | Shared Spandex/Curve quote formatting, simulation filtering, and recommendation arithmetic                                                                             |
| `quote-response.ts` | Shared Zod response schemas and API types                                                                                                                              |
| `redaction.ts`      | Credential removal before logs, errors, and Sentry                                                                                                                     |
| `gas-price.ts`      | Exact chain-native gas prices from RPC with per-block caching                                                                                                          |
| `analytics.ts`      | In-memory quote event tracking — success rates, latency, top pairs and chains                                                                                          |
| `error-insights.ts` | Error pattern aggregation — counts, deduplication, and threshold alerting                                                                                              |
| `metrics.ts`        | Prometheus-compatible metrics (request counts, durations, errors, uptime)                                                                                              |
| `feature-flags.ts`  | Environment-based feature flags (`CURVE_ENABLED`, `COMPARE_ENABLED`, `METRICS_ENABLED`)                                                                                |
| `logger.ts`         | Structured logging via pino with sensitive-value scrubbing (API keys, private keys, tokens)                                                                            |
| `sentry.ts`         | Sentry error-tracking initialization and helpers (`captureException`, `captureMessage`)                                                                                |
| `tracing.ts`        | `x-request-id` propagation — reads or generates a UUID per request                                                                                                     |
| `env.ts`            | `.env` file loader (imported first, before any other module reads `process.env`)                                                                                       |

### API endpoints

| Method | Path                          | Description                                        |
| ------ | ----------------------------- | -------------------------------------------------- |
| `GET`  | `/health`                     | Health check                                       |
| `GET`  | `/chains`                     | Supported chains list                              |
| `GET`  | `/config`                     | Feature flags and runtime config                   |
| `GET`  | `/compare`                    | Compare quotes from Spandex and Curve side-by-side |
| `GET`  | `/quote`                      | Single quote from Spandex                          |
| `GET`  | `/quote-curve`                | Single quote from Curve                            |
| `GET`  | `/tokenlist`                  | Token lists                                        |
| `GET`  | `/token-metadata`             | On-chain token metadata lookup                     |
| `GET`  | `/metrics`                    | Prometheus-compatible metrics                      |
| `GET`  | `/analytics`                  | Quote analytics summary                            |
| `GET`  | `/errors`                     | Error pattern insights                             |
| `GET`  | `/docs`                       | API documentation UI (Swagger)                     |
| `GET`  | `/openapi.json`               | OpenAPI spec (also at `/openapi.yaml`)             |
| `GET`  | `/.well-known/farcaster.json` | Farcaster frame manifest                           |

## Frontend (`packages/frontend`)

A Svelte 5 SPA built with Vite. In production it is served as static files by nginx.

### Components (`src/lib/components/`)

| Component                       | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `CompareForm.svelte`            | Main form — ties together chain, token, and amount inputs |
| `ChainSelector.svelte`          | Chain picker dropdown                                     |
| `TokenInput.svelte`             | Token address input with metadata lookup                  |
| `AmountFields.svelte`           | Swap amount and mode (exactIn / targetOut)                |
| `SlippagePresets.svelte`        | Slippage tolerance selector                               |
| `QuoteResults.svelte`           | Container for quote comparison results                    |
| `QuoteCard.svelte`              | Individual quote summary card                             |
| `QuoteDetails.svelte`           | Expanded quote details (gas, calldata, approvals)         |
| `WalletButton.svelte`           | Wallet connect/disconnect button                          |
| `WalletProviderMenu.svelte`     | Wallet provider selection menu                            |
| `SwapConfirmationModal.svelte`  | Swap confirmation dialog                                  |
| `SettingsModal.svelte`          | Token-list management and wallet RPC guidance             |
| `UnrecognizedTokenModal.svelte` | Warning for unknown token addresses                       |
| `ChainMismatchWarning.svelte`   | Warning when wallet chain differs from selected chain     |
| `AutoRefreshIndicator.svelte`   | Visual indicator for auto-refresh countdown               |
| `ThemeToggle.svelte`            | Light/dark theme toggle                                   |

### Stores (`src/lib/stores/`)

All stores use Svelte 5 runes (`$state`, `$derived`).

| Store                        | Purpose                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `comparisonStore.svelte.ts`  | Quote comparison state — fetching, results, errors                        |
| `formStore.svelte.ts`        | Form input values (chain, tokens, amount)                                 |
| `formLifecycle.svelte.ts`    | Chain defaults and metadata resolution before comparison                  |
| `tokensStore.svelte.ts`      | Selected token metadata                                                   |
| `tokenListStore.svelte.ts`   | Token list loading and search                                             |
| `balanceStore.svelte.ts`     | On-chain token balance fetching                                           |
| `walletStore.svelte.ts`      | Wallet connection state and provider management                           |
| `transactionStore.svelte.ts` | Swap transaction lifecycle (submit, confirm, error)                       |
| `settingsStore.svelte.ts`    | Settings dialog visibility; private RPC guidance stays in the wallet flow |
| `preferencesStore.svelte.ts` | Persisted user preferences (localStorage)                                 |
| `themeStore.svelte.ts`       | Theme state (light/dark)                                                  |
| `autoRefreshStore.svelte.ts` | Auto-refresh timer for quotes                                             |
| `configStore.svelte.ts`      | Backend feature-flag state                                                |
| `urlSync.svelte.ts`          | Two-way URL ↔ form state synchronization                                  |

### API client

`openapi-fetch` with types generated from the API's Zod schemas (`pnpm run generate:types`). Quote and token calls go through a typed client in `src/lib/api.ts`. In development Vite proxies API requests to the local server; in production Traefik routes them.

## Request flow

1. The browser loads the SPA from nginx.
2. Config, preferences, or URL parameters select token addresses. Comparison waits for actual token decimals.
3. The SPA makes one `/api/compare` request. Vite or Traefik strips `/api` before forwarding it.
4. The API builds one Spandex provider set, including Curve when enabled. Both quote groups use the same request parameters and simulation rules.
5. The API filters failed quotes and simulations, formats the common `Quote` schema, and computes the recommendation using exact integer arithmetic and the chain's native asset.
6. The SPA displays both results and the server recommendation together. A request sequence prevents older responses from changing current state.
7. A preview has no execution data. Connecting a wallet obtains a fresh quote for that account.
8. Approval and swap operations check the current quote, form, provider, account, chain, and allowance before sending through the wallet RPC. Context changes cancel confirmation. Auto-refresh pauses during the operation and requests a fresh quote afterward.

## Deployment

Three containers behind Traefik, defined across two compose files:

| Service      | Image / Build                                                    | Port                              | Memory limit |
| ------------ | ---------------------------------------------------------------- | --------------------------------- | ------------ |
| **Traefik**  | `traefik:v3`                                                     | `:80` (HTTP), `:8080` (dashboard) | —            |
| **API**      | `packages/api/Dockerfile` (tsx runtime)                          | `:3100`                           | 512 MB       |
| **Frontend** | `packages/frontend/Dockerfile` (multi-stage: Vite build → nginx) | `:80`                             | 128 MB       |

- `traefik-proxy/docker-compose.yml` — runs Traefik with Docker provider, exposes port 80.
- `docker-compose.yml` — builds API and frontend from source (local development).
- `docker-compose.prod.yml` — pulls pre-built images from `ghcr.io/satoshiandkin/compare-dex-routers-{api,frontend}`.

Traefik routing:

- `/api` and `/api/…` match at priority 10. The middleware removes `/api`.
- `/.well-known/farcaster.json` routes directly to the API for the standard manifest path.
- The frontend serves other paths at priority 1.

Both app Compose files forward all seven `RPC_URL_<id>` overrides. The API listens on port 3100 inside the container. The services share the external `traefik-proxy` network.

## Data flow

`@spandex/core` owns all provider adapters, including the maintained Curve fork. Curve initializes its SDK per chain and RPC URL, shares pending initialization, and retries failed initialization. It converts basis points to the SDK's percentage unit before building calldata.

`quotes.ts` groups successful simulations into Spandex and Curve results. It uses canonical wrapped native tokens for conversion rates. Missing gas or rate data causes an explicit raw-amount comparison. All quote endpoints use `quote-response.ts`; OpenAPI and the generated frontend client share that contract.

Saved token-list identities and enabled states enter memory before network requests start. Responses update lists by URL. Metadata requests are shared by chain and address, and late results cannot replace a newer selection. Balance caches store raw values and format them with the current decimals.

## Runtime lifecycle and browser assets

`shutdown.ts` owns HTTP connection draining and the reporting deadline. `server.ts`
installs one handler for SIGTERM/SIGINT. The Compose drain hook withdraws old
containers from Traefik before stopping them.

`tokenlists.ts` caches parsed default files by file identity and retains last valid
content on read/validation failure. The browser token-list store schedules daily
refreshes only while visible, supports manual refresh, and cancels removed or
unmounted requests. Configured default files appear as one built-in list in Settings.

Wallet SDKs are pinned, lazy-loaded Vite dependencies. Farcaster uses the Mini App
SDK's EIP-1193 provider. Swagger's CDN versions and hashes live in `docs-assets.ts`;
its OpenAPI server URL is relative so direct and `/api`-prefixed deployments work.
The space theme uses local SVG/CSS assets and the existing light/dark preference.
