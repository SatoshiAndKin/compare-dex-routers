# User Testing

Testing surface: tools, URLs, setup steps, known quirks.

**What belongs here:** How to test the app manually, what tools to use, what to watch for.

---

## Testing Surface

- **URL:** http://localhost:3000
- **API Health:** http://localhost:3000/health
- **Start server:** `PORT=3000 npm run dev`
- **Stop server:** `lsof -ti :3000 | xargs kill`

## Tools

- **agent-browser (Playwright):** For page rendering, interactive flows, screenshots
- **curl:** For API endpoints (/health, /compare, /quote, /chains, /tokenlist)

## Setup Steps

1. Ensure `.env` exists with `PORT=3000`
2. `npm install`
3. `PORT=3000 npm run dev` (or use services.yaml start command)
4. Wait for server to respond at http://localhost:3000/health

## Known Quirks

- Curve Finance init fails without ALCHEMY_API_KEY — logged as errors but server works fine
- No wallet extensions available in Playwright headless mode — wallet connection flows can only be partially tested (modal opens, but actual provider connection requires a real browser extension)
- Farcaster miniapp flow requires `?miniApp=true` URL param
- Port 3001 conflicts with OrbStack — always use 3000
