# Validation Assertions: Wallet, Token Management & Modals

## Wallet Connection

### VAL-WALLET-001: EIP-6963 provider discovery
On page load, injected wallet providers are discovered via EIP-6963 events and listed in the wallet provider modal.
Evidence: Open provider modal → each detected wallet shows icon + name in `walletProviderList`.

### VAL-WALLET-002: Connect via provider modal
Clicking a provider in the modal triggers `eth_requestAccounts`, displays connected address/icon, hides "Connect Wallet" button, shows disconnect button.
Evidence: `walletConnected` element visible with address; `connectWalletBtn` hidden.

### VAL-WALLET-003: Disconnect wallet
Clicking disconnect clears provider state, hides connected-wallet UI, re-shows "Connect Wallet" button, clears balances.
Evidence: `disconnectWalletBtn` click → `walletConnected` hidden, `connectWalletBtn` visible.

### VAL-WALLET-004: WalletConnect fallback
If no injected providers found (`walletProviderNoWallet` visible), WalletConnect option is available using `WALLETCONNECT_PROJECT_ID`.
Evidence: Provider modal shows WalletConnect entry when no EIP-6963 providers detected.

### VAL-WALLET-005: Chain switching on connect
After connecting, if wallet chain differs from selected `chainId`, `wallet_switchEthereumChain` is called with correct hex chain ID from `CHAIN_ID_HEX_MAP`.
Evidence: Connect wallet on wrong chain → chain switch prompt appears.

### VAL-WALLET-006: Pending post-connect action (approve)
If user clicks Approve without wallet, pending action `{type:"approve"}` is stored; after connect, approve executes automatically.
Evidence: Click Approve → provider modal opens → connect → approve tx fires without re-clicking.

### VAL-WALLET-007: Pending post-connect action (swap)
Same as VAL-WALLET-006 but for swap action; after connect the swap confirmation modal opens automatically.
Evidence: Click Swap → connect wallet → swap confirmation modal appears.

## Balances

### VAL-BAL-001: Balances shown when wallet connected
With wallet connected, from/to token balance elements display formatted balances fetched via `eth_call`.
Evidence: `fromBalanceEl` and `toBalanceEl` show non-empty values with decimals.

### VAL-BAL-002: Balances hidden without wallet
Without wallet connection, balance elements are empty or hidden.
Evidence: No wallet → `fromBalanceEl`/`toBalanceEl` empty.

### VAL-BAL-003: Balance cache TTL
Repeated balance lookups within cache TTL return cached values (no duplicate RPC calls).
Evidence: Two rapid balance requests → only one `eth_call` observed in network tab.

## Transactions

### VAL-TX-001: Approve sends correct calldata
Approve button encodes ERC-20 `approve(spender, MAX_UINT256_HEX)` calldata and sends via `eth_sendTransaction`.
Evidence: Approve click → tx sent with correct `approve` function selector and max allowance.

### VAL-TX-002: Swap confirmation modal required
Clicking Swap opens `openSwapConfirmModal` before executing; user must confirm.
Evidence: Swap button → confirmation modal appears; tx only sent after confirm.

### VAL-TX-003: Transaction status display
After tx submission, receipt polling updates status on the quote card (pending → confirmed/failed).
Evidence: After approve/swap tx, card shows tx hash and status indicator.

### VAL-TX-004: Auto-refresh paused during transaction
`pauseAutoRefreshForTransaction` called before tx; `resumeAutoRefreshAfterTransaction` called after completion.
Evidence: During pending tx, auto-refresh timer does not fire new comparisons.

## Token Lists

### VAL-TLIST-001: Add custom tokenlist by URL
Entering an HTTPS URL in `tokenlistUrlInput` and clicking Add fetches the list, adds it to `tokenlistSourcesList`.
Evidence: Valid tokenlist URL → new entry appears in sources list with token count.

### VAL-TLIST-002: Validate tokenlist URL (non-HTTPS rejected)
Non-HTTPS URLs are rejected with error message in `tokenlistMessage`.
Evidence: Enter `http://...` → error message shown; list not added.

### VAL-TLIST-003: Toggle tokenlist on/off
Each tokenlist source has a toggle; disabling removes its tokens from autocomplete.
Evidence: Toggle off a list → its tokens no longer appear in autocomplete dropdown.

### VAL-TLIST-004: Remove custom tokenlist
Removing a custom list removes it from sources and its tokens from autocomplete; persisted on reload.
Evidence: Remove list → gone from settings; reload → still gone.

### VAL-TLIST-005: Tokenlist state persists across reload
Added tokenlists are stored in localStorage (`STORAGE_KEYS`) and restored on page load.
Evidence: Add list → reload → list still present in settings.

## Custom Tokens

### VAL-CUSTOM-001: Add token by address (unrecognized token modal)
Pasting an unknown contract address in from/to triggers unrecognized token modal showing name/symbol/decimals after on-chain lookup.
Evidence: Paste unknown 0x address → modal loads metadata → Save adds to local tokens.

### VAL-CUSTOM-002: Remove local custom token
Custom tokens can be removed from the local tokens section in settings.
Evidence: Remove token → disappears from local tokens list and autocomplete.

### VAL-CUSTOM-003: Local tokens persist across reload
Saved custom tokens stored in localStorage and restored on page load.
Evidence: Add custom token → reload → token still in local list and autocomplete.

### VAL-CUSTOM-004: Non-ERC20 address shows error
If pasted address is not an ERC-20 contract, `unrecognizedTokenError` displays an error; Save button disabled.
Evidence: Paste EOA address → error shown in modal; no token saved.

## Autocomplete

### VAL-AUTO-001: Search filters tokens by symbol/name
Typing in from/to input filters autocomplete dropdown to matching tokens.
Evidence: Type "USDC" → dropdown shows only USDC variants.

### VAL-AUTO-002: Deduplication across sources
Tokens appearing in multiple lists are deduplicated in autocomplete results (same address+chainId shown once).
Evidence: Token in default + custom list → appears once in dropdown.

### VAL-AUTO-003: Keyboard navigation
Arrow keys navigate autocomplete items; Enter selects highlighted item.
Evidence: Type query → ArrowDown → Enter → token selected and input populated.

## Settings Modal

### VAL-SETTINGS-001: Open/close settings modal
Gear icon opens settings modal; close button or Escape dismisses it.
Evidence: Click gear → modal visible; press Escape → modal hidden.

### VAL-SETTINGS-002: Body scroll locked while modal open
Opening any modal calls `lockBodyScroll` (sets `overflow:hidden`); closing calls `unlockBodyScroll`.
Evidence: Open modal → page not scrollable; close → scrollable again.

## MEV Protection Modal

### VAL-MEV-001: MEV modal shows on Ethereum
MEV protection modal/toggle available when chain is Ethereum (`ETHEREUM_CHAIN_ID`).
Evidence: Select Ethereum → MEV protection option visible.

### VAL-MEV-002: MEV unavailable on non-Ethereum chains
For BSC, Base, Arbitrum, etc., MEV protection option is hidden or disabled with explanation.
Evidence: Select Base → MEV toggle not shown or shows "not available on this chain".

### VAL-MEV-003: MEV uses Flashbots RPC
When MEV protection enabled on Ethereum, transactions route through `FLASHBOTS_RPC_URL`.
Evidence: Enable MEV → approve/swap tx uses Flashbots RPC endpoint.
