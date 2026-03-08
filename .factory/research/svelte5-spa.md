# Svelte 5 + Vite SPA Research

## 1. Scaffolding a Svelte 5 + Vite SPA (No SvelteKit)

### How to scaffold

```bash
npm create vite@latest my-app -- --template svelte-ts
cd my-app
npm install
npm run dev
```

This creates a **pure client-side SPA** with Svelte 5 and TypeScript — no SvelteKit, no SSR, no file-based routing. The Vite plugin `@sveltejs/vite-plugin-svelte` handles compilation.

### Project structure created by the template

```
my-app/
├── index.html           # Entry HTML (Vite serves this)
├── package.json
├── vite.config.ts        # Vite config with svelte() plugin
├── tsconfig.json
├── svelte.config.js      # Svelte compiler options
├── src/
│   ├── main.ts           # App entry point — mounts root component
│   ├── App.svelte        # Root component
│   ├── app.css           # Global styles
│   ├── lib/              # Reusable components & modules
│   └── vite-env.d.ts     # Vite env types
├── public/               # Static assets (copied as-is)
└── .gitignore
```

### Key files

**`src/main.ts`** — mounts the Svelte app:
```ts
import App from './App.svelte';
import './app.css';

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
```

**`vite.config.ts`**:
```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
});
```

### Client-side routing options for Svelte 5

Since we're not using SvelteKit, we need a client-side router. Options compatible with Svelte 5:

| Library | Svelte 5 Support | Notes |
|---------|------------------|-------|
| `@dvcol/svelte-simple-router` | ✅ Yes | Lightweight, history & hash routing, nested views, route guards, lazy loading, transitions. 118+ stars. Most feature-complete. |
| `svelte5-router` (mateothegreat) | ✅ Yes | SPA router with nested routers, 797+ commits. |
| `@teleology-io/svelte-router` | ✅ Yes | Client-side SPA router for Svelte 5. Dynamic route matching, nested routes, programmatic navigation. |
| `svelte-spa-router` | ❌ Svelte 3/4 only | Hash-based. NOT compatible with Svelte 5. Do not use. |

**Recommendation**: `@dvcol/svelte-simple-router` is the most mature Svelte 5-compatible option. Alternatively, for a very simple app, you can roll a minimal hash router using `$state` and `window.location.hash`.

### Minimal hash-based router pattern (no library)

```svelte
<!-- Router.svelte -->
<script lang="ts">
  import type { Component } from 'svelte';
  
  interface Props {
    routes: Record<string, Component>;
    fallback?: Component;
  }
  
  let { routes, fallback }: Props = $props();
  let hash = $state(window.location.hash.slice(1) || '/');
  
  $effect(() => {
    const handler = () => { hash = window.location.hash.slice(1) || '/'; };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });
  
  let CurrentPage = $derived(routes[hash] ?? fallback ?? routes['/']);
</script>

{#if CurrentPage}
  <CurrentPage />
{/if}
```

---

## 2. Svelte 5 Runes Patterns

Svelte 5 replaced the old `$:` reactive declarations and stores with **runes** — explicit, signal-based reactive primitives that work in `.svelte`, `.svelte.js`, and `.svelte.ts` files.

### Core Runes

#### `$state` — Reactive state declaration
```svelte
<script lang="ts">
  let count = $state(0);          // Primitive
  let items = $state<string[]>([]); // Array (deep proxy)
  let user = $state({ name: '', email: '' }); // Object (deep proxy)
</script>

<button onclick={() => count++}>{count}</button>
```

- Creates a **reactive signal**. Reading it in templates/effects creates a dependency.
- Objects and arrays are wrapped in **deep reactive proxies** — mutating nested properties triggers updates.
- Primitive reassignment (`count = 5`) triggers updates.

#### `$derived` — Computed/derived values
```svelte
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);
  
  // For complex logic, use $derived.by():
  let status = $derived.by(() => {
    if (count > 10) return 'high';
    if (count > 5) return 'medium';
    return 'low';
  });
</script>
```

- **Memoized** — only recalculates when dependencies change.
- Read-only — cannot be assigned to.
- Prefer `$derived` over `$effect` for computed values (no side effects needed).

