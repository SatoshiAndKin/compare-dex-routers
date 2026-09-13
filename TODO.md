# TODO

## Remaining security work

- [ ] Add API rate limits for quote and metadata requests.
- [ ] Define security headers and a CSP that supports wallet and Mini App integrations.
- [ ] Protect diagnostics (`/analytics`, `/errors`, and `/metrics`) and document their access policy.
- [ ] Review CORS policy for public API and diagnostic endpoints separately.

- [ ] Update Farcaster's transitive Jayson dependencies when upstream removes the two moderate advisories described in `docs/runbooks/testing.md`.

## Remaining reliability work

- [ ] Bound token metadata and conversion-rate caches in `config.ts` and `quotes.ts`.
- [ ] Bound error-pattern storage in `error-insights.ts`.
- [ ] Measure analytics eviction cost before replacing its bounded array.
- [ ] Evaluate compiling API TypeScript ahead of time instead of running through tsx.

## Remaining test coverage

- [ ] Add focused coverage for configStore, tokensStore, formStore, and ChainMismatchWarning where existing form lifecycle tests leave behavior uncovered.
- [ ] Extend API response/schema conformance checks beyond quote, health, and token-list contracts.

## Completed audit work

The shared quote schemas, server-owned recommendations, full addresses, typed API client,
comparison/form tests, and GitHub-triggered deployment replaced the older TODO entries.
See `docs/audit-fixes.md` for those changes.

This update adds pinned wallet bundles, Swagger CDN integrity checks, graceful shutdown,
CPU limits, daily/manual token-list refresh, a retro space theme, and local browser/fork
commands. See `docs/runbooks/testing.md` and `docs/runbooks/deployment.md` for verification.

## Housekeeping

- [ ] Review the four saved stashes with Bryan before any cleanup.
