#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "install-swap.sh must run as root" >&2
  exit 1
fi

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

if swapon --noheadings --show=NAME | grep -Fxq /swapfile; then
  echo "The Liteasy staging swap file is already active."
  exit 0
fi

if [ -e /swapfile ]; then
  echo "/swapfile already exists but is not active; refusing to overwrite it" >&2
  exit 1
fi

fallocate -l 2G /swapfile
chmod 0600 /swapfile
mkswap /swapfile >/dev/null
install -m 0644 -o root -g root \
  "${script_directory}/swapfile.swap" \
  /etc/systemd/system/swapfile.swap
install -m 0644 -o root -g root \
  "${script_directory}/99-liteasy-staging-memory.conf" \
  /etc/sysctl.d/99-liteasy-staging-memory.conf
systemctl daemon-reload
systemctl enable --now swapfile.swap
sysctl --system >/dev/null

echo "A 2 GiB persistent swap file is active with vm.swappiness=10."
