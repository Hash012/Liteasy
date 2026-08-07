#!/usr/bin/env bash
set -euo pipefail

marker=/tmp/liteasy-keycloak-configured
rm -f "$marker"

/opt/keycloak/bin/kc.sh start-dev --import-realm &
server_pid=$!

stop_server() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap stop_server TERM INT

configured=false
for _attempt in $(seq 1 60); do
  if bash /opt/liteasy/configure-keycloak.sh; then
    configured=true
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    exit 1
  fi
  sleep 2
done

if [[ "$configured" != "true" ]]; then
  echo "Keycloak started but local client-role configuration did not complete." >&2
  stop_server
  exit 1
fi

touch "$marker"
wait "$server_pid"
