# TODO

## High Priority

### Security

- [ ] **Add rate limiting to API endpoints.** The server has no rate limiting; any client can flood `/quote`, `/compare`, or `/token-metadata` which make expensive RPC calls. File: `packages/api/src/server.ts`
- [ ] **Add security headers.** No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or CSP headers are set on any response. Only `Access-Control-Allow-Origin: *` is present. File: `packages/api/src/server.ts`
- [ ] **Pin CDN dependencies to exact versions.** Swagger UI loaded from `unpkg.com/swagger-ui-dist` (no version pin) — a compromised CDN could inject malicious code into `/docs`. WalletConnect loaded from `esm.sh/@walletconnect/ethereum-provider@2` (major version only). Farcaster SDK from `esm.sh/@farcaster/frame-sdk` (no version). Files: `packages/api/src/server.ts:844-848`, `packages/frontend/src/lib/stores/walletStore.svelte.ts:340,405`
- [ ] **Add Subresource Integrity (SRI) hashes to CDN script tags.** The inline `/docs` HTML loads JS from unpkg without integrity attributes. File: `packages/api/src/server.ts`
- [ ] **The `/analytics` and `/errors` endpoints are unauthenticated.** They expose internal server diagnostics (error patterns, top trading pairs, request durations) to anyone. Consider gating them behind an admin key or feature flag. Files: `packages/api/src/server.ts`, `packages/api/src/analytics.ts`, `packages/api/src/error-insights.ts`
- [ ] **CORS is `Access-Control-Allow-Origin: *`.** This allows any site to make API requests. Fine for a public API, but the `/analytics`, `/errors`, `/metrics`, and `/config` endpoints probably shouldn't be open to all origins. File: `packages/api/src/server.ts`

### Correctness

- [ ] **No graceful shutdown handler.** The API server has no `SIGTERM`/`SIGINT` handler. Docker sends SIGTERM on deploy; without a handler, in-flight requests are dropped. The `stop_grace_period: 35s` in docker-compose.prod.yml suggests this was considered but not implemented. File: `packages/api/src/server.ts`
- [ ] **server.ts is a 900-line monolith.** The `compareQuotes()` function alone is ~300 lines with deeply nested gas-adjusted comparison logic. This makes it hard to test, review, and maintain. Extract the comparison/recommendation logic into its own module. File: `packages/api/src/server.ts`
- [ ] **Tokenlist is cached forever after first load.** `cachedDefaultTokenlists` only invalidates when `DEFAULT_TOKENLISTS` env var changes, which never happens at runtime. If the tokenlist file on disk is updated, the API serves stale data until restart. File: `packages/api/src/server.ts`
- [ ] **Frontend comparison logic duplicates server logic.** `comparisonStore.svelte.ts` has a `computeRecommendation()` that reimplements the recommendation algorithm from the server's `compareQuotes()` — but the frontend version is simpler and ignores gas-adjusted values. These will diverge over time. Consider using the server's `/compare` endpoint instead of client-side parallel `/quote` + `/quote-curve`. Files: `packages/frontend/src/lib/stores/comparisonStore.svelte.ts`, `packages/api/src/server.ts`

## Medium Priority

### Testing

- [ ] **Missing tests for `openapi.ts`.** The OpenAPI spec definition has no tests validating schema correctness or that it matches the actual API responses. File: `packages/api/src/openapi.ts`
- [ ] **Missing tests for `comparisonStore`.** The comparison store (progressive fetch, cancellation, recommendation logic) has no test file. File: `packages/frontend/src/lib/stores/comparisonStore.svelte.ts`
- [ ] **Missing tests for `configStore`, `tokensStore`, `formStore`.** These stores lack dedicated test files. Files: `packages/frontend/src/lib/stores/configStore.svelte.ts`, `packages/frontend/src/lib/stores/tokensStore.svelte.ts`, `packages/frontend/src/lib/stores/formStore.svelte.ts`
- [ ] **Missing tests for `CompareForm` component.** The main form component has no test file. File: `packages/frontend/src/lib/components/CompareForm.svelte`
- [ ] **Missing tests for `ChainMismatchWarning` component.** File: `packages/frontend/src/lib/components/ChainMismatchWarning.svelte`

