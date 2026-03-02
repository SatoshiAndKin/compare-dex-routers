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
- Supporting source files (config, tokenlist serving, etc.)
- Test files in `src/__tests__/`

## Architecture Context

- `src/server.ts` contains EVERYTHING: HTTP server, route handlers, and the entire UI as an inline HTML template literal (`INDEX_HTML`). The HTML includes inline `<style>` and `<script>` blocks.
- The app uses vanilla JS — no React, no bundler, no build step. All client-side code is inline in the template.
- Modal pattern exists (MEV modal): `.modal-overlay` + `.modal` with open/close/focus/aria handling. Reuse this pattern for new modals.
- Token autocomplete: `setupAutocomplete(inputId, listId)` creates dropdowns with `findTokenMatches(value, chainId)`. The `tokenlistTokens` global array holds all loaded tokens.
- localStorage is used for persistence (currently `customTokenlistUrl` key). Always wrap in try/catch for corrupt data.
- The `/tokenlist/proxy?url=` endpoint proxies remote tokenlist URLs (HTTPS-only, 5MB limit, 30s timeout).

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
- Keep client-side JS clean — use `const`/`let`, proper error handling, no global namespace pollution
- Follow the existing brutalist UI style (thick borders, high contrast, monospace elements for addresses)
- **NEVER truncate addresses.** Always display full 0x addresses. This is a project convention.
- For modals: follow the MEV modal pattern (overlay click closes, Escape closes, body scroll lock, aria attributes)
- For localStorage: always wrap reads in try/catch, handle corrupt JSON gracefully by treating as empty/default

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
  "salientSummary": "Implemented settings gear modal replacing inline tokenlist URL input. Modal opens/closes with gear click, X button, Escape, and backdrop click. Focus management follows MEV modal pattern. All 5 GEAR assertions verified via playwright: gear visible, panel opens, closes correctly, keyboard accessible, state preserved on reopen.",
  "whatWasImplemented": "Settings gear icon (SVG cog) in form header row. Settings modal following .modal-overlay + .modal pattern from MEV modal. Tokenlist URL input, Load/Reset buttons, and status message all relocated inside modal. Gear icon has aria-expanded, aria-haspopup attributes. Focus trapped in modal on open, returns to gear on close. Body scroll locked when modal open.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No lint errors" },
      { "command": "npm test", "exitCode": 0, "observation": "All 32 tests pass" }
    ],
    "interactiveChecks": [
      { "action": "Navigated to http://localhost:3002/, looked for settings gear", "observed": "Gear icon visible in form header row, no inline tokenlist URL input present" },
      { "action": "Clicked gear icon", "observed": "Settings modal opened with tokenlist URL input, Load button. Focus moved to close button." },
      { "action": "Pressed Escape", "observed": "Modal closed, focus returned to gear icon" },
      { "action": "Tabbed to gear, pressed Enter", "observed": "Modal opened via keyboard" },
      { "action": "Added tokenlist URL, closed modal, reopened", "observed": "URL input still showed the entered URL, state preserved" }
    ]
  },
  "tests": {
    "added": []
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
