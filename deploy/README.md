# TrashBox 启动与部署

在 Mac 的 TrashBox 目录执行：

```bash
./serve.sh start
./serve.sh status
./serve.sh stop
```

macOS 自动使用 `serve-local.sh`。主站 `http://127.0.0.1:5174/`、Radar `http://127.0.0.1:5173/radar/`、Sniper `http://127.0.0.1:8003/game/sniper/`、Music `http://127.0.0.1:8004/Music/` 共用中央登录。登录前端在 `5175`；各产品代理 `/login`、`/account`、`/auth/` 和中央认证 API，使登录后回到原产品端口。全部使用 `127.0.0.1`，不要与 `localhost` 混用。若默认页面端口被 Cursor 转发或其他工作树占用，脚本会选择空闲端口、打印实际地址，并在 `.run-local/` 保存端口供 `status` / `stop` 使用；显式的 `LOCAL_*_PORT` 配置仍优先。

脚本启动 PostgreSQL SSH 隧道 `15432`、FastAPI `2026`、三个 Vite 进程、Sniper 和 Music。需要 `Ubuntu-Shanghai` SSH 别名可用；数据库密码从服务器现有 `.env` 读取，不保存到本地文件或打印。Mac 后端会在 `.local-venv/` 安装缺失依赖，并先执行幂等的 `migrate_identity.py`。本地连接服务器 PostgreSQL，迁移、登录和发帖会写入该数据库。提供方 OAuth 回调地址必须与各平台配置一致；目前本地 KOOK 回调无法审批，因此 Mac 登录页默认禁用 KOOK 并说明原因；生产域名仍可使用 KOOK。仅当平台允许本地回调后再设置 `KOOK_LOCAL_OAUTH_ENABLED=1`。Mac 可通过 Steam/小程序或测试会话验证登录。

服务器 Music 在线时，仅做 Mac 网页测试可运行 `MUSIC_HTTP_ONLY=1 ./serve.sh start`，跳过重复 KOOK 音频连接。

Music 源码默认在同级 `KBot/MusicBot`，需要其现有 `venv`、`.env`、Node.js 与 FFmpeg。启动 Music 也会启动其音乐机器人和本地网易云服务；Mac 不启动生产主/数据机器人与 GitBot；服务器的 `all` 同时调用 KBot 的 `main` 组（主/数据机器人）和 GitBot 启动器。可通过 `MUSIC_DIR`、`MUSIC_PYTHON` 指定路径。

隔离 QA 可先准备同一 PostgreSQL 中的临时数据库，然后使用 `LOCAL_DB_NAME=临时库名 LOCAL_DB_USER=trashbox MUSIC_HTTP_ONLY=1 ./serve.sh start`。`LOCAL_DB_NAME`、`LOCAL_DB_USER` 默认都是 `trashbox`；密码仍从现有服务器环境读取。`MUSIC_HTTP_ONLY=1` 只运行 Music 网页与门禁，避免为页面测试启动另一份音乐机器人和网易云服务。脚本不会自动创建或删除数据库。

`start frontend` 管理登录、主站与 Radar；`start backend` 管理 API 与数据库隧道；`start sniper`、`start music`、`start auth` 管理对应服务。PID 与日志在 `.run-local/`。`stop` 只停止脚本管理的进程。

## 服务器首次部署

1. 准备 Node.js、npm、pnpm、Python 3（含 venv）、curl、FFmpeg 和支持 `http_auth_request_module` 的 Nginx。TrashBox、TrashBox-Server、KBot 默认位于同一父目录。
2. 在仓库根目录创建 `.env`（可参考 `.env.example`），填写 `DOMAIN` 和需要覆盖的路径。认证提供方密钥配置在 `TrashBox-Server/Backend/.env`，音乐机器人配置在 `KBot/MusicBot/.env`。不要把真实密钥提交到 Git。
3. 执行 `./serve.sh start`。脚本会构建主站、Radar、中央登录、Sniper，发布到 `.serve-public/`，执行账户迁移，启动 FastAPI、Sniper、Music、主/数据机器人与 GitBot。Sniper 和 Music 继续只监听回环地址。
4. 替换 `deploy/nginx.conf` 的 `/ABSOLUTE/PATH/TO/TrashBox`，将其 location 合并进现有主域名 HTTPS server。保留证书、`/Journal/`、`/ll/`、上传文件映射与带签名的 webhook 规则。替换旧的同名 location，避免重复；不要把 `auth_request` 放到整个 server 上。
5. Radar 旧子域名可合并 `deploy/nginx-radar-redirect.conf` 的规则，统一跳转到主域名 `/radar/`。保留其证书与 server 配置。
6. 先检查配置，再重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
./serve.sh status
```

生产 cookie 为主域名专用的 `trashbox_session`，`Secure`、`HttpOnly`、`Path=/`；不使用跨子域名 cookie。登录入口公开，账户与四个应用页面需要会话。应用静态资源和 WebSocket 也受保护；应用页面返回登录跳转，API/WebSocket 返回 `401`。FastAPI 的 API 中间件同时兼容小程序的合法 Bearer JWT，认证发起与回调由各路由独立校验。中央认证服务不可用时，门禁拒绝访问。

Music 在 Nginx 下使用 `/Music/` 前缀。配置将该前缀剥离，并传入 `X-Script-Name: /Music`，使 API、资源与 Socket.IO 地址都留在 `/Music/` 下。

## 更新与验证

```bash
./serve.sh restart
./serve.sh status
```

`restart` 重新构建并重启进程，Sniper 的内存房间会结束。只更新主站、Radar 或中央登录可执行 `restart web`、`restart radar`、`restart auth`；这些命令发布完整静态目录。只重启 Music 可执行 `restart music`。

匿名验证应看到 `/login` 为 `200`，`/`、`/radar/`、`/game/sniper/`、`/Music/`、`/account` 为登录跳转，中央 `/api/v1/auth/session` 与各私有 API 为 `401`。完成一次登录后再检查四个页面、资源、API 与 WebSocket；注销后刷新页面和重新连接 WebSocket应被拒绝。Sniper 已建立的连接每 60 秒重查会话，Music 每 30 秒重查。

```bash
curl -I https://你的域名/login
curl -I https://你的域名/
curl -I https://你的域名/radar/
curl -I https://你的域名/game/sniper/
curl -I https://你的域名/Music/
curl -I https://你的域名/api/v1/auth/session
curl http://127.0.0.1:8003/healthz
curl http://127.0.0.1:8004/healthz
curl http://127.0.0.1:2026/test
```

静态更新不需要 Nginx reload；配置改变才需要检查并重载。`.serve-public/` 是生成目录。服务器 `stop` 停止脚本管理的三个服务，并将发布目录保存为 `.serve-public.paused-*`；共享 Nginx 服务保持运行。脚本使用 nohup 和 PID 文件管理进程；服务器重启后需再次运行 `./serve.sh start`。
