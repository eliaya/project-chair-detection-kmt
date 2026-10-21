#!/usr/bin/env bash
# Local dev for web/: Vite + Worker + local D1 on one port.
#
#   ./dev.sh [--reset] [--seed] [<worktree-path> <port>]
#
#   --reset  delete all local data (web/.wrangler/state, web/.dev.vars) and start from a clean
#            environment; the app then opens the setup wizard.
#   --seed   add sample data (site name, device, camera, zones, floor plan) unless the local D1
#            already has a device, camera, zone or floor plan (web/scripts/seed.ts).
#   Defaults: this repo, port 5173. --host also serves the LAN, so a Pi can reach /api/*.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESET=0; SEED=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reset) RESET=1;;
    --seed) SEED=1;;
    *) break;;
  esac
  shift
done
if [ "$#" -ne 0 ] && [ "$#" -ne 2 ]; then
  echo "Usage: $0 [--reset] [--seed] [<worktree-path> <port>]" >&2
  exit 1
fi
WORKTREE="${1:-$SCRIPT_DIR}"; PORT="${2:-5173}"
WEB="$WORKTREE/web"

[ -f "$WEB/package.json" ] || { echo "Error: no web/package.json in $WORKTREE" >&2; exit 1; }
case "$PORT" in ''|*[!0-9]*) echo "Error: port must be numeric: $PORT" >&2; exit 1;; esac

# Another project's Vite often holds 5173, and vite --strictPort would only fail after the
# migrations. Without an explicit port, move to the next free one.
listener() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
pid="$(listener "$PORT" || true)"
if [ -n "$pid" ]; then
  echo "[dev] port $PORT is in use by pid $pid: $(ps -o command= -p "$pid")" >&2
  [ "$#" -eq 2 ] && { echo "Error: stop that process or choose another port" >&2; exit 1; }
  while [ -n "$(listener "$PORT" || true)" ]; do PORT=$((PORT + 1)); done
  echo "[dev] using port $PORT instead (a Pi set to the old port needs its URL changed)" >&2
fi
cd "$WEB"

if [ "$RESET" = 1 ]; then
  # workerd maps the local D1 files; deleting them under a running server breaks it.
  # (macOS lsof +D exits 1 even on a match, so test its output.)
  pids="$( { [ -d .wrangler/state ] && lsof -t +D .wrangler/state 2>/dev/null; } || true)"
  if [ -n "$pids" ]; then
    echo "Error: a dev server is using web/.wrangler/state (pid $(echo $pids)); stop it first" >&2
    exit 1
  fi
  read -r -p "[dev] Delete all local data (web/.wrangler/state, web/.dev.vars)? [y/N] " ok || true
  case "${ok:-}" in y|Y) ;; *) echo "[dev] aborted" >&2; exit 1;; esac
  rm -rf .wrangler/state .dev.vars
  echo "[dev] local data deleted"
fi

[ -d node_modules ] || npm install

# Local Worker secrets (gitignored). SETUP_TOKEN is the setup wizard's Setup code.
if [ ! -f .dev.vars ]; then
  (umask 077; node -e "const r = (n) => require('crypto').randomBytes(n).toString('hex')
console.log('SESSION_SECRET=' + r(32) + '\nSETUP_TOKEN=' + r(16))" > .dev.vars)
  echo "[dev] created web/.dev.vars"
fi

# Applies only pending migrations; CI skips wrangler's confirmation prompt.
CI=true npm run db:migrate:local
if [ "$SEED" = 1 ]; then npm run --silent seed; fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
echo "[dev] $WEB → http://localhost:${PORT}${LAN_IP:+  (LAN: http://$LAN_IP:$PORT)}"
echo "[dev] public portal: http://localhost:${PORT}/portal  (Setup code: SETUP_TOKEN in web/.dev.vars)"
exec npm run dev -- --port "$PORT" --strictPort --host
