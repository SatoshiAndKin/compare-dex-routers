---
name: fullstack-worker
description: Implements server-side endpoints and inline HTML/JS UI features for the Compare DEX Routers app
---

# Fullstack Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that modify:
- Server-side endpoint handlers in `src/server.ts`
- The inline HTML/JS UI template (`INDEX_HTML` in `src/server.ts`)
- Supporting source files (config, curve, quote, etc.)
- Test files in `src/__tests__/`
- Docker/infrastructure files (Dockerfile, docker-compose, .dockerignore)

## Architecture Context

- `src/server.ts` contains EVERYTHING: HTTP server, route handlers, and the entire UI as an inline HTML template literal (`INDEX_HTML`). The HTML includes inline `<style>` and `<script>` blocks.
- The app uses vanilla JS — no React, no bundler, no build step. All client-side code is inline in the template.
- Modal pattern exists (MEV modal, settings modal): `.modal-overlay` + `.modal` with open/close/focus/aria handling. Reuse this pattern for new modals.
- Token data model: `tokenlistSources` array of `{url, enabled, name, tokens, error?}` objects. Each token carries `_source` field. `getTokensForChain()` merges from all enabled sources with dedup. `findTokenMatches()` sets `_needsDisambiguation` flag for same-symbol disambiguation.
- localStorage keys: `customTokenlists` (JSON array of `{url, enabled, name}`) for remote lists. `localTokenList` for local tokens. Always wrap in try/catch for corrupt data.
- The `/tokenlist/proxy?url=` endpoint proxies remote tokenlist URLs (HTTPS-only, 5MB limit, 30s timeout).
- Curve library: use `createCurve()` from `@curvefi/api` for per-chain instances (NOT the default singleton). Each instance needs separate init() with chainId and RPC URL.

### Client-Side CDN Libraries (No npm install needed)
- **WalletConnect**: `@walletconnect/ethereum-provider` loaded via `https://esm.sh/@walletconnect/ethereum-provider@2` in a `<script type="module">`. Returns EIP-1193 provider that drops into existing `connectToWalletProvider()` flow. Uses `showQrModal: true` for built-in QR. Needs `WALLETCONNECT_PROJECT_ID` env var injected into template.
- **Farcaster SDK**: `@farcaster/miniapp-sdk` loaded via `https://esm.sh/@farcaster/miniapp-sdk` conditionally (only when in miniapp context). Use `sdk.isInMiniApp()` for detection. Call `sdk.actions.ready()` to dismiss splash. Use `sdk.wallet.getEthereumProvider()` for wallet inside Farcaster.

### Progressive Quotes Pattern
Progressive quotes use parallel client-side fetch() to /quote (Spandex) and /quote-curve (Curve) with AbortController for cancellation. First quote renders immediately, second updates tabs/recommendation. Use `cancelInProgressFetches()` to abort in-flight requests before starting new ones.

### Two-Field Amount UX Pattern
The form has two amount fields: #sellAmount (exactIn) and #receiveAmount (targetOut). Only one is "active" (user-typed) at a time. The other is "computed" (populated by quote result). Use an `isProgrammaticUpdate` flag when setting the computed field's value to prevent circular input event re-triggering. Auto-quoting uses a debounce timer (400ms) on input events.

## Conventions (ALWAYS FOLLOW)

- **Node.js LTS**: Always use the latest Node.js LTS release. Currently Node 24 (Krypton). Dockerfile must use `node:24-slim`. Never downgrade to an older version.
- **NEVER truncate addresses.** Always display full 0x addresses in the UI and API responses. No `0xABCD...1234` patterns.
- No direct `console.log` in source code; use the logger from `src/logger.ts`
- ESM modules with TypeScript strict mode
- Pre-commit hooks enforce linting and formatting via Husky + lint-staged

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Read `AGENTS.md` for mission boundaries. Read relevant source files to understand what exists.

### 2. Write Tests First (Red Phase)

