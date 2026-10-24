#!/usr/bin/env bash

# Raspberry Pi bootstrap: installs Docker CE, the Compose plugin and git, fetches the app,
# exports the YOLO26n NCNN model if missing, then builds main.py as the kmt-occupancy image
# (Dockerfile, compose.yaml) and starts it
#
# Usage (run as root; this file can be copied over on its own):
#   scp scripts/pi_initial.sh <user>@<pi>:  &&  ssh -t <user>@<pi> sudo bash pi_initial.sh
# Inside a checkout (scripts/pi_initial.sh next to compose.yaml) that checkout is used as is.
# Offline: run it from the bundle made by scripts/build_pi_bundle.py (CHECKLIST.md there);
# Docker, the base image, wheels, the app and the model then all come from the bundle.
#
# Supports 64-bit Raspberry Pi OS (Debian 12 bookworm / 13 trixie, arm64). Docker's Raspberry Pi
# OS page sends 64-bit installs to the Debian steps; 32-bit (armhf) is not supported here.
#   https://docs.docker.com/engine/install/debian/
#   https://docs.docker.com/engine/install/raspberry-pi-os/
#
# Steps involving privileges or deletion (removing conflicting packages, docker group, stopping the
# old venv + systemd service) all prompt via whiptail dialogs. Safe to re-run.
#
# Environment variables:
#   APP_DIR=/data/docker/apps/kmt-occupancy   # where the repo is cloned (asked when not inside a checkout)
#   REPO_URL=https://github.com/eliaya/project-chair-detection-kmt.git

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PARENT="$(dirname "$SCRIPT_DIR")"
OFFLINE=0
if [[ -f "$SCRIPT_DIR/debs/Packages" && -f "$SCRIPT_DIR/app/compose.yaml" ]]; then
  OFFLINE=1
fi
if [[ -f "$SCRIPT_PARENT/compose.yaml" ]]; then
  APP_DIR="${APP_DIR:-$SCRIPT_PARENT}"
fi
APP_DIR="${APP_DIR:-/data/docker/apps/kmt-occupancy}"
REPO_URL="${REPO_URL:-https://github.com/eliaya/project-chair-detection-kmt.git}"
MODEL_PARAM=models/yolo26n_ncnn_model/model.ncnn.param
# Ultralytics' Raspberry Pi image, used once to export the model (docs.ultralytics.com/guides/raspberry-pi/)
EXPORT_IMAGE=ultralytics/ultralytics:latest-arm64
BASE_IMAGE=python:3.13-slim-trixie   # FROM in the Dockerfile; images/ in the bundle
APT_LIST=""
APT_OPTS=()
ENV_FILE=/etc/kmt-occupancy.env
OLD_UNIT=kmt-occupancy.service
TITLE="KMT Pi Setup"
export DEBIAN_FRONTEND=noninteractive

trap 'if [[ -n "$APT_LIST" ]]; then rm -f "$APT_LIST"; fi' EXIT

log() {
  printf '[pi-initial] %s\n' "$*"
}

warn() {
  printf '[pi-initial] WARN: %s\n' "$*" >&2
}

die() {
  printf '[pi-initial] ERROR: %s\n' "$*" >&2
  exit 1
}

ui_yesno() {
  whiptail --title "$TITLE" --yesno "$1" 22 78
}

ui_msg() {
  whiptail --title "$TITLE" --msgbox "$1" 22 78
}

# whiptail writes input to stderr; swap fds so $() can capture it
ui_input() {
  whiptail --title "$TITLE" --inputbox "$1" 12 78 "${2:-}" 3>&1 1>&2 2>&3 || die "Cancelled"
}

ui_password() {
  whiptail --title "$TITLE" --passwordbox "$1" 12 78 3>&1 1>&2 2>&3 || die "Cancelled"
}

# Offline, apt sees only the bundle's debs/ (no network); online, the normal sources
apt_get() {
  apt-get "${APT_OPTS[@]}" "$@"
}

compose() {
  docker compose -f "$APP_DIR/compose.yaml" "$@"
}

