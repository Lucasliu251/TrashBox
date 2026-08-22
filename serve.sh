#!/usr/bin/env bash
# TrashBox · 静态发布 / Sniper 权威服
# 用法: ./serve.sh {start|stop|restart|status|open} [web|radar|sniper]
# 生产结构: Nginx 直接读取主站和 Radar；仅 Sniper 监听本机端口。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SITE_SOURCE="$ROOT/site"
RADAR_DIST="$ROOT/web/dist"
SNIPER_ENTRY="$ROOT/game/packages/server/dist/index.js"
SNIPER_CLIENT="$ROOT/game/packages/client/dist/index.html"
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
BIND="${BIND:-127.0.0.1}"
SNIPER_PORT="${SNIPER_PORT:-8003}"
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
    *)
      echo "未知服务: $1" >&2
      echo "可选: web (主站) | radar | sniper" >&2
      return 1
      ;;
  esac
}

service_path() {
  case "$1" in
    web) echo "/" ;;
    radar) echo "${RADAR_BASE_PATH}/" ;;
    sniper) echo "${SNIPER_BASE_PATH}/" ;;
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
  esac
}

pid_file() { echo "$ROOT/.serve-sniper.pid"; }
log_file() { echo "$ROOT/.serve-sniper.log"; }

port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$SNIPER_PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -lptn "sport = :$SNIPER_PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true
  fi
}

sniper_is_running() {
  local file pid cmd
  file="$(pid_file)"
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
    grep -Eq 'src="/assets/|href="/assets/' "$html"
  else
    grep -Fq "${base}/" "$html"
  fi
}

ensure_radar() {
  if [[ "$FORCE_REBUILD" != "1" ]] && dist_has_base "$RADAR_DIST/index.html" "$RADAR_BASE_PATH"; then
    return 0
  fi
  require_pnpm
  echo "构建 Radar  BASE_PATH=${RADAR_BASE_PATH} …"
  (cd "$ROOT/web" && pnpm install --frozen-lockfile && env BASE_PATH="$RADAR_BASE_PATH" pnpm build)
}

ensure_sniper() {
  if [[ "$FORCE_REBUILD" != "1" ]] && [[ -f "$SNIPER_ENTRY" ]] && dist_has_base "$SNIPER_CLIENT" "$SNIPER_BASE_PATH"; then
    return 0
  fi
  require_pnpm
  echo "构建 Sniper  BASE_PATH=${SNIPER_BASE_PATH} …"
  (cd "$ROOT/game" && pnpm install --frozen-lockfile && env BASE_PATH="$SNIPER_BASE_PATH" pnpm build)
}

publish_static() {
  local stage backup
  ensure_radar
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
  mkdir -p "$stage/radar"
  cp -R "$SITE_SOURCE"/. "$stage"/
  cp -R "$RADAR_DIST"/. "$stage/radar"/
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
}

print_static_route() {
  local name="$1"
  echo "$(service_label "$name") 已发布，由 Nginx 直接提供 → $(public_url "$name")"
}

start_sniper() {
  local pid_path log_path occupied pid
  pid_path="$(pid_file)"
  log_path="$(log_file)"

  if sniper_is_running; then
    echo "Sniper 已在运行 (PID $(cat "$pid_path")) → $(public_url sniper)"
    return 0
  fi
  occupied="$(port_pids)"
  if [[ -n "${occupied:-}" ]]; then
    echo "端口 $SNIPER_PORT 已被占用 (PID: $occupied)" >&2
    return 1
  fi

  ensure_sniper
  rm -f "$pid_path"
  nohup env \
    HOST="$BIND" \
    PORT="$SNIPER_PORT" \
    NODE_ENV=production \
    BASE_PATH="$SNIPER_BASE_PATH" \
    node "$SNIPER_ENTRY" >"$log_path" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_path"
  sleep 0.4
  if kill -0 "$pid" 2>/dev/null; then
    echo "已启动 Sniper (PID $pid) → $(public_url sniper)"
    echo "监听: ${BIND}:${SNIPER_PORT}"
    echo "探活: http://127.0.0.1:${SNIPER_PORT}/healthz"
    echo "日志: $log_path"
  else
    rm -f "$pid_path"
    echo "启动失败，请查看 $log_path" >&2
    return 1
  fi
}

stop_sniper() {
  local pid_path pid
  pid_path="$(pid_file)"
  if [[ ! -f "$pid_path" ]]; then
    echo "Sniper 当前没有由 serve.sh 管理的运行进程"
    return 0
  fi
  pid="$(cat "$pid_path" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
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
    echo "Sniper 运行中 (PID $(cat "$(pid_file)"))"
    echo "入口: $(public_url sniper)"
    echo "监听: ${BIND}:${SNIPER_PORT}"
  else
    occupied="$(port_pids)"
    if [[ -n "${occupied:-}" ]]; then
      echo "Sniper pid 文件无效，但端口 $SNIPER_PORT 已被其他进程占用 (PID: $occupied)"
    else
      echo "Sniper 未运行"
    fi
  fi
}

start() {
  case "$1" in
    all)
      publish_static
      print_static_route web
      print_static_route radar
      echo
      start_sniper
      ;;
    web|radar)
      publish_static
      print_static_route "$1"
      ;;
    sniper) start_sniper ;;
  esac
}

stop() {
  case "$1" in
    all)
      echo "主站和 Radar 是 Nginx 静态文件，无独立进程可停止。"
      stop_sniper
      ;;
    web|radar) echo "$(service_label "$1") 由 Nginx 直接提供，无独立进程可停止。" ;;
    sniper) stop_sniper ;;
  esac
}

restart() {
  FORCE_REBUILD=1
  case "$1" in
    all)
      publish_static
      ensure_sniper
      FORCE_REBUILD=0
      stop_sniper
      print_static_route web
      print_static_route radar
      echo
      start_sniper
      ;;
    web|radar) start "$1" ;;
    sniper)
      ensure_sniper
      FORCE_REBUILD=0
      stop_sniper
      start_sniper
      ;;
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
      ;;
    web|radar) status_static "$1" ;;
    sniper) status_sniper ;;
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
  start     发布主站/Radar 静态文件并启动 Sniper（默认全部）
  stop      停止 Sniper；静态网页没有独立进程
  restart   重新构建发布并重启 Sniper（拉代码后推荐）
  status    查看静态发布文件和 Sniper 状态
  open      发布并打开入口（默认主站）

服务:
  web       主站   /                       （Nginx 静态文件）
  radar     Radar ${RADAR_BASE_PATH}/                 （Nginx 静态文件）
  sniper    Sniper ${BIND}:${SNIPER_PORT}  ${SNIPER_BASE_PATH}/

环境变量（也可写在仓库根目录 .env）:
  BIND               默认 127.0.0.1，仅 Sniper 使用
  SNIPER_PORT        默认 8003
  DOMAIN             例如 trashbox.tech，用于打印公网地址
  RADAR_BASE_PATH    默认 /radar
  SNIPER_BASE_PATH   默认 /game/sniper

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
    web|site|main|主站|radar|sniper|game|all)
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
