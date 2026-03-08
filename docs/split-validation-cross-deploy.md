# Validation Assertions: Cross-Area Flows & Deployment

> Area: Cross-area integration flows (VAL-CROSS) and deployment (VAL-DEPLOY)
> Context: Splitting monolith (`src/server.ts` + `src/client/`) into `packages/api` + `packages/frontend` (Svelte SPA)
> These assertions catch integration issues that per-area assertions miss.

---

## Cross-Area Flows (VAL-CROSS)

### VAL-CROSS-001 — First Visit Flow (Clean Browser)

**Behavioral description:**
A user with no localStorage and no URL parameters visits the app for the first time. The frontend loads, fetches the default tokenlist from the API (`GET /tokenlist`), applies chain defaults (Base 8453), populates From/To fields with default tokens (formatted as `SYMBOL (0xFullAddress)`), sets slippage to 50 bps, and the form is immediately usable for comparison.

**Pass condition:**
- Page loads without console errors (no CORS, no 404s for API calls)
- Chain selector shows "Base (8453)"
- From/To fields are pre-filled with default tokens for Base (symbol + full address)
- Token icons appear next to From/To fields
- Sell amount field contains "1"
- Slippage shows 50 bps with the "50" preset highlighted
- "Compare Quotes" button is visible and clickable
- No stale localStorage remnants affect the display

**Fail condition:**
- CORS error when frontend fetches `/tokenlist` or `/chains` from API
- Empty or raw-address token fields (no symbol resolution)
- Chain defaults don't match `DEFAULT_TOKENS` for chain 8453
- Any JavaScript error in console during initialization

**Evidence:** Screenshot of loaded form. Browser console log showing no errors. Network tab showing successful `/tokenlist` and `/chains` requests to API domain.

---

### VAL-CROSS-002 — Full Quote Comparison Flow

**Behavioral description:**
User selects a chain (Ethereum 1), picks From token (USDC) via autocomplete, picks To token (WETH) via autocomplete, enters amount "100", clicks "Compare Quotes". The frontend sends `GET /compare?chainId=1&from=...&to=...&amount=100&slippageBps=50&mode=exactIn` to the API. Results display with Recommended/Alternative tabs showing Spandex and Curve quotes, including output amounts, gas costs, provider names, and a recommendation reason.

**Pass condition:**
- Autocomplete lists appear when typing in From/To fields (tokens loaded from API)
- Selecting a token populates the field with `SYMBOL (0xFullAddress)` format and shows icon
- After clicking Compare, a loading indicator appears
- API returns JSON with `spandex` and/or `curve` quote objects
- Recommended tab shows the winner with output amount, gas cost in ETH, provider name
- Alternative tab shows the other quote
- URL updates with query params (`?chainId=1&from=...&to=...&amount=100&slippageBps=50`)
- Auto-refresh indicator appears with countdown

**Fail condition:**
- CORS blocks the `/compare` request
- Frontend fails to parse API response (schema mismatch between packages)
- Results don't render (missing fields, wrong field names)
- URL doesn't update (url-sync broken after split)

**Evidence:** Screenshot of results with both tabs. Network request/response for `/compare`. URL bar showing updated params.

---

### VAL-CROSS-003 — Wallet Connect → Compare → Approve → Swap

**Behavioral description:**
User connects wallet via provider menu, compares quotes (which now include `sender` param from connected address), views results with Approve/Swap buttons enabled, clicks Approve on the recommended quote (sends ERC-20 approve tx), then clicks Swap (sends router tx). The wallet connection state persists across API calls — the `sender` parameter is included in `/compare` requests.

**Pass condition:**
- "Connect Wallet" button opens provider menu modal
- After connecting, wallet address displays in the form area
- Compare request includes `&sender=0x...` (connected address)
- Quote results include `approval_token`, `approval_spender`, `router_address`, `router_calldata`
- Approve button triggers wallet signature request
- After approval, Swap button becomes active
- Swap button triggers wallet transaction
- Auto-refresh pauses during transaction flow

**Fail condition:**
- Wallet connection fails (WalletConnect CDN import broken, or provider detection fails)
- `sender` param not sent to API (form reading broken)
- Approve/Swap buttons don't appear (transaction module not wired to quote display)
- Transaction calldata from API is malformed or missing fields

**Evidence:** Screenshot of connected wallet state. Network request showing `sender` param. Screenshot of Approve/Swap buttons in results.

---

