# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

- `ALCHEMY_API_KEY` required for RPC access
- `ZEROX_API_KEY`, `FABRIC_API_KEY` optional for specific providers
- `CURVE_ENABLED`, `COMPARE_ENABLED`, `METRICS_ENABLED` feature flags (default: true)
- `TOKENLIST_PATH` optional override for the tokenlist file path (defaults to `data/tokenlist.json`)
- Dev server runs with tsx (TypeScript execution, no build step)
- viem ^2.46.3 already installed - use for server-side code; browser-side wallet interaction uses raw EIP-1193 provider.request() calls (no CDN import needed)
- Flashbots Protect RPC URL: `https://rpc.flashbots.net` — hardcoded in client-side JS template (`FLASHBOTS_RPC_URL` constant in `src/server.ts`); used for MEV Protection swap flow on Ethereum mainnet via `wallet_addEthereumChain` + `wallet_switchEthereumChain`
