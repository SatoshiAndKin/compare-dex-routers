# Readiness report: compare-dex-routers

Run context: SKI-57, using the `ski-readiness-report` skill.

## Ecosystems detected

- pnpm (Node.js workspace)

Project roots:

- `.` (root pnpm workspace)

## Method

- Ran the skill's read-only `readiness_probe.py` against the repo root.
- Cross-checked the probe output against `checklists.md`.
- Checked nested workspace manifests for non-registry dependencies.
- Checked GitHub repository settings and the active branch ruleset with `gh api`.

## Findings

| Category        | Check                             | Status         | Evidence                                                                                                                                                                               |
| --------------- | --------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package_manager | pnpm package manager              | pass           | `package.json` pins `packageManager: pnpm@11.1.1`.                                                                                                                                     |
| supply_chain    | pnpm lockfile                     | pass           | `pnpm-lock.yaml` exists.                                                                                                                                                               |
| supply_chain    | conflicting lockfiles             | pass           | No `package-lock.json` or `yarn.lock` found.                                                                                                                                           |
| supply_chain    | 7-day package age gate            | pass           | `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080`.                                                                                                                                 |
| supply_chain    | strict package age gate           | fail           | `pnpm-workspace.yaml` sets `minimumReleaseAgeStrict: false`; the checklist expects strict mode not to be disabled.                                                                     |
| supply_chain    | block exotic subdeps              | pass           | `pnpm-workspace.yaml` sets `blockExoticSubdeps: true`.                                                                                                                                 |
| supply_chain    | strict dependency builds          | pass           | `pnpm-workspace.yaml` sets `strictDepBuilds: true` with explicit `allowBuilds` entries.                                                                                                |
| supply_chain    | direct non-registry dependency    | warn           | `packages/api/package.json` depends on `@spandex/core` from `github:SatoshiAndKin/spandex#07b1dea&path:/packages/core`; pnpm package-age gates do not protect direct Git dependencies. |
| ci              | frozen install                    | pass           | `.github/workflows/ci.yml` uses `pnpm install --frozen-lockfile` in both CI and security jobs.                                                                                         |
| validation      | test scripts                      | pass           | Root and workspace `test` scripts run Vitest, not placeholders.                                                                                                                        |
| agent_context   | AGENTS.md                         | pass           | `AGENTS.md` exists and contains repo-specific setup, validation, API, deployment, and conventions.                                                                                     |
| agent_context   | task runner                       | pass           | `Justfile` includes `validate`, update, and deploy recipes.                                                                                                                            |
| agent_context   | README                            | pass           | `README.md` describes the app, endpoints, environment variables, development, and deployment.                                                                                          |
| agent_context   | docs match package manager        | warn           | `README.md`, `AGENTS.md`, `.github/pull_request_template.md`, `.devcontainer/devcontainer.json`, and `.factory/services.yaml` still teach npm commands in a pnpm repo.                 |
| operational     | GitHub Actions dependency updates | warn           | `.github/dependabot.yml` updates npm dependencies but has no `github-actions` ecosystem entry.                                                                                         |
| operational     | release automation                | not_applicable | No release automation detected; this is an app/prototype rather than a release-oriented library or CLI.                                                                                |
| operational     | env docs                          | pass           | `env.example` exists and the README documents environment variables.                                                                                                                   |
| operational     | deploy docs                       | pass           | Docker, Compose, Traefik, and deploy paths are documented in README, AGENTS, Justfile, and deployment files.                                                                           |
| github          | auto-merge                        | pass           | GitHub repo setting `allow_auto_merge` is true.                                                                                                                                        |
| github          | delete branch on merge            | pass           | GitHub repo setting `delete_branch_on_merge` is true.                                                                                                                                  |
| github          | update branch                     | pass           | GitHub repo setting `allow_update_branch` is true.                                                                                                                                     |
| github          | required status checks            | warn           | Active ruleset `Protect main` requires `check`, `validate-docs`, and `security`, but `strict_required_status_checks_policy` is false.                                                  |
| github          | no reviewer gates                 | pass           | Active ruleset has `required_approving_review_count: 0`, no required reviewers, no code-owner review requirement, and no last-push approval requirement.                               |

## Highest-impact fixes

1. Re-enable strict package-age gating by removing `minimumReleaseAgeStrict: false` or setting it to `true` in `pnpm-workspace.yaml`.
2. Replace npm commands with pnpm commands in primary docs and repo helper configs.
3. Add a Dependabot `github-actions` update entry for `.github/workflows`.
4. Review the direct Git dependency on `@spandex/core`; publish/use a registry package where possible, or document the pinned Git exception explicitly.
5. Enable strict required status checks in the active `Protect main` ruleset.

## Fix spec

### Supply Chain

- **[FAIL] pnpm-minimum-release-age-strict**: `minimumReleaseAgeStrict: false` disables the strict behavior expected by the checklist.
  - Fix: Remove the setting or set `minimumReleaseAgeStrict: true` in `pnpm-workspace.yaml`.
- **[WARN] pnpm-exotic-deps**: `packages/api/package.json` uses `@spandex/core` from GitHub.
  - Fix: Prefer a registry-published package covered by pnpm's package-age gate. If the Git dependency is intentional, pin it to an audited commit and document the exception.

### Agent Context

- **[WARN] pnpm-docs-drift**: README, AGENTS, pull request template, devcontainer setup, and Factory service config still use npm commands.
  - Fix: Replace npm commands with pnpm equivalents, for example `pnpm install --frozen-lockfile`, `pnpm run dev`, `pnpm test`, and `pnpm --filter <workspace> ...`.

### Operational

- **[WARN] github-actions-updates**: Dependabot does not update GitHub Actions.
  - Fix: Add a second `.github/dependabot.yml` update block:

```yaml
- package-ecosystem: github-actions
  directory: /
  schedule:
    interval: weekly
```

### GitHub

- **[WARN] github-strict-status-checks**: The active `Protect main` ruleset requires CI checks but does not require branches to be up to date before merge.
  - Fix: Set `strict_required_status_checks_policy` to true for the ruleset's required status checks.

## Reminder

Do not add PR approval gates or reviewer requirements. GitHub blocks self-approval for solo developers.
