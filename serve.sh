#!/usr/bin/env bash
# TrashBox · 主站 / Radar / Sniper / Music / 登录 / API 一键管理
# 用法: ./serve.sh {start|stop|restart|status|open} [web|radar|sniper|music|auth|backend]
# 生产结构: Nginx 提供静态页面并反代本机 Sniper 与 FastAPI。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" == "Darwin" && "${TRASHBOX_MODE:-local}" == "local" ]]; then
  exec "$ROOT/serve-local.sh" "$@"
fi
SITE_SOURCE="$ROOT/site/dist"
RADAR_DIST="$ROOT/web/dist"
AUTH_DIST="$ROOT/auth/dist"
SNIPER_ENTRY="$ROOT/game/packages/server/dist/index.js"
SNIPER_CLIENT="$ROOT/game/packages/client/dist/index.html"
BACKEND_REQUIREMENTS="$ROOT/deploy/backend-requirements.txt"
FORCE_REBUILD=0

load_dotenv() {
  local file="$1" line key value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      if [[ -z "${!key+x}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$file"
}

normalize_base_path() {
  local raw="${1:-}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  [[ -z "$raw" || "$raw" == "/" ]] && return 0
  raw="${raw#/}"
  raw="${raw%/}"
  printf '/%s' "$raw"
}

load_dotenv "$ROOT/.env"
BACKEND_DIR="${BACKEND_DIR:-$ROOT/../TrashBox-Server/Backend}"
BACKEND_VENV="$BACKEND_DIR/.venv"
MUSIC_DIR="${MUSIC_DIR:-$ROOT/../KBot/MusicBot}"
MUSIC_PYTHON="${MUSIC_PYTHON:-$MUSIC_DIR/venv/bin/python}"
BIND="${BIND:-127.0.0.1}"
SNIPER_PORT="${SNIPER_PORT:-8003}"
MUSIC_PORT="${MUSIC_PORT:-8004}"
BACKEND_PORT="${BACKEND_PORT:-2026}"
RADAR_BASE_PATH="$(normalize_base_path "${RADAR_BASE_PATH:-/radar}")"
SNIPER_BASE_PATH="$(normalize_base_path "${SNIPER_BASE_PATH:-/game/sniper}")"
DOMAIN="${DOMAIN:-}"
PUBLISH_DIR="$ROOT/.serve-public"

resolve_name() {
  case "${1:-}" in
    ""|all) echo "all" ;;
    web|site|main|主站) echo "web" ;;
    radar) echo "radar" ;;
    sniper|game) echo "sniper" ;;
    music|Music) echo "music" ;;
    auth|login|account) echo "auth" ;;
    backend|api|server|服务端) echo "backend" ;;
    *)
      echo "未知服务: $1" >&2
      echo "可选: web (主站) | radar | sniper | music | auth | backend" >&2
      return 1
      ;;
  esac
}

service_path() {
  case "$1" in
    web) echo "/" ;;
    radar) echo "${RADAR_BASE_PATH}/" ;;
    sniper) echo "${SNIPER_BASE_PATH}/" ;;
    music) echo "/Music/" ;;
    auth) echo "/login" ;;
    backend) echo "/api/" ;;
  esac
}

public_url() {
  local name="$1" origin
  if [[ -n "$DOMAIN" ]]; then
    origin="https://${DOMAIN}"
  else
    origin="http://127.0.0.1"
  fi
  echo "${origin}$(service_path "$name")"
}

service_label() {
  case "$1" in
    web) echo "主站" ;;
    radar) echo "Radar" ;;
    sniper) echo "Sniper" ;;
    music) echo "Music" ;;
    auth) echo "登录 / 账户" ;;
    backend) echo "Backend API" ;;
  esac
}

pid_file() { echo "$ROOT/.serve-$1.pid"; }
log_file() { echo "$ROOT/.serve-$1.log"; }

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -lptn "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true
  fi
}

sniper_is_running() {
  local file pid cmd
  file="$(pid_file sniper)"
  [[ -f "$file" ]] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cmd" == *"packages/server/dist/index.js"* ]]
}

require_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "未找到 pnpm。请先: sudo corepack enable && corepack prepare pnpm@11.19.0 --activate" >&2
    return 1
  fi
}