preflight() {
  [[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"
  [[ -t 0 && -t 1 ]] || die "An interactive terminal is required"
  [[ -r /etc/os-release ]] || die "/etc/os-release not found"
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == "debian" ]] || die "Only 64-bit Raspberry Pi OS (ID=debian) is supported, detected: ${PRETTY_NAME:-unknown}"
  [[ "$(dpkg --print-architecture)" == "arm64" ]] \
    || die "Only arm64 is supported, detected: $(dpkg --print-architecture). Use the 64-bit Raspberry Pi OS"

  if ((OFFLINE)); then
    [[ "${VERSION_CODENAME:-}" == "trixie" ]] \
      || die "The bundle is for Raspberry Pi OS trixie (Debian 13), detected: ${PRETTY_NAME:-unknown}"
    [[ "$SCRIPT_DIR" != *" "* ]] || die "Move the bundle to a path without spaces (apt file: URI): ${SCRIPT_DIR}"
    APT_LIST="$(mktemp)"
    printf 'deb [trusted=yes] file:%s/debs ./\n' "$SCRIPT_DIR" >"$APT_LIST"
    APT_OPTS=(-o "Dir::Etc::SourceList=${APT_LIST}" -o Dir::Etc::SourceParts=- -o APT::Get::List-Cleanup=0)
    log "Offline bundle: $(head -1 "$SCRIPT_DIR/VERSION" 2>/dev/null)"
    apt_get update
  fi

  if ! command -v whiptail >/dev/null 2>&1; then
    log "Installing whiptail (interactive dialogs)..."
    ((OFFLINE)) || apt_get update
    apt_get install -y whiptail
  fi

  case "${VERSION_CODENAME:-}" in
    bookworm|trixie) ;;
    *)
      ui_yesno "Docker officially supports only Debian 12 (bookworm) and 13 (trixie).

Detected: ${PRETTY_NAME:-unknown}

Continue anyway?" || die "Cancelled"
      ;;
  esac

  local source="the official apt repository, and git" app="Clone the app into ${APP_DIR}, or update it there (git pull)"
  if ((OFFLINE)); then
    source="this bundle, offline" app="Copy the app and model from this bundle (asks for the directory)"
  fi
  ui_yesno "This script will run on this host:

  1. Install Docker CE and the Compose plugin (${source})
  2. Add login accounts to the docker group (will ask)
  3. ${app}
  4. Export the YOLO26n NCNN model if models/ is missing (will ask)
  5. Write ${ENV_FILE} if missing (asks for the Worker URL and device token)
  6. Stop the old venv + systemd service if present (will ask)
  7. Build main.py as the kmt-occupancy image and start it

Continue?" || die "Cancelled"
}

