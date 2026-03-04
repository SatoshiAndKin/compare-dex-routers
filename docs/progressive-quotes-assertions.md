# Progressive Quotes — Testable Assertions

## 1. First Quote Arrival & Rendering

### VAL-PROG-001: First quote renders immediately on arrival
**Description:** When the user submits a comparison, the first router quote that arrives (either Spandex or Curve) is rendered into the results area immediately, without waiting for the second router.
**Pass:** The results area transitions from "Comparing..." loading state to showing a fully rendered quote card within the latency of the faster router. The quote card includes all standard fields (output amount, gas cost, approve/swap buttons).
**Fail:** The UI remains in the loading state until both routers respond, or the first quote is buffered and not displayed.
**Evidence:** Screenshot showing a rendered quote card while the other tab still shows a loading/pending indicator.

### VAL-PROG-002: Loading indicator shown for pending router
**Description:** After the first quote arrives and renders, the tab for the still-pending router displays a loading indicator (spinner or "Loading..." text).
**Pass:** The pending router's tab is visible, labeled with the router name (e.g., "Curve"), and its content area shows a loading/spinner state. The tab is not hidden.
**Fail:** The pending router's tab is hidden, or its content area is empty with no loading indicator.
**Evidence:** Screenshot showing the first quote rendered in the active tab and the second tab visibly labeled with a loading indicator in its content area.

### VAL-PROG-003: First-arriving quote tab is labeled correctly
**Description:** The tab containing the first-arriving quote is labeled with the router's name (e.g., "Spandex" or "Curve"), not a generic label like "Recommended" or "Loading...".
**Pass:** Tab text matches the router name of the first quote to arrive.
**Fail:** Tab text says "Recommended", "Loading...", or any generic/incorrect label.
**Evidence:** Screenshot of tab bar after first quote renders.

## 2. Second Quote Arrival & Full UI Update

### VAL-PROG-004: Second quote renders into its tab on arrival
**Description:** When the second router's quote arrives, it renders into the alternative tab's content area, replacing the loading indicator.
**Pass:** The second tab's content transitions from loading state to a fully rendered quote card with all standard fields.
**Fail:** The second tab remains in loading state, or the entire result area re-renders/flashes.
**Evidence:** Screenshot showing both tabs populated with quote data.

### VAL-PROG-005: Recommendation recalculated after both quotes arrive
**Description:** Once both quotes have arrived, the system recalculates which is recommended and updates the tab order and reason box accordingly.
**Pass:** The Recommended tab contains the better quote (per the existing recommendation logic including gas-adjusted comparison), the Alternative tab contains the other, and the reason box explains why.
**Fail:** Tab order does not reflect the recommendation, or the reason box is missing/stale.
**Evidence:** Screenshot showing reason box with correct recommendation text and both tabs correctly ordered.

