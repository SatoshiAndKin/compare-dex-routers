# Private Tailscale access

The deployed app uses https://compare-dex-routers.shorthair-fir.ts.net/.
The API uses `https://compare-dex-routers.shorthair-fir.ts.net/api`.
Connect to Tailscale before opening the app or calling the API. The previous
`ski-nuc-3.shorthair-fir.ts.net:8443` and `swap.stytt.com` routes are retired.

Check the live API without a wallet or a transaction:

```sh
curl --fail https://compare-dex-routers.shorthair-fir.ts.net/api/health
```

The private Dockerfiles repository owns production K3s routing and RPC
configuration. See `docs/runbooks/deployment.md` for deployment verification.
The repo-local `traefik-proxy` directory documents the retained Compose setup,
not the current production access URL. Do not enable Tailscale Funnel.
