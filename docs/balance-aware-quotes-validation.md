# Balance-aware quote validation — 2026-09-26

Quote comparisons omit `sender` when the current sell-token balance is insufficient
or unknown. Exact Output starts with previews and automatically requests wallet
quotes when a preview is affordable. Wallet simulation failures retain prices;
same-cycle previews survive wallet quote-generation failures. Only successful
wallet simulations expose execution data, and actual wallet checks still gate
transactions. The Spandex pin and its native funding behavior are unchanged.

## Automated checks

Validation uses Node 24.21.0, pnpm 12.5.1, and Bun 1.4.2.

- 224 API and 474 frontend tests pass, including exact balance boundaries,
  account-scoped balance snapshots, preview/wallet request counts, obsolete
  responses, failed simulation retention, raw and approval-aware ranking, and
  selected-provider retention after failed verification.
- API statement coverage: 92.20%; frontend statement coverage: 82.92%.
- 52 desktop Chromium/mobile WebKit browser tests pass. They cover retained card
  geometry, expanded providers, funding changes, automatic Exact Output wallet
  passes, slow balance reads, approval/swap workflows, and blocked previews.
- Seven real-SDK Anvil fork tests pass, including ERC-20 approvals and native swaps
  on Ethereum and Base, sender-free previews, and unfunded USDC prices with no
  transaction submission. Transactions use disposable accounts on local forks.
- Typecheck, lint, formatting, dead code, duplicate-code threshold, dead flags,
  and CDN integrity checks pass. Dependency audit has no high/critical findings;
  the existing two moderate findings remain.

The fork run used the documented Ethereum HTTPS RPC through `FORK_RPC_URL_1`;
the local `.env` HTTP endpoint was unreachable. No environment file was changed.
Pinned blocks:

| Chain    | Block    | Block hash                                                           |
| -------- | -------- | -------------------------------------------------------------------- |
| Ethereum | 26065286 | `0x05ec02b5d76974d0efeea37761dd3e58c1b5a398f2bbb2b6d52191e4287334d0` |
| Base     | 51840238 | `0x4895f649d71ac7dee3004948ef6256a6325689154e7c8f8be981c1cbc77d0712` |

The fork tests exposed a balance-fetch effect depending on the state it updated.
The final implementation tracks wallet/trade inputs and runs the balance fetch
untracked; a delayed-balance browser regression verifies reads settle without
restarting themselves.

One fork run encountered a transient KyberSwap Base native-route revert. Its price
was retained with `failed` simulation and null execution; the next provider quote
simulated successfully. The failed trace was inspected before repeating the run.

## Original OUSD regression

Read-only live-provider validation used Ethereum Exact Input,
`375.772178271914396231` OUSD, and `10` basis points slippage:

- OUSD: `0x2A8e1E676Ec238d8A992307B495b45B3fEAa5e86`
- crvUSD: `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E`
- `holders1.eth` resolved to `0x5668EAd1eDB8E2a4d724C8fb9cB5fFEabEB422dc`.

Without a sender, KyberSwap, Curve, Velora, Relay, and LiFi supplied unverified
prices with null sender/execution; KyberSwap had the best raw output. With the
resolved sender, those five providers simulated successfully and Curve was
recommended after costs. Nordstern returned a quote-generation failure in both
requests. No production wallet transaction was signed or submitted.

This records local validation. CI and production rollout are verified separately
against the delivered revision, including Tank's final receipt, running API and
frontend image labels, health, restart counts, and the public health endpoint.