dist_has_base() {
  local html="$1" base="$2"
  [[ -f "$html" ]] || return 1
  if [[ -z "$base" ]]; then
    grep -Eq 'src="/site-static/|href="/site-static/' "$html"
  else
    grep -Fq "${base}/" "$html"
  fi
}

ensure_site() {
  if [[ "$FORCE_REBUILD" != "1" ]] && dist_has_base "$SITE_SOURCE/index.html" "" &&
     ! sources_newer_than "$SITE_SOURCE/index.html" "$ROOT/site" &&
     ! sources_newer_than "$SITE_SOURCE/index.html" "$ROOT/shared"; then
    return 0
  fi
  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    require_pnpm
    (cd "$ROOT/web" && pnpm install --frozen-lockfile)
  fi
  if [[ -L "$ROOT/site/node_modules" && ! -e "$ROOT/site/node_modules" ]]; then
    rm "$ROOT/site/node_modules"
  fi
  if [[ ! -e "$ROOT/site/node_modules" ]]; then
    ln -s ../web/node_modules "$ROOT/site/node_modules"
  fi
  echo "构建主站 H5 …"
  (cd "$ROOT/site" && npm run build)
}

ensure_radar() {
  if [[ "$FORCE_REBUILD" != "1" ]] && dist_has_base "$RADAR_DIST/index.html" "$RADAR_BASE_PATH" &&
     ! sources_newer_than "$RADAR_DIST/index.html" "$ROOT/web" &&
     ! sources_newer_than "$RADAR_DIST/index.html" "$ROOT/shared"; then
    return 0
  fi
  require_pnpm
  echo "构建 Radar  BASE_PATH=${RADAR_BASE_PATH} …"
  (cd "$ROOT/web" && pnpm install --frozen-lockfile && env BASE_PATH="$RADAR_BASE_PATH" pnpm build)
}

ensure_sniper() {
  if [[ "$FORCE_REBUILD" != "1" ]] && [[ -f "$SNIPER_ENTRY" ]] &&
     ! sources_newer_than "$SNIPER_ENTRY" "$ROOT/game/packages" &&
     ! sources_newer_than "$SNIPER_CLIENT" "$ROOT/shared" && dist_has_base "$SNIPER_CLIENT" "$SNIPER_BASE_PATH"; then
    return 0
  fi
  require_pnpm
  echo "构建 Sniper  BASE_PATH=${SNIPER_BASE_PATH} …"
  (cd "$ROOT/game" && pnpm install --frozen-lockfile && env BASE_PATH="$SNIPER_BASE_PATH" pnpm build)
}

sources_newer_than() {
  local entry="$1" source="$2" changed
  [[ -f "$entry" ]] || return 0
  changed="$(find "$source" \( -name dist -o -name node_modules \) -prune -o -type f -newer "$entry" -print -quit)"
  [[ -n "$changed" ]]
}

ensure_auth() {
  if [[ "$FORCE_REBUILD" != "1" ]] && [[ -f "$AUTH_DIST/index.html" ]] &&
     ! sources_newer_than "$AUTH_DIST/index.html" "$ROOT/auth" &&
     ! sources_newer_than "$AUTH_DIST/index.html" "$ROOT/shared"; then return 0; fi
  [[ -f "$ROOT/auth/package.json" ]] || { echo "登录前端不存在: $ROOT/auth" >&2; return 1; }
  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    require_pnpm
    (cd "$ROOT/web" && pnpm install --frozen-lockfile)
  fi
  if [[ -L "$ROOT/auth/node_modules" && ! -e "$ROOT/auth/node_modules" ]]; then rm "$ROOT/auth/node_modules"; fi
  if [[ ! -e "$ROOT/auth/node_modules" ]]; then ln -s ../web/node_modules "$ROOT/auth/node_modules"; fi
  echo "构建登录 / 账户前端 …"
  (cd "$ROOT/auth" && npm run build)
}

