#!/usr/bin/env bash
# LiteasyClaw 一键关闭脚本
# 终止 start.sh 启动的整个进程组（dev-cloud + Vite / Tauri），
# 并按端口兜底清理可能残留的进程。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$REPO_ROOT/.liteasy-run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"
CLOUD_PORT="${LITEASY_DEV_CLOUD_PORT:-8787}"
DESKTOP_PORT="${LITEASY_DESKTOP_PORT:-1420}"

stop_by_port() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -k "$port"/tcp 2>/dev/null && fuser "$port"/tcp 2>/dev/null | tr -d ' ' || true)"
  fi
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi
}

stopped_anything=false

# 1) 优先关闭整个进程组
if [[ -f "$PID_FILE" ]]; then
  LEADER="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$LEADER" ]] && kill -0 "$LEADER" 2>/dev/null; then
    echo "==> 关闭进程组 PGID=$LEADER ..."
    # SIGTERM 让 dev-with-cloud.mjs 的处理器优雅关闭子进程
    kill -TERM "-$LEADER" 2>/dev/null || kill -TERM "$LEADER" 2>/dev/null || true
    stopped_anything=true
  fi
  rm -f "$PID_FILE"
fi

# 2) 兜底：按端口清理残留进程
echo "==> 按端口清理残留（$DESKTOP_PORT / $CLOUD_PORT）..."
stop_by_port "$DESKTOP_PORT"
stop_by_port "$CLOUD_PORT"

# 3) 确认已退出（最多等 10 秒）
for _ in $(seq 1 10); do
  sleep 1
  if ! kill -0 "-${LEADER:-0}" 2>/dev/null && ! kill -0 "${LEADER:-0}" 2>/dev/null; then
    break
  fi
done

# 4) 仍有残留则强杀
if [[ -n "${LEADER:-}" ]] && kill -0 "-$LEADER" 2>/dev/null; then
  echo "==> 进程未退出，强制 SIGKILL ..."
  kill -KILL "-$LEADER" 2>/dev/null || true
fi

echo "==> 已停止。"
if [[ -f "$LOG_FILE" ]] && [[ "${KEEP_LOG:-0}" != "1" ]]; then
  : # 保留日志便于排错，不主动删除
fi
