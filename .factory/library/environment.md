# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

- `ALCHEMY_API_KEY` - Required for RPC provider (backend only)
- `WALLETCONNECT_PROJECT_ID` - Optional, for WalletConnect integration (served via /config endpoint)

## Optional Environment Variables

- `ZEROX_API_KEY`, `FABRIC_API_KEY` - Additional Spandex provider keys
- `RPC_URL_{chainId}` - Per-chain RPC overrides
- `CURVE_ENABLED`, `COMPARE_ENABLED`, `METRICS_ENABLED` - Feature flags
- `SENTRY_DSN` - Error tracking
- `LOG_LEVEL` - Logging level (default: info)
- `PORT` - API server port (default: 3100)

## Notes

- Alchemy API key may be invalid/placeholder - server starts fine, only real quote fetching fails
- No API keys should ever appear in frontend bundle
- Frontend gets config via /config endpoint at runtime
