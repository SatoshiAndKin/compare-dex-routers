#!/bin/bash
set -e

cd /Users/bryan/code/compare-dex-routers

# Install dependencies (idempotent)
npm install --prefer-offline --no-audit 2>/dev/null || npm install

# Ensure data directory exists with tokenlist
if [ ! -f data/tokenlist.json ]; then
  mkdir -p data
  echo "Downloading Uniswap default tokenlist..."
  curl -sf https://tokens.uniswap.org -o data/tokenlist.json
fi

# Ensure .env exists
if [ ! -f .env ]; then
  cp env.example .env
  echo "Created .env from env.example - fill in ALCHEMY_API_KEY"
fi

# Kill any existing dev server on port 3002 (idempotent)
lsof -ti :3002 | xargs kill 2>/dev/null || true
