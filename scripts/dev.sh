#!/bin/bash

# KMT table occupancy monitor: development environment launcher
#
# Checks prerequisites, lists the URLs, then hands over to ../dev.sh, which runs
# Vite + the Worker (/api/*) + local D1 on one port. Ctrl+C stops everything.
#
# Usage (same options as ./dev.sh):
#   ./scripts/dev.sh
#   ./scripts/dev.sh --seed                    # sample data into an empty local D1
#   ./scripts/dev.sh --reset [--seed]          # delete local data first (asks to confirm)
#   ./scripts/dev.sh <worktree-path> <port>    # another worktree / port
#
# After start:
#   - Admin:  http://localhost:5173          (LAN: http://<Mac IP>:5173)
#   - Portal: http://localhost:5173/portal   (public, no login)
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

# ../dev.sh takes the port as its last argument (default 5173).
PORT=5173
[ "$#" -ge 2 ] && case "${!#}" in ''|*[!0-9]*) ;; *) PORT="${!#}" ;; esac

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
echo -e "${GREEN}Starting KMT occupancy development environment...${NC}"
echo -e "${GREEN}Services:${NC}"
echo -e "  • Admin:  http://localhost:$PORT${LAN_IP:+   (LAN: http://$LAN_IP:$PORT)}"
echo -e "  • Portal: http://localhost:$PORT/portal"
echo -e "  • API:    http://localhost:$PORT/api/*"
echo -e "  • Stop:   Ctrl+C\n"

exec "$ROOT/dev.sh" "$@"
