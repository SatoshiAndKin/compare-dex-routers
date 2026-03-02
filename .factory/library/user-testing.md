# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

**What belongs here:** How to manually test the app, testing tools available, URLs, credentials, setup.

---

## Testing Surface

- **URL:** http://localhost:3002/
- **Dev server:** `PORT=3002 npm run dev` (uses tsx with file watching)
- **Tools:** Playwright v1.58.2 available globally at /opt/homebrew/bin/playwright
- **Browser automation:** playwright MCP tools (browser_navigate, browser_snapshot, browser_click, etc.)

## Testing Notes

- Wallet connection features require a real browser wallet extension (MetaMask, Frame, etc.) for full signing
- ERC-6963 detection CAN be automated: inject a mock provider via `page.evaluate()` that dispatches `eip6963:announceProvider` with a fake provider object — this allows testing connect/disconnect flows without a real wallet extension
- Token autocomplete, auto-refresh, and UI state are fully testable via playwright
- The dev server auto-reloads on file changes
- Frame wallet is running on localhost:8421 and 1248 (detected in port scan)

## Known Limitations

- Actual swap execution requires a funded wallet on the correct chain
- Approval transactions require token balance
- Console may show favicon.ico 404 - this is cosmetic

---

## Flow Validator Guidance: Web UI

**Tool:** agent-browser skill (Playwright browser automation)
**App URL:** http://localhost:3002/
**Session naming:** Use your assigned session ID (e.g., "54ae4ea52d92__token", "54ae4ea52d92__wallet", etc.)

### Isolation Rules
- This is a stateless app with no user accounts — each browser session is fully isolated by default.
- Multiple subagents can hit the same server simultaneously without interference.
- Each subagent gets its own browser session (unique --session ID).
- Never reuse another subagent's session.

### Mock Wallet Injection
For wallet-related assertions, inject a mock ERC-6963 provider via page.evaluate():
```js
await page.evaluate(() => {
  const mockProvider = {
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        return ['0x1234567890123456789012345678901234567890'];
      }
      if (method === 'eth_chainId') return '0x1'; // mainnet
      if (method === 'net_version') return '1';
      return null;
    },
    on: () => {},
    removeListener: () => {},
  };
  const event = new CustomEvent('eip6963:announceProvider', {
    detail: {
      info: { uuid: 'mock-uuid', name: 'Mock Wallet', icon: 'data:image/png;base64,iVBORw0KGgo=', rdns: 'mock.wallet' },
      provider: mockProvider,
    },
  });
  window.dispatchEvent(event);
  window.ethereum = mockProvider;
});
```

### Source Inspection
Some assertions require source code inspection (VAL-WALLET-014, VAL-WALLET-015).
Read `/Users/bryan/code/compare-dex-routers/src/server.ts` to verify swap/approve handler code.

### Boundaries
- Do not modify server source files
- Do not call POST/mutating endpoints
- Screenshot evidence should be saved to the flow report (describe what you saw)
- favicon.ico 404 errors in console are cosmetic and should be ignored

## Flow Validator Guidance: API

**Tool:** curl
**Base URL:** http://localhost:3002/
**Isolation:** No isolation needed — stateless API calls

---

## Known Issues & Quirks (from ux-polish validation round 1)

- **Curve gas estimation requires funded sender**: Gas estimation for Curve (`gas_used`) only succeeds when the sender actually holds the tokens. For testing Curve gas display, inject a mock fetch response with `gas_used` set, or skip live gas testing (the code path is verified via source inspection).
- **Auto-refresh interference**: The 15s auto-refresh can interfere with interactive testing (closing expanded details, changing tabs). Take screenshots quickly or pause auto-refresh via `clearInterval(window._refreshTimer)` if needed.

## Known Issues & Quirks (from swap-ux validation round 1)

- **data/tokenlist.json**: Must be downloaded on disk via `.factory/init.sh` (curl from https://tokens.uniswap.org). Not committed to git. Without it, /tokenlist returns 500.
- **/quote returns 500**: Spandex provider failures (API key / rate limit). Not a regression. /compare still works because Curve is available.
- **Disconnect button**: Renders in DOM even when no wallet is connected (minor UI cosmetic issue).
- **favicon.ico 404**: Cosmetic — ignore in console error checks.
- **Playwright MCP tools vs agent-browser CLI**: Playwright MCP tools (`browser_evaluate`, `browser_wait_for`, etc.) are more stable for complex eval + interaction sequences than `agent-browser` CLI. The CLI sometimes loses page context after page updates or eval calls. Use Playwright MCP for reliable testing.
- **Form field fill**: Direct DOM manipulation via `page.evaluate()` (setting `.value` and dispatching `input`/`change` events) is more reliable than `browser_fill` or `agent-browser fill` for autocomplete inputs, as those commands can sometimes navigate away.