#### `$effect` — Side effects
```svelte
<script lang="ts">
  let searchQuery = $state('');
  
  $effect(() => {
    // Automatically tracks `searchQuery`
    console.log('Search changed:', searchQuery);
    
    // Return cleanup function (runs before next execution and on destroy)
    return () => {
      console.log('Cleaning up previous search');
    };
  });
</script>
```

- Runs **after** the DOM updates.
- Auto-tracks any `$state`/`$derived` read inside.
- Return a cleanup function for teardown (event listeners, timers, subscriptions).
- `$effect.pre()` runs **before** DOM updates (rare, for measuring DOM before changes).
- **Considered an escape hatch** — prefer `$derived` when possible.

#### `$props` — Component props
```svelte
<script lang="ts">
  interface Props {
    name: string;
    count?: number;
    onchange?: (value: number) => void;
  }
  
  let { name, count = 0, onchange }: Props = $props();
</script>
```

#### `$bindable` — Two-way bindable props
```svelte
<script lang="ts">
  let { value = $bindable(0) }: { value: number } = $props();
</script>
```

### Key rules and gotchas

1. **Runes are compile-time magic** — they look like function calls but are compiler directives. They cannot be aliased, stored in variables, or called conditionally.

2. **`$state` in modules requires closures for cross-module reactivity**:
   ```ts
   // ❌ WRONG — importing `count` freezes the value
   export let count = $state(0);
   
   // ✅ RIGHT — wrap in object or use getter/setter
   export const counter = $state({ value: 0 });
   
   // ✅ RIGHT — class pattern (most performant)
   class Counter {
     value = $state(0);
     doubled = $derived(this.value * 2);
     increment() { this.value++; }
   }
   export const counter = new Counter();
   ```
   This is because JS module exports capture the binding at import time. You need a closure (object property, getter, or function) to keep it reactive.

3. **Don't use `$effect` where `$derived` works** — `$effect` is for side effects (API calls, DOM manipulation, subscriptions), not computed values.

4. **`$effect` cannot be used at module top-level** — only inside components or inside functions called from component `<script>` blocks.

5. **Deep reactivity gotcha**: `$state` wraps objects in a Proxy. If you destructure properties out, you lose reactivity:
   ```ts
   let user = $state({ name: 'Alice' });
   let { name } = user; // ❌ `name` is now a plain string, not reactive
   let name2 = $derived(user.name); // ✅ stays reactive
   ```

---

## 3. State Management Patterns for Complex SPAs in Svelte 5

### Pattern 1: Class-based stores (recommended for complex state)

```ts
// src/lib/stores/wallet.svelte.ts
class WalletStore {
  address = $state<string | null>(null);
  chainId = $state<number>(1);
  isConnected = $derived(this.address !== null);
  
  connect(address: string, chainId: number) {
    this.address = address;
    this.chainId = chainId;
  }
  
  disconnect() {
    this.address = null;
    this.chainId = 1;
  }
}

export const walletStore = new WalletStore();
```

**Why classes?**
- V8 optimizes classes heavily (hidden classes, inline caching).
- Natural encapsulation with methods.
- `$derived` works on class properties.
- Single exported instance = singleton pattern.
- File extension must be `.svelte.ts` for runes to work.

### Pattern 2: Object-based stores (simpler cases)

```ts
// src/lib/stores/settings.svelte.ts
export const settings = $state({
  slippageBps: 100,
  mevProtection: false,
  theme: 'dark' as 'light' | 'dark',
});
```

- Simpler but no encapsulation, no methods, no derived values.
- Good for simple key-value config.

### Pattern 3: Function-based stores (factory pattern)

```ts
// src/lib/stores/createQuoteStore.svelte.ts
export function createQuoteStore() {
  let quotes = $state<Quote[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  
  async function fetchQuotes(params: QuoteParams) {
    loading = true;
    error = null;
    try {
      const response = await api.GET('/compare', { params: { query: params } });
      if (response.data) quotes = response.data;
      if (response.error) error = response.error.message;
    } finally {
      loading = false;
    }
  }
  
  return {
    get quotes() { return quotes; },
    get loading() { return loading; },
    get error() { return error; },
    fetchQuotes,
  };
}
```

- Each call creates a new independent instance.
- Uses getters to maintain reactivity across module boundaries.
- Good for per-component or per-route state.

