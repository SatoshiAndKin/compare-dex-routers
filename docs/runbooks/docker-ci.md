# Production image validation and cache trust

CI builds both complete shipped Dockerfiles on every pull request and main push.
This catches lockfile, workspace policy, base image, and build-tool failures even
when the Dockerfiles themselves are unchanged. The Docker matrix belongs to CI,
so the existing Auto Merge workflow cannot proceed until both targets pass.

PR builds use read-only repository permissions, no registry login, no secrets,
and no image or cache export. Checkout does not persist credentials. Only a
push to main exports the image-specific, linux/amd64 BuildKit GHA cache.
CD imports that trusted cache in addition to its existing registry cache and
retains its existing registry publication, tags, release, and deployment behavior.

This is the safe fallback, not direct PR-to-main cache promotion. GHA caches
created at a PR merge ref are unavailable to main. A PR-writable GHCR cache would
require independently enforced, cache-only credentials and writer trust; this
change deliberately does not grant package write access or introduce such secrets.
Forks never get registry credentials or a shared cache writer.

Both image definitions already install the exact packageManager from package.json
without Corepack. Frozen-lockfile installation and the workspace build-script
allowlist remain unchanged. The frontend does not need Git metadata at build time;
.git stays excluded. Revision labels are output metadata rather than dependency
layer inputs. The API SENTRY_RELEASE argument remains after dependency/source layers.

## Validation and measurement

Inspect CI's Docker (api) and Docker (frontend) jobs on the exact PR revision.
No Docker daemon is available in the authoring environment, so CI must verify the
actual builds. Existing repository checks remain enabled.

Compare BuildKit step timings and CACHED lines on a cold build, a main-cache-warmed
PR, and the subsequent CD build. No timing improvement is claimed before those
runs complete. A missing/evicted cache is a performance miss, never permission to
skip a build. Main CI and CD may race on a merge, so an immediately following CD
can miss that main run's cache and still reuse the previous main/registry cache.

Draft PRs are excluded by Auto Merge. CD is triggered only by a merged PR, a v*
tag, or explicit dispatch; opening/updating this draft does not deploy.