publish_static() {
  local stage backup
  ensure_radar
  ensure_site
  ensure_auth
  if [[ ! -f "$SITE_SOURCE/index.html" ]]; then
    echo "主站入口不存在: $SITE_SOURCE/index.html" >&2
    return 1
  fi
  if [[ ! -f "$RADAR_DIST/index.html" ]]; then
    echo "Radar 构建入口不存在: $RADAR_DIST/index.html" >&2
    return 1
  fi

  mkdir -p "$(dirname "$PUBLISH_DIR")"
  stage="$(mktemp -d "${PUBLISH_DIR}.tmp.XXXXXX")"
  backup="${PUBLISH_DIR}.previous"
  mkdir -p "$stage/radar" "$stage/auth"
  cp -R "$SITE_SOURCE"/. "$stage"/
  cp -R "$RADAR_DIST"/. "$stage/radar"/
  cp -R "$AUTH_DIST"/. "$stage/auth"/
  chmod -R a+rX "$stage"

  rm -rf "$backup"
  if [[ -e "$PUBLISH_DIR" || -L "$PUBLISH_DIR" ]]; then
    mv "$PUBLISH_DIR" "$backup"
  fi
  if mv "$stage" "$PUBLISH_DIR"; then
    rm -rf "$backup"
  else
    [[ -e "$backup" ]] && mv "$backup" "$PUBLISH_DIR"
    rm -rf "$stage"
    return 1
  fi

  echo "静态文件已发布: $PUBLISH_DIR"
  echo "  主站:  $PUBLISH_DIR/index.html"
  echo "  Radar: $PUBLISH_DIR/radar/index.html"
  echo "  登录:  $PUBLISH_DIR/auth/index.html"
}

print_static_route() {
  local name="$1"
  echo "$(service_label "$name") 已发布，由 Nginx 直接提供 → $(public_url "$name")"
}

start_sniper() {
  local pid_path log_path occupied pid attempt
  pid_path="$(pid_file sniper)"
  log_path="$(log_file sniper)"

  if sniper_is_running; then
    echo "Sniper 已在运行 (PID $(cat "$pid_path")) → $(public_url sniper)"
    return 0
  fi
  occupied="$(port_pids "$SNIPER_PORT")"
  if [[ -n "${occupied:-}" ]]; then
    echo "端口 $SNIPER_PORT 已被占用 (PID: $occupied)" >&2
    return 1
  fi

  ensure_sniper || return 1
  command -v curl >/dev/null || { echo "未找到 curl，无法检查 Sniper 探活" >&2; return 1; }
  rm -f "$pid_path"
  nohup env \
    HOST="$BIND" \
    PORT="$SNIPER_PORT" \
    NODE_ENV=production \
    BASE_PATH="$SNIPER_BASE_PATH" \
    TRASHBOX_AUTH_CHECK_URL="http://127.0.0.1:$BACKEND_PORT/api/v1/auth/check" \
    TRASHBOX_LOGIN_URL="${TRASHBOX_LOGIN_URL:-${DOMAIN:+https://${DOMAIN}}/login}" \
    node "$SNIPER_ENTRY" >"$log_path" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_path"
  for attempt in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    if curl -fsS --max-time 2 "http://127.0.0.1:${SNIPER_PORT}/healthz" >/dev/null 2>&1; then
      echo "已启动 Sniper (PID $pid) → $(public_url sniper)"
      echo "监听: ${BIND}:${SNIPER_PORT}"
      echo "探活: http://127.0.0.1:${SNIPER_PORT}/healthz"
      echo "日志: $log_path"
      return 0
    fi
    sleep 0.25
  done
  echo "Sniper 启动或探活失败，请查看 $log_path" >&2
  stop_sniper
  return 1
}

stop_sniper() {
  local pid_path pid
  pid_path="$(pid_file sniper)"
  if [[ ! -f "$pid_path" ]]; then
    echo "Sniper 当前没有由 serve.sh 管理的运行进程"
    return 0
  fi
  pid="$(cat "$pid_path" 2>/dev/null || true)"
  if sniper_is_running; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "已停止 Sniper PID $pid"
  else
    echo "Sniper pid 文件已失效"
  fi
  rm -f "$pid_path"
}

