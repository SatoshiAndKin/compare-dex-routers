# Quick Fixes Milestone — Scrutiny Notes

- Default tokenlist configuration now uses `DEFAULT_TOKENLISTS` (comma-separated) and falls back to `static/tokenlist.json` when unset.
- `TOKENLIST_PATH` is deprecated/replaced by `DEFAULT_TOKENLISTS`.
- The default tokenlist is expected in `static/tokenlist.json` (committed). `.factory/init.sh` only fetches a fallback list when needed.
- `/quote` and `/compare` now accept `mode` with `exactIn` (default) and `targetOut`.
- Curve reverse-quote integration uses `curve.router.required(...)` (not `swapRequired(...)`).
