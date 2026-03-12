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

---

## Flow Validator Guidance: Frontend (Svelte SPA)

This is a read-only DEX comparison app — no login, no user accounts, no shared mutable state between sessions. Multiple browser sessions can run simultaneously without interference.

**Isolation rules:**
- Each flow validator gets its own browser session ID (use the session suffix assigned by orchestrator)
- No test data to isolate — all browser sessions read the same app state independently
- Token autocomplete suggestions come from the shared token list (read-only)

**Boundaries / off-limits:**
- Do not modify source files during validation
- Do not make API calls to external DEXes unless testing quote flow
- viewport size changes are local to each browser session

**Test URL:** http://localhost:5173

**How to select tokens:**
1. Click the From Token or To Token input
2. Type a token name (e.g., "USDC" or "WETH")
3. Wait for autocomplete dropdown to appear
4. Click on a token in the dropdown to select it
5. Selected token shows "SYMBOL (0xFullAddress)" in the input

**Key selectors to know:**
- Token input fields: `.token-input-field input`
- Clear buttons: `button[aria-label^="Clear"]`
- Autocomplete dropdown: `.autocomplete-list`
- Token items in dropdown: `.autocomplete-list button`

**Switching to dark mode:**
- Click the ThemeToggle button (sun/moon icon) in the header

**Viewport testing:**
- Use browser_resize to set width=375 for mobile viewport testing
- Use browser_resize to set width=1200 for desktop testing