### Pattern 4: Context API (for component tree scoping)

```ts
// src/lib/contexts/quote-context.ts
import { getContext, setContext } from 'svelte';

const QUOTE_CTX = Symbol('quote');

export function setQuoteContext(store: ReturnType<typeof createQuoteStore>) {
  setContext(QUOTE_CTX, store);
}

export function getQuoteContext() {
  return getContext<ReturnType<typeof createQuoteStore>>(QUOTE_CTX);
}
```

- Use contexts when you need per-subtree state (not global singletons).
- Since we're building a pure SPA (no SSR), global singletons via class stores are safe — no cross-request leakage concern.
- Contexts are still useful for component composition patterns.

### When to use what

| Pattern | Use case |
|---------|----------|
| Class store (singleton) | Global app state: wallet, settings, theme. Most common for SPAs. |
| Object store | Simple config/settings with no methods. |
| Function store (factory) | Per-page or per-component state instances. |
| Context | Component libraries, scoped state within subtrees. |

---

## 4. Wallet / Web3 Integration in Svelte 5

### Option A: wagmi-svelte (recommended)

**`@byteatatime/wagmi-svelte`** — A port of Wagmi to Svelte 5, using runes for reactivity.

```bash
npm install @byteatatime/wagmi-svelte
```

**Key design decisions:**
- Uses `create-` prefix instead of `use-` (e.g., `createAccount` instead of `useAccount`).
- Returns functions that return values (wrapped with `$derived.by`) to maintain reactivity with primitive rune values.
- Re-exports from `@wagmi/core` renamed to `createWagmi-` prefix to avoid conflicts.

**Setup:**
```svelte
<!-- App.svelte -->
<script lang="ts">
  import { WagmiProvider, createWagmiConfig, http } from '@byteatatime/wagmi-svelte';
  import { mainnet, arbitrum, base } from '@byteatatime/wagmi-svelte/chains';

  const config = createWagmiConfig({
    chains: [mainnet, arbitrum, base],
    transports: {
      [mainnet.id]: http(),
      [arbitrum.id]: http(),
      [base.id]: http(),
    },
  });
</script>

<WagmiProvider {config}>
  <slot />
</WagmiProvider>
```

**Usage in components:**
```svelte
<script lang="ts">
  import { createAccount, createConnect } from '@byteatatime/wagmi-svelte';
  import { injected } from '@byteatatime/wagmi-svelte/connectors';

  const { address, chainId, status } = $derived.by(createAccount());
  const { connect } = $derived.by(createConnect());
</script>

{#if status === 'connected'}
  <p>Connected: {address}</p>
{:else}
  <button onclick={() => connect({ connector: injected() })}>Connect</button>
{/if}
```

**Pros:**
- Direct port of battle-tested Wagmi API — familiar patterns for anyone who's used Wagmi/React.
- Built for Svelte 5 runes.
- Gets Wagmi ecosystem (connectors, chains, actions) for free.

**Cons:**
- Relatively young library, smaller community than React Wagmi.
- Tied to Wagmi's abstractions.

### Option B: Direct viem + custom Svelte stores

Since the project already uses `viem` for its backend, you can build wallet integration directly with viem and Svelte 5 runes:

```ts
// src/lib/stores/wallet.svelte.ts
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { mainnet } from 'viem/chains';

class WalletStore {
  address = $state<`0x${string}` | null>(null);
  chainId = $state<number>(1);
  isConnected = $derived(this.address !== null);
  
  async connect() {
    if (!window.ethereum) throw new Error('No wallet found');
    
    const [addr] = await window.ethereum.request({ 
      method: 'eth_requestAccounts' 
    });
    this.address = addr;
    
    const chainIdHex = await window.ethereum.request({ 
      method: 'eth_chainId' 
    });
    this.chainId = parseInt(chainIdHex, 16);
    
    // Listen for changes
    window.ethereum.on('accountsChanged', (accounts: string[]) => {
      this.address = accounts[0] ?? null;
    });
    window.ethereum.on('chainChanged', (chainIdHex: string) => {
      this.chainId = parseInt(chainIdHex, 16);
    });
  }
  
  disconnect() {
    this.address = null;
  }
  
  getWalletClient() {
    if (!this.address || !window.ethereum) return null;
    return createWalletClient({
      account: this.address,
      chain: mainnet, // or lookup by this.chainId
      transport: custom(window.ethereum),
    });
  }
}

export const wallet = new WalletStore();
```

