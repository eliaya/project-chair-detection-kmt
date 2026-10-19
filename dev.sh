#!/usr/bin/env bash
# Local dev for web/: Vite + Worker + local D1 on one port.
#
#   ./dev.sh [--reset] [<worktree-path> <port>]
#
#   --reset  delete all local data (web/.wrangler/state, web/.dev.vars) and start from a clean
#            environment; the app then opens the setup wizard.
#   Sample data (site name, device, camera, zones, floor plan) is added while the local D1 has
#   none of them (web/scripts/seed.ts).
#   Defaults: this repo, port 5173. --host also serves the LAN, so a Pi can reach /api/*.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESET=0
if [ "${1:-}" = --reset ]; then RESET=1; shift; fi
if [ "$#" -ne 0 ] && [ "$#" -ne 2 ]; then
  echo "Usage: $0 [--reset] [<worktree-path> <port>]" >&2
  exit 1
fi
WORKTREE="${1:-$SCRIPT_DIR}"; PORT="${2:-5173}"
WEB="$WORKTREE/web"

[ -f "$WEB/package.json" ] || { echo "Error: no web/package.json in $WORKTREE" >&2; exit 1; }
case "$PORT" in ''|*[!0-9]*) echo "Error: port must be numeric: $PORT" >&2; exit 1;; esac
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
npm run --silent seed

echo "[dev] $WEB → http://localhost:${PORT}  (Setup code: SETUP_TOKEN in web/.dev.vars)"
exec npm run dev -- --port "$PORT" --strictPort --host
