---
name: svelte-worker
description: Builds Svelte 5 frontend components - form, quote display, wallet, token management, modals
---

# Svelte Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features involving:
- Svelte 5 component development (form inputs, display, modals)
- State management with Svelte 5 runes ($state, $derived, $effect)
- API integration via openapi-fetch
- Wallet/Web3 integration
- CSS/responsive layout
- URL sync and localStorage persistence

## Critical Svelte 5 Patterns

**Runes (NOT legacy stores):**
- `$state` for reactive state (deep proxied)
- `$derived` for computed values
- `$effect` for side effects (escape hatch - prefer $derived)
- Exported $state must be wrapped in objects/classes for cross-module reactivity

**Class-based stores** in `.svelte.ts` files:
```typescript
// src/lib/stores/chain.svelte.ts
class ChainStore {
  selectedChainId = $state(8453);
  chainName = $derived(CHAIN_NAMES[this.selectedChainId]);
}
export const chainStore = new ChainStore();
```

**API calls** via openapi-fetch:
```typescript
import createClient from 'openapi-fetch';
import type { paths } from '../generated/api-types';
const client = createClient<paths>({ baseUrl: API_BASE_URL });
const { data, error } = await client.GET('/compare', { params: { query: { chainId, from, to, amount } } });
```

**WalletConnect and Farcaster** MUST be loaded via CDN ESM imports (cannot be npm bundled):
```html
<script type="module">
  import { EthereumProvider } from 'https://esm.sh/@walletconnect/ethereum-provider@2';
</script>
```

## Work Procedure

1. **Read mission context**: Read `AGENTS.md`, `.factory/services.yaml`, `.factory/library/` for knowledge. Read `.factory/research/svelte5-spa.md` for Svelte 5 patterns.

2. **Understand the feature**: Read feature description, preconditions, expectedBehavior, verificationSteps.

3. **Write tests first (TDD)**:
   - Write component tests in `packages/frontend/src/__tests__/` using Vitest + @testing-library/svelte.
   - Test rendering, user interactions, state changes, API call triggering.
   - Run tests to confirm they fail (red phase).

4. **Implement the Svelte component(s)**:
   - Create components in `packages/frontend/src/lib/components/`.
   - Create stores in `packages/frontend/src/lib/stores/` as `.svelte.ts` files.
   - Use the generated API types from `packages/frontend/src/generated/api-types.d.ts`.
   - Use Svelte 5 runes, NOT legacy store syntax.
   - CSS: use Svelte scoped styles.
   - **NEVER truncate addresses.** Always display full 0x addresses.

5. **Run tests (green phase)**:
   - `cd packages/frontend && npm test` — all tests pass
   - `cd packages/frontend && npx tsc --noEmit` — no type errors (use `svelte-check`)
   - `npm run lint` — no new lint errors

6. **Manual verification with agent-browser**:
   - Ensure API is running: `cd packages/api && PORT=3100 npx tsx src/server.ts &`
   - Start frontend: `cd packages/frontend && npm run dev &`
   - Use agent-browser to navigate to http://localhost:5173
   - Test each user interaction described in expectedBehavior
   - Take screenshots for evidence
   - Kill both servers after verification

7. **Update shared knowledge**: Add any Svelte patterns, gotchas, or environment notes to `.factory/library/`.

## Example Handoff

```json
{
  "salientSummary": "Built ChainSelector, TokenInput, AmountFields, and SlippagePresets Svelte components. Chain selector filters by name/ID with keyboard nav. Token inputs have autocomplete from API tokenlist. Amount fields support direction toggle. All 12 component tests pass. Verified full form interaction at http://localhost:5173 via agent-browser.",
  "whatWasImplemented": "4 Svelte 5 components: ChainSelector.svelte (dropdown with search/filter/keyboard), TokenInput.svelte (autocomplete via openapi-fetch /tokenlist), AmountFields.svelte (sell/receive with direction toggle), SlippagePresets.svelte (preset buttons + custom input). Store: formStore.svelte.ts managing chainId, tokens, amounts, slippage, mode state.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd packages/frontend && npm test", "exitCode": 0, "observation": "12 tests passed" },
      { "command": "cd packages/frontend && npx svelte-check", "exitCode": 0, "observation": "No errors" }
    ],
    "interactiveChecks": [
      { "action": "Open http://localhost:5173, click chain selector, type 'base'", "observed": "Dropdown filters to show only Base (8453)" },
      { "action": "Type 'USDC' in From field", "observed": "Autocomplete shows USDC entries for selected chain" },
      { "action": "Enter amount 100, click Compare Quotes", "observed": "Request sent to API, results display in tabs" },
      { "action": "Click direction toggle", "observed": "Mode switches to targetOut, Receive field becomes active" }
    ]
  },
  "tests": {
    "added": [
      { "file": "packages/frontend/src/__tests__/ChainSelector.test.ts", "cases": [
        { "name": "renders all chains in dropdown", "verifies": "Chain list rendering" },
        { "name": "filters chains by search query", "verifies": "Search/filter behavior" },
        { "name": "selects chain on Enter key", "verifies": "Keyboard navigation" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- API endpoint missing or returning unexpected shape (not matching OpenAPI spec)
- Generated types don't match actual API responses
- WalletConnect CDN import fails or has breaking changes
- Cannot replicate original behavior because original code is unclear/buggy
- Svelte 5 runes don't support a pattern needed (check docs first)
