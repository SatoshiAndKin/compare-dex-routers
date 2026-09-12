# Production deployment

GitHub owns the normal deployment trigger. Automatic merges wait for successful
CI, merge the exact tested revision, then explicitly dispatch the CD workflow.
Human merges trigger CD through the pull request event. GitHub suppresses merge
events produced by `GITHUB_TOKEN`, so automatic merges require that explicit
dispatch.

CD builds and pushes both images, then sends the repository, merged commit, and
`compare-dex-routers` target to Tank's authenticated `/hooks/deploy` endpoint.
Tank stores the request before returning its receipt ID. Its host worker deploys
clean fetched main through the managed application script and checks Traefik
before starting the application rollout.

A successful GitHub deploy job confirms request storage. To confirm deployment,
read `/opt/deploy-webhooks/queue/results/<receipt-id>.json` on Tank and check the
API, frontend, and deployed image revisions. Worker logs are available with
`sudo journalctl -u deploy-webhooks-worker.service`.

To request a fresh build and deployment, dispatch CD on main:

```sh
gh workflow run cd.yml --repo SatoshiAndKin/compare-dex-routers --ref main
```

If image builds passed but the worker failed, fix the reported cause and rerun
the deploy job from that GitHub run. Keep the successful image build jobs.

The private [Dockerfiles controller](https://github.com/SatoshiAndKin/dockerfiles/blob/main/docs/webhooks-cutover.md)
owns Tank setup, trusted keys, and caller configuration. It sets
`DEPLOY_WEBHOOK_URL` and `WEBHOOK_SECRET`; the runtime worker has no GitHub admin
token. Preserve the production `.env` and shared Traefik project.

## Draining and resource limits

Each API container has a 2 CPU / 512 MiB limit. Each frontend container has a
0.5 CPU / 128 MiB limit. These are per-container caps; rolling replacement can
briefly double the container count.

The `docker-rollout.pre-stop-hook` label creates `/tmp/drain` and waits 40 seconds.
The existing 10-second, three-failure health check removes the old container from
Traefik before Docker sends the stop signal. Rollout reads labels from the old
container, so the new hook first applies when replacing a container from this release.

The API handles SIGTERM and SIGINT once. It closes the listener, lets accepted
requests finish for up to 25 seconds, closes remaining connections, and gives
telemetry/log flushing up to 5 seconds. The total fits Docker's 35-second grace
period. Health checks and requests that reach a draining process return HTTP 503
with code `SHUTTING_DOWN`. Normal shutdown exits 0; a forced close or failed flush exits 1.
The frontend uses nginx's SIGQUIT graceful shutdown.

After rollout, inspect the final Tank receipt, image revisions, health, restart
counts, and Docker CPU limits. A stored webhook request alone does not prove that
production updated successfully.
