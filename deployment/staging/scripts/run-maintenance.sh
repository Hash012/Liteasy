#!/usr/bin/env bash
set -Eeuo pipefail

readonly repository=/opt/liteasy/repository
readonly compose_file="${repository}/deployment/staging/compose.yaml"
readonly env_file="${repository}/deployment/staging/config.env"

cd "${repository}"

if /usr/bin/docker compose \
  --env-file "${env_file}" \
  --file "${compose_file}" \
  --profile maintenance \
  run --rm liteasy-maintenance; then
  /usr/bin/logger -p local0.info -t liteasy-maintenance "result=success"
else
  status=$?
  /usr/bin/logger -p local0.err -t liteasy-maintenance "result=failure exit_code=${status}"
  exit "${status}"
fi
