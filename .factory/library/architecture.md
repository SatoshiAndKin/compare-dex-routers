# Architecture

Architectural decisions, patterns, and conventions discovered during the mission.

**What belongs here:** Architecture decisions, module organization, dependency patterns, build pipeline details.

---

## Server Architecture

- `src/server.ts` — HTTP server, request routing, HTML UI template (INDEX_HTML)
- `src/config.ts` — Chain config, router setup, viem clients, token metadata
- `src/curve.ts` — Curve Finance API integration
- `src/quote.ts` — Query parameter parsing and validation
- `src/env.ts` — .env file loader
- `src/logger.ts` — Structured logging with pino
- Runtime: `tsx` (TypeScript execution without build step)

## Client Architecture (target state after extraction)

- `src/client/main.ts` — Entry point, initialization, event wiring
- `src/client/types.ts` — Shared interfaces and type definitions
- `src/client/styles.css` — All application CSS
- `src/client/*.ts` — Focused modules (wallet, autocomplete, chain-selector, etc.)
- Build: esbuild compiles to static output directory
- Server-side config injected via `window.__config` inline script

## Server-Side Template Interpolations

Only 2 values are injected from server into client:
1. `DEFAULT_TOKENS` — Chain-specific default token addresses (from config.ts)
2. `WALLETCONNECT_PROJECT_ID` — WalletConnect project ID env var

These must be passed via `window.__config` after extraction.

## Key Patterns

- No frameworks — vanilla TypeScript with DOM manipulation
- ERC-6963 wallet provider discovery (standards-based)
- Progressive quote rendering (stream results as they arrive)
- Client-side recommendation computation
- localStorage for preferences, tokenlist state, local tokens
