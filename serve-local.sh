#!/usr/bin/env bash
# Mac 本地预览：主站 5174、Radar 5173、Sniper 8003 各自独立。
# ./serve.sh {start|stop|restart|status} [all|frontend|backend|sniper]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="${BACKEND_DIR:-$ROOT/../TrashBox-Server/Backend}"
RUN_DIR="$ROOT/.run-local"
PYTHON="$ROOT/.local-venv/bin/python"
SSH_HOST="${TRASHBOX_SSH_HOST:-Ubuntu-Shanghai}"
PG_PORT="${LOCAL_PG_PORT:-15432}"
API_PORT="${LOCAL_API_PORT:-2026}"
SNIPER_PORT="${LOCAL_SNIPER_PORT:-8003}"
RADAR_PORT="${LOCAL_RADAR_PORT:-5173}"
SITE_PORT="${LOCAL_SITE_PORT:-5174}"
mkdir -p "$RUN_DIR"

pid_file() { printf '%s/%s.pid\n' "$RUN_DIR" "$1"; }
log_file() { printf '%s/%s.log\n' "$RUN_DIR" "$1"; }

managed() {
  local name="$1" pattern="$2" pid cmd port
  [[ -f "$(pid_file "$name")" ]] || return 1
  pid="$(cat "$(pid_file "$name")" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ -n "$cmd" ]]; then
    if [[ "$cmd" == *"$pattern"* ]]; then return 0; fi
    return 1
  fi
  # Codex 沙箱可能禁止 ps；此时仍须确认该 PID 正监听预期端口。
  case "$name" in
    tunnel) port="$PG_PORT" ;;
    backend) port="$API_PORT" ;;
    sniper) port="$SNIPER_PORT" ;;
    radar) port="$RADAR_PORT" ;;
    site) port="$SITE_PORT" ;;
    *) return 1 ;;
  esac
  lsof -nP -a -p "$pid" -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .
}

port_free() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .; then
    echo "端口 $port 已被其他进程占用；不会接管它。" >&2
    return 1
  fi
}

wait_http() {
  local url="$1" pid="$2" attempt
  for attempt in {1..40}; do
    kill -0 "$pid" 2>/dev/null || return 1
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  return 1
}

ensure_python() {
  [[ -f "$BACKEND_DIR/main.py" ]] || { echo "找不到后端: $BACKEND_DIR/main.py" >&2; return 1; }
  if [[ ! -x "$PYTHON" ]]; then
    python3 -m venv --system-site-packages "$ROOT/.local-venv"
  fi
  if ! "$PYTHON" -c 'import fastapi,uvicorn,sqlalchemy,psycopg2,multipart,httpx,h2' >/dev/null 2>&1; then
    echo "安装本地后端 Python 依赖 …"
    "$PYTHON" -m pip install --index-url https://pypi.org/simple -r "$ROOT/deploy/backend-requirements.txt"
  fi
  "$PYTHON" -c 'import fastapi,uvicorn,sqlalchemy,psycopg2,multipart,httpx,h2' >/dev/null
}

remote_password() {
  local value
  value="$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_HOST" \
    'sed -n "s/^DB_PASSWORD=//p" /home/ubuntu/TrashBox-Server/Backend/.env')" || return 1
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [[ -n "$value" ]] || { echo "服务器 PostgreSQL 密码不可用。" >&2; return 1; }
  printf '%s' "$value"
}

start_tunnel() {
  if managed tunnel "127.0.0.1:${PG_PORT}:127.0.0.1:5432"; then return 0; fi
  port_free "$PG_PORT" || return 1
  nohup ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=8 \
    -N -L "127.0.0.1:${PG_PORT}:127.0.0.1:5432" "$SSH_HOST" \
    >"$(log_file tunnel)" 2>&1 &
  local pid=$!
  echo "$pid" >"$(pid_file tunnel)"
  sleep 0.4
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "PostgreSQL SSH 隧道启动失败，见 $(log_file tunnel)" >&2
    rm -f "$(pid_file tunnel)"
    return 1
  fi
  echo "PostgreSQL SSH 隧道: 127.0.0.1:$PG_PORT → $SSH_HOST:5432"
}

