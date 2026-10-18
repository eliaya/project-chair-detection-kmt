#!/usr/bin/env bash
# Export YOLO26n to NCNN on the dev PC (the export needs PyTorch; the Pi only runs NCNN).
#   ./scripts/export_model.sh   → models/yolo26n_ncnn_model/
# Then copy it to the Pi:  scp -r models <user>@<pi>:<repo dir>/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv-export"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q ultralytics

mkdir -p "$ROOT/models"
cd "$ROOT/models"
"$VENV/bin/yolo" export model=yolo26n.pt format=ncnn imgsz=640
rm -f yolo26n.pt
echo "[export] $ROOT/models/yolo26n_ncnn_model"
