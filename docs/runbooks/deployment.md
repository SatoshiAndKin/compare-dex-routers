# Production deployment

GitHub builds and publishes both images before sending an authenticated
`/hooks/deploy` request with `repository`, `commit`, and `targets`. Each image has
a `sha-<full-commit>` tag and an OCI revision label. The Kubernetes delivery
controller checks the merged commit, resolves both Linux amd64 image digests,
and rejects a mismatch before changing the private K3s Helm release.

GitHub has no Kubernetes administration credentials. The private Dockerfiles
repository owns Helm configuration, routing, secrets, namespace-scoped
deployment access, and infrastructure promotion.

## Verify a deployment

Open the GitHub Actions CD run for the expected commit. In the `deploy` job,
copy the `id` from the JSON response with `status: queued`. Use a production
K3s context with permission to read pods and access the controller. The active
queue is mounted in `deployment/controller` in the `platform-delivery`
namespace. Tank's local queue is an archive.

Read the terminal receipt. Check that `request.commit` matches the expected
commit, `status` is `succeeded`, and `exit_code` is `0`.

```sh
receipt_id=REPLACE_WITH_RECEIPT_ID
kubectl -n platform-delivery exec deployment/controller -c controller -- \
  cat "/opt/deploy-webhooks/queue/results/${receipt_id}.json"
```

If the result is missing, check `queue/pending` in the same mount and the
controller logs. If the receipt reports failure, use its `log_path` to locate
the job log in the controller.

```sh
kubectl -n platform-delivery logs deployment/controller -c controller --since=1h
```

Read the current release record and check that both containers are Ready and
their running image digests match `images.api` and `images.frontend` in the
record. Check `revision` against the expected commit. If a newer release is
active, record its revision and digests separately from the receipt for the
requested deployment.

```sh
kubectl -n platform-delivery exec deployment/controller -c controller -- \
  cat /opt/deploy-webhooks/worker/compare-dex-routers.json
kubectl -n compare-dex-routers get pods -o \
  'custom-columns=POD:.metadata.name,CONTAINERS:.status.containerStatuses[*].name,READY:.status.containerStatuses[*].ready,RESTARTS:.status.containerStatuses[*].restartCount,IMAGE:.status.containerStatuses[*].imageID'
```

From a client connected to Tailscale, check the homepage, `/api/health`, and
`/api/chains`. Check the application behavior affected by the release.

## Request a new deployment

To build and request deployment again, dispatch CD on main:

```sh
gh workflow run cd.yml --repo SatoshiAndKin/compare-dex-routers --ref main
```

Automatic merges explicitly dispatch CD because `GITHUB_TOKEN` suppresses merge
events. Human merges trigger CD through the pull-request event. Existing checks
and this trigger behavior remain unchanged.

## Runtime behavior

The API and frontend each run one replica. The API keeps its 2 CPU / 512 MiB cap;
the frontend keeps its 0.5 CPU / 128 MiB cap.
Rolling replacement allows one additional pod and waits for readiness before
removing an old pod. CPU and memory requests also reserve scheduler capacity.

The API pre-stop hook waits five seconds for Kubernetes endpoint removal before
SIGTERM. It creates no marker in the pod-scoped `/tmp` volume, which survives
container restarts. The existing shutdown handler drains requests, closes connections,
and flushes telemetry within the 45-second pod termination period. nginx uses SIGQUIT.
Kubernetes readiness replaces Docker health checks for production routing.

Set `FLASHPROFITS_BASE_URL` on the API to enable Flashprofits Electric and
Direct for Ethereum. Production uses the private ClusterIP hostname. Verify
Flashprofits `/ready`, a quote from the CDR API pod, and both provider results
through CDR `/api/quote` before rollout acceptance. Unset the URL to disable
both providers. After the verified Ethereum interpreter is live, an ordinary
wallet can deploy the shared factory from a Flashprofits quote if the factory
address is empty. The first wallet pays the deployment gas. Later wallets only
need to create their own executors. The API checks the factory's deployed bytecode
before offering executor setup. Set both `FLASHPROFITS_WALLET_FACTORY` and
`FLASHPROFITS_WALLET_FACTORY_CODE_HASH` to override the default with an existing
verified deployment. Prices can be ranked while wallet execution is unavailable.

Deploy the Flashprofits blocked-list endpoint before enabling the CDR mirror.
CDR reads `/api/v1/blocked-tokenlist.json` from `FLASHPROFITS_BASE_URL`.
Set `FLASHPROFITS_TOKENLIST_URL` to override the source or to enable list
filtering without the Flashprofits quote providers. Verify CDR
`/api/blocked-tokenlist.json` publishes the same version and provenance.

When updating the default factory, run `forge build src --no-cache` with
Flashprofits' pinned toolchain. From the CDR checkout, run
`pnpm run generate:flashprofits-factory` with the
`WalletAmountFlowFactory.json` artifact path and the interpreter address as
arguments. Verify the generated address and runtime hash with Ethereum
`eth_call` before publishing the update.

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