start_backend() {
  local password secret pid
  if managed backend "uvicorn main:app"; then
    echo "Backend 已运行: http://127.0.0.1:$API_PORT/test"
    return 0
  fi
  port_free "$API_PORT" || return 1
  ensure_python || return 1
  start_tunnel || return 1
  password="$(remote_password)" || return 1
  secret="$(openssl rand -hex 32)"
  (
    export DB_HOST=127.0.0.1 DB_PORT="$PG_PORT" DB_USER=trashbox DB_NAME=trashbox
    export DB_PASSWORD="$password" JWT_SECRET="$secret"
    export BASE_URL="http://127.0.0.1:$RADAR_PORT"
    export WEB_ORIGIN="http://127.0.0.1:$RADAR_PORT/radar"
    export UPLOAD_DIR="$BACKEND_DIR/assets/posts"
    cd "$BACKEND_DIR"
    exec nohup "$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port "$API_PORT"
  ) >"$(log_file backend)" 2>&1 &
  pid=$!
  echo "$pid" >"$(pid_file backend)"
  if ! wait_http "http://127.0.0.1:$API_PORT/test" "$pid"; then
    echo "Backend 启动失败，见 $(log_file backend)" >&2
    stop_one backend 'uvicorn main:app'
    return 1
  fi
  echo "Backend: http://127.0.0.1:$API_PORT/test"
  if [[ -z "${STEAM_API_KEY:-}" ]] && ! grep -Eq '^STEAM_API_KEY=.+$' "$BACKEND_DIR/.env"; then
    echo "提示：未配置 STEAM_API_KEY；Steam 登录可用，但 Radar 实时查询不可用。" >&2
  fi
}

start_sniper() {
  local pid
  if managed sniper 'packages/server/dist/index.js'; then
    echo "Sniper 已运行: http://127.0.0.1:$SNIPER_PORT/game/sniper/"
    return 0
  fi
  port_free "$SNIPER_PORT" || return 1
  if [[ ! -f "$ROOT/game/packages/server/dist/index.js" ||
        ! -f "$ROOT/game/packages/client/dist/index.html" ]] ||
        ! grep -Fq '/game/sniper/' "$ROOT/game/packages/client/dist/index.html"; then
    (cd "$ROOT/game" && BASE_PATH=/game/sniper pnpm build) || return 1
  fi
  HOST=127.0.0.1 PORT="$SNIPER_PORT" BASE_PATH=/game/sniper NODE_ENV=production \
    nohup node "$ROOT/game/packages/server/dist/index.js" \
    >"$(log_file sniper)" 2>&1 &
  pid=$!
  echo "$pid" >"$(pid_file sniper)"
  if ! wait_http "http://127.0.0.1:$SNIPER_PORT/healthz" "$pid"; then
    echo "Sniper 启动失败，见 $(log_file sniper)" >&2
    stop_one sniper 'packages/server/dist/index.js'
    return 1
  fi
  echo "Sniper: http://127.0.0.1:$SNIPER_PORT/game/sniper/"
}

start_radar() {
  local pid
  if managed radar "--port $RADAR_PORT"; then return 0; fi
  port_free "$RADAR_PORT" || return 1
  [[ -x "$ROOT/web/node_modules/.bin/vite" ]] || { echo "缺少 web/node_modules，请在 web/ 执行 pnpm install" >&2; return 1; }
  (cd "$ROOT/web" && BASE_PATH=/radar exec nohup "$ROOT/web/node_modules/.bin/vite" \
    --host 127.0.0.1 --port "$RADAR_PORT" --strictPort) \
    >"$(log_file radar)" 2>&1 &
  pid=$!
  echo "$pid" >"$(pid_file radar)"
  if ! wait_http "http://127.0.0.1:$RADAR_PORT/radar/" "$pid"; then
    echo "Radar 启动失败，见 $(log_file radar)" >&2
    stop_one radar "--port $RADAR_PORT"
    return 1
  fi
  echo "Radar: http://127.0.0.1:$RADAR_PORT/radar/"
}

