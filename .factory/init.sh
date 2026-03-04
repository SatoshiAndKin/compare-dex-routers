#!/bin/bash
set -e

# Install dependencies (idempotent)
npm install

# Ensure .env exists
if [ ! -f .env ]; then
  cp env.example .env
  # Set port to 3000 (3001 conflicts with OrbStack)
  sed -i '' 's/^PORT=.*/PORT=3000/' .env 2>/dev/null || true
fi

# Build client if build script exists
if npm run --silent build:client 2>/dev/null; then
  echo "Client built successfully"
else
  echo "No build:client script yet (pipeline milestone not started)"
fi
