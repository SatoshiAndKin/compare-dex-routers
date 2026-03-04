# Core-Polish Milestone — Testable Assertions

## A. Slippage Box Redesign

### VAL-POLISH-001 — Slippage presets render as pill/radio buttons
**Description:** The slippage preset buttons (3, 10, 50, 100, 300 bps) must be visually distinct from the custom text input. Presets should appear as pill-shaped or radio-style buttons (rounded/grouped, inverted fill on active state), not as rectangular text fields.
**Pass condition:** Preset buttons have a clearly different visual treatment (e.g., border-radius ≥ 4px, grouped/adjacent styling, toggle-style active state) from the text input.
**Evidence:** Screenshot of the slippage area at desktop width showing all 5 presets and the text input side by side.

### VAL-POLISH-002 — Slippage text input renders as a text field
**Description:** The custom slippage text input (`#slippageBps`) must look like a standard text input field — rectangular, with an underline or inset border — visually distinct from the pill-shaped presets.
**Pass condition:** The text input has a different visual shape/treatment from the preset buttons (e.g., no pill shape, visible text-field border style).
**Evidence:** Screenshot zoomed on the slippage area.

### VAL-POLISH-003 — Clicking a preset updates the text input value
**Description:** Clicking any preset button (3, 10, 50, 100, 300) must update the text input value to match.
**Pass condition:** After clicking the "100" preset, `#slippageBps` input value is `"100"`.
**Evidence:** Screenshot or DOM inspection after preset click.

### VAL-POLISH-004 — Active preset highlights when its value matches text input
**Description:** When the text input value matches a preset value, that preset must have the `active` class/style. Only one preset may be active at a time.
**Pass condition:** Type `10` in the text input → only the "10" preset has active styling. Type `42` → no preset is active.
**Evidence:** Screenshots for matching and non-matching values.

### VAL-POLISH-005 — Slippage presets are keyboard-accessible
**Description:** Each preset button must be focusable via Tab and activatable via Enter/Space.
**Pass condition:** Tab-navigating through the slippage area focuses each preset in order; pressing Enter/Space on a focused preset updates the value and active state.
**Evidence:** Accessibility snapshot showing focus outline on a preset button.

### VAL-POLISH-006 — Slippage box at 375px viewport
**Description:** At 375px mobile viewport, the slippage area (presets + text input + "bps" label) must remain usable — no overflow or horizontal scroll.
**Pass condition:** At 375px width, all slippage elements are visible without horizontal scrollbar and touch-target sizes are ≥ 32px.
**Evidence:** Screenshot at 375px viewport width.

---

## B. Default Amount

### VAL-POLISH-007 — Default amount is 1 on first visit
**Description:** On a first visit (no URL params, no localStorage), the amount input must default to `1`, not `1000`.
**Pass condition:** Loading the page with empty localStorage and no URL query params → `#amount` value is `"1"`.
**Evidence:** Screenshot of the form on first visit showing amount field.

### VAL-POLISH-008 — URL param overrides default amount
**Description:** If the URL contains `?amount=500`, the amount field must use `500`, not the default.
**Pass condition:** Navigate to `/?amount=500` → `#amount` value is `"500"`.
**Evidence:** Screenshot or DOM inspection.

---

## C. Default Tokens

