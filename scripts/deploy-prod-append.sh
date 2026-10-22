#!/usr/bin/env bash
# scripts/deploy-prod-append.sh — non-interactive production deploy of web/ (Worker + D1 kmt-occupancy).
#
# Auth via CLOUDFLARE_API_TOKEN (not `wrangler login`), so this runs headless/CI too.
# Idempotent: safe to re-run. It creates the D1 database only if it does not exist yet, applies
# only the migrations not applied yet (wrangler's own d1_migrations table), then builds and deploys.
# Nothing here drops a table or deletes a row. The variant that starts from an empty database is
# scripts/deploy-prod-fresh.sh.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=xxx ./scripts/deploy-prod-append.sh
#   ./scripts/deploy-prod-append.sh          # values read from web/.env (gitignored)
#
# Secrets (worker side, `wrangler secret`): set only when the worker does not hold them yet, never
# overwritten — a new SESSION_SECRET would sign every admin out.
#   SESSION_SECRET  generated (openssl rand -hex 32) when missing and not given
#   SETUP_TOKEN     the setup code for the first admin at /admin; pushed only when given
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WEB_DIR="$ROOT/web"
CONFIG="$WEB_DIR/wrangler.jsonc"
DB_NAME="kmt-occupancy"
WRANGLER="$WEB_DIR/node_modules/.bin/wrangler" # the pinned one, not whatever npx would fetch

for arg in "$@"; do
  echo "Error: unknown flag '$arg' (this script takes none)" >&2; exit 1
done

# --- web/.env ----------------------------------------------------------------
# Optional, gitignored. Only fills what is unset or empty, so a value passed on the command line wins.
# Plain KEY=value, taken literally to end of line (quotes would land inside the token).
load_env() { # <file> <key regex>
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    k="${line%%=*}"; v="${line#*=}"
    if [[ $line == *=* && $k =~ $2 ]] && [ -z "${!k:-}" ]; then export "$k=$v"; fi
  done < "$1"
}
load_env "$WEB_DIR/.env" '^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|SESSION_SECRET|SETUP_TOKEN)$'

# --- 0) preconditions --------------------------------------------------------
: "${CLOUDFLARE_API_TOKEN:?Error: CLOUDFLARE_API_TOKEN not set. Create one at
  https://dash.cloudflare.com/profile/api-tokens (permissions: Workers Scripts:Edit, D1:Edit)
  and export it, or put it in web/.env.}"
export CLOUDFLARE_API_TOKEN
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID # only needed if the token can see >1 account

command -v node >/dev/null 2>&1 || { echo "Error: node not found (need Node.js)" >&2; exit 1; }

# node_modules must match package.json before anything touches production, or the build below fails
# after the migrations have already been applied. `npm ls` exits non-zero on a missing package.
if ! npm --prefix "$WEB_DIR" ls --depth=0 >/dev/null 2>&1; then
  echo "[deploy] web/node_modules is out of date with package.json — running npm install ..."
  npm --prefix "$WEB_DIR" install --no-audit --no-fund
fi

cd "$WEB_DIR"

echo "[deploy] verifying API token ..."
$WRANGLER whoami

# --- 1) D1 database ------------------------------------------------------------
# Before the build: the Vite plugin copies wrangler.jsonc into dist/, so an id added later would not
# reach the deployed worker.
db_uuid() {
  $WRANGLER d1 list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(d?d.uuid:'')})" "$DB_NAME"
}
if ! grep -q '"database_id"' "$CONFIG"; then
  DB_ID="$(db_uuid)"
  if [ -z "$DB_ID" ]; then
    echo "[deploy] creating D1 database '$DB_NAME' ..."
    # Run outside web/ so wrangler finds no config to edit on its own; the id is written below.
    (cd "$(mktemp -d)" && "$WRANGLER" d1 create "$DB_NAME" </dev/null)
    DB_ID="$(db_uuid)"
  fi
  [ -n "$DB_ID" ] || { echo "Error: D1 database '$DB_NAME' not found after create" >&2; exit 1; }
  node -e "const fs=require('fs');const [f,n,id]=process.argv.slice(1);const s=fs.readFileSync(f,'utf8');const t=s.replace('\"database_name\": \"'+n+'\",','\$&\n      \"database_id\": \"'+id+'\",');if(t===s){console.error('Error: no \"database_name\": \"'+n+'\" line in '+f);process.exit(1)}fs.writeFileSync(f,t)" "$CONFIG" "$DB_NAME" "$DB_ID"
  echo "[deploy] wrangler.jsonc database_id set to $DB_ID — commit this change"
fi

# --- 2) build before anything touches production ------------------------------
echo "[deploy] building (tsc -b && vite build) ..."
npm run build

# --- 3) migrations -------------------------------------------------------------
# -c: the build leaves .wrangler/deploy/config.json pointing wrangler at dist/; migrations live here.
# CI=true skips the confirmation prompt (wrangler still takes its backup first).
echo "[deploy] applying D1 migrations (remote) ..."
CI=true $WRANGLER d1 migrations apply "$DB_NAME" --remote -c "$CONFIG"

# --- 4) deploy -------------------------------------------------------------------
echo "[deploy] deploying worker ..."
$WRANGLER deploy

# --- 5) secrets ------------------------------------------------------------------
# After the deploy: `secret list` needs the worker to exist.
SECRETS="$($WRANGLER secret list --format json)"
has_secret() { printf '%s' "$SECRETS" | grep -q "\"$1\""; }

if ! has_secret SESSION_SECRET; then
  echo "[deploy] setting secret SESSION_SECRET ..."
  printf '%s' "${SESSION_SECRET:-$(openssl rand -hex 32)}" | $WRANGLER secret put SESSION_SECRET
fi

if ! has_secret SETUP_TOKEN; then
  if [ -n "${SETUP_TOKEN:-}" ]; then
    echo "[deploy] setting secret SETUP_TOKEN ..."
    printf '%s' "$SETUP_TOKEN" | $WRANGLER secret put SETUP_TOKEN
  else
    # Only matters while no admin exists; the setup wizard stays disabled without it.
    echo "[deploy] note: no SETUP_TOKEN on the worker — /admin cannot create the first admin until one is set:" >&2
    echo "[deploy]       npx wrangler secret put SETUP_TOKEN   (in web/)" >&2
  fi
fi

echo "[deploy] done."
