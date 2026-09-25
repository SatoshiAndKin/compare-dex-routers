# Unified quote validation — 2026-09-25

Spandex [PR #5](https://github.com/SatoshiAndKin/spandex/pull/5) merged first at
`3a88dab87c42f124d23cb541a8747143d5d1cd06`, rebased on upstream
`9bdca4c76bd58b9e25607607f46c59be0829e700`. The site dependency and build allowlist
pin that exact merge. Worker ownership, fixtures, protocol, and lifecycle tests
live in Spandex; the site registers `curve()` normally.

SDK QA passed: build, typecheck, lint, audit, and 240 tests. Six live Fynd/Mobula
tests were skipped for missing credentials. Tarball tests cover Node ESM,
CommonJS, and browser builds. The CI cold-worker check passed in Docker with
2 CPUs and 512 MiB memory/no swap: Base quote 2.46 seconds, 24 concurrent network
probes, maximum probe latency 22.65 ms, peak RSS 233152512 bytes. The optional
pkg-pr-new prerelease publication failed because the fork lacks that GitHub app;
the site consumes the tested Git commit and does not require a prerelease.

Site checks passed with Node 24.21.0, pnpm 12.3.1, and Bun 1.4.0:

- Typecheck, lint, formatting, dead-code, duplicates, dead-flags, and CDN integrity.
- 192 API and 399 frontend unit tests.
- API coverage exceeds every configured 80% threshold; frontend line coverage is 82.12%.
- 30 desktop Chromium and mobile WebKit tests, including light/dark layouts,
  zero balances, exact balance entry, native gas reserves, missing fee data,
  ETH/WETH search, absent token lists, rejection, reverts, and context changes.
- Seven Ethereum/Base pinned-fork tests, including ERC-20 approvals, native input,
  native output previews, Exact Output previews, and the unfunded 1,000 USDC to
  crvUSD regression. No site tests were skipped for credentials.
- Dependency audit has no high/critical findings; two moderate advisories remain.

[Raw fork evidence](unified-quotes-fork-evidence.json) records full block hashes,
local transaction hashes, and exact balance deltas. These transactions exist
only on isolated Anvil forks. Ethereum transactions use Curve and Base uses a
fixed KyberSwap provider; actions retain that provider across refreshes.
The unfunded regression displayed zero USDC, retained Curve and other prices,
showed “Insufficient USDC balance,” and submitted no transaction.

The first integration run found cold Curve requests exceeding the old five-second
shared provider deadline; the site now uses ten seconds. A dynamically selected
Nordstern native route failed wallet gas estimation with `ExecutionFailed()` and
was blocked before submission. Saved calldata did not reproduce the failure on
a new fork; no provider-specific workaround was added. Live provider routes can
change independently of pinned chain state, so transaction tests choose fixed
providers and the client always checks the refreshed transaction against actual
wallet state.

Rollup recommendations use raw amounts because simulation gas alone lacks full
posting/operator fees. Wallet reserves read Base/Optimism fee oracles and
Arbitrum posting-gas estimates. Missing fee data blocks automatic native entry
and required readiness checks. Price simulations are never proof of readiness.
