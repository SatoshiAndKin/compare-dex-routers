# Cross-Area User Flows — Tokenlist Management System

All flows that span two or more of the six feature areas:

| # | Feature Area |
|---|---|
| F1 | Settings gear (replaces inline tokenlist URL input) |
| F2 | Multiple tokenlists (add/remove/toggle) |
| F3 | Chain mismatch warning |
| F4 | Autocomplete disambiguation (source list name for duplicate symbols) |
| F5 | Unrecognized address → on-chain lookup → save to local list |
| F6 | Local list export/import |

---

## 1. Custom List + Chain Switch + Mismatch Warning  
**Areas:** F2 × F3  
**Steps:**  
1. User adds a custom tokenlist URL that contains tokens only for Ethereum (chainId 1).  
2. User switches chain selector to Base (chainId 8453).  
3. **Expected:** Chain mismatch warning appears for the custom list (e.g., "List X has 0 tokens for Base").  
4. User adds a second list that *does* have Base tokens.  
5. **Expected:** Warning clears (or shows partial: only the first list still mismatches). Autocomplete now returns Base tokens from the second list.

---

## 2. Save Unrecognized Token → Appears in Autocomplete from "Local Tokens"  
**Areas:** F5 × F4  
**Steps:**  
1. User types an unrecognized 0x address into the "from" field.  
2. On-chain lookup fires, resolves symbol/decimals.  
3. Confirmation popup shows resolved metadata; user clicks "Save".  
4. Token is saved to the "Local Tokens" list in localStorage.  
5. User clears the from field and starts typing the same symbol.  
6. **Expected:** Autocomplete shows the token with source label "Local Tokens".  
7. If the same symbol exists in another loaded list, disambiguation shows both entries with their respective source names.

---

## 3. Export Local List → Clear → Import → Tokens Restored  
**Areas:** F6 × F5 × F4  
**Steps:**  
1. User saves two unrecognized tokens via on-chain lookup (F5).  
2. Autocomplete shows both under "Local Tokens" (F4).  
3. User opens Settings gear → exports local list to JSON file (F6).  
4. User clears/resets local list.  
5. **Expected:** Previously saved tokens no longer appear in autocomplete.  
6. User imports the exported JSON file.  
7. **Expected:** Both tokens reappear in autocomplete under "Local Tokens" with identical metadata.

---

## 4. All Lists Toggled Off → Raw Address → Save → Token Appears  
**Areas:** F2 × F5 × F4  
**Steps:**  
1. User toggles OFF every loaded tokenlist (default + any custom).  
2. User types a partial symbol into from/to field.  
3. **Expected:** Autocomplete shows nothing (no lists enabled).  
4. User enters a full 0x address manually.  
5. On-chain lookup fires, resolves the token.  
6. User saves to local list.  
7. **Expected:** That single token now appears in autocomplete (source: "Local Tokens") even though all other lists are disabled.  
8. **Expected:** The "Local Tokens" list has its own toggle; if it's on (default), the token appears.

---

## 5. Chain Switching with Local Tokens (Chain-Scoped Filtering)  
**Areas:** F5 × F3  
**Steps:**  
1. User is on Ethereum. Saves an unrecognized Ethereum token (chainId 1) to local list.  
2. Token appears in autocomplete for Ethereum.  
3. User switches to Base (chainId 8453).  
4. **Expected:** The Ethereum-only local token does NOT appear in autocomplete.  
5. User switches back to Ethereum.  
6. **Expected:** The local token reappears in autocomplete.

---

## 6. Settings Panel State Preserved Across Page Reload  
**Areas:** F1 × F2  
**Steps:**  
1. User opens Settings gear, adds two custom tokenlist URLs, toggles off the default list.  
2. User reloads the page (F5 key / navigation).  
3. **Expected:** Settings gear reopened shows: both custom URLs still present, default list still toggled off.  
4. **Expected:** Autocomplete only returns tokens from the two custom lists (default is off).  
5. **Expected:** Token counts and any chain mismatch warnings match the pre-reload state.

---

## 7. "From" Address Save → Same Token in "To" Autocomplete  
**Areas:** F5 × F4  
**Steps:**  
1. User types an unrecognized 0x address in the "from" field.  
2. On-chain lookup resolves it; user saves to local list.  
3. User moves to the "to" field and starts typing the same symbol or address.  
4. **Expected:** Autocomplete in the "to" field shows the saved token from "Local Tokens".  
5. **Expected:** User can select it (though swapping from X to X would be flagged by the comparison logic, the autocomplete itself must offer it).

---

