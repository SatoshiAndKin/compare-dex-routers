> **WARNING: This is a vibe coded prototype. Use at your own risk.**

# compare-dex-routers

Compare swap quotes from [Spandex](https://www.spandex.exchange/) and Curve Finance side by side, then execute the winning trade from the browser. Spandex aggregates across 0x, Fabric, KyberSwap, Odos, LiFi, Relay, and Velora. Curve covers all 7 supported chains.

![Web UI screenshot](docs/screenshot.png)

## Quick start

```sh
cp env.example .env   # fill in ALCHEMY_API_KEY
npm install
npm run dev           # starts API at :3100 and frontend at :5173
```

Open `http://localhost:5173` to use the UI.

## Features

- Searchable chain selector (filter by name or chain ID)
- Token autocomplete from built-in and custom tokenlists, with source labels when symbols collide
- Wallet connection via ERC-6963 discovery with `window.ethereum` fallback
- Approve + Swap flow with chain switching and transaction status tracking
- Auto-refreshing quotes (15s countdown, pauses during transactions)
- Gas-adjusted comparison with RPC fallback when Spandex omits gas price
- MEV protection guidance (Flashbots Protect on Ethereum, sequencer details on L2s)
- Slippage presets (10, 50, 100, 300 bps) plus custom input
- Clear (X) button on token inputs to quickly reset selections
- Duplicate token guard — selecting the same token in both fields swaps them automatically
- Brutalist black/white design with WCAG AA color accents
- Full addresses everywhere, no truncation (responsive font sizing via CSS `clamp()`)

## Tokenlist management

Token autocomplete reads from `packages/api/static/tokenlist.json` plus any custom remote tokenlists you add via the settings panel (gear icon next to the chain selector).

- Add custom tokenlist URLs (fetched directly from the browser)
- Toggle individual lists on/off; URLs and toggle states persist in `localStorage`
- Chain mismatch warnings when a list has no tokens for the selected chain
- Paste an unknown contract address to trigger on-chain ERC-20 metadata lookup, then save to your local token list
- Export/import local tokens as [Uniswap-format tokenlist](https://tokenlists.org/) JSON
- Trust warning for custom tokenlist sources
- Built-in default tokenlist loads even when the API is unreachable

## Supported chains

| Chain     | ID    |
| --------- | ----- |
| Ethereum  | 1     |
| Base      | 8453  |
| Arbitrum  | 42161 |
| Optimism  | 10    |
| Polygon   | 137   |
| BSC       | 56    |
| Avalanche | 43114 |

## API

### `GET /compare`

Compare quotes from multiple routers (Spandex and Curve) side-by-side.

| Param        | Required | Description                                |
| ------------ | -------- | ------------------------------------------ |
| `chainId`    | yes      | Chain ID (see table above)                 |
| `from`       | yes      | Input token address                        |
| `to`         | yes      | Output token address                       |
| `amount`     | yes      | Human-readable input amount (e.g. `1000`)  |
| `slippageBps`| no       | Slippage tolerance in basis points (default `50`) |
| `sender`     | no       | Sender address for approval checks (the UI uses the connected wallet automatically) |

### `GET /quote`

Single quote from the Spandex router. Same parameters as `/compare`.

### `GET /tokenlist`

Returns the contents of `packages/api/static/tokenlist.json`.

### `GET /token-metadata`

Looks up on-chain ERC-20 metadata for a given token address. Used by the UI for unrecognized token detection.

| Param     | Required | Description                        |
| --------- | -------- | ---------------------------------- |
| `chainId` | yes      | Chain ID (see table above)         |
| `address` | yes      | Token contract address             |

### `GET /chains`

Returns the list of supported chains.

### `GET /health`

Health check endpoint.

### `GET /metrics`

Prometheus-compatible metrics (enabled via `METRICS_ENABLED`).

### `GET /`

Interactive web UI.

## Environment variables

Copy `env.example` to `.env` and fill in your keys.

| Variable          | Required | Description                                  |
| ----------------- | -------- | -------------------------------------------- |
| `ALCHEMY_API_KEY` | yes      | Alchemy API key for RPC access               |
| `ZEROX_API_KEY`   | no       | 0x API key                                   |
| `FABRIC_API_KEY`  | no       | Fabric API key                               |
| `RPC_URL_<id>`    | no       | Per-chain RPC override (e.g. `RPC_URL_8453`) |
| `CURVE_ENABLED`   | no       | Enable Curve Finance quotes (all 7 chains)   |
| `COMPARE_ENABLED` | no       | Enable the `/compare` endpoint               |
| `METRICS_ENABLED` | no       | Enable the `/metrics` endpoint               |
| `SENTRY_DSN`      | no       | Sentry DSN for error tracking                |
| `LOG_LEVEL`       | no       | Log level (default `info`)                   |

## Development

All commands run from the repo root and delegate to workspaces (`packages/api`, `packages/frontend`).

```sh
npm run dev             # dev server with file watch
npm run typecheck       # type-check without emitting
npm run lint            # lint with ESLint
npm run lint:fix        # lint and auto-fix
npm run format          # format with Prettier
npm test                # run tests (Vitest)
npm run test:coverage   # tests with coverage
```

## Production

```sh
cd packages/api && npm start    # API server
cd packages/frontend && npm run build && npm run preview  # Frontend
```

Or with Docker:

```sh
docker compose up --build -d
docker compose down       # to stop
```

### Zero-downtime deploys

Uses [docker-rollout](https://github.com/Wowu/docker-rollout) with Traefik for zero-downtime rolling deployments. See `scripts/deploy.sh`.
