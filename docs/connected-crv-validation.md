# Connected CRV simulation and compact trade layout

Validated on 2026-09-26 for Ethereum, selling 4161.636507410085088097 CRV
(`0xD533a949740bb3306d119CC777fa900bA034cd52`) for crvUSD
(`0xf939e0a03fb07f59a73314e73794be0e57ac1b4e`) with 3 bps slippage.
ENS resolved `holders1.eth` to `0x5668EAd1eDB8E2a4d724C8fb9cB5fFEabEB422dc`.

The live connected response failed the CRV approval for Curve and Nordstern at
simulation block 26063670. At block 26063671 the account held the exact input
balance, 4161636507410085088097 base units, and its Curve router allowance was
115792089237316195423570985008687907853269984665640564027939715900178855004311.
The Curve router was `0x45312ea0eff7e09c83cbe249fa1d7598c4c8cd4e`.

A controlled `eth_simulateV1` reproduction based on block 26063670 (simulated
block 26063671) showed `approve(router, inputAmount)` reverting with empty return
data. `approve(router, 0)` followed by that same approval succeeded. This is a
nonzero-to-nonzero allowance restriction, not an insufficient CRV balance.

[Spandex PR #6](https://github.com/SatoshiAndKin/spandex/pull/6) resets allowance
inside simulation before approving the input, for both same-chain and cross-chain
quotes. It preserves provider approval metadata, skips approvals for native input,
and counts both approval calls separately from swap gas. It does not alter actual
wallet approvals. The app pins the tested SDK commit and its build allowlist.

With the new SDK, the app's real `quoteRoutes` path returned successful connected
quotes from KyberSwap, Nordstern, Velora, Curve, Relay, and LiFi for the same trade,
with no provider failures. This is read-only price-simulation evidence: no wallet
transaction was submitted, and real balance, allowance, gas, and identity checks
still guard approval and swap execution. Future quotes remain subject to market
movement and the user's 3 bps slippage limit.

The UI retains the precise quote strings in adjacent input/output fields, reserves
space for metadata and status updates, and retains quotes while refreshing. Browser
regressions measure document-relative geometry during delayed metadata and quote
responses on desktop Chromium and mobile WebKit.