For server-side changes:
- Add/update test cases in `src/__tests__/` using vitest
- Mock external dependencies (viem, @spandex/core) as established in existing tests
- Run `npm test` to confirm new tests fail (red)

For client-side-only changes (inline JS):
- Testing is done via manual verification (step 4) since the UI is inline HTML
- Still write server-side tests for any new endpoints or server-side logic

For infrastructure changes (Dockerfile, docker-compose, etc.):
- Verify by building and running containers

### 3. Implement

- Make changes to source files
- For the inline HTML template: be careful with template literal escaping (backticks, `${}`). The HTML is inside a tagged template string.
- Keep client-side JS clean — use `const`/`let`, proper error handling, no global namespace pollution
- Follow the existing brutalist UI style (thick borders, high contrast, monospace elements for addresses)
- For modals: follow the MEV modal pattern (overlay click closes, Escape closes, body scroll lock, aria attributes)
- For localStorage: always wrap reads in try/catch, handle corrupt JSON gracefully

### 4. Verify

Run ALL of these and fix any issues:

```bash
npm run typecheck   # Must pass with zero errors
npm run lint        # Must pass (run lint:fix if needed)
npm test            # All tests must pass
```

Then manually verify via playwright browser tools:
- Navigate to http://localhost:3002/
- Take a snapshot to verify UI renders correctly
- Test the specific user interactions this feature adds
- Check console for errors

Each interactive check = one entry in `interactiveChecks` with the full action sequence and observed result.

### 5. Restart Dev Server If Needed

If you modified server-side code, the dev server (running with tsx --watch) should auto-reload. If it doesn't respond, restart it:
```bash
lsof -ti :3002 | xargs kill 2>/dev/null; PORT=3002 npm run dev &
sleep 3
curl -sf http://localhost:3002/health
```

## Example Handoff

```json
{
  "salientSummary": "Implemented Curve multi-chain support using createCurve() factory for per-chain instances. All 7 chains init eagerly at startup in parallel. Updated isCurveSupported() and findCurveQuote() to route to correct instance. Removed 'Curve only supports Ethereum' error. Ran npm test (all 142 tests pass), typecheck clean, lint clean. Verified via curl: /compare on Base returns Curve quote, /compare on Ethereum still works.",
  "whatWasImplemented": "Per-chain Curve instances via createCurve() stored in Map<number, CurveInstance>. Eager parallel init at startup for all 7 chains (1, 8453, 42161, 10, 137, 56, 43114). Updated isCurveSupported() to check against CURVE_SUPPORTED_CHAINS array. findCurveQuote() now accepts chainId and uses getCurveInstance(chainId). Init failure on one chain logged but doesn't block others. 8 new tests for multi-chain init, per-chain routing, and error isolation.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No lint errors" },
      { "command": "npm test", "exitCode": 0, "observation": "All 142 tests pass including 8 new multi-chain tests" }
    ],
    "interactiveChecks": [
      { "action": "curl /compare on Base with USDC/WETH", "observed": "Curve quote present with output amount, no Ethereum-only error" },
      { "action": "curl /compare on Ethereum with USDC/WETH", "observed": "Curve quote still works as before" },
      { "action": "Checked server startup logs", "observed": "Curve init messages for all 7 chains" }
    ]
  },
  "tests": {
    "added": [
      { "file": "src/__tests__/curve.test.ts", "cases": [
        { "name": "initializes for all supported chains", "verifies": "createCurve called 7 times with correct chainIds" },
        { "name": "returns quote on non-Ethereum chain", "verifies": "findCurveQuote routes to correct instance" },
        { "name": "init failure isolation", "verifies": "one chain failing doesn't block others" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature requires a new npm dependency not already in package.json
- The inline HTML template needs structural refactoring beyond the feature scope
- Dev server won't start or tests fail for reasons unrelated to this feature
- Requirements are ambiguous about a specific UI behavior or data model choice
- A precondition is not met (e.g., expected function or data structure doesn't exist yet)
- Docker build fails for infrastructure reasons (OrbStack down, disk full, etc.)
