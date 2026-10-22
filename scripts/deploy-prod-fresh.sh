#!/usr/bin/env bash
# scripts/deploy-prod-fresh.sh — deploy onto an EMPTY production database.
#
# DESTRUCTIVE. Every table in the D1 database kmt-occupancy is dropped first: admins, devices
# (and their API tokens), cameras, zones and seat polygons, settings, floor plan, API keys, and all
# occupancy history. The worker's own secrets live in `wrangler secret`, not in D1, so they survive.
#
# What comes back is only what the migrations write: the schema and default settings. No admin —
# /admin opens the setup wizard again, which needs SETUP_TOKEN. Every Pi has to be registered
# again under "デバイス" and given its new API_TOKEN in /etc/kmt-occupancy.env.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=xxx ./scripts/deploy-prod-fresh.sh --yes
#   ./scripts/deploy-prod-fresh.sh --yes     # values read from web/.env (gitignored)
#
# Everything after the wipe is scripts/deploy-prod-append.sh — same migrations, build, deploy and
# secrets, just against an empty database. Use that script on its own for every deploy that must
# keep the production data.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WEB_DIR="$ROOT/web"
CONFIG="$WEB_DIR/wrangler.jsonc"
DB_NAME="kmt-occupancy"
WRANGLER="$WEB_DIR/node_modules/.bin/wrangler"
CONFIRMED=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) CONFIRMED=1 ;;
    *) echo "Error: unknown flag '$arg' (only --yes is supported)" >&2; exit 1 ;;
  esac
done

if [ "$CONFIRMED" -ne 1 ]; then
  cat >&2 <<EOF
Error: this deletes every row in the production D1 database '$DB_NAME' — there is no undo
       from this script (Cloudflare's own D1 Time Travel is the only way back).

       If that is what you want:  ./scripts/deploy-prod-fresh.sh --yes
       To deploy and keep the data: ./scripts/deploy-prod-append.sh
EOF
  exit 1
fi

# --- web/.env ----------------------------------------------------------------
# Same as deploy-prod-append.sh: without it the token check below aborts here even though the
# append script on its own would have found the token.
load_env() { # <file> <key regex>
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    k="${line%%=*}"; v="${line#*=}"
    if [[ $line == *=* && $k =~ $2 ]] && [ -z "${!k:-}" ]; then export "$k=$v"; fi
  done < "$1"
}
load_env "$WEB_DIR/.env" '^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|SESSION_SECRET|SETUP_TOKEN)$'

# --- 0) preconditions --------------------------------------------------------
# Checked here as well as in deploy-prod-append.sh: the wipe below runs before that script is
# ever called, and a wipe followed by a "no token" abort is the worst outcome.
: "${CLOUDFLARE_API_TOKEN:?Error: CLOUDFLARE_API_TOKEN not set. Create one at
  https://dash.cloudflare.com/profile/api-tokens (permissions: Workers Scripts:Edit, D1:Edit)
  and export it, or put it in web/.env.}"
export CLOUDFLARE_API_TOKEN
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

command -v node >/dev/null 2>&1 || { echo "Error: node not found (need Node.js)" >&2; exit 1; }
[ -x "$WRANGLER" ] || { echo "Error: web/ has no wrangler installed — run 'npm --prefix web i' first" >&2; exit 1; }

cd "$WEB_DIR"

echo "[fresh] verifying API token ..."
$WRANGLER whoami

# --- 1) drop every table -----------------------------------------------------
# Dropping the tables (d1_migrations included) rather than `d1 delete` + `d1 create` keeps the
# database_id committed in wrangler.jsonc. No id yet: nothing to drop, append creates the database.
if ! grep -q '"database_id"' "$CONFIG"; then
  echo "[fresh] no database_id in wrangler.jsonc yet — deploy-prod-append.sh will create '$DB_NAME'"
  TABLES=""
else
  echo "[fresh] listing tables in remote D1 '$DB_NAME' ..."
  # On failure `--json` prints `{"error":{...}}` instead of the result array — show that and stop.
  TABLES="$($WRANGLER d1 execute "$DB_NAME" --remote --json -c "$CONFIG" --command \
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!Array.isArray(j)){console.error('Error: wrangler d1 execute failed:\n'+JSON.stringify(j.error??j,null,2));process.exit(1)}process.stdout.write(j[0].results.map(x=>x.name).join('\n'))})")"
fi

if [ -z "$TABLES" ]; then
  echo "[fresh] database is already empty, nothing to drop"
else
  echo "[fresh] dropping $(printf '%s\n' "$TABLES" | wc -l | tr -d ' ') tables ..."
  DROP_SQL="$(mktemp)"
  # defer_foreign_keys: the drop order is alphabetical, not dependency order, and D1 applies a
  # --file atomically — deferring the FK checks to the end of it is what makes any order work.
  {
    echo "PRAGMA defer_foreign_keys = TRUE;"
    printf '%s\n' "$TABLES" | sed -E 's/.*/DROP TABLE IF EXISTS "&";/'
  } > "$DROP_SQL"
  $WRANGLER d1 execute "$DB_NAME" --remote --yes -c "$CONFIG" --file "$DROP_SQL"
  rm -f "$DROP_SQL"
fi

# --- 2) the normal deploy, now against an empty database ---------------------
echo "[fresh] handing over to deploy-prod-append.sh (migrations, build, deploy, secrets) ..."
"$ROOT/scripts/deploy-prod-append.sh"

cat <<EOF
[fresh] done. The database now holds only the schema and default settings:
  - no admin: open /admin and create one with the setup code (SETUP_TOKEN)
  - no devices, cameras, zones, floor plan or API keys: set them up again in /admin
  - every Pi needs a newly issued API_TOKEN in /etc/kmt-occupancy.env, then
    sudo systemctl restart kmt-occupancy
EOF
