# User Testing

Testing surface, tools, URLs, setup steps, and known quirks.

**What belongs here:** How to test the app manually, what tools to use, setup steps, isolation notes.

---

## Testing Surface

### API (packages/api)
- **Tool:** curl
- **URL:** http://localhost:3100
- **Key endpoints:** /health, /chains, /config, /compare, /quote, /tokenlist, /docs
- **Start:** `cd packages/api && PORT=3100 npx tsx src/server.ts`

### Frontend (packages/frontend)
- **Tool:** agent-browser (Playwright)
- **URL:** http://localhost:5173
- **Start:** `cd packages/frontend && npm run dev -- --port 5173`
- **Requires:** API running on port 3100

## Setup Steps

1. `npm install` from repo root
2. Ensure .env exists with ALCHEMY_API_KEY
3. Start API first, then frontend
4. Frontend fetches /config, /tokenlist, /chains on startup

## Known Quirks

- Alchemy API key may return 401 - server starts fine, quotes fail. Not a UI test blocker.
- WalletConnect requires real browser with wallet extension for full flow testing.
- Farcaster SDK only works in Farcaster frame context.
- 17 pre-existing lint warnings (complexity) - not errors.

## Validation Dry Run Results (confirmed working)

- Ports 3100 and 5173: available
- npm test: 164 tests pass
- typecheck: clean
- lint: 0 errors
- Dev server on 3100: starts, /health returns ok
- agent-browser: navigates and interacts successfully