### Performance

- [ ] **In-memory caches grow unbounded.** `decimalsCache`, `symbolCache`, and `nameCache` in `config.ts` have no max size or TTL — a long-running server queried with many different token addresses will leak memory. File: `packages/api/src/config.ts`
- [ ] **In-memory caches grow unbounded (Curve).** `symbolCache` in `curve.ts` and `outputToEthRateCache`/`inputToEthRateCache` in `server.ts` also have no max size. Files: `packages/api/src/curve.ts`, `packages/api/src/server.ts`
- [ ] **Analytics events array uses splice for eviction.** `events.splice(0, events.length - MAX_EVENTS)` on every push past MAX_EVENTS copies the entire array. Use a ring buffer or shift-based approach. File: `packages/api/src/analytics.ts`
- [ ] **Error patterns map grows unbounded.** `errorPatterns` in `error-insights.ts` has no max size — a server seeing many distinct errors will slowly leak memory. File: `packages/api/src/error-insights.ts`

### Infrastructure

- [ ] **API production image uses `tsx` runtime.** The Dockerfile runs TypeScript via tsx at runtime (`CMD ["node_modules/.bin/tsx", ...]`). This adds startup overhead and memory usage vs pre-compiling to JS. Consider a build step. File: `packages/api/Dockerfile`
- [ ] **No CPU resource limits in docker-compose.prod.yml.** Memory limits are set (512M API, 128M frontend) but no CPU limits. A runaway Curve initialization could starve other services. File: `docker-compose.prod.yml`
- [ ] **Deploy webhook secret sent via curl with env var.** The CD workflow passes `WEBHOOK_SECRET` via `-H` header, which is fine, but the webhook endpoint URL (`webhook.stytt.com`) is hardcoded. Consider making it a secret too. File: `.github/workflows/cd.yml`

### Code Quality

- [ ] **OpenAPI spec has `servers: [{ url: "http://localhost:3100" }]` hardcoded.** This means the Swagger UI "Try it out" only works in dev. Production should have the real URL or use a relative path. File: `packages/api/src/openapi.ts`
- [ ] **`apiClient` from `openapi-fetch` is created but never used for fetching.** The `comparisonStore` uses raw `fetch()` calls to `/api/quote` and `/api/quote-curve` instead of the typed `apiClient`. This bypasses the type safety that openapi-fetch provides. Files: `packages/frontend/src/lib/api.ts`, `packages/frontend/src/lib/stores/comparisonStore.svelte.ts`
- [ ] **`from.slice(0, 10)` in log messages and analytics.** Token addresses are sliced to 10 chars in several log calls and in `getAnalyticsSummary()`. This violates the "NEVER truncate addresses" convention and makes debugging harder. Files: `packages/api/src/server.ts`, `packages/api/src/analytics.ts`

## Low Priority

### Style

- [ ] **Inconsistent quote result types.** `QuoteResult` and `CurveQuoteResult` are structurally similar but defined independently with different field names (`approval_token`/`approval_spender` vs `approval_target`/`approval_calldata`). A shared base type would reduce duplication. Files: `packages/api/src/server.ts`, `packages/api/src/curve.ts`
- [ ] **OpenAPI spec marks optional fields as required.** `SpandexQuoteSchema` lists `router_value`, `approval_token`, `approval_spender`, `gas_cost_eth`, `output_value_eth`, `net_value_eth` as required, but they're optional in the actual `QuoteResult` interface. File: `packages/api/src/openapi.ts`
- [ ] **Feature flags are evaluated once at module load.** `CURVE_ENABLED` is set from `isEnabled("curve_enabled")` at import time. Changing the env var requires a restart. This is probably fine but worth documenting. File: `packages/api/src/server.ts`
