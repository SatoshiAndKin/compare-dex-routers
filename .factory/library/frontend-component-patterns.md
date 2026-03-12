# Frontend Component Patterns

## TokenInput.svelte — handleInput() clears token before selectToken()

In `packages/frontend/src/lib/components/TokenInput.svelte`, the `handleInput()` function (lines ~183-186) sets `formStore.fromToken` or `formStore.toToken` to `null` **before** `selectToken()` is ever called. This is because typing in the input should clear any previously-selected token, but it means that any code inside `selectToken()` that reads `currentSideToken` (the current store value for this side) will always see `null` during normal UI dropdown-selection flow.

**Implication for features that need to inspect/preserve the pre-selection token:** If you need to access what token was selected _before_ the user's new selection completes (e.g., for a swap feature), you must capture the current token value _before_ `handleInput()` runs — for example, in a component-level `$state` variable that saves the token whenever the dropdown opens or the user focuses the input. Relying on `currentSideToken` inside `selectToken()` will always yield `null`.

## tokenListStore — Avoid early returns inside try blocks in async init methods

In async store init methods that have cleanup or fallback logic _after_ the try/catch block, avoid early `return` statements inside the try block. An early `return` inside the try skips all post-try/catch code including fallback defaults.

**Pattern to avoid:**
```typescript
async _loadDefaultLists() {
  try {
    const { data } = await apiClient.GET("/tokenlist");
    if (!data) return;          // ← Exits function; skips _ensureDefaultList()
    this.lists.push(...);
  } catch { /* handle */ }
  this._ensureDefaultList();    // ← Never reached when data is undefined
}
```

**Preferred pattern:**
```typescript
async _loadDefaultLists() {
  try {
    const { data } = await apiClient.GET("/tokenlist");
    if (data) {
      this.lists.push(...);     // ← Guard block; fallthrough continues
    }
  } catch { /* handle */ }
  this._ensureDefaultList();    // ← Always reached
}
```

This was the root cause of the `fix-default-tokenlist-always-present` regression: API error responses set `data` to `undefined`, triggering the early return before the fallback was created.

## TokenInput.svelte — Capture-once guard for pending state variables

When using a pending `$state` variable in `handleInput()` to capture the pre-selection token (see the "handleInput() clears token before selectToken()" pattern above), use a **capture-once guard** to ensure the variable is only set on the _first_ keystroke:

```svelte
// WRONG — always-true guard, overwrites on every keystroke
if (pendingSelectedToken === null || ...) {  // pendingSelectedToken is immediately reset below
  pendingCurrentSideToken = currentStore;    // ← overwritten with null on keystroke 2+
  pendingSelectedToken = null;               // ← makes condition above always true
}

// CORRECT — capture-once guard
if (pendingCurrentSideToken === null) {      // only fires on the first keystroke
  pendingCurrentSideToken = currentStore;    // ← captures the pre-clear token once
}
formStore.fromToken = null;                  // store clearing happens unconditionally
```

The "always-true" anti-pattern occurs when the same block that evaluates the condition also resets the guard variable, making the guard always evaluate to `true`. The result: after the first keystroke clears the store, every subsequent keystroke overwrites `pendingCurrentSideToken` with `null` from the now-cleared store, making the swap degrade to a clear.

## SVG Favicons — Dark Mode Support

SVG favicons that target both light and dark browser chrome should use embedded CSS media queries to switch colors:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>
    path { stroke: #111; }
    @media (prefers-color-scheme: dark) {
      path { stroke: #eeeeee; }
    }
  </style>
  <!-- icon paths here -->
</svg>
```

A hardcoded dark stroke (`stroke="#111"`) is invisible on dark browser chrome (Firefox dark theme, macOS dark mode). The `prefers-color-scheme` media query inside a `<style>` block in the SVG handles both modes. This applies to `packages/frontend/public/favicon.svg`.
