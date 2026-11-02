# Production deployment

GitHub builds and publishes both images before requesting deployment through Tank.
Each image has a `sha-<full-commit>` tag and an OCI revision label. Tank checks the
merged commit, resolves both Linux amd64 image digests, and rejects a mismatch
before changing the private K3s Helm release.

The existing authenticated `/hooks/deploy` request keeps its `repository`, `commit`,
and `targets` fields. GitHub has no Kubernetes administration credentials.
The private Dockerfiles repository owns Helm configuration, routing, secrets,
namespace-scoped deployment access, and infrastructure promotion.

A successful GitHub deploy job confirms queue storage. Confirm completion through
Tank's `/opt/deploy-webhooks/queue/results/<receipt-id>.json`, its
`worker/compare-dex-routers.json` release record, running image revisions, and real
application checks. Worker logs use `journalctl -u deploy-webhooks-worker.service`.

To build and request deployment again, dispatch CD on main:

```sh
gh workflow run cd.yml --repo SatoshiAndKin/compare-dex-routers --ref main
```

Automatic merges explicitly dispatch CD because `GITHUB_TOKEN` suppresses merge
events. Human merges trigger CD through the pull-request event. Existing checks
and this trigger behavior remain unchanged.

## Runtime behavior

The API and frontend each have two replicas on separate physical hosts. The API
keeps its 2 CPU / 512 MiB cap; the frontend keeps its 0.5 CPU / 128 MiB cap.
Rolling replacement allows one additional pod and waits for readiness before
removing an old pod. CPU and memory requests also reserve scheduler capacity.

The API pre-stop hook waits five seconds for Kubernetes endpoint removal before
SIGTERM. It creates no marker in the pod-scoped `/tmp` volume, which survives
container restarts. The existing shutdown handler drains requests, closes connections,
and flushes telemetry within the 45-second pod termination period. nginx uses SIGQUIT.
Kubernetes readiness replaces Docker health checks for production routing.

The production URL is `https://compare-dex-routers.shorthair-fir.ts.net/`, with
the API under `/api` on the same origin. Connect to Tailscale before checking it.
The former `https://ski-nuc-3.shorthair-fir.ts.net:8443/` URL is retired.
Traefik binds only host loopback on NUC3 and Lambo. Application pods use
the pod network and ClusterIP Services; no public Kubernetes listener is installed.

A failed update restores the previous Helm revision, checks recovery, and reports
the attempted deployment as failed. The infrastructure controller provides manual
status and rollback operations. Original Docker containers and Compose files stay
available for a platform rollback; Docker rollout is no longer an active
production deployment command. Compose-based tests still check local container
shutdown behavior and do not prove Kubernetes deployment acceptance.
