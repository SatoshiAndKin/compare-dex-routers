#!/bin/bash
set -e

# Install all workspace dependencies
cd /Users/bryan/code/compare-dex-routers
npm install

# Ensure .env exists
if [ ! -f .env ]; then
  cp env.example .env
  echo "Created .env from env.example - fill in ALCHEMY_API_KEY"
fi

# Generate API types for frontend (if openapi.yaml exists and frontend package exists)
if [ -f openapi.yaml ] && [ -d packages/frontend ]; then
  npx openapi-typescript openapi.yaml -o packages/frontend/src/generated/api-types.d.ts 2>/dev/null || true
fi