remove_conflicting_packages() {
  local -a found=()
  local pkg

  for pkg in docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
      found+=("$pkg")
    fi
  done
  ((${#found[@]} > 0)) || return 0

  ui_yesno "The following packages conflict with Docker CE and must be removed:

  ${found[*]}

Images, containers and volumes in /var/lib/docker will not be deleted.

Remove them?" || die "Conflicting packages not removed; cannot install Docker CE"
  apt-get remove -y "${found[@]}"
}

install_docker() {
  if ((OFFLINE)); then
    log "Installing Docker CE from the bundle (debs/)..."
    apt_get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    install_docker_online
  fi
  systemctl enable --now docker
  # docker info, not hello-world: that needs Docker Hub
  docker info >/dev/null
  log "Docker $(docker version --format '{{.Server.Version}}'), Compose $(docker compose version --short) ready"
}

install_docker_online() {
  log "Configuring the official Docker apt repository..."
  apt-get update
  apt-get install -y ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  log "Installing Docker CE..."
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

grant_docker_access() {
  local -a items=()
  local name uid selected
  while IFS=: read -r name _ uid _; do
    if ((uid >= 1000 && uid < 65534)) && ! id -nG "$name" | grep -qw docker; then
      items+=("$name" "" "$([[ "$name" == "${SUDO_USER:-}" ]] && echo ON || echo OFF)")
    fi
  done </etc/passwd
  ((${#items[@]} > 0)) || return 0

  selected="$(whiptail --title "$TITLE" --separate-output --checklist \
    "Select login accounts to add to the docker group (docker without sudo; equivalent to root).
If none are needed, just press OK:" 20 78 10 "${items[@]}" 3>&1 1>&2 2>&3)" || return 0
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    usermod -aG docker "$name"
    log "Added ${name} to the docker group (takes effect after re-login)"
  done <<<"$selected"
}

# Offline: the bundle's app/ (code, models/, wheels/) is copied over; state stays in the volume
copy_bundle_app() {
  APP_DIR="$(ui_input "Directory to install the app into:" "$APP_DIR")"
  if [[ -f "$APP_DIR/compose.yaml" ]]; then
    ui_yesno "${APP_DIR} already has the app. Overwrite its files with this bundle's?
(${ENV_FILE} and the container's data volume are kept.)" || {
      log "Keeping the app in ${APP_DIR}"
      return 0
    }
  elif [[ -e "$APP_DIR" && -n "$(ls -A "$APP_DIR")" ]]; then
    die "${APP_DIR} exists, is not empty and has no compose.yaml; choose another directory or empty it"
  fi
  install -d -m 0755 "$APP_DIR"
  cp -a "$SCRIPT_DIR/app/." "$APP_DIR/"
  log "Copied the bundle's app into ${APP_DIR}"
}

# A re-run brings an existing checkout up to date: an old compose.yaml or main.py stays otherwise
update_checkout() {
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" pull --ff-only \
      || warn "git pull failed in ${APP_DIR}; building the app as it is"
  fi
  log "Using the app in ${APP_DIR}"
}

fetch_app() {
  if ((OFFLINE)); then
    copy_bundle_app
    return 0
  fi
  if [[ -f "$APP_DIR/compose.yaml" ]]; then
    update_checkout
    return 0
  fi
  APP_DIR="$(ui_input "Directory to clone the app into:" "$APP_DIR")"
  if [[ -f "$APP_DIR/compose.yaml" ]]; then
    update_checkout
    return 0
  fi
  [[ ! -e "$APP_DIR" || -z "$(ls -A "$APP_DIR")" ]] \
    || die "${APP_DIR} exists, is not empty and has no compose.yaml; choose another directory or empty it"
  local url
  url="$(ui_input "Git repository of the app (a private repo asks for credentials, e.g. a GitHub token):" "$REPO_URL")"
  install -d -m 0755 "$(dirname "$APP_DIR")"
  git clone "$url" "$APP_DIR" || die "git clone failed. Alternatively copy the repo from the dev PC:
  rsync -a --exclude node_modules --exclude '.venv*' ./ <user>@<pi>:${APP_DIR}/
and re-run: sudo bash ${APP_DIR}/scripts/pi_initial.sh"
  [[ -f "$APP_DIR/compose.yaml" ]] || die "${url} has no compose.yaml (push the latest main first)"
  log "Cloned ${url} into ${APP_DIR}"
}

# models/ is not in git; scripts/export_model.sh on a dev PC does the same
export_model() {
  if [[ -f "$APP_DIR/$MODEL_PARAM" ]]; then
    log "Model found: ${MODEL_PARAM}"
    return 0
  fi
  if ((OFFLINE)); then
    warn "No model in the bundle; rebuild it (scripts/build_pi_bundle.py) or scp -r models <pi>:${APP_DIR}/"
    return 0
  fi
  ui_yesno "${APP_DIR}/models/ has no YOLO26n NCNN model.

Export it on this Pi with Ultralytics' image ${EXPORT_IMAGE}?
It downloads about 1 GB and yolo26n.pt, and takes several minutes.
The image is removed afterwards.

No: copy models/ from the dev PC later (scripts/export_model.sh)." || {
    warn "Model not exported"
    return 0
  }
  install -d -m 0755 "$APP_DIR/models"
  docker run --rm --ipc=host -v "$APP_DIR/models:/models" -w /models "$EXPORT_IMAGE" \
    yolo export model=yolo26n.pt format=ncnn imgsz=640
  rm -f "$APP_DIR/models/yolo26n.pt"
  docker image rm "$EXPORT_IMAGE" >/dev/null || true
  [[ -f "$APP_DIR/$MODEL_PARAM" ]] || die "Export finished without ${MODEL_PARAM}"
  log "Exported ${MODEL_PARAM}"
}

# Same file as the old systemd setup: API_TOKEN and CONFIG_URL
write_env_file() {
  # docker compose reads env_file itself, so the docker group (docker compose without sudo) needs read
  if [[ -f "$ENV_FILE" ]]; then
    chgrp docker "$ENV_FILE" && chmod 0640 "$ENV_FILE"
    log "${ENV_FILE} exists, keeping it"
    return 0
  fi
  local url token
  url="$(ui_input "Worker config URL (leave empty to fill in ${ENV_FILE} later):" "https://<worker>/api/config")"
  token="$(ui_password "Device token from the admin UI (Devices -> issue token; may be empty for now):")"
  install -m 0640 -g docker /dev/null "$ENV_FILE"
  printf 'API_TOKEN=%s\nCONFIG_URL=%s\n' "$token" "$url" >"$ENV_FILE"
  log "Wrote ${ENV_FILE}"
}

# The venv + systemd setup would hold the camera too
stop_systemd_service() {
  systemctl is-enabled --quiet "$OLD_UNIT" 2>/dev/null || systemctl is-active --quiet "$OLD_UNIT" || return 0
  if ui_yesno "${OLD_UNIT} (old venv + systemd setup) is installed. It runs main.py outside Docker
and would hold the camera at the same time as the container.

Stop and disable it? (The unit file is kept; re-enable with
  systemctl enable --now ${OLD_UNIT})"; then
    systemctl disable --now "$OLD_UNIT"
    log "Stopped and disabled ${OLD_UNIT}"
  else
    warn "${OLD_UNIT} left running; the container may fail to open the camera"
  fi
}

build_image() {
  log "Building the kmt-occupancy image..."
  if ((OFFLINE)); then
    docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 \
      || docker load -i "$SCRIPT_DIR/images/${BASE_IMAGE//[:]/-}.tar"
    # The wheels context replaces the Dockerfile's wheels stage; --no-index keeps pip off PyPI
    docker build --build-context wheels="$APP_DIR/wheels" --build-arg PIP_OPTS=--no-index \
      -t kmt-occupancy "$APP_DIR"
  else
    compose build
  fi
  # The image alone: compose run would need the camera device present
  docker run --rm kmt-occupancy python -c "import cv2, ncnn, numpy"
  log "Image ready: $(docker image inspect kmt-occupancy --format '{{.Id}}' | cut -c1-19)"
}

start_container() {
  local -a missing=()
  [[ -f "$APP_DIR/$MODEL_PARAM" ]] \
    || missing+=("models/ (re-run this script, or scp -r models <pi>:${APP_DIR}/)")
  grep -q '^API_TOKEN=.' "$ENV_FILE" || missing+=("API_TOKEN in ${ENV_FILE}")
  if ! grep -Eq '^CONFIG_URL=https?://' "$ENV_FILE" || grep -q '<worker>' "$ENV_FILE"; then
    missing+=("CONFIG_URL in ${ENV_FILE}")
  fi
  if ((${#missing[@]} > 0)); then
    warn "Not started; missing: ${missing[*]}"
    return 0
  fi
  compose up -d
  log "Started: $(compose ps --format '{{.Name}} {{.Status}}')"
  # Not fatal: main.py retries the camera and reports it to the admin UI
  compgen -G '/dev/video*' >/dev/null || warn "No camera (/dev/video*) yet; plug it in, main.py picks it up"
}

summary() {
  ui_msg "Done. Next steps:

1. If not started yet: copy models/ from the dev PC and fill in ${ENV_FILE}
   (sudo nano ${ENV_FILE}), then
   cd ${APP_DIR} && docker compose up -d
2. Logs: docker compose logs -f   (in ${APP_DIR})
3. Update: sudo git pull, then docker compose up -d --build
   (offline: re-run pi_initial.sh from a new bundle, then docker compose up -d)
4. Camera: any /dev/videoN, also plugged in later (set its path in the admin UI)
5. docker without sudo: accounts in the docker group, after logging in again"
  log "Done. docker: $(systemctl is-active docker), container: $(compose ps --format '{{.Status}}' | head -1)"
}

main() {
  preflight
  remove_conflicting_packages
  install_docker
  grant_docker_access
  fetch_app
  export_model
  write_env_file
  stop_systemd_service
  build_image
  start_container
  summary
}

main "$@"