status_static() {
  local name="$1" entry
  case "$name" in
    web) entry="$PUBLISH_DIR/index.html" ;;
    radar) entry="$PUBLISH_DIR/radar/index.html" ;;
    auth) entry="$PUBLISH_DIR/auth/index.html" ;;
  esac
  if [[ -f "$entry" ]]; then
    echo "$(service_label "$name") 已发布（Nginx 静态文件）"
    echo "入口: $(public_url "$name")"
    echo "文件: $entry"
  else
    echo "$(service_label "$name") 尚未发布；执行 ./serve.sh start $name"
  fi
}

status_sniper() {
  local occupied
  if sniper_is_running; then
    echo "Sniper 运行中 (PID $(cat "$(pid_file sniper)"))"
    echo "入口: $(public_url sniper)"
    echo "监听: ${BIND}:${SNIPER_PORT}"
  else
    occupied="$(port_pids "$SNIPER_PORT")"
    if [[ -n "${occupied:-}" ]]; then
      echo "Sniper pid 文件无效，但端口 $SNIPER_PORT 已被其他进程占用 (PID: $occupied)"
    else
      echo "Sniper 未运行"
    fi
  fi
}

music_is_running() {
  local file pid cmd
  file="$(pid_file music)"
  [[ -f "$file" ]] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cmd" == *"$MUSIC_DIR/run.py"* ]]
}

ensure_music() {
  [[ -f "$MUSIC_DIR/run.py" && -x "$MUSIC_PYTHON" && -f "$MUSIC_DIR/.env" ]] || {
    echo "Music 未准备好，请检查 MUSIC_DIR、MusicBot/.env 与 MUSIC_PYTHON。" >&2
    return 1
  }
  command -v ffmpeg >/dev/null || { echo "Music 需要 ffmpeg，请先安装。" >&2; return 1; }
}

start_music() {
  local occupied pid attempt log_path
  if music_is_running; then
    echo "Music 已在运行 (PID $(cat "$(pid_file music)")) → $(public_url music)"
    return 0
  fi
  occupied="$(port_pids "$MUSIC_PORT")"
  if [[ -n "$occupied" ]]; then
    echo "Music 端口 $MUSIC_PORT 已被其他进程占用 (PID: $occupied)" >&2
    return 1
  fi
  ensure_music || return 1
  log_path="$(log_file music)"
  (cd "$MUSIC_DIR" && HOST=127.0.0.1 PORT="$MUSIC_PORT" DEBUG=false \
    TRASHBOX_AUTH_SESSION_URL="http://127.0.0.1:$BACKEND_PORT/api/v1/auth/session" \
    TRASHBOX_AUTH_ACTIVITY_URL="http://127.0.0.1:$BACKEND_PORT/api/v1/auth/activity" \
    TRASHBOX_LOGIN_URL="${TRASHBOX_LOGIN_URL:-${DOMAIN:+https://${DOMAIN}}/login}" \
    exec nohup "$MUSIC_PYTHON" -u "$MUSIC_DIR/run.py") >"$log_path" 2>&1 &
  pid=$!
  echo "$pid" >"$(pid_file music)"
  for attempt in {1..40}; do
    kill -0 "$pid" 2>/dev/null || break
    if curl -fsS --max-time 2 "http://127.0.0.1:$MUSIC_PORT/healthz" >/dev/null 2>&1; then
      echo "已启动 Music (PID $pid) → $(public_url music)"
      echo "日志: $log_path"
      return 0
    fi
    sleep 0.25
  done
  echo "Music 启动或探活失败，请查看 $log_path" >&2
  stop_music
  return 1
}

stop_music() {
  local pid
  if ! music_is_running; then rm -f "$(pid_file music)"; echo "Music 未运行"; return 0; fi
  pid="$(cat "$(pid_file music)")"
  kill "$pid" 2>/dev/null || true
  for _ in {1..25}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "Music PID $pid 未退出，请检查日志；不会强制终止。" >&2
    return 1
  fi
  rm -f "$(pid_file music)"
  echo "已停止 Music PID $pid"
}

status_music() {
  if music_is_running; then
    echo "Music 运行中 (PID $(cat "$(pid_file music)")) → $(public_url music)"
  elif [[ -n "$(port_pids "$MUSIC_PORT")" ]]; then
    echo "Music 未由此脚本管理，端口 $MUSIC_PORT 已被其他进程占用"
  else
    echo "Music 未运行"
  fi
}

