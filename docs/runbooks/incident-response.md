# Incident Response Runbook

## Health Check Failing

**Symptoms**: `/health` returns non-200 or times out

**Steps**:
1. Check container status: `docker ps`
2. Check logs: `docker compose logs api --tail 100`
3. Verify port binding: `curl http://localhost:3100/health`
4. Check Sentry for recent errors
5. Restart: `docker compose restart api`

## High Error Rate on /quote or /compare

**Symptoms**: Sentry alerts on quote failures, metrics show elevated error counts

**Steps**:
1. Check `/metrics` for error counts per endpoint and router
2. Review Sentry for error patterns (provider timeouts, RPC errors, router failures)
3. Verify RPC endpoints are responding: check Alchemy dashboard
4. Check if specific chains or routers are affected
5. If provider-specific: check 0x/Odos/KyberSwap status pages
6. If Curve-specific: check Curve API status
7. Temporary mitigation: increase timeout or disable failing provider/router

## Curve Initialization Failure

**Symptoms**: Log message "Curve initialization failed, continuing without Curve"

**Steps**:
1. Verify `RPC_URL_1` or `ALCHEMY_API_KEY` is set
2. Test RPC endpoint directly: `curl -X POST <rpc_url>`
3. Check Curve API status
4. Set `CURVE_ENABLED=false` to skip Curve while investigating

## High Memory Usage

**Steps**:
1. Check metrics: `curl http://localhost:3100/metrics`
2. Check container resources: `docker stats`
3. Review recent deployments for memory leaks
4. Restart container as immediate mitigation
5. Enable Node.js heap profiling if persistent

## Deployment Rollback

**Steps**:
1. Identify the last known good version tag
2. Pull previous image: `docker pull ghcr.io/satoshiandkin/compare-dex-routers-api:<tag>`
3. Update docker-compose or deployment to use previous tag
4. Restart: `docker compose up -d`
5. Verify health: `curl http://localhost:3100/health`
