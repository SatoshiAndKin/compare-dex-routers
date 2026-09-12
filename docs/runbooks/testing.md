# Validation and local fork trades

Use Node 24.21.0, pnpm 12.3.1, and Bun 1.4.0. Install dependencies with
`pnpm install --frozen-lockfile`.

## Repository checks

Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm test`,
`pnpm run dead-code`, `pnpm run duplicates`, and `pnpm run dead-flags`.
`pnpm run verify:cdn` compares Swagger's pinned npm archive, CDN bytes, and
committed SHA-384 hashes. It checks both CSS and JavaScript.

## Browser checks

Install the browsers once with `pnpm exec playwright install chromium webkit`.
Run `pnpm run test:e2e`. The command builds the frontend, starts isolated API and
preview listeners at ports 3120 and 5180, and tests desktop Chromium and mobile WebKit.
It checks both themes, settings and keyboard focus, Farcaster SDK loading, wallet
rejection, account/chain changes, failed receipts, Swagger base paths, and actual
browser rejection of altered CDN JavaScript. Screenshots and traces go to
`test-results/`; the HTML report goes to `playwright-report/`.

## Local fork trades

Install Foundry's Anvil, then run `pnpm run test:fork` from the repo root.
The command starts its own loopback-only Anvil nodes and stops them on completion.
It funds Anvil's disposable development account on each fork. It does not use a
personal signing key. Browser transactions use the production EIP-1193 wallet path.

Ethereum uses `https://ski-lambo-1.shorthair-fir.ts.net:18544`. This node now requires
HTTPS; its former HTTP URL returns HTTP 400. Override the source with
`FORK_RPC_URL_1` when needed. Base uses `FORK_RPC_URL_8453`, then `RPC_URL_8453`,
then the existing `ALCHEMY_API_KEY` from `.env`. Keep these credentials out of reports.

Each run captures a block before starting each fork and explicitly pins Anvil to
that block. `test-results/fork-manifest.json` records the block number, hash, and
Anvil version. For replay, set `FORK_BLOCK_1` and `FORK_BLOCK_8453` to the recorded
numbers. The RPC sources must retain state for those blocks.

Tests cover ERC-20 approval and native-input swaps on Ethereum and Base. They check
on-chain receipts, allowance, exact ERC-20 input spending, and minimum output balances.
The UI must also show the updated balances after confirmation. Each test resets
its fork state. Quote services remain live dependencies; a missing
required route fails the test. The fork suite runs locally, not in GitHub CI.

## Local production rollout

Install Docker Compose and `docker-rollout`. Start the isolated fixture with:

```sh
docker compose --project-name cdr-rollout-test --env-file /dev/null -f e2e/compose.rollout.yml up -d --build --wait
pnpm run test:rollout
docker compose --project-name cdr-rollout-test --env-file /dev/null -f e2e/compose.rollout.yml down
```

The fixture extends the production service settings. It uses its own network and
Traefik listener at `http://localhost:5190`. The test replaces both services while
sending requests, fails on any non-200 response, and checks container replacement,
health, restart counts, CPU caps, and nginx's stop signal.

## Dependency audit limits

`pnpm audit --audit-level=high` gates CI. Axios uses the patched 1.18.0 release.
Farcaster's Solana dependency still brings Jayson 4.3.0 with two moderate advisories:

- [uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq): the affected
  functions are v3/v5/v6. Jayson's browser client calls v4.
- [stream-json nested filters](https://github.com/advisories/GHSA-528h-pc64-c93x):
  Jayson's Node stream parser is outside the browser entry used here. The API
  production image does not install the Farcaster SDK.

The current parent releases retain these versions. Track their upstream updates;
do not force a major stream-json replacement with a different module contract.

The 2026-09-12 local run passed all four fork trades at Ethereum block 25963441
and Base block 51226066. See [fork evidence](../fork-validation.json) for the local
transaction hashes and measured balances. These hashes exist only on the disposable
forks. The same validation passed 611 unit tests, 20 desktop/mobile browser tests,
and 874 HTTP requests through the isolated rolling replacement with zero failures.
