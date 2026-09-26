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
| `config.ts`         | Chain definitions (7 chains), Spandex router setup with providers (0x, KyberSwap, Nordstern, LiFi, Relay, Velora), viem public clients, token metadata helpers |
| `quote.ts`          | Query-parameter parsing and validation (`chainId`, `from`, `to`, `amount`, `slippageBps`, `sender`, `mode`)                                                            |
| `quotes.ts`         | Unified provider quote formatting, simulation filtering, and recommendation arithmetic                                                                             |
| `quote-response.ts` | Shared Zod response schemas and API types                                                                                                                              |
| `redaction.ts`      | Credential removal before logs, errors, and Sentry                                                                                                                     |
| `gas-price.ts`      | Exact chain-native gas prices from RPC with per-block caching                                                                                                          |
| `analytics.ts`      | In-memory quote event tracking — success rates, latency, top pairs and chains                                                                                          |
| `error-insights.ts` | Error pattern aggregation — counts, deduplication, and threshold alerting                                                                                              |
| `metrics.ts`        | Prometheus-compatible metrics (request counts, durations, errors, uptime)                                                                                              |
| `feature-flags.ts`  | Environment-based feature flags (`CURVE_ENABLED`, `METRICS_ENABLED`)                                                                                |
| `logger.ts`         | Structured logging via pino with sensitive-value scrubbing (API keys, private keys, tokens)                                                                            |
| `sentry.ts`         | Sentry error-tracking initialization and helpers (`captureException`, `captureMessage`)                                                                                |
| `tracing.ts`        | `x-request-id` propagation — reads or generates a UUID per request                                                                                                     |
| `env.ts`            | `.env` file loader (imported first, before any other module reads `process.env`)                                                                                       |

Spandex owns Curve execution in a persistent Node worker thread, packaged with the SDK. The site registers normal `curve()` and has no worker protocol, loader, or provider-specific error handling. Shared SDK infrastructure owns request IDs, deadlines, serialized errors, crashes, cleanup, restart, and idle termination. Its synchronous catalog and route
computation cannot block the HTTP event loop or make the network providers miss
their quote deadlines. Spandex still evaluates every configured provider in
parallel, and the API still simulates each quote before selection. The worker
reuses Curve instances per chain and RPC URL. A cold Curve catalog can exceed the shared ten-second quote deadline; network providers still run independently and their successes remain in the response. The SDK retires an aborted worker once no callers remain, and a later request starts a fresh worker. Worker errors settle pending requests, and
the next request can start a new worker. Idle workers do not keep the API process
alive.

### API endpoints

| Method | Path                          | Description                                        |
| ------ | ----------------------------- | -------------------------------------------------- |
| `GET`  | `/health`                     | Health check                                       |
| `GET`  | `/chains`                     | Supported chains list                              |
| `GET`  | `/config`                     | Feature flags and runtime config                   |
| `GET`  | `/quote`                      | All provider results, failures, and recommendation                          |
| `GET`  | `/tokenlist`                  | Token lists                                        |
| `GET`  | `/token-metadata`             | On-chain token metadata lookup                     |
| `GET`  | `/metrics`                    | Prometheus-compatible metrics                      |
| `GET`  | `/analytics`                  | Quote analytics summary                            |
| `GET`  | `/errors`                     | Error pattern insights                             |
| `GET`  | `/docs`                       | API documentation UI (Swagger)                     |
| `GET`  | `/openapi.json`               | OpenAPI spec (also at `/openapi.yaml`)             |
| `GET`  | `/.well-known/farcaster.json` | Farcaster frame manifest                           |

### USD display values

`usd-price.ts` fetches one DeFiLlama native-asset/USD rate per quote response,
shared across routes. Requests have a two-second timeout, a 60-second cache,
and a ten-minute source-age limit. The API returns nullable dollar values plus
`usd_conversion` provenance. Decimal multiplication happens after native-currency
ranking, including required wallet approvals. A missing USD rate leaves the
recommendation intact; raw rankings omit gas-adjusted USD totals.

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

Transaction status links carry the submitted chain ID and full hash. Explorer
defaults come from viem chain metadata; users can save a per-chain HTTPS explorer
base URL in Settings. Links use `/tx/{hash}` and retain the submitted chain when
the wallet changes networks. Explorer preferences share the existing local
preferences storage and survive trade preference updates.

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
3. The SPA makes one `/api/quote` request. Vite or Traefik strips `/api` before forwarding it.
4. The API builds one Spandex provider set, including Curve when enabled. All providers use the same request parameters and simulation rules.
5. The API filters failed quotes and simulations, formats the common `Quote` schema, and computes the recommendation using exact integer arithmetic and the chain's native asset.
6. The SPA displays one recommended quote and an expandable list of provider results and failures. A request sequence prevents older responses from changing current state.
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

`quotes.ts` ranks every successful provider together with exact integer arithmetic and configuration-order ties. It uses canonical wrapped native tokens for conversion rates. Missing gas or rate data causes an explicit raw-amount comparison. The quote endpoint uses `quote-response.ts`; OpenAPI and the generated frontend client share that contract.

For a connected wallet, the API reads the input token's `balanceOf` (or the
native balance) once per request and compares it with each route's required
input. Sufficient balances are simulated with the original sender and token
state. There is no token storage discovery or balance override. The SDK supplies
native gas funds for price simulation; actual gas affordability remains a wallet
readiness check. Required approval estimates use the wallet's real allowance.

Without sufficient input funds or a successful balance read, provider quotes
remain visible with `simulation_status: "not_run"` and an explanation. They have
no execution payload or swap gas estimate. A funded refresh must simulate before
the route can be used for approval or swap. Mixed simulated and unsimulated
results use the same raw-amount ranking basis. Conversion-rate estimates use
ordinary provider quotes without simulation or token funding.

Exact-output quotes must meet the requested output amount. Simulated routes use
the actual simulated output; unsimulated routes use the provider's quoted output.
The API rejects even a one-unit shortfall before exposing a quote.
The pinned Spandex SDK simulates the swap at the RPC gas price and rejects
fee-sensitive reverts. It reports native output before gas costs so the API
does not deduct the same fee twice when it calculates a recommendation.
Before approval or confirmation, the browser refreshes `/quote` and retains the selected provider. It refreshes again after an approval receipt. After confirmation, the wallet store rechecks actual balances, allowances, account, network, and fresh fees and estimates gas for the exact transaction and
sets a limit 20% above the larger of that estimate and simulated gas usage. It
checks the wallet, chain, and quote again after the estimate before submission.

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

Native assets come from `/config` independently of token lists. Native balances use `eth_getBalance` and need no approvals. Raw integer balances and decimals drive exact sell-balance entry. Native entry first obtains a route estimate, reserves gas with the 20% margin and fresh network fees, and fails closed when fees are unavailable. Balance response sequences discard outdated reads.
