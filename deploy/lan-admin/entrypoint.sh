#!/bin/sh
# First start: generates SESSION_SECRET and the setup code (kept in $DATA). Every start: applies
# the D1 migrations, then serves the admin UI and /api on port 8787.
set -eu
DATA="${DATA:-/data}"
umask 077
[ -s "$DATA/session_secret" ] || head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_' > "$DATA/session_secret"
[ -s "$DATA/setup_code" ] || head -c 18 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_' > "$DATA/setup_code"
echo "[lan-admin] setup code (first admin only): $(cat "$DATA/setup_code")"
npx wrangler d1 migrations apply kmt-occupancy --local --persist-to "$DATA/state"
exec npx wrangler dev --ip 0.0.0.0 --port "${PORT:-8787}" --persist-to "$DATA/state" \
  --show-interactive-dev-session=false \
  --var "SESSION_SECRET:$(cat "$DATA/session_secret")" --var "SETUP_TOKEN:$(cat "$DATA/setup_code")"