## 8. Multiple Lists + Local Tokens + Disambiguation Combined  
**Areas:** F2 × F4 × F5  
**Steps:**  
1. User loads two custom lists that both include a token with symbol "USDC" but different addresses (e.g., bridged USDC vs. native USDC).  
2. User also has a local token saved with symbol "USDC" (a third address).  
3. User types "USDC" in the from field.  
4. **Expected:** Autocomplete shows three entries, each disambiguated:  
   - `USDC` — source: "List A Name" — 0x...aaa  
   - `USDC` — source: "List B Name" — 0x...bbb  
   - `USDC` — source: "Local Tokens" — 0x...ccc  
5. User selects one; the correct address (not just symbol) is used for the quote.

---

## 9. First Visit Experience (No localStorage, Defaults Only)  
**Areas:** F1 × F2 × F4 × F5  
**Steps:**  
1. User visits the app for the first time (clean browser, no localStorage).  
2. **Expected:** Settings gear is present but no custom lists are loaded. Default tokenlist is active and toggled on.  
3. **Expected:** No chain mismatch warning (default list covers the default chain — Ethereum).  
4. **Expected:** Autocomplete works using the default tokenlist tokens.  
5. **Expected:** Local Tokens list exists but is empty; no "Local Tokens" source label appears in autocomplete until user saves one.  
6. **Expected:** From/to fields are pre-filled with chain defaults (USDC → WETH for Ethereum).

---

## 10. Page Reload Preserves: Custom List URLs, Toggle States, Local Tokens  
**Areas:** F1 × F2 × F5 × F6  
**Steps:**  
1. User adds a custom tokenlist URL → confirmed loaded.  
2. User toggles off the default list.  
3. User saves an unrecognized token to local list.  
4. User reloads the page.  
5. **Expected (custom list URLs):** The custom list URL is restored from localStorage, re-fetched, and tokens loaded.  
6. **Expected (toggle states):** Default list remains toggled off after reload.  
7. **Expected (local tokens):** The saved local token still appears in autocomplete under "Local Tokens".  
8. **Expected:** If the custom list fetch fails on reload, a fallback message appears and the app still functions with whatever lists succeed + local tokens.

---

