#!/usr/bin/env bash
# ClearStream — one-command local install.
#
#   ./install.sh             # power/resolver build, Chrome (default)
#   ./install.sh --store     # plain detector+player, Chrome
#   ./install.sh --firefox   # Firefox build (add --store/--power too)
#
# Builds into a STABLE folder (~/.clearstream/…) that survives rebuilds, then prints the exact
# "Load unpacked" steps and opens your browser's extensions page. The only thing it can't do for
# you is click "Load unpacked" — Chrome requires that by design. For a true one-click install,
# use the Chrome Web Store listing (see README).
set -euo pipefail
cd "$(dirname "$0")"

echo "ClearStream installer"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is required (https://nodejs.org). Install Node 20+ and re-run." >&2
  exit 1
fi

# Ensure pnpm — corepack ships with Node and provides it without a global install.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "• pnpm not found — enabling it via corepack…"
  corepack enable >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "✗ Could not get pnpm. Install it (https://pnpm.io/installation) and re-run." >&2
  exit 1
fi

echo "• Installing dependencies…"
pnpm install --silent

node scripts/install-local.mjs "$@"
