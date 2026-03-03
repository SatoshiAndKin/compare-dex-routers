> **WARNING: This is a vibe coded prototype. Use at your own risk.**

# compare-dex-routers

A DEX router comparison and swap execution tool. Queries multiple swap routers ([Spandex](https://www.spandex.exchange/) and Curve Finance) for side-by-side quote comparison, then lets you execute the winning trade directly from the browser. Spandex aggregates across 0x, Fabric, KyberSwap, Odos, LiFi, Relay, and Velora. Curve Finance supports all 7 chains (Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche) with eager parallel initialization at startup. Includes a built-in web UI with wallet connection, token autocomplete, auto-refreshing quotes, and gas-adjusted recommendations.

![Web UI screenshot](docs/screenshot.png)

## Quick start

```sh
cp env.example .env   # fill in ALCHEMY_API_KEY
npm install
npm run dev           # starts server at http://localhost:3000
```

Open `http://localhost:3000` in a browser to use the UI.

## Features

**Searchable chain selector** — The chain dropdown is a searchable input that filters by chain name or chain ID. Type "base" or "8453" to narrow the list instantly.

**Token selection** — Autocomplete powered by a built-in tokenlist (`data/tokenlist.json`) plus any custom remote tokenlists added via the settings panel. Filters by the selected chain, shows token logos in the input fields after selection and in comparison results, and accepts name, symbol, or address. When multiple lists contain tokens with the same symbol, the source list name is shown for disambiguation. After selection the input displays the symbol followed by the full contract address. Dropdowns have a minimum width of 320 px. Full addresses are displayed throughout the UI — no truncation anywhere. Setting from and to to the same token automatically swaps them. The form fields are ordered: From token → To token → Sell exact/Buy exact toggle → Amount.

**Wallet connection** — Integrated directly in the form flow (Chain → Wallet → Tokens → Slippage → Compare). Detects wallets via ERC-6963 multi-provider discovery with `window.ethereum` fallback. Connect/disconnect with one click; the connected address is used automatically as the sender. The wallet provider menu supports scrolling when many wallets are available.

**Swap execution** — Approve and Swap buttons appear on each quote with a step indicator pattern (Step 1: Approve → Step 2: Swap) when token approval is required. Uses raw EIP-1193 provider calls. Handles chain switching when the wallet is on the wrong network and shows transaction status (pending → confirmed / failed). Clicking approve or swap when no wallet is connected triggers the wallet connection flow first, then automatically sends the transaction once connected.

**Auto-refresh** — Quotes re-fetch every 15 seconds with a visible countdown. Refreshing pauses while a transaction is in flight and resumes after it completes or fails.

**Gas-adjusted comparison** — The recommendation factors in gas costs when available. For ETH/WETH swaps, gas-adjusted output amounts are shown so you can compare net value received. Gas price is labeled "Gas Price:" and displayed next to the gas cost. When Spandex doesn't return a gas price, the server fetches it from its own RPC node with per-block caching as a fallback.

**MEV protection guidance** — An info button near the swap action area in results opens a modal with chain-specific MEV advice: Flashbots Protect for Ethereum, bloXroute for BSC, and sequencer details for L2 chains.

**Slippage presets** — Quick-pick buttons for common slippage values (10, 50, 100, 300 bps) alongside the manual input field. The active preset is highlighted; typing a custom value clears the highlight.

**Brutalist design** — High-contrast black/white with WCAG AA compliant color accents: blue (`#0055FF`) for the recommended quote, dark orange (`#CC2900`) for alternatives, dark green (`#007700`) for success states, and dark red (`#CC0000`) for errors. Labels get blue left borders; result cards get colored left borders. The "Recommended" badge is a flat label rather than a pill. No border-radius. Inline results with collapsible details.

## Tokenlist management

Token autocomplete reads from `data/tokenlist.json` (the built-in default list) plus any custom remote tokenlists you add. Click the **gear icon** next to the chain selector to open the settings panel.

**Multiple tokenlists** — Add as many custom tokenlist URLs as you want (e.g. `https://tokens.uniswap.org`). Each list can be independently toggled on/off. Remote lists are fetched through a server-side proxy (`GET /tokenlist/proxy?url=...`) to avoid CORS issues. All list URLs and toggle states persist in `localStorage`.

**Chain mismatch warnings** — If a loaded tokenlist has no tokens for the currently selected chain, a warning is displayed in the settings panel.

**Unrecognized token detection** — Entering a contract address that isn't in any active tokenlist triggers an on-chain ERC-20 metadata lookup via `GET /token-metadata`. If the address is a valid ERC-20 token, a popup offers to save it to your local token list.

**Local token management** — Custom tokens saved via the popup are stored in `localStorage` and appear in autocomplete alongside list tokens. You can view and remove individual local tokens from the settings panel.

**Export/Import** — Export your local tokens as a [Uniswap-format tokenlist](https://tokenlists.org/) JSON file. Import tokens from a previously exported file. Useful for sharing custom token sets across browsers or devices.

**Trust warning** — The settings panel includes a reminder to only use tokenlist sources you trust, since malicious lists could include scam tokens.

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

Returns the contents of `data/tokenlist.json`.

### `GET /tokenlist/proxy`

Server-side proxy for fetching remote tokenlists. Avoids CORS restrictions.

| Param | Required | Description                          |
| ----- | -------- | ------------------------------------ |
| `url` | yes      | Remote tokenlist URL to fetch        |

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
npm start
```

Or with Docker:

```sh
docker compose up --build -d
docker compose down       # to stop
```

### Docker Swarm (zero-downtime deploys)

A `docker-stack.yml` is included for single-node zero-downtime rolling deployments via Docker Swarm. The stack uses `start-first` ordering so the new container must pass its healthcheck before the old one is stopped.

```sh
docker swarm init                                              # one-time setup
docker build -t compare-dex-routers:latest .
docker stack deploy -c docker-stack.yml spandex                # deploy / update
docker stack services spandex                                  # check status
docker stack rm spandex                                        # tear down
```

Rollback is automatic if the new container fails to become healthy.