**Pros:**
- No extra dependencies — reuses viem already in the project.
- Full control over wallet UX and state.
- Simpler mental model.

**Cons:**
- Must implement connector logic yourself (MetaMask, WalletConnect, Coinbase, etc.).
- No automatic reconnection, no multi-wallet support without more work.

### Recommendation for this project

Given that the app already has a backend using viem and the wallet interaction is limited (connect, read address, send approve/swap transactions), **Option B (direct viem)** is simpler and avoids pulling in the full Wagmi stack. If multi-wallet support or WalletConnect becomes needed, upgrade to wagmi-svelte.

---

## 5. OpenAPI TypeScript Codegen for Svelte

### Recommended: `openapi-typescript` + `openapi-fetch`

This is the best option for a Svelte SPA. The project already has an `openapi.yaml`.

#### Setup

```bash
npm install openapi-fetch
npm install -D openapi-typescript typescript
```

#### Generate types from the OpenAPI spec

```bash
npx openapi-typescript ./openapi.yaml -o ./src/lib/api/schema.d.ts
```

Add to `package.json` scripts:
```json
{
  "scripts": {
    "generate:api": "openapi-typescript ./openapi.yaml -o ./src/lib/api/schema.d.ts"
  }
}
```

#### Create a typed API client

```ts
// src/lib/api/client.ts
import createClient from 'openapi-fetch';
import type { paths } from './schema';

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
});
```

#### Usage in Svelte components

```svelte
<script lang="ts">
  import { api } from '$lib/api/client';
  
  let quotes = $state<any>(null);
  let loading = $state(false);
  
  async function compare() {
    loading = true;
    const { data, error } = await api.GET('/compare', {
      params: {
        query: {
          chainId: 1,
          from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          amount: '1000000000',
          slippageBps: 100,
        },
      },
    });
    if (data) quotes = data;
    if (error) console.error(error);
    loading = false;
  }
</script>
```

#### Why openapi-fetch over alternatives

| Tool | Bundle | Approach | Status |
|------|--------|----------|--------|
| **openapi-fetch** | 6 KB | Types-only codegen + thin fetch wrapper | ✅ Active, recommended |
| openapi-typescript-fetch | 3 KB | Similar approach, slightly different API | ✅ Active |
| openapi-typescript-codegen | 367 KB | Full client codegen (functions for every endpoint) | ❌ **Deprecated**, migrating to `@hey-api/openapi-ts` |
| @hey-api/openapi-ts | varies | Full client codegen (successor to above) | ✅ Active |
| openapi-generator (typescript-fetch) | varies | Java-based codegen, heavy | ⚠️ Overkill for frontend |

**`openapi-fetch` wins because:**
- Smallest bundle (6 KB).
- Type-safe without runtime codegen overhead.
- Works with any framework (Svelte, React, Vue, vanilla).
- Uses native `fetch` under the hood — no extra HTTP library.
- Explicit Svelte examples in docs.
- Types are generated at build time from the spec — zero runtime type checking cost.

---

## 6. Anti-Patterns and Gotchas

### Svelte 5 Anti-Patterns

1. **Don't use `$effect` for derived state** — use `$derived` instead:
   ```ts
   // ❌ BAD
   let count = $state(0);
   let doubled = $state(0);
   $effect(() => { doubled = count * 2; }); // Unnecessary effect
   
   // ✅ GOOD
   let count = $state(0);
   let doubled = $derived(count * 2);
   ```

2. **Don't destructure reactive objects**:
   ```ts
   let user = $state({ name: 'Alice' });
   let { name } = user; // ❌ Loses reactivity
   ```

3. **Don't export bare `$state` from modules** — wrap in objects, classes, or use getters.

4. **Don't forget `.svelte.ts` extension** — runes only work in `.svelte`, `.svelte.ts`, and `.svelte.js` files.

5. **Don't put `$effect` at module scope** — it must be in a component or a function called from a component's script.

6. **Don't reassign exported `$state` objects directly** — mutate properties instead:
   ```ts
   export const store = $state({ count: 0 });
   // ❌ store = { count: 1 }; // Can't reassign
   // ✅ store.count = 1; // Mutate property
   ```

