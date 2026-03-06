# docker-rollout + Traefik Research

> Research date: 2026-03-05
> Sources: github.com/wowu/docker-rollout, docker-rollout.wowu.dev, doc.traefik.io, community blogs

---

## 1. How docker-rollout Works

**What it is:** A Docker CLI plugin (single bash script, no dependencies) that enables zero-downtime deployments for Docker Compose services. Drop-in replacement for `docker compose up -d <service>`.

**Installation:**
```bash
mkdir -p ~/.docker/cli-plugins
curl https://raw.githubusercontent.com/wowu/docker-rollout/main/docker-rollout \
  -o ~/.docker/cli-plugins/docker-rollout
chmod +x ~/.docker/cli-plugins/docker-rollout
```

**Lifecycle / How it works:**
1. `docker rollout <service>` is called
2. It scales the service to 2× current instances (e.g., 1 → 2)
3. The new container starts alongside the old one
4. If healthcheck is defined: waits for new container to become healthy (default timeout: 60s)
5. If no healthcheck: waits a fixed time (default: 10s)
6. Traefik/proxy automatically routes traffic to healthy containers
7. Old container is stopped and removed
8. Container count returns to original (e.g., back to 1)

**Key CLI options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-f \| --file PATH` | auto | Path to compose file(s) |
| `-t \| --timeout SECONDS` | 60 | Healthcheck timeout |
| `-w \| --wait SECONDS` | 10 | Wait time (no healthcheck) |
| `--wait-after-healthy SECONDS` | 0 | Extra wait after healthy |
| `--env-file PATH` | - | Env file path(s) |
| `-p \| --project-name NAME` | - | Project name |
| `--profile NAME` | - | Compose profile |
| `--pre-stop-hook CMD` | - | Command to run in old container before stop |

**Sample deployment script:**
```bash
git pull
docker compose build web
docker compose run --rm web rake db:migrate  # or equivalent
docker rollout web
```

---

## 2. Caveats & Limitations

1. **No `container_name`** – Services rolled out cannot have `container_name` set (can't run two containers with the same name)
2. **No `ports` on rolled-out services** – Can't bind host ports on scaled services (use proxy instead). The **proxy service** (Traefik) keeps `ports`.
3. **No `network_mode: host`** – Same reason as ports
4. **Requires a reverse proxy** – Traefik or nginx-proxy for traffic routing
5. **Container name increments** – e.g., `project-web-1` → `project-web-2` → `project-web-3` (never resets)
6. **Pre-stop hook labels read from old container** – First deployment after adding the label won't use it; CLI flag overrides work immediately
7. **Not Docker Swarm** – This is for plain Docker Compose only (replaces docker-stack.yml approach)

---

## 3. Container Draining (Zero Lost Requests)

Without draining, the old container is stopped immediately after the new one is healthy. In-flight requests to the old container may be dropped.

**Draining setup:**

1. Add a healthcheck that fails when `/tmp/drain` exists:
```yaml
services:
  web:
    image: myapp:latest
    healthcheck:
      test: test ! -f /tmp/drain && curl -f http://localhost:3001/health
      interval: 5s
      retries: 1
```

2. Use pre-stop-hook (via label or CLI):
```yaml
labels:
  - "docker-rollout.pre-stop-hook=touch /tmp/drain && sleep 10"
```
Or CLI: `docker rollout web --pre-stop-hook "touch /tmp/drain && sleep 10"`

**Draining lifecycle:**
1. New container starts → becomes healthy
2. Proxy routes to both containers
3. `/tmp/drain` created in old container (pre-stop-hook)
4. Docker marks old container unhealthy
5. Proxy stops sending requests to old container
6. Sleep allows in-flight requests to complete
7. Old container removed

**Sleep formula:** `healthcheck_interval × retries + request_drain_time`
Example: interval=5s, retries=1, drain=5s → sleep 10

---

## 4. Traefik Configuration for docker-rollout

### Key Principles
- Traefik discovers services via Docker labels (Docker provider)
- `exposedbydefault=false` → only services with `traefik.enable=true` are exposed
- Services behind Traefik do NOT expose `ports:` — Traefik handles all inbound traffic
- The Traefik container itself exposes ports 80/443 and has `container_name: traefik`
- Docker socket mounted read-only for service discovery

### Essential Traefik Labels for Services
```yaml
labels:
  - "traefik.enable=true"
  # Router: routing rule
  - "traefik.http.routers.myservice.rule=Host(`myapp.example.com`)"
  # Router: entrypoint
  - "traefik.http.routers.myservice.entrypoints=websecure"
  # Router: TLS
  - "traefik.http.routers.myservice.tls=true"
  - "traefik.http.routers.myservice.tls.certresolver=letsencrypt"
  # Service: which port in the container to route to
  - "traefik.http.services.myservice.loadbalancer.server.port=3001"