backend_is_running() {
  local pid_path pid cmd
  pid_path="$(pid_file backend)"
  [[ -f "$pid_path" ]] || return 1
  pid="$(cat "$pid_path" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cmd" == *"uvicorn main:app"* && "$cmd" == *"$BACKEND_DIR"* ]]
}

ensure_backend() {
  local hash stamp python
  [[ -f "$BACKEND_DIR/main.py" ]] || { echo "后端不存在: $BACKEND_DIR/main.py" >&2; return 1; }
  [[ -f "$BACKEND_DIR/.env" ]] || { echo "后端环境文件不存在: $BACKEND_DIR/.env" >&2; return 1; }
  [[ -f "$BACKEND_REQUIREMENTS" ]] || { echo "后端依赖清单不存在: $BACKEND_REQUIREMENTS" >&2; return 1; }
  [[ -f "$BACKEND_DIR/migrate_identity.py" ]] || { echo "后端缺少统一账户迁移脚本 migrate_identity.py。" >&2; return 1; }
  if ! grep -Fq 'app.include_router(web_auth.router)' "$BACKEND_DIR/main.py" ||
     ! grep -Fq 'app.include_router(radar.router)' "$BACKEND_DIR/main.py" ||
     ! grep -Fq 'app.include_router(identity.router)' "$BACKEND_DIR/main.py"; then
    echo "服务器后端源码缺少 Radar / Web Auth / 统一账户路由；先部署兼容版本，再运行一键启动。" >&2
    return 1
  fi
  if [[ ! -x "$BACKEND_VENV/bin/python" ]]; then
    command -v python3 >/dev/null || { echo "未找到 python3" >&2; return 1; }
    echo "创建后端 Python 虚拟环境 …"
    python3 -m venv "$BACKEND_VENV" || return 1
  fi
  python="$BACKEND_VENV/bin/python"
  hash="$(sha256sum "$BACKEND_REQUIREMENTS" | cut -d ' ' -f1)"
  stamp="$BACKEND_VENV/.trashbox-requirements-sha256"
  if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$hash" ]] ||
     ! "$python" -c 'import fastapi, uvicorn, sqlalchemy, psycopg2, httpx' >/dev/null 2>&1; then
    echo "安装后端 Python 依赖 …"
    "$python" -m pip install -r "$BACKEND_REQUIREMENTS" || return 1
    printf '%s\n' "$hash" > "$stamp"
  fi
  (cd "$BACKEND_DIR" && "$python" -c 'import main' >/dev/null) || {
    echo "后端导入失败；请检查依赖、配置和数据库驱动。" >&2
    return 1
  }
}

start_backend() {
  local occupied pid pid_path log_path attempt
  if backend_is_running; then
    echo "Backend 已在运行 (PID $(cat "$(pid_file backend)")) → $(public_url backend)"
    return 0
  fi
  occupied="$(port_pids "$BACKEND_PORT")"
  if [[ -n "$occupied" ]]; then
    echo "后端端口 $BACKEND_PORT 已被其他进程占用 (PID: $occupied)" >&2
    return 1
  fi
  ensure_backend || return 1
  command -v curl >/dev/null || { echo "未找到 curl，无法检查后端探活" >&2; return 1; }
  pid_path="$(pid_file backend)"
  log_path="$(log_file backend)"
  rm -f "$pid_path"
  pushd "$BACKEND_DIR" >/dev/null || return 1
  export TRASHBOX_AUTH_COOKIE_SECURE=1
  if [[ -n "$DOMAIN" ]]; then
    export TRASHBOX_AUTH_BASE_URL="${TRASHBOX_AUTH_BASE_URL:-https://$DOMAIN}"
    export TRASHBOX_AUTH_ORIGINS="${TRASHBOX_AUTH_ORIGINS:-https://$DOMAIN}"
  fi
  if ! "$BACKEND_VENV/bin/python" migrate_identity.py >>"$log_path" 2>&1; then
    popd >/dev/null
    echo "统一账户数据库迁移失败，请查看 $log_path" >&2
    return 1
  fi
  nohup "$BACKEND_VENV/bin/python" -m uvicorn main:app \
    --host 127.0.0.1 --port "$BACKEND_PORT" --app-dir "$BACKEND_DIR" --no-access-log \
    >"$log_path" 2>&1 &
  pid=$!
  popd >/dev/null
  echo "$pid" >"$pid_path"
  for attempt in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    if curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/test" >/dev/null 2>&1 &&
       [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/api/v1/auth/session")" == "401" ]] &&
       [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/api/v1/auth/check")" == "401" ]]; then
      echo "已启动 Backend (PID $pid) → $(public_url backend)"
      echo "探活: http://127.0.0.1:${BACKEND_PORT}/test"
      echo "日志: $log_path"
      return 0
    fi
    sleep 0.25
  done
  echo "后端启动或路由检查失败，请查看 $log_path" >&2
  stop_backend
  return 1
}

