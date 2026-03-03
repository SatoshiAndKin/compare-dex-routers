# Architecture

Architectural decisions, patterns, and conventions.

**What belongs here:** Architecture decisions, UI patterns, code organization.

---

- Single-file server: `src/server.ts` contains HTTP server + inline HTML template (`INDEX_HTML`)
- All UI is vanilla HTML/CSS/JS in the inline template string - no framework, no bundler
- Server uses Node.js built-in `http` module (no Express)
- Token data: `data/tokenlist.json` served via `GET /tokenlist` endpoint
- Browser-side wallet: use raw EIP-1193 `provider.request()` calls directly (e.g., `eth_requestAccounts`, `eth_sendTransaction`, `wallet_switchEthereumChain`) — no CDN import needed; `handleRequest` is exported for integration tests with an `isMainModule()` guard so tests use the real handler, not a stub
- ERC-6963: listen for `eip6963:announceProvider` events, dispatch `eip6963:requestProvider`
- Token autocomplete filters from fetched tokenlist by chainId, matches name/symbol/address
- Token input display format after selection: `SYMBOL (0xFullAddress)` — full 42-char address, never truncated. Actual address also stored in `data-address` attribute; `extractAddressFromInput()` reads `data-address` first, falls back to parsing display format. Note: there is a now-dead code path in `extractAddressFromInput()` at ~line 1872 that handles the old truncated `0xABCD...1234` format — it's harmless but unreachable.
- Spandex `gas_used` is always present (defaults to `'0'` when simulation absent); Curve `gas_used` is only present when a sender address is provided and gas estimation succeeds — render Curve gas conditionally
- Gas price sourcing uses two tiers: prefer Spandex-provided `gas_price_gwei` when present, otherwise fallback to RPC via `src/gas-price.ts`. Fallback cache key is `(chainId, blockNumber)` so repeated requests in the same block share one `getGasPrice()` RPC call per chain.
- Gas-adjusted comparison in `compareQuotes` uses three-way branching: (1) ETH/WETH output — subtract gas cost (gas_used * gas_price_gwei * 1e-9 ETH) directly from output for net comparison; (2) non-ETH output — show gas cost informationally in reason text without adjusting the comparison value; (3) gas unavailable for either router — fall back to raw output comparison with a note. Both renderers show `Gas Used: N/A` when gas data is absent.
- All existing API endpoints: /health, /chains, /compare, /quote, /metrics, /tokenlist, /tokenlist/proxy (GET, proxies HTTPS tokenlist URLs server-side to avoid CORS; validates https-only, 5MB limit, JSON+tokens-array structure; returns 400 for invalid URL, 502 for fetch failure)
- `updateTransactionActionStates()` broadly sets `button.disabled = false` for ALL `.tx-btn` elements when a wallet connects. This conflicts with the step-indicator pattern where the Swap button is intentionally rendered with `disabled` until Approve completes. The `.disabled` CSS class remains after wallet-connect but the HTML attribute is removed, making Swap technically clickable before approval. Any future worker modifying either the step-indicator or wallet-state management must account for this coupling.
- Form layout order (inside `<form id="form">`): chain selector → wallet section (.wallet-group, formerly .wallet-section which was outside the form) → from+amount row → to token → slippage → compare button. Wallet section is now a child of the form element.
- CSS class `.form-row-fixed` is used for the From+Amount row to prevent collapsing to vertical on narrow screens (flex-wrap: nowrap by CSS default, not explicitly declared). This is distinct from `.form-row` which collapses at 600px viewport width.
- MEV Protection info button is inside `#result` div (only visible after first compare submission). Sender field (`<input id="sender">`) was removed; sender is now sourced from the `connectedWalletAddressValue` wallet state variable.
