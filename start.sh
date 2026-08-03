#!/usr/bin/env bash
# LiteasyClaw 一键启动脚本
#   ./start.sh            # Web 开发模式：Vite 前端(1420) + dev-cloud 后端(8787)
#   ./start.sh --tauri     # 完整 Tauri 桌面应用（需要 Rust 工具链 + WSLg/X server）
#   ./start.sh --help
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$REPO_ROOT/LiteasyClaw/desktop"
CLOUD_DIR="$REPO_ROOT/LiteasyClaw/services/dev-cloud"
RUN_DIR="$REPO_ROOT/.liteasy-run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"
MODE="web"

usage() {
  cat <<'EOF'
LiteasyClaw 一键启动

用法:
  ./start.sh             启动 Web 开发模式（Vite + dev-cloud）
  ./start.sh --tauri     启动 Tauri 桌面应用（需 Rust 工具链）
  ./start.sh --help      显示本帮助

环境变量（可选）:
  LITEASY_DEV_CLOUD_PORT   dev-cloud 端口（默认 8787）
  LITEASY_DESKTOP_PORT     Vite 端口（默认 1420）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tauri) MODE="tauri"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $1（使用 --help 查看用法）" >&2; exit 1 ;;
  esac
done

mkdir -p "$RUN_DIR"

# 已在运行则拒绝重复启动
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "已有实例在运行（PID $(cat "$PID_FILE")）。请先执行 ./stop.sh。" >&2
  exit 1
fi
rm -f "$PID_FILE"

echo "==> 检查依赖..."

# dev-cloud 依赖
if [[ ! -d "$CLOUD_DIR/node_modules" ]]; then
  echo "    安装 dev-cloud 依赖..."
  (cd "$CLOUD_DIR" && npm install)
fi

# 桌面端依赖
if [[ ! -d "$DESKTOP_DIR/node_modules" ]]; then
  echo "    安装 desktop 依赖..."
  (cd "$DESKTOP_DIR" && npm install)
fi

# 初始化 .env.local（密钥由用户自行填写，不覆盖已存在文件）
ENV_LOCAL="$CLOUD_DIR/.env.local"
if [[ ! -f "$ENV_LOCAL" ]]; then
  cp "$CLOUD_DIR/.env.example" "$ENV_LOCAL"
  echo "    已从 .env.example 创建 .env.local（请按需填写 OpenAI/DeepSeek 密钥）"
fi

# Tauri 模式额外检查
if [[ "$MODE" == "tauri" ]]; then
  if ! command -v cargo >/dev/null 2>&1; then
    echo "Tauri 模式需要 Rust 工具链（cargo/rustc），未检测到。" >&2
    echo "请先安装：https://www.rust-lang.org/tools/install" >&2
    exit 1
  fi
  if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    echo "警告：未检测到 DISPLAY/WAYLAND_DISPLAY，Tauri 窗口可能无法显示。" >&2
    echo "         WSL2 用户请确保使用 WSLg 或配置 X server。" >&2
  fi
fi

echo "==> 启动 $MODE 模式..."
echo "    日志: $LOG_FILE"

if [[ "$MODE" == "web" ]]; then
  CMD=(npm run dev)
else
  CMD=(npm run tauri dev)
fi

# 用 setsid 建立独立进程组，便于 stop.sh 整组关闭所有子进程
cd "$DESKTOP_DIR"
setsid bash -c '"$@"' _ "${CMD[@]}" >"$LOG_FILE" 2>&1 &
LEADER_PID=$!
echo "$LEADER_PID" > "$PID_FILE"

echo "==> 已启动（进程组 PGID=$LEADER_PID）"
echo "    等待服务就绪..."

# 给服务一点时间起来，再检查是否存活
sleep 4
if ! kill -0 "$LEADER_PID" 2>/dev/null; then
  echo "启动失败，进程已退出。最近日志：" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
fi

CLOUD_PORT="${LITEASY_DEV_CLOUD_PORT:-8787}"
DESKTOP_PORT="${LITEASY_DESKTOP_PORT:-1420}"

echo ""
echo "=============================================="
if [[ "$MODE" == "web" ]]; then
  echo " LiteasyClaw 已启动（Web 开发模式）"
  echo "   前端:   http://127.0.0.1:$DESKTOP_PORT"
  echo "   后端:   http://127.0.0.1:$CLOUD_PORT"
else
  echo " LiteasyClaw 已启动（Tauri 桌面应用）"
  echo "   首次构建 Rust 较慢，请耐心等待窗口出现"
fi
echo " 日志:   $LOG_FILE"
echo " 关闭:   ./stop.sh"
echo "=============================================="