### Vite/Build Gotchas

1. **Vite 6 dropped Node.js core module polyfills** — if importing `buffer`, `crypto`, `stream` etc. from npm packages (common in Web3), you need explicit polyfills:
   ```ts
   // vite.config.ts
   import { defineConfig } from 'vite';
   import { svelte } from '@sveltejs/vite-plugin-svelte';
   import { nodePolyfills } from 'vite-plugin-node-polyfills';
   
   export default defineConfig({
     plugins: [svelte(), nodePolyfills()],
   });
   ```

2. **Use `import.meta.env.VITE_*` for env variables** — only `VITE_`-prefixed vars are exposed to client code.

3. **Path aliases** — configure in both `vite.config.ts` and `tsconfig.json`:
   ```ts
   // vite.config.ts
   resolve: {
     alias: { '$lib': '/src/lib' }
   }
   ```

### OpenAPI Gotchas

1. **Regenerate types when API changes** — add `generate:api` to your dev/build pipeline.
2. **`openapi-typescript` output is `.d.ts`** (declaration-only) — no runtime code, just types. This is intentional and good.
3. **Enable `noUncheckedIndexedAccess`** in tsconfig for best type safety with openapi-fetch.

---

## 7. Summary / Recommended Stack

For the Compare DEX Routers Svelte 5 SPA:

| Layer | Tool | Why |
|-------|------|-----|
| **Build** | Vite + `@sveltejs/vite-plugin-svelte` | Standard, fast, official |
| **Framework** | Svelte 5 (no SvelteKit) | Client-side SPA, backend already exists |
| **Language** | TypeScript | Already used in backend |
| **Routing** | `@dvcol/svelte-simple-router` or minimal hash router | Client-side SPA routing |
| **State** | Svelte 5 runes (class stores in `.svelte.ts`) | No external state library needed |
| **API Client** | `openapi-fetch` + `openapi-typescript` | Type-safe, 6 KB, uses project's `openapi.yaml` |
| **Wallet** | Direct viem integration (class store) | Already using viem in backend, simple needs |
| **Styling** | CSS (inline in `.svelte` files) or Tailwind | Scoped by default in Svelte |

### Quick-start commands

```bash
# Scaffold
npm create vite@latest ui -- --template svelte-ts
cd ui && npm install

# API types
npm install openapi-fetch
npm install -D openapi-typescript
npx openapi-typescript ../openapi.yaml -o ./src/lib/api/schema.d.ts

# Wallet (viem is already a project dep)
npm install viem

# Dev
npm run dev
```

---

## Sources

- https://svelte.dev/docs/svelte/overview — Official Svelte 5 docs
- https://www.reddit.com/r/sveltejs/comments/1dlk3a6/ — Svelte 5 + Vite SPA without SvelteKit discussion
- https://mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/ — Runes and global state patterns (closures, classes, contexts)
- https://www.divotion.com/blog/signals-in-svelte-5-a-comprehensive-guide-to-runes — Comprehensive runes guide
- https://weblogtrips.com/technology/svelte-5-runes-state-management-guide-2026/ — Svelte 5 runes state management 2026
- https://ganeshjoshi.dev/blogs/svelte-5-runes-overview — Svelte 5 runes quick overview
- https://coldfusion-example.blogspot.com/2025/12/svelte-5-runes-debugging-stale-ui.html — Debugging stale UI with $derived
- https://wagmi-svelte.vercel.app/ — wagmi-svelte (Svelte 5 Wagmi port)
- https://www.npmjs.com/package/svelte-wagmi — svelte-wagmi (older, stores-based)
- https://sveltekit.io/blog/web3-svelte — Building Web3 dApps with Svelte
- https://openapi-ts.dev/openapi-fetch/ — openapi-fetch docs
- https://www.npmjs.com/package/openapi-fetch — openapi-fetch npm
- https://www.npmjs.com/package/create-vite — Vite scaffolding
- https://github.com/dvcol/svelte-simple-router — Svelte 5 SPA router
- https://github.com/mateothegreat/svelte5-router — Another Svelte 5 router
- https://github.com/teleology-io/svelte-router — Teleology Svelte 5 router
