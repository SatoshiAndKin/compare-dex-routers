# Quick Fixes Milestone — Scrutiny Notes

- Default tokenlist configuration now uses `DEFAULT_TOKENLISTS` (comma-separated) and falls back to `static/tokenlist.json` when unset.
- `TOKENLIST_PATH` is deprecated/replaced by `DEFAULT_TOKENLISTS`.
- The default tokenlist is expected in `static/tokenlist.json` (committed). `.factory/init.sh` only fetches a fallback list when needed.
- `/quote` and `/compare` now accept `mode` with `exactIn` (default) and `targetOut`.
- Curve reverse-quote integration uses `curve.router.required(...)` (not `swapRequired(...)`).
- Comparison semantics are mode-dependent: `exactIn` prefers higher output (or higher gas-adjusted net value), while `targetOut` prefers lower required input (or lower gas-adjusted total cost = input value in ETH + gas cost in ETH).
- The searchable chain control (`#chainId`) is a text input whose `.value` is display text (e.g., `Base (8453)`), not a raw numeric ID; read the active chain via `getCurrentChainId()` (or `dataset.chainId`) when filtering chain-scoped token data.