```

### Traefik v3 with Let's Encrypt (Production)
```yaml
services:
  traefik:
    image: traefik:v3.4
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=proxy"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.websecure.http.tls=true"
      - "--certificatesresolvers.letsencrypt.acme.email=you@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "acme-data:/acme"
    networks:
      - proxy

volumes:
  acme-data:

networks:
  proxy:
    name: proxy
```

### Path-Based Routing (Multiple Services, One Domain)
```yaml
# API service
labels:
  - "traefik.http.routers.api.rule=Host(`app.example.com`) && PathPrefix(`/api`)"

# Frontend service
labels:
  - "traefik.http.routers.frontend.rule=Host(`app.example.com`)"
```

### Host-Based Routing (Separate Subdomains)
```yaml
# API
labels:
  - "traefik.http.routers.api.rule=Host(`api.example.com`)"

# Frontend
labels:
  - "traefik.http.routers.frontend.rule=Host(`app.example.com`)"
```

---

## 5. Recommended docker-compose.yml for Compare DEX Routers

This is a complete production-ready example for the compare-dex-routers project behind Traefik with docker-rollout support.

### Option A: Single Service (API serves UI)

```yaml
# docker-compose.yml
services:
  # ─── Traefik Reverse Proxy ───────────────────────────────────
  traefik:
    image: traefik:v3.4
    container_name: traefik        # OK: traefik is never rolled out
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=proxy"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.websecure.http.tls=true"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "acme-data:/acme"
    networks:
      - proxy

  # ─── Compare DEX Routers API ─────────────────────────────────
  compare-dex-routers:
    build: .
    # NO container_name (required for docker-rollout)
    # NO ports (Traefik handles ingress)
    env_file:
      - .env
    restart: unless-stopped
    networks:
      - proxy
    labels:
      # Traefik routing
      - "traefik.enable=true"
      - "traefik.http.routers.dex-compare.rule=Host(`${DOMAIN:-dex.example.com}`)"
      - "traefik.http.routers.dex-compare.entrypoints=websecure"
      - "traefik.http.routers.dex-compare.tls=true"
      - "traefik.http.routers.dex-compare.tls.certresolver=letsencrypt"
      - "traefik.http.services.dex-compare.loadbalancer.server.port=${PORT:-3001}"
      # docker-rollout draining
      - "docker-rollout.pre-stop-hook=touch /tmp/drain && sleep 10"
    healthcheck:
      test: >-
        test ! -f /tmp/drain &&
        node -e "fetch('http://localhost:${PORT:-3001}/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
      interval: 5s
      timeout: 5s
      retries: 1
      start_period: 15s

volumes:
  acme-data:

networks:
  proxy:
    name: proxy
