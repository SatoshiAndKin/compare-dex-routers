---
name: fullstack-worker
description: Implements server-side endpoints and inline HTML/JS UI features for the CowSwap Trader app
---

# Fullstack Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that modify:
- Server-side endpoint handlers in `src/server.ts`
- The inline HTML/JS UI template (`INDEX_HTML` in `src/server.ts`)
- Supporting source files (config, tokenlist serving, etc.)
- Test files in `src/__tests__/`

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
- Still write server-side tests for any new endpoints

### 3. Implement

- Make changes to `src/server.ts` and/or other source files
- For the inline HTML template: be careful with template literal escaping (backticks, `${}`). The HTML is inside a tagged template string.
- Keep client-side JS clean - use `const`/`let`, proper error handling, no global namespace pollution
- For wallet features: use viem imports from CDN or inline the minimal needed code since this is vanilla JS (no bundler). The server already has viem - for browser-side, either use importmap pointing to an ESM CDN (e.g., esm.sh or unpkg) or embed the needed logic directly.

**IMPORTANT for viem browser usage:** Since there's no bundler, you CANNOT import viem normally in the inline script. Options:
- Use `<script type="importmap">` with CDN URLs for viem
- Or implement wallet interaction using raw EIP-1193 provider.request() calls (simpler, no external deps)
- The raw approach: `provider.request({ method: 'eth_sendTransaction', params: [{ to, data, value, from }] })` for swaps, and similarly for approvals

Choose the simplest approach that works reliably.

### 4. Verify

Run ALL of these and fix any issues:

```bash
npm run typecheck   # Must pass with zero errors
npm run lint        # Must pass (run lint:fix if needed)
npm test            # All tests must pass
```

Then manually verify via playwright browser tools:
- Navigate to http://localhost:3001/
- Take a snapshot to verify UI renders correctly
- Test the specific user interactions this feature adds
- Check console for errors

Each interactive check = one entry in `interactiveChecks` with the full action sequence and observed result.

### 5. Restart Dev Server If Needed

If you modified server-side code, the dev server (running with tsx --watch) should auto-reload. If it doesn't respond, restart it:
```bash
lsof -ti :3001 | xargs kill 2>/dev/null; PORT=3001 npm run dev &
sleep 3
curl -sf http://localhost:3001/health
```

## Example Handoff

```json
{
  "salientSummary": "Added GET /tokenlist endpoint serving data/tokenlist.json with proper Content-Type and error handling. Added 4 test cases for the endpoint (200 with valid JSON, content-type header, tokens array structure, 500 on missing file). Verified via curl and playwright that autocomplete dropdown shows chain-filtered tokens with logos.",
  "whatWasImplemented": "GET /tokenlist endpoint in server.ts that reads and serves data/tokenlist.json. Client-side JS fetches /tokenlist on page load, filters tokens by current chainId, and populates autocomplete dropdowns for from/to token inputs. Autocomplete matches by name, symbol, or address (case-insensitive). Token logos shown via img tags with onerror fallback.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No lint errors" },
      { "command": "npm test", "exitCode": 0, "observation": "All 28 tests pass, coverage 84%" },
      { "command": "curl -sf http://localhost:3001/tokenlist | python3 -c \"import json,sys; d=json.load(sys.stdin); print(len(d['tokens']))\"", "exitCode": 0, "observation": "1367 tokens returned" }
    ],
    "interactiveChecks": [
      { "action": "Navigated to http://localhost:3001/, typed 'USDC' in From field", "observed": "Autocomplete dropdown appeared with USDC entries for Base chain (chainId 8453), each showing logo, name, and symbol" },
      { "action": "Clicked USDC entry in dropdown", "observed": "From field filled with 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (USDC on Base)" },
      { "action": "Switched chain to Ethereum, typed 'WETH'", "observed": "Dropdown shows WETH for Ethereum (chainId 1), not Base" },
      { "action": "Checked browser console", "observed": "No errors. /tokenlist fetched successfully on page load." }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/__tests__/server.integration.test.ts",
        "cases": [
          { "name": "GET /tokenlist returns 200 with JSON", "verifies": "Endpoint serves tokenlist file" },
          { "name": "GET /tokenlist has correct content-type", "verifies": "Response has application/json content-type" },
          { "name": "GET /tokenlist response has tokens array", "verifies": "Response body structure matches tokenlist format" },
          { "name": "GET /tokenlist returns 500 when file missing", "verifies": "Error handling when tokenlist.json not found" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature requires a new npm dependency (mission says no new deps)
- The inline HTML template is too complex to modify safely (structural refactoring needed)
- Dev server won't start or tests fail for reasons unrelated to this feature
- Wallet integration requires a bundler/build step that can't be worked around
- Requirements are ambiguous about browser-side viem usage approach
