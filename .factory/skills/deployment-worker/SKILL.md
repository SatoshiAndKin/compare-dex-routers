---
name: deployment-worker
description: Creates Docker, Traefik, and docker-rollout deployment configuration
---

# Deployment Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features involving:
- Dockerfile creation for API and frontend services
- Docker Compose configuration
- Traefik reverse proxy setup
- docker-rollout zero-downtime deployment integration
- Deploy scripts and documentation

## Work Procedure

1. **Read mission context**: Read `AGENTS.md`, `.factory/services.yaml`, `.factory/library/`. Read `.factory/research/docker-rollout.md` for docker-rollout patterns.

2. **Understand the feature**: Read feature description, preconditions, expectedBehavior, verificationSteps.

3. **Implement the configuration**:
   - **Dockerfiles**: Create `packages/api/Dockerfile` and `packages/frontend/Dockerfile`.
     - API: Node.js base, install deps, copy source, run with tsx. Include healthcheck.
     - Frontend: Multi-stage build (node for Vite build, nginx for serving). SPA fallback in nginx config. Include healthcheck.
   - **docker-compose.yml**: Project-level compose with api + frontend services. NO `container_name` or `ports` (required by docker-rollout). Use Traefik labels for routing. Healthchecks. Shared external network `traefik`.
   - **traefik/docker-compose.yml**: Standalone Traefik setup with ports 80/443, Docker socket mount, Let's Encrypt ACME, dashboard, network creation.
   - **Deploy script**: `scripts/deploy.sh` using `docker rollout` for each service.
   - Services MUST have `labels` for Traefik routing and `healthcheck` for docker-rollout.
   - docker-rollout requires: no `container_name`, no `ports` on services, healthcheck present.

4. **Verify configuration** (Docker is NOT running locally, so verify syntax only):
   - `docker compose config` to validate compose file syntax (if docker available)
   - Manually review Dockerfile for correctness
   - Verify Traefik labels match expected routing rules
   - Check healthcheck commands reference correct ports
   - Verify pre-stop hooks for container draining

5. **Manual review checklist**:
   - [ ] No API keys or secrets hardcoded in Dockerfiles
   - [ ] Frontend Dockerfile does NOT include .env or backend source
   - [ ] nginx config has SPA fallback (`try_files $uri $uri/ /index.html`)
   - [ ] Traefik labels use correct service names and ports
   - [ ] docker-rollout compatible (no container_name, no ports, has healthcheck)
   - [ ] Memory limits configured
   - [ ] Graceful shutdown handlers present

6. **Update shared knowledge**: Add deployment patterns and configuration notes to `.factory/library/`.

## Example Handoff

```json
{
  "salientSummary": "Created Dockerfiles for API (Node.js + tsx) and frontend (multi-stage Vite build + nginx). Set up docker-compose.yml with Traefik labels for path-based routing. Created traefik/docker-compose.yml with Let's Encrypt. Added deploy.sh script using docker rollout.",
  "whatWasImplemented": "packages/api/Dockerfile (Node.js 24-slim, tsx, healthcheck on /health), packages/frontend/Dockerfile (multi-stage: node build + nginx serve with SPA fallback), docker-compose.yml (api + frontend services with Traefik labels, no container_name/ports, healthchecks, memory limits), traefik/docker-compose.yml (Traefik v3, ports 80/443, Let's Encrypt ACME, Docker socket, dashboard), scripts/deploy.sh (docker rollout for each service), packages/frontend/nginx.conf (SPA fallback, cache headers for hashed assets).",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cat docker-compose.yml | grep -c container_name", "exitCode": 0, "observation": "0 - no container_name (docker-rollout compatible)" },
      { "command": "grep -r 'ALCHEMY_API_KEY' packages/frontend/", "exitCode": 1, "observation": "No API keys in frontend package" }
    ],
    "interactiveChecks": [
      { "action": "Review docker-compose.yml Traefik labels", "observed": "API routes: PathPrefix /health, /chains, /compare, /quote, /tokenlist, /token-metadata, /metrics, /analytics, /errors, /config, /docs, /.well-known. Frontend: catchall." },
      { "action": "Review nginx.conf SPA fallback", "observed": "try_files $uri $uri/ /index.html configured" }
    ]
  },
  "tests": { "added": [] },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Docker not available and feature requires building/testing images
- Traefik routing conflicts with existing services on the server
- Need domain name or TLS certificate configuration decisions
- docker-rollout has breaking changes or doesn't work as documented