stop_backend() {
  local pid_path pid
  pid_path="$(pid_file backend)"
  if ! backend_is_running; then
    [[ -f "$pid_path" ]] && rm -f "$pid_path"
    echo "Backend 未运行"
    return 0
  fi
  pid="$(cat "$pid_path")"
  kill "$pid"
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "Backend PID $pid 未在 4 秒内退出，请手动检查；不会强制终止。" >&2
    return 1
  fi
  rm -f "$pid_path"
  echo "已停止 Backend PID $pid"
}

status_backend() {
  local occupied
  if backend_is_running; then
    echo "Backend 运行中 (PID $(cat "$(pid_file backend)"))"
    echo "监听: 127.0.0.1:$BACKEND_PORT"
    echo "日志: $(log_file backend)"
  else
    occupied="$(port_pids "$BACKEND_PORT")"
    if [[ -n "$occupied" ]]; then
      echo "Backend PID 文件无效，但端口 $BACKEND_PORT 已被其他进程占用 (PID: $occupied)"
    else
      echo "Backend 未运行"
    fi
  fi
}

pause_static() {
  local paused
  if [[ ! -d "$PUBLISH_DIR" ]]; then
    echo "主站、Radar 与登录页已暂停"
    return 0
  fi
  paused="${PUBLISH_DIR}.paused-$(date +%Y%m%d-%H%M%S)"
  mv "$PUBLISH_DIR" "$paused"
  echo "已暂停主站、Radar 与登录页；发布文件保留在 $paused"
}

# Server all-target also restores the main/data bot group and GitBot.
# Each sibling launcher owns its PID checks; Music is managed separately above.
core_bots() {
  local action="$1" kbot_dir="${KBOT_DIR:-$ROOT/../KBot}" gitbot_dir="${GITBOT_DIR:-$ROOT/../GitBot}"
  if [[ -f "$kbot_dir/serve.sh" ]]; then
    (cd "$kbot_dir" && bash ./serve.sh "$action" main) || return 1
  fi
  if [[ -f "$gitbot_dir/serve.sh" ]]; then
    (cd "$gitbot_dir" && bash ./serve.sh "$action") || return 1
  fi
}

start() {
  local had_backend=0 had_sniper=0 had_static=0
  case "$1" in
    all)
      backend_is_running && had_backend=1
      sniper_is_running && had_sniper=1
      [[ -f "$PUBLISH_DIR/index.html" ]] && had_static=1
      ensure_backend
      ensure_sniper
      ensure_music
      publish_static
      if ! start_backend; then
        [[ "$had_static" == "1" ]] || pause_static
        return 1
      fi
      if ! start_sniper; then
        [[ "$had_backend" == "1" ]] || stop_backend
        [[ "$had_static" == "1" ]] || pause_static
        return 1
      fi
      if ! start_music; then
        [[ "$had_sniper" == "1" ]] || stop_sniper
        [[ "$had_backend" == "1" ]] || stop_backend
        [[ "$had_static" == "1" ]] || pause_static
        return 1
      fi
      core_bots start || return 1
      print_static_route web
      print_static_route radar
      print_static_route auth
      ;;
    web|radar|auth)
      publish_static
      print_static_route "$1"
      ;;
    sniper) start_sniper ;;
    music) start_music ;;
    backend) start_backend ;;
  esac
}

stop() {
  case "$1" in
    all)
      stop_sniper
      stop_music
      stop_backend
      core_bots stop
      pause_static
      ;;
    web|radar|auth) pause_static ;;
    sniper) stop_sniper ;;
    music) stop_music ;;
    backend) stop_backend ;;
  esac
}