```

**Deploy command:**
```bash
docker compose build compare-dex-routers
docker rollout compare-dex-routers
```

### Option B: Two Services (API + Separate Frontend)

If you later split into API + frontend:

```yaml
# docker-compose.yml
services:
  traefik:
    image: traefik:v3.4
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=proxy"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.websecure.http.tls=true"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "acme-data:/acme"
    networks:
      - proxy

  # ─── API Service ─────────────────────────────────────────────
  api:
    build: .
    env_file:
      - .env
    restart: unless-stopped
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`${DOMAIN}`) && (PathPrefix(`/api`) || PathPrefix(`/compare`) || PathPrefix(`/quote`) || PathPrefix(`/health`) || PathPrefix(`/chains`) || PathPrefix(`/metrics`))"
      - "traefik.http.routers.api.entrypoints=websecure"
      - "traefik.http.routers.api.tls=true"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
      - "traefik.http.services.api.loadbalancer.server.port=${PORT:-3001}"
      - "docker-rollout.pre-stop-hook=touch /tmp/drain && sleep 10"
    healthcheck:
      test: >-
        test ! -f /tmp/drain &&
        node -e "fetch('http://localhost:${PORT:-3001}/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
      interval: 5s
      timeout: 5s
      retries: 1
      start_period: 15s

  # ─── Frontend Service ───────────────────────────────────────
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.frontend.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.frontend.entrypoints=websecure"
      - "traefik.http.routers.frontend.tls=true"
      - "traefik.http.routers.frontend.tls.certresolver=letsencrypt"
      - "traefik.http.routers.frontend.priority=1"
      - "traefik.http.services.frontend.loadbalancer.server.port=80"
      - "docker-rollout.pre-stop-hook=touch /tmp/drain && sleep 10"
    healthcheck:
      test: "test ! -f /tmp/drain && curl -f http://localhost:80/ || exit 1"
      interval: 5s
      timeout: 5s
      retries: 1

volumes:
  acme-data:

networks:
  proxy:
    name: proxy
```

**Deploy commands (independent rollouts):**
```bash
# Deploy API
docker compose build api
docker rollout api

# Deploy frontend
docker compose build frontend
docker rollout frontend
```

---

## 6. Migration Path from Docker Swarm

The project currently uses `docker-stack.yml` with Docker Swarm's `update_config: order: start-first` for zero-downtime deploys. Moving to docker-rollout:

| Aspect | Docker Swarm (current) | docker-rollout (proposed) |
|--------|----------------------|--------------------------|
| Orchestrator | Docker Swarm mode | Plain Docker Compose |
| Zero-downtime mechanism | `order: start-first` in deploy config | Scale to 2×, wait healthy, remove old |
| Proxy | Direct port binding (3001:3001) | Traefik reverse proxy |
| TLS | External / not configured | Traefik + Let's Encrypt auto-certs |
| Rollback | Automatic via `rollback_config` | Manual: redeploy previous image |
| Resource limits | Via `deploy.resources` | Via compose `deploy.resources` (v2) or container runtime flags |
| Complexity | Requires swarm init, manager node | Just Docker + bash script plugin |
| Container draining | Not built-in | Via pre-stop-hook + healthcheck |

**Key migration steps:**
1. `docker swarm leave --force` (if not needed for other services)
2. Remove `docker-stack.yml` (or keep as reference)
3. Update `docker-compose.yml` to the Traefik structure above
4. Remove `container_name` and `ports` from the app service
5. Install docker-rollout on the server
6. Install and configure Traefik
7. Update deploy scripts: `docker stack deploy` → `docker rollout`

---

## 7. Docker Socket Security

Mounting `/var/run/docker.sock` into Traefik is a security risk. Mitigations:

1. **Read-only mount:** `/var/run/docker.sock:/var/run/docker.sock:ro` (already shown above)
2. **docker-socket-proxy:** Use [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) to limit API access:
```yaml
services:
  dockerproxy:
    image: tecnativa/docker-socket-proxy
    environment:
      - CONTAINERS=1
      - SERVICES=0
      - TASKS=0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - proxy

  traefik:
    # ... instead of mounting docker.sock directly:
    command:
      - "--providers.docker.endpoint=tcp://dockerproxy:2375"
    depends_on:
      - dockerproxy
```
3. **`security_opt: no-new-privileges:true`** on Traefik container
4. **`exposedbydefault=false`** to prevent accidental exposure

---

## 8. Quick Reference: Deployment Script

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-compare-dex-routers}"

echo "==> Pulling latest code..."
git pull

echo "==> Building image..."
docker compose build "$SERVICE"

echo "==> Rolling out (zero-downtime)..."
docker rollout "$SERVICE"

echo "==> Done! Verifying health..."
sleep 5
curl -sf "https://${DOMAIN}/health" && echo " ✓ Healthy" || echo " ✗ Health check failed"
```
