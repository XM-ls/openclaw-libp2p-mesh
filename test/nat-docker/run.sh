#!/usr/bin/env bash
#
# Automation for the docker-compose-based NAT-traversal end-to-end test.
#
# Subcommands:
#   ./run.sh build     —— Just build the openclaw-nat-test image (slow first time)
#   ./run.sh up        —— Bring up relay → harvest PeerID → bring up clients
#   ./run.sh verify    —— Send messages A↔B and assert receipt in container logs
#   ./run.sh peers     —— Print the 3 PeerIDs
#   ./run.sh status    —— Show getNATStatus()-style info per container
#   ./run.sh logs <svc> —— Tail container logs (svc = relay | client-a | client-b)
#   ./run.sh down      —— Stop containers, keep volumes
#   ./run.sh clean     —— down + remove volumes + remove .state/

set -euo pipefail

# ---------- paths & helpers ----------
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${HARNESS_DIR}/.state"
TEMPLATE_DIR="${HARNESS_DIR}/config"

# Pick docker compose flavour (v2 plugin preferred; fall back to classic docker-compose).
if docker compose version >/dev/null 2>&1; then
  DC_BIN=("docker" "compose")
elif command -v docker-compose >/dev/null 2>&1; then
  DC_BIN=("docker-compose")
else
  echo "ERROR: neither 'docker compose' (v2) nor 'docker-compose' (v1) is installed." >&2
  exit 1
fi

dc() { "${DC_BIN[@]}" -f "${HARNESS_DIR}/docker-compose.yml" "$@"; }
log() { printf '\033[1;32m[run.sh]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[run.sh]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[run.sh]\033[0m %s\n' "$*" >&2; exit 1; }

ensure_state_dirs() {
  mkdir -p "${STATE_DIR}/relay" "${STATE_DIR}/client-a" "${STATE_DIR}/client-b"
}

wait_for_log() {
  local container="$1"; local pattern="$2"; local timeout="${3:-60}"
  log "Waiting for '${pattern}' in ${container} (timeout ${timeout}s)..."
  local deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    if docker logs "${container}" 2>&1 | grep -Eq "${pattern}"; then
      return 0
    fi
    sleep 1
  done
  die "Timed out waiting for '${pattern}' in ${container}. Recent logs:\n$(docker logs --tail 30 ${container} 2>&1)"
}

extract_relay_peer_id() {
  # Look for "Peer ID: 12D3KooW..." in relay logs.
  docker logs nat-test-relay 2>&1 \
    | grep -oE 'Peer ID: 12D3KooW[A-Za-z0-9]+' \
    | tail -n1 \
    | awk '{print $3}'
}

extract_peer_id_for() {
  docker logs "$1" 2>&1 \
    | grep -oE 'Peer ID: 12D3KooW[A-Za-z0-9]+' \
    | tail -n1 \
    | awk '{print $3}'
}

# ---------- subcommands ----------
cmd_build() {
  ensure_state_dirs
  # the build step doesn't need the placeholder substitution
  cp "${TEMPLATE_DIR}/relay/openclaw.json"    "${STATE_DIR}/relay/openclaw.json"
  cp "${TEMPLATE_DIR}/client-a/openclaw.json" "${STATE_DIR}/client-a/openclaw.json"
  cp "${TEMPLATE_DIR}/client-b/openclaw.json" "${STATE_DIR}/client-b/openclaw.json"
  log "Building openclaw-nat-test image (first build can take 5–10 minutes)..."
  dc build relay
}

cmd_up() {
  ensure_state_dirs

  # 1. Seed relay config (no placeholders inside) and start relay only.
  cp "${TEMPLATE_DIR}/relay/openclaw.json" "${STATE_DIR}/relay/openclaw.json"
  log "Starting relay..."
  dc up -d relay
  wait_for_log nat-test-relay 'Peer ID: 12D3KooW' 90

  local relay_id
  relay_id="$(extract_relay_peer_id)"
  [ -n "${relay_id}" ] || die "Could not extract RELAY-PEER-ID from relay logs."
  log "RELAY-PEER-ID = ${relay_id}"

  # Also confirm Circuit Relay v2 SERVER actually started
  if ! docker logs nat-test-relay 2>&1 | grep -q "Circuit Relay v2 SERVER enabled"; then
    warn "Relay logs do not mention 'Circuit Relay v2 SERVER enabled' — relay may not be configured as a server. Continuing anyway, but expect reservation failures."
  fi

  # 2. Generate client configs with placeholder replaced.
  for client in client-a client-b; do
    sed "s|__RELAY_PEER_ID__|${relay_id}|g" \
        "${TEMPLATE_DIR}/${client}/openclaw.json" \
        > "${STATE_DIR}/${client}/openclaw.json"
  done

  # 3. Start clients.
  log "Starting clients..."
  dc up -d client-a client-b

  # 4. Wait until each client has acquired a /p2p-circuit reservation on the relay.
  wait_for_log nat-test-client-a 'Active relay reservations' 90
  wait_for_log nat-test-client-b 'Active relay reservations' 90

  log "All three nodes up. Peer IDs:"
  cmd_peers
  log "Try:   ./run.sh verify"
}

