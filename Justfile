validate:
    pnpm install --frozen-lockfile
    pnpm run typecheck
    pnpm run lint
    pnpm run format:check
    pnpm test
    pnpm run dead-code
    pnpm run duplicates
    pnpm run dead-flags
    docker compose build

dev-update:
    pnpm update --recursive

dev-update-incompatible:
    pnpm update --recursive --latest

