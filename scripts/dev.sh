#!/bin/bash

# KMT table occupancy monitor: development environment launcher
#
# Checks prerequisites, then hands over to ../dev.sh, which runs Vite + the Worker
# (/api/*) + local D1 on one port and prints the URLs. Ctrl+C stops everything.
#
# Usage (same options as ./dev.sh):
#   ./scripts/dev.sh
#   ./scripts/dev.sh --seed                    # sample data into an empty local D1
#   ./scripts/dev.sh --reset [--seed]          # delete local data first (asks to confirm)
#   ./scripts/dev.sh <worktree-path> <port>    # another worktree / port
#
# After start (5173, or the next free port when 5173 is taken and no port was given):
#   - Portal: http://localhost:5173          (public, no login; LAN: http://<Mac IP>:5173)
#   - Admin:  http://localhost:5173/admin
#   - API:    http://localhost:5173/api/*    (a Pi on the LAN can POST here)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

for cmd in node npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo -e "${RED}Error: $cmd not found.${NC}"; exit 1; }
done

echo -e "${GREEN}Starting KMT occupancy development environment...${NC}"

exec "$ROOT/dev.sh" "$@"
