#!/usr/bin/env bash
set -euo pipefail

tls_dir=/var/lib/postgresql/tls
mkdir -p "$tls_dir"
if [[ ! -s "$tls_dir/server.key" || ! -s "$tls_dir/server.crt" ]]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
    -subj "/CN=liteasy-local-postgres" \
    -keyout "$tls_dir/server.key" \
    -out "$tls_dir/server.crt"
fi
chown -R postgres:postgres "$tls_dir"
chmod 600 "$tls_dir/server.key"
chmod 644 "$tls_dir/server.crt"

exec docker-entrypoint.sh "$@"