### VAL-PROG-006: Tab reorder does not disrupt user's active view
**Description:** If the user is viewing the first-arriving quote's tab and the second quote arrives triggering a recommendation reorder, the user's currently viewed content does not suddenly switch away.
**Pass:** If the user is reading the Spandex tab and Curve arrives as the new recommended quote, the display remains on the Spandex tab content (the user's selection is preserved). The tabs may re-label but the active tab content does not jump.
**Fail:** The active tab switches automatically to the newly recommended tab, causing the user to lose their place.
**Evidence:** Interaction sequence showing: (1) first quote arrives, user views it, (2) second quote arrives and is recommended, (3) user is still viewing the same content they were reading.

### VAL-PROG-007: Reason box updates live when second quote arrives
**Description:** The reason/recommendation box at the top of results updates its text when the second quote arrives, reflecting the full comparison.
**Pass:** Before the second quote arrives, the reason box shows a preliminary message (e.g., "Spandex quote received. Waiting for Curve..."). After both arrive, it shows the standard comparison reason (e.g., "Spandex recommended: better net output after gas").
**Fail:** The reason box shows stale or incorrect text after the second quote arrives.
**Evidence:** Two screenshots: one showing the preliminary reason text after first quote, one showing the full comparison reason after both.

## 3. Router Failures During Progressive Loading

### VAL-PROG-008: One router fails, other succeeds — successful quote displayed
**Description:** If one router returns an error and the other returns a valid quote, the successful quote is displayed and the failed router's tab shows its error message.
**Pass:** The successful quote renders fully. The failed router's tab shows the error message (e.g., "Curve: No route found"). No generic "No quotes available" message is shown.
**Fail:** Both tabs show errors, or the successful quote is not displayed, or the error tab is hidden.
**Evidence:** Screenshot showing the successful quote in one tab and the error message in the other tab.

### VAL-PROG-009: First router fails, second succeeds — loading state transitions correctly
**Description:** If the first response to arrive is an error (e.g., Curve fails quickly), the UI shows the error in that tab and continues showing a loading indicator for the pending router.
**Pass:** The failed router's tab shows the error immediately. The other tab continues showing a loading indicator. When the successful quote arrives, it renders normally.
**Fail:** The UI shows a global error state and stops waiting for the second router.
**Evidence:** Two screenshots: (1) after first router fails showing error + loading, (2) after second router succeeds showing error + quote.

### VAL-PROG-010: Both routers fail — combined error displayed
**Description:** If both routers return errors, the UI shows a combined error message listing both failures.
**Pass:** The result area shows error messages from both routers (e.g., "Spandex: timeout. Curve: No route found"). No loading indicators remain.
**Fail:** Only one error is shown, or a loading indicator persists after both have responded.
**Evidence:** Screenshot showing combined error messages with no residual loading state.

### VAL-PROG-011: Loading indicators cleared after all routers respond
**Description:** Regardless of success/failure combination, all loading indicators (tab spinners, "Loading..." text, disabled submit button) are cleared once every router has responded.
**Pass:** Submit button re-enables and shows "Compare Quotes". No tab shows loading state. No spinner remains.
**Fail:** Any loading indicator persists after all routers have responded.
**Evidence:** Screenshot of final state with no loading indicators.

## 4. Swap Confirmation Modal (Partial Quotes)

### VAL-PROG-012: Swap click with pending quotes shows confirmation modal
**Description:** If the user clicks a Swap button on the first-arriving quote while the second router's quote is still loading, a confirmation modal appears warning that a better price may be incoming.
**Pass:** A modal/dialog appears with text warning the user that another quote is still loading and a potentially better price may arrive. The modal has "Wait" and "Swap Anyway" (or equivalent) buttons.
**Fail:** The swap executes immediately with no warning, or the swap button is disabled during progressive loading.
**Evidence:** Screenshot of the confirmation modal with warning text and both action buttons visible.

### VAL-PROG-013: Confirmation modal — "Wait" dismisses without action
**Description:** Clicking "Wait" (or equivalent dismiss button) on the confirmation modal closes it without executing the swap. The user returns to viewing the progressive results.
**Pass:** Modal closes. No wallet transaction is initiated. The quote results remain visible. The pending router's loading state continues.
**Fail:** The swap executes despite clicking "Wait", or the results are cleared, or the modal does not close.
**Evidence:** Interaction sequence: click Swap → modal appears → click Wait → modal closes → results still visible with loading state for pending router.

### VAL-PROG-014: Confirmation modal — "Swap Anyway" proceeds with transaction
**Description:** Clicking "Swap Anyway" (or equivalent confirm button) on the confirmation modal initiates the wallet transaction for the displayed quote.
**Pass:** Modal closes. Wallet provider popup appears requesting transaction confirmation. The swap proceeds with the currently displayed quote data (router address, calldata, value).
**Fail:** No wallet interaction occurs, or the wrong quote data is used for the transaction.
**Evidence:** Interaction sequence: click Swap → modal appears → click Swap Anyway → wallet provider dialog opens with correct transaction details.

### VAL-PROG-015: No confirmation modal when all quotes have arrived
**Description:** If the user clicks Swap after both routers have responded (regardless of success/failure), no confirmation modal is shown — the swap proceeds directly as it does today.
**Pass:** Clicking Swap immediately triggers the wallet transaction flow (or wallet connect flow if not connected) with no intermediate modal.
**Fail:** A confirmation modal appears even though all routers have responded.
**Evidence:** Interaction showing Swap click after both tabs are populated → direct wallet interaction, no modal.

### VAL-PROG-016: Confirmation modal — second quote arrives while modal is open
**Description:** If the second quote arrives while the confirmation modal is still displayed, the modal updates its text or auto-dismisses to reflect that the comparison is now complete.
**Pass:** Either: (a) the modal text updates to indicate all quotes are now available and the user can review before swapping, or (b) the modal auto-dismisses and the full comparison is rendered behind it. The user is not left with a stale warning.
**Fail:** The modal continues showing the "better price may arrive" warning after all quotes have already arrived.
**Evidence:** Interaction sequence showing modal open → second quote arrives → modal state changes.

## 5. Approve Flow with Partial Quotes

### VAL-PROG-017: Approve click with pending quotes — no confirmation modal
**Description:** Clicking the Approve button while quotes are still loading does NOT trigger a confirmation modal (approval is a prerequisite step, not the final swap).
**Pass:** Approve proceeds directly to the wallet interaction without any intermediate modal. The approval flow works identically to the current behavior.
**Fail:** A confirmation modal is shown for the Approve action.
**Evidence:** Interaction showing Approve click during progressive loading → wallet provider dialog opens directly.

### VAL-PROG-018: Swap button enabled after approval even during progressive loading
**Description:** After approval completes on the first-arriving quote's card, the Swap button on that card becomes enabled, even if the second router is still loading.
**Pass:** Approve button shows "Approved ✓", Swap button is no longer disabled/greyed.
**Fail:** Swap button remains disabled until all quotes arrive, even though approval is complete.
**Evidence:** Screenshot showing "Approved ✓" and an enabled Swap button on the first quote's card while the second tab still loads.

## 6. Auto-Refresh Compatibility

### VAL-PROG-019: Auto-refresh triggers progressive loading cycle
**Description:** When the 15-second auto-refresh fires, it initiates a new progressive comparison that streams quotes independently, just like a manual comparison.
**Pass:** Auto-refresh starts a new progressive fetch. The first returning quote updates the results (preserving UI state per existing behavior). The second quote updates when it arrives.
**Fail:** Auto-refresh falls back to the old all-at-once behavior, or the progressive stream is not initiated.
**Evidence:** Network log or UI observation showing two distinct quote updates during a single auto-refresh cycle.

### VAL-PROG-020: Auto-refresh preserves UI state during progressive updates
**Description:** During auto-refresh progressive loading, the user's active tab selection and scroll position are preserved (matching existing `preserveUiState` behavior).
**Pass:** If the user is viewing the Alternative tab and scrolled down, the auto-refresh updates quote data in-place without switching tabs or resetting scroll.
**Fail:** Tab switches to Recommended or scroll resets during auto-refresh.
**Evidence:** Interaction sequence: user selects Alternative tab → auto-refresh fires → first quote updates → second quote updates → user is still on Alternative tab at same scroll position.

### VAL-PROG-021: Auto-refresh countdown resets only after all quotes arrive
**Description:** The auto-refresh countdown timer (15s) does not restart until all routers have responded for the current cycle.
**Pass:** Countdown shows "Refreshing..." (or equivalent in-flight state) from the moment auto-refresh fires until the last router responds. Only then does the next 15-second countdown begin.
**Fail:** Countdown restarts after the first quote arrives, causing premature re-fetching.
**Evidence:** Observation of refresh indicator showing in-flight state through both quote arrivals, then countdown restart.

### VAL-PROG-022: Auto-refresh failure with partial success preserves existing quotes
**Description:** If during auto-refresh one router fails and the other succeeds, the existing `keepExistingResultsOnError` logic keeps the previous quotes visible and shows a refresh-failed status.
**Pass:** The successful quote from auto-refresh updates normally. The failed router's quote retains its previous data (not replaced with an error). The refresh error message appears.
**Fail:** The failed router's tab shows an error replacing the previous valid quote, or both quotes are cleared.
**Evidence:** Screenshot showing updated successful quote, preserved previous data for failed router, and refresh error status message.

## 7. Loading States & Transitions

### VAL-PROG-023: Submit button shows "Comparing..." during progressive loading
**Description:** The submit button remains disabled with "Comparing..." text from the moment the user clicks Compare until all routers have responded.
**Pass:** Submit button stays disabled with "Comparing..." throughout the entire progressive loading cycle, then re-enables to "Compare Quotes" after the last response.
**Fail:** Submit button re-enables after the first quote arrives, or the text changes prematurely.
**Evidence:** Two screenshots: (1) submit button disabled during progressive loading, (2) submit button re-enabled after completion.

### VAL-PROG-024: Results area shows immediately on comparison start
**Description:** The results container (`.show` class) becomes visible as soon as the comparison starts, before any quote arrives.
**Pass:** Results area is visible with an initial loading state (e.g., "Querying Spandex + Curve for best price...") immediately after clicking Compare.
**Fail:** Results area remains hidden until the first quote arrives.
**Evidence:** Screenshot of results area visible with loading message before any quote data renders.

### VAL-PROG-025: Tab transition from loading to first quote is smooth
**Description:** When the first quote arrives, the tab content transitions from the loading placeholder to the rendered quote without a visible flash, blank state, or layout jump.
**Pass:** Content replacement is visually smooth — no flash of empty content, no layout shift that causes the page to jump.
**Fail:** Visible blank flash between loading state and rendered quote, or significant layout shift.
**Evidence:** Visual observation or rapid screenshots showing smooth transition.

## 8. Race Conditions & Request Sequencing

### VAL-PROG-026: New comparison cancels in-progress progressive stream
**Description:** If the user starts a new comparison while a previous progressive stream is still delivering quotes, the old stream is discarded and the new one takes over.
**Pass:** Results from the old comparison's pending routers do not render. Only quotes from the new comparison appear. No mixed/interleaved results.
**Fail:** A quote from the old comparison renders after the new comparison has started, causing mixed results.
**Evidence:** Interaction sequence: start comparison A → first quote for A renders → immediately start comparison B → A's second quote arrives → only B's quotes are shown, A's late quote is ignored.

### VAL-PROG-027: Rapid sequential comparisons — only latest renders
**Description:** If the user rapidly submits multiple comparisons (e.g., changing tokens and clicking Compare quickly), only the most recent comparison's results are displayed.
**Pass:** The `compareRequestSequence` mechanism ensures stale responses are discarded. Final state shows only the latest comparison's quotes.
**Fail:** Results from an earlier comparison briefly flash or persist.
**Evidence:** Interaction sequence with 3+ rapid comparisons → final state matches only the last submitted parameters.

### VAL-PROG-028: SSE/stream connection properly closed on navigation or new request
**Description:** When the user starts a new comparison or navigates away, the browser properly closes the SSE/stream connection for the previous request to avoid resource leaks.
**Pass:** Network panel shows the previous EventSource/fetch stream is closed when a new comparison starts. No orphaned connections accumulate.
**Fail:** Multiple open SSE connections or fetch streams accumulate in the network panel.
**Evidence:** Browser network panel showing clean connection lifecycle across multiple comparisons.

## 9. Edge Cases & Boundary Conditions

### VAL-PROG-029: Curve not available for chain — single quote renders without progressive flow
**Description:** When comparing on a chain where Curve is not supported (e.g., Arbitrum), only the Spandex quote is fetched. The UI should render the single quote without showing a loading state for Curve.
**Pass:** Spandex quote renders. No Curve loading indicator is shown. The Curve tab either shows "Curve does not support chain X" immediately or is hidden. No unnecessary delay.
**Fail:** A loading indicator for Curve persists even though Curve was never queried, or the response is artificially delayed.
**Evidence:** Screenshot on a non-Curve chain showing immediate Spandex result with no Curve loading state.

### VAL-PROG-030: Curve disabled via feature flag — single quote progressive behavior
**Description:** When `CURVE_ENABLED=false`, the comparison should behave as a single-router fetch with immediate rendering.
**Pass:** Only the Spandex quote is fetched and rendered. No progressive loading states for Curve appear.
**Fail:** The UI shows Curve loading indicators even when Curve is disabled.
**Evidence:** Screenshot with Curve disabled showing immediate single-quote result.

### VAL-PROG-031: Very slow router — timeout handling during progressive loading
**Description:** If one router is extremely slow (approaching timeout), the other router's quote is still rendered promptly. The slow router eventually times out and its tab shows a timeout error.
**Pass:** The fast router's quote renders within its normal latency. After the timeout period, the slow router's tab transitions from loading to an error message. Total wait time does not exceed the timeout threshold.
**Fail:** The fast router's quote is held back by the slow router, or the slow router's loading indicator persists indefinitely.
**Evidence:** Timing observation: fast quote renders at ~Xms, slow router tab shows timeout error at ~Yms (Y ≈ configured timeout).

### VAL-PROG-032: Network disconnection during progressive loading
**Description:** If the network drops after the first quote arrives but before the second, the first quote remains visible and the second tab transitions to an error state.
**Pass:** First quote remains rendered and functional (swap buttons work). Second tab shows a network error. No data loss for the already-received quote.
**Fail:** The entire results area is cleared, or the first quote is lost.
**Evidence:** Interaction sequence: comparison starts → first quote renders → network drops → second tab shows error → first quote still visible and interactive.

### VAL-PROG-033: Empty/null quote from router handled gracefully
**Description:** If a router returns successfully but with a null/empty quote (no route found), the UI handles this the same as an error — showing the message in that tab while the other quote (if any) displays normally.
**Pass:** The no-route tab shows an appropriate message (e.g., "No quote available"). The other tab renders normally if its quote succeeded.
**Fail:** A null quote causes a rendering error, blank tab, or JavaScript exception.
**Evidence:** Screenshot showing one tab with "No quote available" and the other with a valid quote.

## 10. Mobile & Responsive Behavior

### VAL-PROG-034: Progressive loading at 375px viewport
**Description:** On a 375px-wide mobile viewport, the progressive loading behavior works identically — first quote renders, tabs update, loading indicators are visible and properly sized.
**Pass:** All progressive loading states (initial loading, first quote, second quote, errors) render correctly within the mobile viewport. No horizontal overflow, no cut-off loading indicators.
**Fail:** Loading indicators overflow, tabs are not visible, or progressive behavior is broken on mobile.
**Evidence:** Screenshots at 375px showing: (1) initial loading state, (2) first quote rendered with pending tab, (3) both quotes rendered.

## 11. URL & State Management

### VAL-PROG-035: URL updates only after comparison is fully complete
**Description:** The browser URL (query parameters) should update only after all routers have responded, not after the first quote arrives.
**Pass:** URL parameters remain unchanged while quotes are still loading. Once all quotes arrive, URL updates to reflect the comparison parameters.
**Fail:** URL updates prematurely after the first quote, potentially causing bookmark/share issues with incomplete state.
**Evidence:** Observation of browser URL bar during progressive loading — no change until completion.

### VAL-PROG-036: Page reload during progressive loading — clean restart
**Description:** If the user reloads the page while a progressive comparison is in progress, the page loads cleanly with no stale state. If URL parameters are present, a fresh comparison starts.
**Pass:** Page reloads cleanly. If comparison params exist in URL, a new comparison initiates from scratch. No partial results from the interrupted stream persist.
**Fail:** Stale or partial results appear, or the page is in an inconsistent state after reload.
**Evidence:** Interaction sequence: start comparison → reload during loading → page loads fresh → new comparison starts if URL params present.

## 12. Accessibility & Keyboard Navigation

### VAL-PROG-037: Screen reader announces quote arrivals
**Description:** When a quote arrives during progressive loading, an appropriate ARIA live region or status update announces the new data to screen readers.
**Pass:** An `aria-live` region or equivalent mechanism announces "Spandex quote received" (or similar) when the first quote renders, and "Comparison complete" when all quotes arrive.
**Fail:** No screen reader announcement for progressive state changes — users relying on assistive technology have no feedback.
**Evidence:** Screen reader output log or ARIA live region inspection showing announcements during progressive loading.

### VAL-PROG-038: Keyboard-accessible confirmation modal
**Description:** The swap confirmation modal (VAL-PROG-012) is fully keyboard-accessible — focus is trapped in the modal, Escape dismisses it, Tab cycles through buttons.
**Pass:** Modal traps focus. Tab moves between "Wait" and "Swap Anyway" buttons. Escape closes the modal (equivalent to "Wait"). Enter activates the focused button.
**Fail:** Focus escapes the modal, Escape does not close it, or buttons are not reachable via Tab.
**Evidence:** Keyboard interaction sequence showing focus trap, Tab cycling, and Escape dismissal.