### VAL-POLISH-009 — Ethereum defaults to USDC → crvUSD
**Description:** On Ethereum (chainId 1), the default From token must be USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`) and the default To token must be crvUSD (`0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`), not WETH.
**Pass condition:** Select chain "Ethereum (1)" with no URL params → From field shows USDC, To field shows crvUSD. `data-address` attributes match the correct contract addresses.
**Evidence:** Screenshot of form with Ethereum selected, showing token fields.

### VAL-POLISH-010 — Non-Ethereum chains default to USDC → native token
**Description:** On non-Ethereum chains (Base, Arbitrum, Polygon, etc.), the default From token must be USDC and the default To token must be the chain's native wrapped token (WETH on Base/Arbitrum, WMATIC on Polygon, etc.).
**Pass condition:** Select Base (8453) → From=USDC, To=WETH. Select Polygon (137) → From=USDC, To=WMATIC (or whatever the native token is for that chain).
**Evidence:** Screenshot per chain.

### VAL-POLISH-011 — Chain switch updates default tokens
**Description:** Switching chains must update the From/To token fields to the new chain's defaults (unless the user has saved preferences — see persistence section).
**Pass condition:** Start on Base → switch to Ethereum → tokens change to USDC/crvUSD. Switch to Arbitrum → tokens change to USDC/WETH.
**Evidence:** Screenshots before and after chain switch.

### VAL-POLISH-012 — URL params override default tokens
**Description:** If URL contains `?from=0x...&to=0x...`, those override the chain defaults.
**Pass condition:** Navigate to `/?chainId=1&from=0xdAC17F958D2ee523a2206206994597C13D831ec7&to=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&amount=100` → tokens match URL params, not defaults.
**Evidence:** DOM inspection of `data-address` attributes.

---

## D. Persist User Choices (localStorage)

### VAL-POLISH-013 — Selections saved to localStorage after form submission
**Description:** After a successful quote comparison, the user's token, amount, chain, and slippage selections must be saved to localStorage.
**Pass condition:** Submit a comparison with chain=1, from=DAI, to=USDC, amount=500, slippage=100 → inspect localStorage for saved values matching these selections.
**Evidence:** Console/DevTools localStorage inspection.

### VAL-POLISH-014 — Saved selections restored on return visit
**Description:** On a return visit (page reload without URL params), the form must be populated from localStorage values instead of hardcoded defaults.
**Pass condition:** Save preferences (chain=1, from=DAI, to=USDC, amount=500) → reload page without URL params → form fields match saved values.
**Evidence:** Screenshot of form after reload showing restored values.

### VAL-POLISH-015 — URL params take priority over localStorage
**Description:** When both URL params and localStorage values exist, URL params must win.
**Pass condition:** Save chain=1 to localStorage → navigate to `/?chainId=8453&from=...&to=...&amount=100` → form uses URL param values, not localStorage.
**Evidence:** DOM inspection confirming URL param values.

### VAL-POLISH-016 — First visit with no saved data uses hardcoded defaults
**Description:** When localStorage is empty and no URL params exist, the form must use the hardcoded defaults (chain=8453/Base, amount=1, USDC→native token).
**Pass condition:** Clear localStorage → load page → form shows default chain, default amount (1), default tokens.
**Evidence:** Screenshot of form on first visit.

### VAL-POLISH-017 — Saved slippage restored on return visit
**Description:** If the user changes slippage (e.g., to 100 bps) and that is saved, it must be restored on reload.
**Pass condition:** Set slippage to 100 → submit → reload → slippage input value is 100, the "100" preset is active.
**Evidence:** Screenshot showing restored slippage with correct active preset.

### VAL-POLISH-018 — Chain change with saved preferences per chain
**Description:** If persistence is per-chain (e.g., Ethereum→DAI/USDC, Base→USDC/WETH), switching chains restores chain-specific saved tokens.
**Pass condition:** Save Ethereum tokens as DAI/USDC → switch to Base (saves USDC/WETH) → switch back to Ethereum → tokens are DAI/USDC (not base defaults).
**Evidence:** Screenshots of chain switching with different saved preferences.

### VAL-POLISH-019 — Corrupt localStorage data handled gracefully
**Description:** If localStorage contains malformed or corrupted saved preferences, the app must fall back to hardcoded defaults without errors.
**Pass condition:** Set localStorage key to invalid JSON → reload → app loads with defaults, no console errors, no blank form.
**Evidence:** Console log showing no errors; screenshot of form with defaults.

---

## E. Transaction Details in Wei

### VAL-POLISH-020 — Input amount in wei shown in expandable details
**Description:** The expandable "Details" section for each quote result must show the input amount in wei (raw integer, no decimals) in addition to the human-readable amount.
**Pass condition:** Submit a comparison → expand Details → a field labeled "Input Amount (wei)" or similar shows the raw wei value (e.g., `1000000` for 1 USDC with 6 decimals).
**Evidence:** Screenshot of expanded details section.

### VAL-POLISH-021 — Output amount in wei shown in expandable details
**Description:** The expandable "Details" section must also show the output amount in wei.
**Pass condition:** Expand Details → a field shows raw output amount in wei.
**Evidence:** Screenshot of expanded details.

### VAL-POLISH-022 — Wei values match raw API response values
**Description:** The wei values displayed in the details must match `input_amount_raw` and `output_amount_raw` from the API response.
**Pass condition:** Compare the displayed wei values with the `/compare` API JSON response → they match exactly.
**Evidence:** Side-by-side of details section screenshot and network response.

### VAL-POLISH-023 — Wei display for both Spandex and Curve quotes
**Description:** Both the Spandex and Curve quote detail sections must show wei amounts.
**Pass condition:** Both the recommended and alternative quote details sections show wei values.
**Evidence:** Screenshots of both expanded details.

### VAL-POLISH-024 — Wei values for targetOut (Buy exact) mode
**Description:** In targetOut mode, the details must correctly label which is "desired output (wei)" vs "required input (wei)".
**Pass condition:** Switch to Buy exact → submit → expand Details → labels correctly distinguish input/output in wei with appropriate mode-specific labels.
**Evidence:** Screenshot of details in targetOut mode.

---

## F. Address Display in Errors

### VAL-POLISH-025 — Error messages show token symbol
**Description:** When an error message references a token address, it must display the token symbol (e.g., "USDC") instead of or alongside the raw address.
**Pass condition:** Trigger an error involving a known token → the error message includes the symbol name.
**Evidence:** Screenshot of error message showing symbol.

### VAL-POLISH-026 — Hovering token address shows full address in tooltip
**Description:** When a token symbol is displayed in an error message, hovering over it must reveal the full 0x address in a tooltip or title attribute.
**Pass condition:** Hover over the token symbol in an error → a tooltip/title with the full `0x...` address appears.
**Evidence:** Screenshot showing tooltip.

### VAL-POLISH-027 — Clicking token address copies to clipboard
**Description:** Clicking on a token symbol/address element in an error message must copy the full address to the clipboard.
**Pass condition:** Click the token symbol → clipboard contains the full 0x address. A visual confirmation (e.g., "Copied!") briefly appears.
**Evidence:** Screenshot of copy confirmation; clipboard content verification.

### VAL-POLISH-028 — Address display works for unknown tokens
**Description:** For tokens not in any tokenlist (unknown symbol), the full address must still be displayed and be copyable.
**Pass condition:** Trigger an error with an unknown token address → the address is shown (possibly truncated with hover-for-full) and clicking copies it.
**Evidence:** Screenshot of error with unknown token address.

---

## G. CSS Polish

### VAL-POLISH-029 — Slippage label font size ≥ 0.75rem
**Description:** The slippage box label ("Slippage"), preset buttons, and "bps" hint must have font sizes ≥ 0.75rem (12px), not the current 0.5rem (8px).
**Pass condition:** Inspect computed font-size of `.slippage-box-label`, `.slippage-preset-compact`, `.slippage-box-hint` → all ≥ 12px.
**Evidence:** DevTools computed styles screenshot.

### VAL-POLISH-030 — Slippage text input font size ≥ 0.75rem
**Description:** The slippage text input (`.slippage-box-input`) font size must be ≥ 0.75rem (12px), not the current 0.625rem.
**Pass condition:** Computed font-size of `#slippageBps` ≥ 12px.
**Evidence:** DevTools computed styles screenshot.