cmd_peers() {
  printf '  %-12s  %s\n' "relay"    "$(extract_peer_id_for nat-test-relay   || echo '?')"
  printf '  %-12s  %s\n' "client-a" "$(extract_peer_id_for nat-test-client-a || echo '?')"
  printf '  %-12s  %s\n' "client-b" "$(extract_peer_id_for nat-test-client-b || echo '?')"
}

cmd_status() {
  for c in nat-test-relay nat-test-client-a nat-test-client-b; do
    printf '\n=== %s ===\n' "$c"
    docker logs --tail 200 "$c" 2>&1 \
      | grep -E "NAT traversal services|Active relay reservations|Listening on|Node started|Connected to relay|Peer connected" \
      | tail -n 12
  done
}

cmd_verify() {
  local id_a id_b
  id_a="$(extract_peer_id_for nat-test-client-a)" || die "client-a not running?"
  id_b="$(extract_peer_id_for nat-test-client-b)" || die "client-b not running?"
  [ -n "${id_a}" ] && [ -n "${id_b}" ] || die "PeerIDs could not be extracted."

  log "client-a → client-b ..."
  local marker_ab="nat-docker-ab-$(date +%s)"
  dc exec -T client-a node /app/openclaw/openclaw.mjs \
    message send libp2p-mesh "${id_b}" "${marker_ab}" \
    || warn "send A→B exited non-zero"

  log "client-b → client-a ..."
  local marker_ba="nat-docker-ba-$(date +%s)"
  dc exec -T client-b node /app/openclaw/openclaw.mjs \
    message send libp2p-mesh "${id_a}" "${marker_ba}" \
    || warn "send B→A exited non-zero"

  # Give libp2p a moment to deliver the messages.
  sleep 3

  local ok_ab=0 ok_ba=0
  if docker logs nat-test-client-b 2>&1 | grep -q "${marker_ab}"; then
    ok_ab=1
    log "✓ client-b received: ${marker_ab}"
  else
    warn "✗ client-b did NOT receive: ${marker_ab}"
  fi
  if docker logs nat-test-client-a 2>&1 | grep -q "${marker_ba}"; then
    ok_ba=1
    log "✓ client-a received: ${marker_ba}"
  else
    warn "✗ client-a did NOT receive: ${marker_ba}"
  fi

  if [ "${ok_ab}" -eq 1 ] && [ "${ok_ba}" -eq 1 ]; then
    log "End-to-end NAT-traversal verification PASSED."
    exit 0
  else
    warn "End-to-end NAT-traversal verification FAILED. Run './run.sh status' and './run.sh logs <svc>' for details."
    exit 1
  fi
}

cmd_logs() {
  local svc="${1:-}"
  [ -n "${svc}" ] || die "Usage: ./run.sh logs <relay|client-a|client-b>"
  dc logs -f --tail 200 "${svc}"
}

cmd_down() {
  log "Stopping containers (volumes kept)..."
  dc down
}

cmd_clean() {
  log "Stopping containers and removing volumes + .state/ ..."
  dc down -v
  rm -rf "${STATE_DIR}"
}

case "${1:-}" in
  build)  cmd_build ;;
  up)     cmd_up ;;
  verify) cmd_verify ;;
  peers)  cmd_peers ;;
  status) cmd_status ;;
  logs)   shift; cmd_logs "$@" ;;
  down)   cmd_down ;;
  clean)  cmd_clean ;;
  *)
    cat <<EOF
usage: ./run.sh <subcommand>

  build               Build the openclaw-nat-test image (slow first time).
  up                  Bring up relay first, harvest its PeerID, then clients.
  verify              Send messages A↔B and assert receipt — exits 0 on success.
  peers               Print the 3 PeerIDs.
  status              Per-container summary of NAT services + reservations.
  logs <svc>          Tail container logs (svc = relay | client-a | client-b).
  down                Stop containers, keep volumes (PeerIDs persist).
  clean               down + remove volumes and .state/ (start from scratch).
EOF
    exit 1
    ;;
esac