### VAL-CROSS-004 — Token List Management → Autocomplete → Quote

**Behavioral description:**
User opens Settings, adds a custom tokenlist URL (e.g., `https://tokens.uniswap.org`). The frontend fetches it via `GET /tokenlist/proxy?url=...` through the API. After loading, user closes Settings, types a token symbol from the new list in the From field, autocomplete shows it with source label, user selects it, runs comparison. The custom token address is correctly sent to the API.

**Pass condition:**
- Settings modal opens with tokenlist management UI
- Custom URL input accepts HTTPS URLs
- `GET /tokenlist/proxy?url=...` request goes to API (not direct to external URL)
- Loaded tokens appear in autocomplete with source label (list name)
- Selecting a custom-list token populates the field with correct address
- Comparison works with the custom token address
- Tokenlist URL persists in localStorage across page reloads

**Fail condition:**
- CORS error on `/tokenlist/proxy` endpoint
- Proxy endpoint missing from API package (dropped during split)
- Autocomplete doesn't refresh after tokenlist loads
- Token address mismatch between autocomplete selection and API request

**Evidence:** Screenshot of Settings with loaded custom list. Autocomplete showing custom-list tokens. Network request for `/tokenlist/proxy`. Comparison result using custom token.

---

### VAL-CROSS-005 — Settings Persistence Across Reload

**Behavioral description:**
User changes: chain to Ethereum (1), From to DAI, To to USDC, amount to "500", slippage to 100 bps, direction to targetOut, adds a custom tokenlist, toggles off default list. User reloads the page. All settings are restored from localStorage. The frontend re-fetches tokenlists from API on reload and re-applies formatting.

**Pass condition:**
- After reload, chain shows "Ethereum (1)"
- From/To fields show previously selected tokens with symbols and icons
- Amount field shows "500" in the correct field (Receive for targetOut)
- Slippage shows 100 bps with "100" preset highlighted
- Direction mode is targetOut (Receive field is active)
- Settings modal shows custom tokenlist still loaded, default list toggled off
- Autocomplete only shows tokens from enabled lists
- `localStorage` key `compare-dex-preferences` contains all saved state

