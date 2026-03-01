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
- All existing API endpoints must remain unchanged: /health, /chains, /compare, /quote, /metrics
