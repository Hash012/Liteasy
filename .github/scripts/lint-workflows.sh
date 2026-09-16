#!/usr/bin/env bash
set -euo pipefail

# Pin the validator and checksum; never pipe a mutable remote script into a shell.
lint_dir="${RUNNER_TEMP:-/tmp}/liteasy-actionlint-1.7.12"
mkdir -p "$lint_dir"
if [[ ! -f "$lint_dir/actionlint.tar.gz" ]]; then
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors --connect-timeout 15 --max-time 120 \
    https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz \
    --output "$lint_dir/actionlint.tar.gz"
fi
printf '%s  %s\n' '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' "$lint_dir/actionlint.tar.gz" | sha256sum --check --status
tar -xzf "$lint_dir/actionlint.tar.gz" -C "$lint_dir" actionlint
"$lint_dir/actionlint" -color