## 11. Chain Mismatch Warning + Multiple Lists + Toggle Interaction  
**Areas:** F2 × F3  
**Steps:**  
1. User is on Ethereum with two custom lists: List A (Ethereum tokens) and List B (Polygon tokens only).  
2. **Expected:** Chain mismatch warning on List B: "List B has 0 tokens for Ethereum".  
3. User toggles off List B.  
4. **Expected:** Warning disappears (toggled-off lists shouldn't show warnings).  
5. User toggles List B back on.  
6. **Expected:** Warning reappears.  
7. User switches chain to Polygon.  
8. **Expected:** Warning moves to List A (no Polygon tokens); List B warning clears.

---

## 12. Remove Custom List While Its Token Is Selected in Form  
**Areas:** F2 × F4  
**Steps:**  
1. User loads a custom list containing token XYZ.  
2. User selects XYZ from autocomplete into the "from" field.  
3. User opens Settings and removes that custom list.  
4. **Expected:** The form field still shows the selected address (already committed to the input). The quote can still be requested since the address is valid.  
5. **Expected:** Autocomplete no longer shows XYZ if user clears and re-types.

---

## 13. Unrecognized Address + Chain Mismatch (Wrong Chain for Address)  
**Areas:** F5 × F3  
**Steps:**  
1. User is on Base (chainId 8453).  
2. User pastes a valid Ethereum-only contract address.  
3. On-chain lookup attempts to resolve the token on Base.  
4. **Expected:** If the address is not a valid ERC-20 on Base, lookup fails with a clear error: "Token not found on Base" (not a misleading chain mismatch warning for a list).  
5. **Expected:** User is not prompted to save a non-existent token.

---

## 14. Export Local List → Switch Chain → Import on Different Chain  
**Areas:** F6 × F3 × F5  
**Steps:**  
1. User is on Ethereum. Saves two local Ethereum tokens. Exports local list.  
2. User switches to Base.  
3. User imports the exported file.  
4. **Expected:** Import succeeds (local list stores tokens with their chainId).  
5. **Expected:** Imported Ethereum tokens do NOT appear in Base autocomplete (filtered by chainId).  
6. User switches back to Ethereum.  
7. **Expected:** All imported tokens appear correctly.

---

## 15. Settings Gear Interaction While Autocomplete Is Open  
**Areas:** F1 × F4  
**Steps:**  
1. User starts typing in the "from" field; autocomplete dropdown is open.  
2. User clicks the Settings gear.  
3. **Expected:** Autocomplete closes. Settings panel opens.  
4. User changes list configuration (adds/removes/toggles a list).  
5. User closes Settings panel.  
6. **Expected:** If the from field still has text, and the user focuses it, autocomplete re-fires with the updated token pool.

---

## 16. Duplicate Symbol Across Local + Remote After Import  
**Areas:** F4 × F5 × F6  
**Steps:**  
1. User has a loaded remote list with "PEPE" token.  
2. User imports a local list file that also contains a different "PEPE" token (different address).  
3. User types "PEPE" in the from field.  
4. **Expected:** Autocomplete shows two entries, disambiguated by source:  
   - `PEPE` — source: "Remote List Name" — 0x...aaa  
   - `PEPE` — source: "Local Tokens" — 0x...bbb  

---

## 17. Toggle Off Local Tokens List  
**Areas:** F2 × F5 × F4  
**Steps:**  
1. User saves an unrecognized token to local list.  
2. Token appears in autocomplete.  
3. User opens Settings and toggles off "Local Tokens".  
4. **Expected:** Token no longer appears in autocomplete.  
5. User toggles "Local Tokens" back on.  
6. **Expected:** Token reappears.

---

## 18. URL Bookmark with Token from Removed List  
**Areas:** F2 × F4  
**Steps:**  
1. User loads a custom list, selects a token, runs a comparison. URL updates with the token address.  
2. User bookmarks the URL.  
3. Later, user opens the bookmark (custom list no longer configured in localStorage).  
4. **Expected:** The from/to addresses load from URL params. The app attempts to display them.  
5. **Expected:** Since the custom list isn't loaded, the token shows as raw address (no symbol resolution) until/unless the user adds the list back.  
6. **Expected:** The quote still works (addresses are valid) even without symbol resolution.

---

## 19. Multiple Saves from Unrecognized Addresses → Bulk in Local List  
**Areas:** F5 × F6 × F4  
**Steps:**  
1. User saves 5 different unrecognized tokens via on-chain lookup.  
2. All 5 appear in autocomplete under "Local Tokens".  
3. User exports local list → file contains all 5 tokens.  
4. User clears local list and imports the file.  
5. **Expected:** All 5 tokens restored, appear in autocomplete with correct metadata.

---

## 20. Settings Panel Shows Correct Token Counts Per Chain  
**Areas:** F1 × F2 × F3  
**Steps:**  
1. User is on Ethereum. Settings shows token count per list for the current chain.  
2. User switches to Base.  
3. **Expected:** Settings updates to show token counts for Base (might be 0 for Ethereum-only lists, triggering chain mismatch indicator).  
4. User adds a Base-specific tokenlist.  
5. **Expected:** New list shows non-zero count for Base; chain mismatch warning clears for that list.

---

## 21. On-Chain Lookup While Settings Panel Is Open  
**Areas:** F1 × F5  
**Steps:**  
1. User opens Settings gear.  
2. User enters an unrecognized address in the from/to field (if fields are still accessible with settings open, e.g., settings is a sidebar/modal that doesn't block form).  
3. On-chain lookup fires.  
4. **Expected:** Save confirmation appears correctly (not obscured by settings panel).  
5. User saves token; "Local Tokens" count in Settings panel updates in real-time.  
   - OR if Settings is a blocking modal: user must close it first, the flow is sequential, and the local list count updates when Settings is reopened.

---

## 22. Import Malformed File → Graceful Error → Prior State Intact  
**Areas:** F6 × F2 × F5  
**Steps:**  
1. User has a custom list loaded and 2 local tokens saved.  
2. User attempts to import a malformed/invalid JSON file.  
3. **Expected:** Clear error message ("Invalid token list format" or similar).  
4. **Expected:** Custom list and existing local tokens are unaffected. Autocomplete still works with pre-import data.

---

## 23. Chain Switch During Active Comparison with Local Token  
**Areas:** F5 × F3  
**Steps:**  
1. User is on Ethereum. Selects a local-saved Ethereum token in "from". Runs comparison. Auto-refresh is active.  
2. User switches chain to Arbitrum.  
3. **Expected:** Auto-refresh stops. Results clear. From/to fields reset to Arbitrum defaults.  
4. **Expected:** The Ethereum local token is NOT offered in autocomplete for Arbitrum.

---

## 24. Settings Persist Through Failed Custom List Fetch  
**Areas:** F1 × F2  
**Steps:**  
1. User adds two custom lists: one valid, one URL that will fail (e.g., 404).  
2. Valid list loads; failed list shows error message per-list.  
3. User reloads the page.  
4. **Expected:** Both URLs are restored from localStorage. Valid one re-fetches successfully. Failed one re-attempts and shows error again.  
5. **Expected:** The rest of the app (default list, local tokens) still works.

---

## 25. Disambiguation With Toggled-Off List  
**Areas:** F2 × F4  
**Steps:**  
1. Two lists both have "DAI". List A is on, List B is toggled off.  
2. User types "DAI".  
3. **Expected:** Only List A's DAI appears (no disambiguation needed since only one source active).  
4. User toggles List B on.  
5. **Expected:** Both DAI entries now appear, disambiguated by source name.