start_site() {
  local pid
  if managed site "--port $SITE_PORT"; then return 0; fi
  port_free "$SITE_PORT" || return 1
  [[ -x "$ROOT/web/node_modules/.bin/vite" ]] || { echo "缺少 web/node_modules，请在 web/ 执行 pnpm install" >&2; return 1; }
  if [[ -L "$ROOT/site/node_modules" && ! -e "$ROOT/site/node_modules" ]]; then rm "$ROOT/site/node_modules"; fi
  if [[ ! -e "$ROOT/site/node_modules" ]]; then ln -s ../web/node_modules "$ROOT/site/node_modules"; fi
  (cd "$ROOT/site" && exec nohup "$ROOT/web/node_modules/.bin/vite" \
    --host 127.0.0.1 --port "$SITE_PORT" --strictPort) \
    >"$(log_file site)" 2>&1 &
  pid=$!
  echo "$pid" >"$(pid_file site)"
  if ! wait_http "http://127.0.0.1:$SITE_PORT/" "$pid"; then
    echo "主站启动失败，见 $(log_file site)" >&2
    stop_one site "--port $SITE_PORT"
    return 1
  fi
  echo "主站: http://127.0.0.1:$SITE_PORT/"
}

stop_one() {
  local name="$1" pattern="$2" pid
  if ! managed "$name" "$pattern"; then
    rm -f "$(pid_file "$name")"
    return 0
  fi
  pid="$(cat "$(pid_file "$name")")"
  kill "$pid" 2>/dev/null || true
  for _ in {1..25}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "$name PID $pid 未退出，请手动检查。" >&2
    return 1
  fi
  rm -f "$(pid_file "$name")"
  echo "已停止 $name"
}

stop_all() {
  stop_one site "--port $SITE_PORT"
  stop_one radar "--port $RADAR_PORT"
  stop_one sniper 'packages/server/dist/index.js'
  stop_one backend 'uvicorn main:app'
  stop_one tunnel "127.0.0.1:${PG_PORT}:127.0.0.1:5432"
}

start_all() {
  if ! start_backend || ! start_sniper || ! start_radar || ! start_site; then
    echo "一键启动未完成，正在关闭已启动的本地进程。" >&2
    stop_all
    return 1
  fi
  echo "全部本地服务已启动，入口: http://127.0.0.1:$SITE_PORT/"
}

status() {
  local name pattern
  for name in tunnel backend sniper radar site; do
    case "$name" in
      tunnel) pattern="127.0.0.1:${PG_PORT}:127.0.0.1:5432" ;;
      backend) pattern='uvicorn main:app' ;;
      sniper) pattern='packages/server/dist/index.js' ;;
      radar) pattern="--port $RADAR_PORT" ;;
      site) pattern="--port $SITE_PORT" ;;
    esac
    if managed "$name" "$pattern"; then
      echo "$name 运行中 (PID $(cat "$(pid_file "$name")"))"
    else
      echo "$name 未运行"
    fi
  done
}

usage() {
  cat <<EOF
Mac 本地用法: ./serve.sh {start|stop|restart|status} [all|frontend|backend|sniper]
  start         一键启动 PostgreSQL SSH 隧道、FastAPI、Sniper、Radar、主站
  stop          停止由脚本启动的本地进程
  frontend      仅启动或停止主站与 Radar，API 数据需要单独启动 backend
  backend       FastAPI + PostgreSQL SSH 隧道
  sniper        仅启动或停止 Sniper
本地入口: http://127.0.0.1:$SITE_PORT/
日志与 PID: $RUN_DIR
EOF
}

command="${1:-help}"
target="${2:-all}"
case "$target" in all|frontend|backend|sniper) ;; *) usage; exit 2 ;; esac
case "$command" in
  start)
    case "$target" in
      all) start_all ;;
      frontend) start_radar; start_site ;;
      backend) start_backend ;;
      sniper) start_sniper ;;
    esac
    ;;
  stop)
    case "$target" in
      all) stop_all ;;
      frontend) stop_one site "--port $SITE_PORT"; stop_one radar "--port $RADAR_PORT" ;;
      backend) stop_one backend 'uvicorn main:app'; stop_one tunnel "127.0.0.1:${PG_PORT}:127.0.0.1:5432" ;;
      sniper) stop_one sniper 'packages/server/dist/index.js' ;;
    esac
    ;;
  restart) "$0" stop "$target"; "$0" start "$target" ;;
  status) status ;;
  help|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
