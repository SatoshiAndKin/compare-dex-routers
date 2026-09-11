# Private Tailscale access

The deployed app uses https://ski-nuc-3.shorthair-fir.ts.net:8443/.
The API stays under `/api` on the same origin. Connect to Tailscale before
opening the app. The previous `swap.stytt.com` route is retired.

Set these values in the production `.env`:

```dotenv
VIRTUAL_HOST=ski-nuc-3.shorthair-fir.ts.net
RPC_URL_1=https://ski-lambo-1.shorthair-fir.ts.net:18544
```

The shared Traefik `web` entrypoint receives traffic on loopback port 8000.
See `traefik-proxy/README.md` for the private Serve configuration. The app and
dashboard backends must remain on loopback; do not enable Tailscale Funnel.