### VAL-POLISH-031 — All form labels minimum 0.75rem
**Description:** All form labels (Chain, From Token, To Token, Amount, etc.) must have font-size ≥ 0.75rem.
**Pass condition:** Inspect all `<label>` elements → computed font-size ≥ 12px.
**Evidence:** DevTools inspection.

### VAL-POLISH-032 — Detail section field labels ≥ 0.625rem
**Description:** Field labels in the expandable details section (`.field-label`) must be ≥ 0.625rem (10px).
**Pass condition:** Inspect `.field-label` computed font-size → ≥ 10px.
**Evidence:** DevTools computed styles.

### VAL-POLISH-033 — Mobile 375px: no horizontal overflow
**Description:** At 375px viewport width, the entire page must render without horizontal scrollbar.
**Pass condition:** Set viewport to 375px × 667px → no horizontal scrollbar appears. `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
**Evidence:** Screenshot at 375px showing full page.

### VAL-POLISH-034 — Mobile 375px: form elements usable
**Description:** At 375px width, all form elements (chain dropdown, token inputs, amount, direction toggle, slippage, submit button) must be visible, tappable, and not overlapping.
**Pass condition:** All form elements are visible and non-overlapping at 375px width.
**Evidence:** Full-page screenshot at 375px.

### VAL-POLISH-035 — Mobile 375px: results area readable
**Description:** At 375px width, comparison results (primary amounts, gas info, action buttons) must be readable and not cut off.
**Pass condition:** Submit a comparison at 375px → results area is fully visible and readable.
**Evidence:** Screenshot of results at 375px.

### VAL-POLISH-036 — Mobile 375px: slippage box wraps properly
**Description:** At 375px width, if the slippage box cannot fit next to the submit button, it must wrap to its own line gracefully.
**Pass condition:** The action row (submit + slippage) wraps without overlap at 375px.
**Evidence:** Screenshot of action row at 375px.

### VAL-POLISH-037 — Brutalist aesthetic preserved
**Description:** All CSS changes must maintain the existing brutalist design language: black borders, monospace fonts for data, uppercase labels, #0055FF accent, #f5f5f5 background.
**Pass condition:** Visual inspection confirms: 2px+ solid black borders on form elements, monospace for values, uppercase labels with blue left-border, blue focus outlines, light gray background.
**Evidence:** Screenshot of form and results area.

### VAL-POLISH-038 — Spacing consistency in form area
**Description:** Form groups must have consistent vertical spacing (margin-bottom). No cramped or excessively gapped areas.
**Pass condition:** All `.form-group` elements have uniform `margin-bottom` values (within 2px tolerance).
**Evidence:** DevTools box model inspection of multiple form groups.

### VAL-POLISH-039 — Touch targets ≥ 44px on mobile
**Description:** Buttons and interactive elements must have minimum 44×44px touch target area on mobile.
**Pass condition:** Submit button, preset buttons, direction toggle buttons all have a computed height ≥ 44px or hit area ≥ 44px at 375px viewport.
**Evidence:** DevTools element size measurement.

---

## H. Docker Service Rename

### VAL-POLISH-040 — docker-compose.yml service name is "flashprofits"
**Description:** The service name in `docker-compose.yml` must be `flashprofits`, not `spandex-router`.
**Pass condition:** `docker-compose.yml` contains `services: flashprofits:` and does NOT contain `spandex-router`.
**Evidence:** File content showing service name.

### VAL-POLISH-041 — docker-stack.yml service name is "flashprofits"
**Description:** The service name in `docker-stack.yml` must be `flashprofits`, not `spandex-router`.
**Pass condition:** `docker-stack.yml` contains `services: flashprofits:` and does NOT contain `spandex-router`.
**Evidence:** File content showing service name.

### VAL-POLISH-042 — docker-compose.yml healthcheck still works
**Description:** The healthcheck in `docker-compose.yml` must still reference the correct `/health` endpoint and work with the renamed service.
**Pass condition:** The healthcheck test command is unchanged (references `localhost` and `/health`). Running `docker compose config` does not error.
**Evidence:** Output of `docker compose config` or file content.

### VAL-POLISH-043 — docker-stack.yml configuration intact after rename
**Description:** All other configuration in `docker-stack.yml` (image, ports, env_file, deploy config, healthcheck, resources) must remain unchanged after the service rename.
**Pass condition:** Diff between old and new `docker-stack.yml` shows ONLY the service name change from `spandex-router` to `flashprofits`.
**Evidence:** Git diff of docker-stack.yml.

### VAL-POLISH-044 — docker-stack.yml comments updated if they reference old name
**Description:** If any comments in `docker-stack.yml` reference `spandex-router` (e.g., the `DOCKER_IMAGE` comment), they must be updated to reference `flashprofits`.
**Pass condition:** No occurrence of `spandex-router` remains in `docker-stack.yml`.
**Evidence:** `grep` for `spandex-router` returns no results.

---

## I. Cross-Cutting / Integration

### VAL-POLISH-045 — Full flow: first visit → compare → details → wei values
**Description:** Complete end-to-end flow: load page fresh → verify defaults (amount=1, correct tokens for default chain) → submit comparison → view results → expand details → verify wei values present.
**Pass condition:** All sub-assertions pass in sequence without errors.
**Evidence:** Series of screenshots covering each step.

### VAL-POLISH-046 — Full flow: save preferences → reload → verify restored
**Description:** Complete persistence flow: change tokens/amount/chain → submit comparison → reload page → verify form is populated from saved preferences.
**Pass condition:** After reload, form matches previously saved selections.
**Evidence:** Before and after screenshots.

### VAL-POLISH-047 — Full flow: Ethereum with crvUSD default → compare
**Description:** Select Ethereum → verify USDC/crvUSD defaults → submit comparison → verify both quotes return results (since crvUSD is a Curve native token, Curve should have a route).
**Pass condition:** Comparison returns at least one quote; no error about unknown tokens.
**Evidence:** Screenshot of results with Ethereum/USDC/crvUSD.

### VAL-POLISH-048 — No console errors on page load
**Description:** Loading the page must not produce any JavaScript console errors.
**Pass condition:** Console log shows no `error`-level messages after full page load and tokenlist initialization.
**Evidence:** Browser console screenshot.

### VAL-POLISH-049 — No console errors after chain switch
**Description:** Switching chains must not produce JavaScript errors.
**Pass condition:** Switch between 3+ chains → no console errors.
**Evidence:** Browser console screenshot after switching.

### VAL-POLISH-050 — API /compare endpoint unaffected by UI changes
**Description:** The `/compare` API endpoint must continue to return the same JSON structure with `input_amount_raw` and `output_amount_raw` fields.
**Pass condition:** `GET /compare?chainId=1&from=...&to=...&amount=1&slippageBps=50` returns JSON with `input_amount_raw` and `output_amount_raw` fields.
**Evidence:** curl response.

### VAL-POLISH-051 — Existing URL bookmarks still work
**Description:** Old bookmarked URLs with `?chainId=8453&from=0x...&to=0x...&amount=1000&slippageBps=50` must still load correctly (URL params override new defaults).
**Pass condition:** Navigate to a legacy-format URL → form populates correctly from URL params.
**Evidence:** Screenshot showing URL param values in form.

### VAL-POLISH-052 — Settings modal unaffected by changes
**Description:** The Settings modal (gear icon) must still open, display tokenlist sources, and close normally after all CSS/JS changes.
**Pass condition:** Open Settings → tokenlists visible → add/remove works → close via X or Escape.
**Evidence:** Screenshot of settings modal.

### VAL-POLISH-053 — Auto-refresh preserves user's saved preferences
**Description:** Auto-refresh (15s countdown) must use the current form values and not reset them to defaults.
**Pass condition:** Change amount to 500 → submit → wait for auto-refresh → amount field still shows 500.
**Evidence:** Screenshot after auto-refresh showing preserved values.

### VAL-POLISH-054 — Direction toggle (Sell exact / Buy exact) unaffected
**Description:** The direction toggle must continue to work correctly after all changes.
**Pass condition:** Click "Buy exact" → submit → results show targetOut mode labels → click "Sell exact" → works normally.
**Evidence:** Screenshot of both modes.

### VAL-POLISH-055 — Typecheck passes (npm run typecheck)
**Description:** All TypeScript changes must pass strict type checking.
**Pass condition:** `npm run typecheck` exits with code 0.
**Evidence:** Command output.

### VAL-POLISH-056 — Lint passes (npm run lint)
**Description:** All changes must pass ESLint.
**Pass condition:** `npm run lint` exits with code 0.
**Evidence:** Command output.

### VAL-POLISH-057 — Tests pass (npm test)
**Description:** All existing Vitest tests must pass.
**Pass condition:** `npm test` exits with code 0, all tests green.
**Evidence:** Test output.

### VAL-POLISH-058 — No dead code introduced (npm run dead-code)
**Description:** Changes must not introduce unused exports or dead code.
**Pass condition:** `npm run dead-code` shows no new issues.
**Evidence:** Command output.
