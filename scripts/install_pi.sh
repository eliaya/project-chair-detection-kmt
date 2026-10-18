#!/usr/bin/env bash
# One-time setup on the Raspberry Pi (Raspberry Pi OS Lite), run from the repo as the
# user that owns it:   ./scripts/install_pi.sh
# Afterwards: copy models/ from the dev PC (scripts/export_model.sh), fill in
# /etc/kmt-occupancy.env, then  sudo systemctl restart kmt-occupancy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=/etc/kmt-occupancy.env
UNIT=/etc/systemd/system/kmt-occupancy.service

sudo apt-get update -q
sudo apt-get install -y -q python3-venv
sudo timedatectl set-ntp true

python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -q --upgrade pip
"$ROOT/.venv/bin/pip" install -q -r "$ROOT/requirements-pi.txt"
# --no-deps: ncnn declares opencv-python (GUI build); the headless build above is enough.
"$ROOT/.venv/bin/pip" install -q --no-deps ncnn==1.0.20260526

if [ ! -f "$ENV_FILE" ]; then
  printf 'API_TOKEN=\nCONFIG_URL=https://<worker>/api/config\n' | sudo tee "$ENV_FILE" >/dev/null
  sudo chmod 600 "$ENV_FILE"
fi
sed -e "s|@ROOT@|$ROOT|g" -e "s|@USER@|$USER|g" "$ROOT/deploy/kmt-occupancy.service" \
  | sudo tee "$UNIT" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable kmt-occupancy

echo "[install] done."
[ -f "$ROOT/models/yolo26n_ncnn_model/model.ncnn.param" ] \
  || echo "  - models/ がありません: 開発PCで scripts/export_model.sh → scp -r models <pi>:$ROOT/"
echo "  - $ENV_FILE に API_TOKEN と CONFIG_URL を設定: sudo nano $ENV_FILE"
echo "  - 起動: sudo systemctl restart kmt-occupancy / ログ: journalctl -u kmt-occupancy -f"