restart() {
  FORCE_REBUILD=1
  case "$1" in
    all)
      ensure_backend
      publish_static
      ensure_sniper
      ensure_music
      FORCE_REBUILD=0
      stop_sniper
      stop_music
      stop_backend
      core_bots stop
      print_static_route web
      print_static_route radar
      print_static_route auth
      echo
      start_backend
      start_sniper
      start_music
      core_bots start
      ;;
    web|radar|auth) start "$1" ;;
    sniper)
      ensure_sniper
      FORCE_REBUILD=0
      stop_sniper
      start_sniper
      ;;
    backend)
      stop_backend
      start_backend
      ;;
    music) ensure_music; stop_music; start_music ;;
  esac
}

status() {
  case "$1" in
    all)
      status_static web
      echo
      status_static radar
      echo
      status_sniper
      echo
      status_music
      echo
      status_static auth
      echo
      status_backend
      echo
      core_bots status
      ;;
    web|radar|auth) status_static "$1" ;;
    sniper) status_sniper ;;
    music) status_music ;;
    backend) status_backend ;;
  esac
}

open_browser() {
  local target="$1" name url
  start "$target"
  if [[ "$target" == "all" ]]; then name="web"; else name="$target"; fi
  url="$(public_url "$name")"
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url"
  else
    echo "请手动打开: $url"
  fi
}

usage() {
  cat <<EOF
用法: $(basename "$0") <命令> [服务]

命令:
  start     发布主站/Radar/登录页并启动 Sniper、Music、Backend（默认全部）
  stop      停止 Sniper、Music、Backend，并暂停静态发布
  restart   重新构建发布并重启全部服务
  status    查看静态发布文件及三个服务状态
  open      发布并打开入口（默认主站）

服务:
  web       主站   /                       （Nginx 静态文件）
  radar     Radar ${RADAR_BASE_PATH}/                 （Nginx 静态文件）
  sniper    Sniper ${BIND}:${SNIPER_PORT}  ${SNIPER_BASE_PATH}/
  music     Music 127.0.0.1:${MUSIC_PORT}  /Music/
  auth      登录 /login 与账户 /account （Nginx 静态文件）
  backend   FastAPI 127.0.0.1:${BACKEND_PORT}  /api/

环境变量（也可写在仓库根目录 .env）:
  BIND               默认 127.0.0.1，仅 Sniper 使用
  SNIPER_PORT        默认 8003
  MUSIC_PORT         默认 8004
  MUSIC_DIR          默认与本仓库同级的 KBot/MusicBot
  MUSIC_PYTHON       默认 MUSIC_DIR/venv/bin/python（需要已安装 Music 依赖）
  DOMAIN             例如 trashbox.tech，用于打印公网地址
  RADAR_BASE_PATH    默认 /radar
  SNIPER_BASE_PATH   默认 /game/sniper
  BACKEND_DIR        默认与本仓库同级的 TrashBox-Server/Backend
  BACKEND_PORT       默认 2026，仅监听 127.0.0.1

Nginx:
  首次部署时把 deploy/nginx.conf 中的仓库绝对路径替换后加入 HTTPS server。
  静态文件更新不需要 reload；只有 Nginx 配置变化才需要 nginx -t 和 reload。
EOF
}

cmd="${1:-}"
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) FORCE_REBUILD=1 ;;
    web|site|main|主站|radar|sniper|game|music|Music|auth|login|account|backend|api|server|服务端|all)
      if [[ -z "${target_arg:-}" ]]; then
        target_arg="$1"
      else
        echo "多余参数: $1" >&2
        usage
        exit 1
      fi
      ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

target="$(resolve_name "${target_arg:-}" || true)"
if [[ -z "$target" ]]; then
  usage
  exit 1
fi

case "$cmd" in
  start) start "$target" ;;
  stop) stop "$target" ;;
  restart) restart "$target" ;;
  status) status "$target" ;;
  open) open_browser "$target" ;;
  -h|--help|help|"") usage ;;
  *)
    echo "未知命令: $cmd"
    usage
    exit 1
    ;;
esac
