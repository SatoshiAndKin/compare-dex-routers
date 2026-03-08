#!/bin/bash
set -euo pipefail

# Deploy script using docker rollout for zero-downtime deployments
# Usage: ./scripts/deploy.sh [api|frontend|all]

SERVICE="${1:-all}"
COMPOSE_FILE="docker-compose.yml"

build_and_rollout() {
  local service="$1"
  echo "Building $service..."
  docker compose -f "$COMPOSE_FILE" build "$service"
  
  echo "Rolling out $service..."
  docker rollout -f "$COMPOSE_FILE" "$service"
  
  echo "$service deployed successfully"
}

case "$SERVICE" in
  api)
    build_and_rollout api
    ;;
  frontend)
    build_and_rollout frontend
    ;;
  all)
    build_and_rollout api
    build_and_rollout frontend
    ;;
  *)
    echo "Usage: $0 [api|frontend|all]"
    exit 1
    ;;
esac

echo "Deployment complete!"
