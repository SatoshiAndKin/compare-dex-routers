---
name: fullstack-worker
description: Implements server-side endpoints and inline HTML/JS UI features for the Compare DEX Routers app
---

# Fullstack Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that modify:
- Server-side endpoint handlers in `src/server.ts`
- Client-side TypeScript modules in `src/client/`
- The HTML template (`INDEX_HTML` in `src/server.ts`)
- CSS in `src/client/styles.css`
- Build pipeline configuration (esbuild, package.json scripts)
- Supporting source files (config, curve, quote, etc.)
- Test files in `src/__tests__/`

## Architecture Context

### Server Side
- `src/server.ts` contains the HTTP server, route handlers, and the HTML template (`INDEX_HTML`)
- Runtime: `tsx` (TypeScript execution without build step)
- ESM modules with TypeScript strict mode
- Pre-commit hooks enforce linting and formatting via Husky + lint-staged

### Client Side (target architecture)
- `src/client/main.ts` — Entry point, initialization, event wiring
- `src/client/types.ts` — Shared interfaces and type definitions
- `src/client/styles.css` — All application CSS (extracted from inline `<style>`)
- `src/client/*.ts` — Focused modules (wallet, autocomplete, chain-selector, etc.)
- Build: esbuild compiles TypeScript to JS bundle + copies CSS to output directory
- Server serves built files from `/static/` route
- Server-side config injected via `window.__config` inline script (only `DEFAULT_TOKENS` and `WALLETCONNECT_PROJECT_ID`)

### Key Patterns
- **Progressive quotes**: Parallel client-side fetch() to /quote and /quote-curve with AbortController. First quote renders immediately, second updates tabs/recommendation.
- **Two-field amount UX**: #sellAmount (exactIn) and #receiveAmount (targetOut). Use `isProgrammaticUpdate` flag when setting computed field to prevent circular input events. 400ms debounce on auto-quote.
- **Modal pattern**: `.modal-overlay` + `.modal` with open/close/focus/aria handling, body scroll lock via ref-counting.
- **Token data model**: `tokenlistSources` array of `{url, enabled, name, tokens, error?}`. Each token carries `_source` field. `getTokensForChain()` merges from all enabled sources with dedup.
- **localStorage persistence**: `customTokenlists`, `localTokenList`, `localTokensEnabled`, `defaultTokenlistEnabled`, `compare-dex-preferences`, `compare-dex-theme`. Always try/catch reads for corrupt data.
- **ERC-6963 wallet discovery**: Standards-based wallet provider detection. WalletConnect via ESM CDN import. Farcaster miniapp via conditional CDN import.

## Conventions (ALWAYS FOLLOW)

- **NEVER truncate addresses.** Always display full 0x addresses. No `0xABCD...1234` patterns.
- No direct `console.log` in source code; use the logger from `src/logger.ts` for server code.
- No `any` types in client modules. Use `unknown` and narrow, or define proper interfaces.
- All functions must have explicit parameter and return types.
- kebab-case for file names, camelCase for functions/variables, PascalCase for interfaces/types.
- DOM elements passed to module init functions (dependency injection), not looked up globally within modules.

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Read `AGENTS.md` for mission boundaries. Read relevant source files to understand what exists.

### 2. Write Tests First (Red Phase)

For server-side changes:
- Add/update test cases in `src/__tests__/` using vitest
- Mock external dependencies as established in existing tests
- Run `npm test` to confirm new tests fail (red)

For client TypeScript modules:
- If the module has pure logic (e.g., recommendation computation, URL param parsing), write unit tests
- For DOM-dependent code, testing is done via manual verification (step 4)

For build pipeline changes:
- Test by running the build and verifying output

### 3. Implement

- Make changes to source files
- For extraction work: carefully move code from inline `<script>` blocks to TypeScript modules
  - Preserve ALL behavior — this is a refactoring, not a rewrite
  - Add proper TypeScript types as you extract
  - Replace template literal interpolations with `window.__config` reads
  - Convert global variables to module-scoped state or exports
  - Ensure initialization order is preserved
- For the HTML template: update `<script>` and `<style>` tags to reference external files
- Keep CSS changes minimal — extract as-is, don't redesign

### 4. Verify

Run ALL of these and fix any issues:

```bash
npm run typecheck   # Must pass with zero errors
npm run lint        # Must pass (run lint:fix if needed)
npm test            # All tests must pass
```

If the feature involves build pipeline:
```bash
npm run build:client  # Must succeed
ls -la <output-dir>   # Verify output files exist
```

Then manually verify with the dev server running:
- Start: `PORT=3000 npm run dev`
- Use browser tools to verify page loads correctly
- Test specific interactions this feature affects
- Check browser console for JS errors

Each interactive check = one entry in `interactiveChecks` with the full action sequence and observed result.

### 5. Commit

Commit with a descriptive message. Use feature branches — never commit to main.

## Example Handoff

```json
{
  "salientSummary": "Extracted wallet connection code (~300 lines) from inline JS into src/client/wallet.ts with full TypeScript types. Defined WalletProviderInfo, WalletState, and ConnectOptions interfaces. All 168 tests pass, typecheck clean, lint clean. Verified wallet modal opens and displays correctly in browser.",
  "whatWasImplemented": "Created src/client/wallet.ts with: WalletProviderInfo and WalletState interfaces, initWallet() function that takes DOM elements + callbacks, ERC-6963 discovery logic, connect/disconnect functions, triggerWalletConnectionFlow() for auto-approve/swap pending actions, setWalletGlobals() for window.__selectedWalletProvider. Removed corresponding code from inline script in server.ts. Updated main.ts to import and initialize wallet module.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run build:client", "exitCode": 0, "observation": "Bundle built, 145KB" },
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No lint errors" },
      { "command": "npm test", "exitCode": 0, "observation": "All 168 tests pass" }
    ],
    "interactiveChecks": [
      { "action": "Loaded http://localhost:3000 in browser", "observed": "Page loads, no console errors, wallet section visible" },
      { "action": "Clicked Connect Wallet button", "observed": "Wallet provider modal opens with close button, overlay backdrop" },
      { "action": "Pressed Escape", "observed": "Modal closes, focus returns to Connect Wallet button" },
      { "action": "Verified bundle includes wallet module", "observed": "grep 'initWallet' in bundle output confirms inclusion" }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature requires a new npm dependency not listed in AGENTS.md as allowed
- Circular dependency detected between client modules that can't be resolved without architectural change
- Existing tests fail for reasons unrelated to this feature
- Dev server won't start or build fails for infrastructure reasons
- Requirements are ambiguous about behavioral preservation
- A precondition is not met (e.g., expected module or build pipeline doesn't exist yet)
