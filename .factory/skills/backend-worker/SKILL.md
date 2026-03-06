---
name: backend-worker
description: Implements backend API features - monorepo setup, server extraction, OpenAPI spec, Swagger UI, tests
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features involving:
- Monorepo structure setup (npm workspaces)
- Backend server code extraction and refactoring
- OpenAPI spec completion and Swagger UI integration
- API endpoint creation (/config)
- Test migration and maintenance

## Work Procedure

1. **Read mission context**: Read `AGENTS.md` and `.factory/services.yaml` for boundaries and commands. Read `.factory/library/` files for accumulated knowledge.

2. **Understand the feature**: Read the feature description, preconditions, expectedBehavior, and verificationSteps from features.json thoroughly.

3. **Write tests first (TDD)**:
   - For new endpoints: write integration tests in `packages/api/src/__tests__/` that test the expected request/response shapes.
   - For migrations: verify existing tests still pass after changes.
   - Run tests to confirm they fail (red phase).

4. **Implement the feature**:
   - For monorepo setup: create directory structure, move files, update package.json with workspaces, update tsconfig.json.
   - For code extraction: move server modules to packages/api/src/, update import paths, remove HTML template and static file serving.
   - For OpenAPI: edit openapi.yaml to add missing endpoint documentation with correct schemas.
   - For Swagger UI: install swagger-ui package, add /docs route.
   - For /config endpoint: create handler returning defaultTokens and walletConnectProjectId.
   - Keep all existing endpoint behavior identical.

5. **Run tests (green phase)**:
   - `cd packages/api && npm test` — all tests must pass
   - `cd packages/api && npx tsc --noEmit` — no type errors
   - `npm run lint` — no new lint errors

6. **Manual verification**:
   - Start the API: `cd packages/api && PORT=3100 npx tsx src/server.ts`
   - curl key endpoints: /health, /chains, /config, /docs
   - Verify /docs serves Swagger UI (if applicable)
   - Verify CORS headers present
   - Kill the server after verification

7. **Update shared knowledge**: If you discover environment quirks, useful patterns, or gotchas, add them to `.factory/library/` files.

## Example Handoff

```json
{
  "salientSummary": "Extracted server code to packages/api, removed INDEX_HTML and /static serving, added /config endpoint returning defaultTokens and walletConnectProjectId. All 164 existing tests pass. Verified /health, /chains, /config via curl on port 3100.",
  "whatWasImplemented": "Moved all server-side source files to packages/api/src/. Removed INDEX_HTML template string and static file serving routes from server.ts. Added GET /config endpoint. Updated package.json with workspace config. CORS headers set to allow all origins.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd packages/api && npm test", "exitCode": 0, "observation": "164 tests passed, 80%+ coverage" },
      { "command": "cd packages/api && npx tsc --noEmit", "exitCode": 0, "observation": "No type errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "0 errors, 17 warnings (pre-existing)" },
      { "command": "curl -s http://localhost:3100/health | jq .status", "exitCode": 0, "observation": "Returns 'ok'" },
      { "command": "curl -s http://localhost:3100/config | jq keys", "exitCode": 0, "observation": "Returns ['defaultTokens', 'walletConnectProjectId']" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "packages/api/src/__tests__/config.test.ts", "cases": [
        { "name": "GET /config returns defaultTokens for all chains", "verifies": "Config endpoint response shape" },
        { "name": "GET /config includes walletConnectProjectId", "verifies": "WalletConnect config" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Circular dependency between packages that can't be resolved
- Existing tests fail due to architectural issues (not just import paths)
- Need to modify frontend code to accommodate API changes
- OpenAPI spec conflicts with actual server behavior that can't be reconciled
