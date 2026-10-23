#!/usr/bin/env bash

# Raspberry Pi bootstrap: installs Docker CE and the Compose plugin, then builds main.py as the
# kmt-occupancy image (Dockerfile, compose.yaml) and starts it
#
# Usage (run as root from the cloned repo on the Pi):
#   sudo bash scripts/pi_initial.sh
#
# Supports 64-bit Raspberry Pi OS (Debian 12 bookworm / 13 trixie, arm64). Docker's Raspberry Pi
# OS page sends 64-bit installs to the Debian steps; 32-bit (armhf) is not supported here.
#   https://docs.docker.com/engine/install/debian/
#   https://docs.docker.com/engine/install/raspberry-pi-os/
#
# Steps involving privileges or deletion (removing conflicting packages, docker group, stopping the
# systemd service of scripts/install_pi.sh) all prompt via whiptail dialogs. Safe to re-run.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=/etc/kmt-occupancy.env
OLD_UNIT=kmt-occupancy.service
TITLE="KMT Pi Setup"
export DEBIAN_FRONTEND=noninteractive

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

compose() {
  docker compose -f "$ROOT/compose.yaml" "$@"
}

preflight() {
  [[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"
  [[ -t 0 && -t 1 ]] || die "An interactive terminal is required"
  [[ -f "$ROOT/compose.yaml" && -f "$ROOT/main.py" ]] || die "Run from the cloned repo (no compose.yaml in ${ROOT})"
  [[ -r /etc/os-release ]] || die "/etc/os-release not found"
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == "debian" ]] || die "Only 64-bit Raspberry Pi OS (ID=debian) is supported, detected: ${PRETTY_NAME:-unknown}"
  [[ "$(dpkg --print-architecture)" == "arm64" ]] \
    || die "Only arm64 is supported, detected: $(dpkg --print-architecture). Use the 64-bit Raspberry Pi OS"

  if ! command -v whiptail >/dev/null 2>&1; then
    log "Installing whiptail (interactive dialogs)..."
    apt-get update
    apt-get install -y whiptail
  fi

  case "${VERSION_CODENAME:-}" in
    bookworm|trixie) ;;
    *)
      ui_yesno "Docker officially supports only Debian 12 (bookworm) and 13 (trixie).

Detected: ${PRETTY_NAME:-unknown}

Continue anyway?" || die "Cancelled"
      ;;
  esac

  ui_yesno "This script will run on this host:

  1. Install Docker CE and the Compose plugin (official apt repository)
  2. Add login accounts to the docker group (will ask)
  3. Write ${ENV_FILE} if missing (asks for the Worker URL and device token)
  4. Stop the systemd service of install_pi.sh if present (will ask)
  5. Build main.py as the kmt-occupancy image and start it

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
  log "Configuring the official Docker apt repository..."
  apt-get update
  apt-get install -y ca-certificates curl
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
  systemctl enable --now docker
  docker run --rm hello-world >/dev/null
  log "Docker $(docker version --format '{{.Server.Version}}'), Compose $(docker compose version --short) ready"
}

grant_docker_access() {
  local -a items=()
  local name uid selected
  while IFS=: read -r name _ uid _; do
    if ((uid >= 1000 && uid < 65534)) && ! id -nG "$name" | grep -qw docker; then
      items+=("$name" "" OFF)
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

# Same file as the systemd setup (install_pi.sh): API_TOKEN and CONFIG_URL
write_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    log "${ENV_FILE} exists, keeping it"
    return 0
  fi
  local url token
  url="$(ui_input "Worker config URL (leave empty to fill in ${ENV_FILE} later):" "https://<worker>/api/config")"
  token="$(ui_password "Device token from the admin UI (Devices -> issue token; may be empty for now):")"
  install -m 0600 /dev/null "$ENV_FILE"
  printf 'API_TOKEN=%s\nCONFIG_URL=%s\n' "$token" "$url" >"$ENV_FILE"
  log "Wrote ${ENV_FILE}"
}

# The venv + systemd setup would hold the camera too
stop_systemd_service() {
  systemctl is-enabled --quiet "$OLD_UNIT" 2>/dev/null || systemctl is-active --quiet "$OLD_UNIT" || return 0
  if ui_yesno "${OLD_UNIT} (scripts/install_pi.sh) is installed. It runs main.py outside Docker
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
  compose build
  # The image alone: compose run would need the camera device present
  docker run --rm kmt-occupancy python -c "import cv2, ncnn, numpy"
  log "Image ready: $(docker image inspect kmt-occupancy --format '{{.Id}}' | cut -c1-19)"
}

start_container() {
  local -a missing=()
  [[ -f "$ROOT/models/yolo26n_ncnn_model/model.ncnn.param" ]] \
    || missing+=("models/ (scripts/export_model.sh on the dev PC, then scp -r models <pi>:${ROOT}/)")
  [[ -e /dev/video0 ]] || missing+=("camera /dev/video0")
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
}

summary() {
  ui_msg "Done. Next steps:

1. If not started yet: copy models/ from the dev PC and fill in ${ENV_FILE}
   (sudo nano ${ENV_FILE}), then
   cd ${ROOT} && sudo docker compose up -d
2. Logs: sudo docker compose logs -f   (in ${ROOT})
3. After git pull: sudo docker compose up -d --build
4. Another camera: add its device to compose.yaml (devices)"
  log "Done. docker: $(systemctl is-active docker), container: $(compose ps --format '{{.Status}}' | head -1)"
}

main() {
  preflight
  remove_conflicting_packages
  install_docker
  grant_docker_access
  write_env_file
  stop_systemd_service
  build_image
  start_container
  summary
}

main "$@"
