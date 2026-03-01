# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

**What belongs here:** How to manually test the app, testing tools available, URLs, credentials, setup.

---

## Testing Surface

- **URL:** http://localhost:3001/
- **Dev server:** `PORT=3001 npm run dev` (uses tsx with file watching)
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