**Fail condition:**
- Any setting reverts to default after reload
- Token symbols not resolved (tokenlist not re-fetched from API on reload)
- Per-chain token memory lost (switching chains doesn't restore per-chain tokens)
- Custom tokenlist URL lost or not re-fetched

**Evidence:** Screenshot before reload. Screenshot after reload. localStorage dump showing `compare-dex-preferences` and tokenlist URLs.

---

### VAL-CROSS-006 — URL Sharing (Deep Link)

**Behavioral description:**
User A runs a comparison on Ethereum, USDC→WETH, amount 100, slippage 30 bps. URL updates to `?chainId=1&from=0x...&to=0x...&amount=100&slippageBps=30`. User A copies URL and shares it. User B opens the URL in a new browser tab (no localStorage). The form populates from URL params, tokenlists load, token symbols resolve, and comparison auto-fires.

**Pass condition:**
- URL contains all params: `chainId`, `from`, `to`, `amount`, `slippageBps`
- Opening URL in new tab: chain selector shows Ethereum (1)
- From/To fields show tokens with resolved symbols (after tokenlist loads from API)
- Amount field shows "100"
- Slippage shows 30 bps
- Comparison auto-fires (because all 4 required URL params present)
- Results display correctly
- `mode` param excluded from URL when it's the default (`exactIn`)
- `sender` param never written to URL (comes from wallet state)

**Fail condition:**
- URL params don't survive the split (different URL structure in SPA)
- Token symbols don't resolve (tokenlist not loaded before formatting)
- Auto-compare doesn't fire (URL param detection broken)
- SPA routing interferes with query params

**Evidence:** URL from User A's browser. Screenshot of User B's browser showing populated form and results.

---

### VAL-CROSS-007 — Custom Token by Address → Quote

**Behavioral description:**
User enters an unrecognized ERC-20 contract address in the From field. The frontend detects it's address-like (`0x...`, 42 chars), triggers the unrecognized token modal. The frontend calls `GET /token-metadata?chainId=...&address=...` to fetch on-chain metadata (name, symbol, decimals). User saves token to local list. Token appears in autocomplete. User selects it and runs a comparison.

**Pass condition:**
- Entering a 42-char hex address triggers unrecognized token modal
- Modal shows "Fetching token metadata..." loading state
- `GET /token-metadata` request sent to API
- Modal displays resolved name, symbol, decimals
- "Save to Local List" button saves to localStorage
- Saved token appears in autocomplete under "Local Tokens" source
- Comparison works with the custom token address
- Token metadata (decimals) correctly used for amount parsing

**Fail condition:**
- `/token-metadata` endpoint missing from API package
- CORS blocks the metadata request
- Modal doesn't appear (address detection broken)
- Saved token not visible in autocomplete (local token management broken)
- Wrong decimals cause amount parsing errors in comparison

**Evidence:** Screenshot of unrecognized token modal with metadata. Network request for `/token-metadata`. Autocomplete showing saved local token. Comparison result.

---

### VAL-CROSS-008 — Chain Switching Clears State

**Behavioral description:**
User is on Ethereum with active comparison results and auto-refresh running. User switches chain to Arbitrum (42161). Auto-refresh stops, results clear, From/To fields update to Arbitrum defaults (or saved per-chain preferences), balance cache clears, token balances re-fetch for new chain, tokenlist sources re-render for new chain.

**Pass condition:**
- Chain change fires event that triggers: `stopAutoRefresh()`, `clearResultDisplay()`, `resetCurrentQuoteChainId()`, `applyDefaults(newChainId)`, `clearBalanceCache()`, `updateTokenBalances()`, `renderTokenlistSources()`
- Results area is empty after chain switch
- From/To fields show Arbitrum default tokens (or saved per-chain tokens)
- Token icons update to match new tokens
- Auto-refresh indicator disappears
- If wallet connected, balances update for new chain
- URL updates to reflect new chain

**Fail condition:**
- Stale Ethereum results remain visible after switching to Arbitrum
- Auto-refresh continues with old chain params
- From/To fields still show Ethereum tokens
- Balance cache not cleared (shows stale Ethereum balances)

**Evidence:** Screenshot before chain switch (Ethereum results). Screenshot after chain switch (Arbitrum defaults, empty results).

---

### VAL-CROSS-009 — Error Handling Across Boundaries

**Behavioral description:**
Multiple error scenarios across the frontend↔API boundary: (a) API is unreachable — frontend shows connection error, (b) invalid token address returns 400 from API — frontend shows validation error, (c) both routers fail — frontend shows combined error message, (d) network timeout — frontend handles gracefully with retry option, (e) malformed API response — frontend doesn't crash.

**Pass condition:**
- **(a) API down:** Frontend shows "Failed to fetch" or connection error, no unhandled promise rejection
- **(b) Invalid params:** API returns 400 with `{"error": "..."}`, frontend displays the error message
- **(c) Both routers fail:** API returns 200 with `spandex_error` and `curve_error` populated, frontend shows both error messages
- **(d) Timeout:** Frontend's fetch has timeout handling, shows appropriate message
- **(e) Malformed response:** Frontend doesn't throw on unexpected JSON shape, shows generic error

**Fail condition:**
- Unhandled promise rejection crashes the app
- Error message not displayed to user (silent failure)
- Infinite loading spinner with no timeout
- Console errors from JSON parse failures

**Evidence:** Screenshots of each error state. Console log showing no unhandled errors. Network tab showing error responses.

---

### VAL-CROSS-010 — Responsive Full Flow at 375px

**Behavioral description:**
On a 375px viewport (mobile), the entire flow works: chain selection dropdown opens and is usable, token autocomplete lists are scrollable and tappable, amount fields are large enough to type, slippage presets are tappable, Compare button is full-width, results display without horizontal overflow, tabs are tappable, expanded details are readable, wallet connect modal is usable, settings modal scrolls properly.

**Pass condition:**
- No horizontal scrollbar on body at 375px
- Chain dropdown opens below input, doesn't overflow viewport
- Autocomplete list items have adequate touch targets (≥44px height)
- Amount fields are wide enough for 20-digit numbers
- Slippage presets all visible and tappable
- Results cards don't overflow horizontally
- Full token addresses visible (no truncation — per project rules)
- Modals (Settings, MEV, Wallet, Unrecognized Token) are scrollable and don't overflow
- All buttons have minimum touch target size

**Fail condition:**
- Horizontal scroll appears
- Autocomplete items too small to tap
- Token addresses truncated with `...` pattern
- Modals extend beyond viewport without scroll
- Any interactive element unreachable on mobile

**Evidence:** Screenshots at 375px viewport of: form, autocomplete open, results, settings modal, wallet modal.

---

## Deployment Assertions (VAL-DEPLOY)

### VAL-DEPLOY-001 — API Docker Image Builds and Starts

**Behavioral description:**
The `packages/api` Dockerfile builds successfully from the monorepo. The resulting image starts the Node.js server (via `tsx src/server.ts` or compiled JS), listens on the configured PORT, and the `/health` endpoint returns `{"status":"ok"}`.

**Pass condition:**
- `docker build -t api ./packages/api` completes without errors
- `docker run -p 3001:3001 --env-file .env api` starts the server
- `curl http://localhost:3001/health` returns `{"status":"ok","requestId":"...","flags":{...}}`
- Container healthcheck passes (exit code 0)
- All API endpoints respond: `/chains`, `/tokenlist`, `/compare`, `/quote`, `/token-metadata`, `/tokenlist/proxy`, `/metrics`
- No "module not found" or "Cannot find module" errors in container logs

**Fail condition:**
- Build fails (missing dependencies, TypeScript errors, missing `src/` files)
- Server doesn't start (missing env vars, wrong entrypoint)
- `/health` returns non-200 or non-JSON
- Any API endpoint returns 404 (route missing after split)

**Evidence:** Docker build log. Container startup log. `curl` output for `/health`. `docker inspect` showing healthy status.

---

### VAL-DEPLOY-002 — Frontend Docker Image Builds and Starts (nginx)

**Behavioral description:**
The `packages/frontend` Dockerfile builds the Svelte SPA (produces static files in `dist/` or `build/`), then copies them into an nginx container. The nginx serves `index.html` for all routes (SPA fallback), static assets with correct MIME types, and the app loads in a browser.

**Pass condition:**
- `docker build -t frontend ./packages/frontend` completes without errors
- Svelte/Vite build produces `index.html`, JS bundles, CSS
- `docker run -p 80:80 frontend` starts nginx
- `curl http://localhost:80/` returns HTML containing `<script>` tags for the Svelte app
- `curl http://localhost:80/static/client.js` returns JavaScript with correct `Content-Type: application/javascript`
- SPA fallback: `curl http://localhost:80/any/path` returns `index.html` (not 404)
- Container healthcheck passes: `curl -f http://localhost:80/` returns 200

**Fail condition:**
- Build fails (missing dependencies, Svelte compilation errors)
- nginx returns 403 (wrong file permissions) or 404 (wrong root path)
- Static assets served with wrong MIME type
- SPA fallback not configured (deep links return 404)

**Evidence:** Docker build log. `curl` output for `/` and a static asset. nginx access log showing 200 responses.

---

### VAL-DEPLOY-003 — Traefik Routes to Correct Service

**Behavioral description:**
With Traefik as reverse proxy and both API and frontend services running, HTTP requests are routed correctly: API paths (`/compare`, `/quote`, `/health`, `/chains`, `/tokenlist`, `/tokenlist/proxy`, `/token-metadata`, `/metrics`, `/analytics`, `/errors`) route to the API container on port 3001. All other paths (including `/`) route to the frontend container on port 80. Traefik handles TLS termination.

**Pass condition:**
- `curl https://DOMAIN/health` → routed to API, returns `{"status":"ok"}`
- `curl https://DOMAIN/chains` → routed to API, returns chain list JSON
- `curl https://DOMAIN/compare?...` → routed to API, returns comparison JSON
- `curl https://DOMAIN/` → routed to frontend, returns HTML
- `curl https://DOMAIN/static/client.js` → routed to frontend, returns JS
- API router has higher priority for its specific paths
- Frontend router catches all remaining paths (priority=1 or lower)
- TLS certificate is valid (Let's Encrypt)
- HTTP→HTTPS redirect works

**Fail condition:**
- API paths return HTML (routed to frontend instead)
- Frontend paths return JSON (routed to API instead)
- `/tokenlist/proxy` returns 404 (Traefik path matching doesn't cover it)
- TLS errors or certificate warnings

**Evidence:** Traefik dashboard showing router rules. `curl -v` output for API and frontend paths showing correct routing. TLS certificate details.

---

### VAL-DEPLOY-004 — docker-rollout Deploys API Without Frontend Downtime

**Behavioral description:**
While the frontend is serving traffic, `docker rollout api` is executed. docker-rollout scales API to 2 containers, waits for the new container's healthcheck to pass, runs the pre-stop hook on the old container (`touch /tmp/drain && sleep 10`), then removes the old container. Throughout this process, the frontend remains accessible and API requests continue to be served (routed to whichever API container is healthy).

**Pass condition:**
- During rollout, `curl https://DOMAIN/` returns frontend HTML (no downtime)
- During rollout, `curl https://DOMAIN/health` returns 200 from at least one API container
- No failed API requests during the rollout window (verified by continuous polling)
- After rollout, only one API container remains
- New API container responds to `/health`
- Pre-stop hook runs: old container's healthcheck fails → Traefik stops routing to it → in-flight requests complete → container removed
- Frontend never restarts during API rollout

**Fail condition:**
- Frontend returns 502/503 during API rollout
- API requests return errors during rollout transition
- Both API containers removed simultaneously (brief downtime)
- Pre-stop hook doesn't fire (in-flight requests dropped)
- Frontend container restarted by docker-rollout (wrong service targeted)

**Evidence:** Continuous `curl` loop output during rollout showing no errors. Docker events log showing container lifecycle. `docker ps` before and after showing correct container count.

---

### VAL-DEPLOY-005 — docker-rollout Deploys Frontend Without API Downtime

**Behavioral description:**
While the API is serving comparison requests, `docker rollout frontend` is executed. docker-rollout scales frontend to 2 containers, waits for the new container's healthcheck (nginx responds to `/`), runs pre-stop hook, removes old container. API remains fully functional throughout.

**Pass condition:**
- During rollout, `curl https://DOMAIN/health` returns 200 (API unaffected)
- During rollout, `curl https://DOMAIN/compare?...` returns valid JSON (API serving quotes)
- After rollout, `curl https://DOMAIN/` returns updated frontend HTML
- No 502/503 errors on frontend paths during transition
- API container never restarts during frontend rollout

**Fail condition:**
- API returns errors during frontend rollout
- Frontend briefly unavailable (502 from Traefik)
- Old and new frontend serve different asset versions simultaneously causing JS errors
- API container affected by frontend rollout

**Evidence:** Continuous `curl` loop for both API and frontend during rollout. Docker events log. Container list before/after.

---

### VAL-DEPLOY-006 — CORS Works in Production (Frontend → API)

**Behavioral description:**
In production, the frontend (served from frontend container) makes fetch requests to the API (served from API container). Since these may be on different origins (e.g., `app.example.com` for frontend, `api.example.com` for API, or same domain with path routing), CORS headers must be correctly configured. The API's `Access-Control-Allow-Origin` header must permit the frontend's origin. Preflight OPTIONS requests must return 204 with correct CORS headers.

**Pass condition:**
- **Same-domain path routing:** No CORS needed (same origin), all requests work
- **Subdomain routing:** API responds with `Access-Control-Allow-Origin: https://app.example.com` (or `*` if configured)
- `OPTIONS /compare` returns: 204, `Access-Control-Allow-Methods: GET, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`
- Browser console shows no CORS errors when frontend fetches from API
- All API endpoints accessed by frontend work: `/tokenlist`, `/chains`, `/compare`, `/quote`, `/tokenlist/proxy`, `/token-metadata`

**Fail condition:**
- Browser blocks requests with "CORS policy" error
- API returns CORS headers for wrong origin
- OPTIONS preflight returns 404 or 405 (method not allowed)
- Some endpoints have CORS, others don't (inconsistent after split)

**Evidence:** Browser console showing no CORS errors. `curl -v -X OPTIONS` output showing CORS headers. Network tab in DevTools showing successful cross-origin requests.

---

### VAL-DEPLOY-007 — Environment Variable Propagation

**Behavioral description:**
After the split, environment variables must reach the correct service. The API needs: `ALCHEMY_API_KEY`, `ZEROX_API_KEY`, `FABRIC_API_KEY`, `RPC_URL_*`, `CURVE_ENABLED`, `COMPARE_ENABLED`, `SENTRY_DSN`, `LOG_LEVEL`, `PORT`. The frontend needs build-time variables (API base URL) baked into the static build, and runtime nginx config. The `.env` file or Docker secrets are correctly mapped.

**Pass condition:**
- API container has all required env vars (verified via `/health` flags or startup logs)
- API connects to Alchemy RPC (verified by successful `/compare` request)
- Frontend knows the API base URL (requests go to correct API endpoint, not `localhost`)
- `SENTRY_DSN` reaches the API for error tracking
- `LOG_LEVEL` is respected (API logs at configured level)
- No sensitive env vars leaked to frontend bundle (no API keys in client JS)

**Fail condition:**
- API fails to start due to missing `ALCHEMY_API_KEY`
- Frontend hardcodes `localhost:3001` as API URL (works in dev, fails in prod)
- API keys appear in frontend JavaScript bundle
- Feature flags not loaded (`CURVE_ENABLED`, `COMPARE_ENABLED` ignored)

**Evidence:** API startup log showing loaded config. Frontend JS bundle grep for "ALCHEMY" (should find nothing). `/health` response showing feature flags. Successful comparison request.

---

### VAL-DEPLOY-008 — Static Asset Versioning and Cache Busting

**Behavioral description:**
After a frontend deployment, browsers must load the new JavaScript and CSS bundles, not cached old versions. The Svelte/Vite build produces content-hashed filenames (e.g., `client.abc123.js`). The `index.html` references the new hashes. nginx serves static assets with appropriate cache headers (long cache for hashed assets, no-cache for `index.html`).

**Pass condition:**
- Built JS/CSS files have content hashes in filenames
- `index.html` references the correct hashed filenames
- nginx serves `index.html` with `Cache-Control: no-cache` or short max-age
- nginx serves hashed assets with `Cache-Control: max-age=31536000, immutable`
- After deployment, browser loads new bundle (verified by checking loaded script URLs in DevTools)
- Old cached `index.html` pointing to removed assets triggers a reload (graceful degradation)

**Fail condition:**
- Static filenames don't change between deployments (cache serves stale JS)
- `index.html` cached by browser, references old JS that no longer exists (404)
- New bundle loads but expects API fields that old API doesn't have (version mismatch)

**Evidence:** `ls` of built frontend assets showing hashed names. HTTP response headers for `index.html` and JS files. Two consecutive builds showing different hashes.

---

### VAL-DEPLOY-009 — Health Check Cascade

**Behavioral description:**
Both services have health checks that Traefik and docker-rollout rely on. If the API becomes unhealthy (e.g., crashes, OOM), Traefik stops routing API requests to it, docker restarts it per restart policy, and frontend continues to serve (with API errors shown gracefully). If frontend becomes unhealthy, API continues serving programmatic clients.

**Pass condition:**
- API health check: `GET /health` returns 200 → healthy, non-200 → unhealthy
- Frontend health check: `curl -f http://localhost:80/` returns 200 → healthy
- Traefik removes unhealthy API container from load balancer within `interval × retries` seconds
- Frontend still serves while API is down (shows error state, not blank page)
- API still serves while frontend is down (programmatic `/compare` requests work)
- Docker restart policy brings crashed container back
- `start_period: 15s` grace period prevents premature unhealthy marking during startup

**Fail condition:**
- Unhealthy container continues receiving traffic from Traefik
- Both services go down when one fails (dependency coupling)
- Frontend shows blank page when API is unreachable (should show error UI)
- Restart loop: container fails health check → restarts → fails again → no backoff

**Evidence:** `docker inspect` showing health status. Traefik dashboard showing backend health. Frontend screenshot when API is down. Docker events showing restart behavior.

---

### VAL-DEPLOY-010 — Resource Limits and Graceful Shutdown

**Behavioral description:**
Both containers have memory limits configured. When receiving SIGTERM (during rollout or manual stop), both services shut down gracefully: the API finishes in-flight HTTP requests before exiting, nginx drains connections. No data loss or corrupted responses during shutdown.

**Pass condition:**
- API container memory limit: 512M (matching current docker-stack.yml)
- Frontend container memory limit: 128M (nginx is lightweight)
- `docker stop api-container` → API finishes in-flight requests → exits cleanly (exit code 0)
- `docker stop frontend-container` → nginx sends FIN to open connections → exits cleanly
- SIGTERM handling: Node.js `process.on('SIGTERM', ...)` closes HTTP server gracefully
- OOM kill triggers restart (not infinite crash loop)
- Container logs show clean shutdown messages, not abrupt termination

**Fail condition:**
- No memory limit → runaway memory crashes the host
- SIGTERM causes immediate kill → in-flight requests get connection reset
- Exit code non-zero on clean shutdown (triggers unnecessary alerts)
- No SIGTERM handler → 10s timeout → SIGKILL (responses dropped)

**Evidence:** Docker Compose resource config. Container exit codes after `docker stop`. Logs showing graceful shutdown. `docker stats` showing memory within limits.
