#!/usr/bin/env bash

# One-command update of main.py on the Pi: new app files, image rebuilt, container restarted.
# Kept: conf/ (API_TOKEN, CONFIG_URL) and the container's data volume (unsent queue).
#
#   sudo bash /data/docker/apps/kmt-occupancy/scripts/pi_update.sh            # latest GitHub Release
#   sudo bash /data/docker/apps/kmt-occupancy/scripts/pi_update.sh <kmt-pi-bundle-vX.tar.gz>
#                                         # offline: the bundle and its .sha256 next to it (USB)
# In a git checkout without an argument: git pull, then rebuild.
# Docker itself is not upgraded; for that re-run pi_initial.sh from a new bundle.
#
# Environment variables:
#   REPO=eliaya/project-chair-detection-kmt   # GitHub repository of the releases
#   FORCE=1                                   # reinstall even when the version is unchanged

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${REPO:-eliaya/project-chair-detection-kmt}"
BASE_IMAGE=python:3.13-slim-trixie   # FROM in the Dockerfile; images/ in the bundle

log() {
  printf '[pi-update] %s\n' "$*"
}

die() {
  printf '[pi-update] ERROR: %s\n' "$*" >&2
  exit 1
}

compose() {
  docker compose -f "$APP_DIR/compose.yaml" "$@"
}

version_of() {
  sed -n 's/^VERSION = "\(.*\)"$/\1/p' "$1"
}

finish() {
  # The image alone: compose run would need the camera device present
  docker run --rm kmt-occupancy python -c "import cv2, ncnn, numpy, websockets"
  compose up -d
  log "Updated to $(version_of "$APP_DIR/main.py"): $(compose ps --format '{{.Name}} {{.Status}}')"
}

[[ -f "$APP_DIR/compose.yaml" && -f "$APP_DIR/main.py" ]] || die "No app in ${APP_DIR}"
[[ -w "$APP_DIR" ]] || die "Run as root: sudo bash $0 $*"
current="$(version_of "$APP_DIR/main.py")"

if [[ -d "$APP_DIR/.git" && $# -eq 0 ]]; then
  git -C "$APP_DIR" pull --ff-only
  compose build
  finish
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if (($# > 0)); then
  tarball="$1"
  sum="$1.sha256"
else
  log "Looking up the latest release of ${REPO}..."
  url="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -o '"browser_download_url": *"[^"]*/kmt-pi-bundle-[^"/]*\.tar\.gz"' | cut -d'"' -f4)" \
    || die "Cannot read the latest release (no internet?). Offline: pass a bundle .tar.gz"
  [[ -n "$url" ]] || die "The latest release of ${REPO} has no kmt-pi-bundle-*.tar.gz"
  log "Downloading ${url##*/} (about 190 MB)..."
  tarball="$TMP/${url##*/}"
  sum="$tarball.sha256"
  curl -fL --retry 3 -o "$tarball" "$url"
  curl -fsSL --retry 3 -o "$sum" "$url.sha256"
fi
[[ -f "$tarball" ]] || die "No such file: ${tarball}"
[[ -f "$sum" ]] || die "No checksum ${sum} (copy it next to the bundle)"
printf '%s  %s\n' "$(cut -d' ' -f1 "$sum")" "$tarball" | sha256sum -c --quiet \
  || die "Checksum mismatch: ${tarball} is damaged or incomplete"

tar -xzf "$tarball" -C "$TMP"
BUNDLE="$TMP/kmt-pi-bundle"
[[ -f "$BUNDLE/app/main.py" ]] || die "${tarball} is not a kmt-pi-bundle"
(cd "$BUNDLE" && sha256sum -c --quiet SHA256SUMS) || die "Bundle files damaged (SHA256SUMS)"
new="$(version_of "$BUNDLE/app/main.py")"
if [[ "$new" == "$current" && "${FORCE:-0}" != 1 ]]; then
  log "Already ${current}; nothing to do (FORCE=1 reinstalls)"
  exit 0
fi
log "main.py ${current} -> ${new}"

# wheels/ replaced, so old versions do not pile up; conf/ is not in the bundle
rm -rf "$APP_DIR/wheels"
cp -a "$BUNDLE/app/." "$APP_DIR/"
# The bundle's base image may be newer than the loaded one
docker load -q -i "$BUNDLE/images/${BASE_IMAGE//[:]/-}.tar"
log "Building the kmt-occupancy image..."
docker build -q --build-context wheels="$APP_DIR/wheels" --build-arg PIP_OPTS=--no-index \
  -t kmt-occupancy "$APP_DIR" >/dev/null
finish
