# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

- `PORT` — Server port (default: 3001, use 3000 to avoid OrbStack conflict)
- `ALCHEMY_API_KEY` — Required for RPC access (Curve init will fail without it, but server still works)

## Optional Environment Variables

- `WALLETCONNECT_PROJECT_ID` — For WalletConnect integration
- `ZEROX_API_KEY`, `FABRIC_API_KEY` — Provider API keys
- `RPC_URL_<chainId>` — Per-chain RPC overrides
- `DEFAULT_TOKENLISTS` — Comma-separated tokenlist file paths (defaults to `static/tokenlist.json`)
- `CURVE_ENABLED`, `COMPARE_ENABLED`, `METRICS_ENABLED` — Feature flags
- `SENTRY_DSN` — Error tracking
- `LOG_LEVEL` — Logging level

## Platform Notes

- Port 3001 conflicts with OrbStack on this machine. Always use PORT=3000.
- No Alchemy API key in .env — Curve Finance init logs errors but server starts fine.
