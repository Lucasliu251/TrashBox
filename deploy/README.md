# TrashBox 生产部署

## Mac 本地一键测试

在 Mac 的 `TrashBox` 目录执行：

```bash
./serve.sh start
./serve.sh status
# 测试完毕
./serve.sh stop
```

脚本在 macOS 自动切换到 `serve-local.sh`。三个站点独立打开：主站 `http://127.0.0.1:5174/`、Radar `http://127.0.0.1:5173/radar/`、Sniper `http://127.0.0.1:8003/game/sniper/`。本地会启动两个 Vite 进程、Sniper、FastAPI，并通过 `Ubuntu-Shanghai` SSH 隧道连接服务器的 PostgreSQL。需要本机 SSH 别名可用；数据库密码从服务器现有 `.env` 读入进程内存，不保存到本地文件。Mac 后端源码需支持 PostgreSQL。

首次运行会在本仓库的 `.local-venv/` 安装缺失的 Python 包。`./serve.sh start frontend` 可以仅预览主站和 Radar 页面；`./serve.sh start backend` 可单独启动 API 与 SSH 隧道。PID 与日志在 `.run-local/`，`stop` 只停止脚本管理的本地进程。由于本地使用服务器 PostgreSQL，测试登录挑战、发帖等操作会写入该数据库。本地 JWT 密钥为临时生成，二维码可渲染，但小程序若仍请求生产 API，不能由本机后端直接完成扫码确认。

## 首次部署

1. 确保 Node.js、npm、pnpm、Python 3（含 venv）、curl 和 Nginx 已安装。前端仓库与 `TrashBox-Server` 位于同一父目录，或在 `.env` 设置 `BACKEND_DIR`。
2. 在仓库根目录创建环境文件并发布：

   ```bash
   cp -n .env.example .env
   # 编辑 .env，至少填写 DOMAIN
   ./serve.sh start
   ```

3. 执行 `pwd` 得到仓库绝对路径，把 `deploy/nginx.conf` 中所有 `/ABSOLUTE/PATH/TO/TrashBox` 替换为该路径。
4. 将配置放进域名现有的 HTTPS `server { ... }`，保留已有的证书和 `/api/` 规则，然后检查并重载：

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. 检查三个入口以及两个本机服务：

   ```bash
   curl -I https://你的域名/
   curl -I https://你的域名/radar/
   curl -I https://你的域名/game/sniper/
   curl http://127.0.0.1:8003/healthz
   curl http://127.0.0.1:2026/test
   ./serve.sh status
   ```

## 日常更新

拉取代码后执行：

```bash
./serve.sh restart
./serve.sh status
```

`start` 会检查后端源码和环境文件，在 `TrashBox-Server/Backend/.venv` 安装缺失依赖，构建并发布主站 H5、Radar、Sniper，随后启动本机 FastAPI 和 Sniper。`restart` 会重新构建并重启两项进程；Sniper 重启会结束当前内存房间，建议在无人游戏时发布。

`stop` 停止由脚本管理的 FastAPI 和 Sniper，并将 `.serve-public/` 移到带时间戳的 `.serve-public.paused-*` 目录。Nginx 是共享服务，不会被停止；再次执行 `./serve.sh start` 会重新发布静态网页。

如果只更新主站或 Radar，可执行 `./serve.sh restart web` 或 `./serve.sh restart radar`，这样不会中断 Sniper 房间。

## 必须注意

- Nginx 运行用户必须能读取 `.serve-public/`，并能穿过仓库路径上的父目录。推荐把生产仓库放在 `/srv/trashbox` 一类服务目录；不要为了省事把整个个人主目录开放写权限。
- 防火墙或云安全组只开放 80/443。8003 继续绑定 `127.0.0.1`，不要直接暴露公网；8001 和 8002 已不再使用。
- Radar 必须以 `RADAR_BASE_PATH=/radar` 构建，Sniper 必须以 `SNIPER_BASE_PATH=/game/sniper` 构建。`serve.sh` 会自动检查。
- 主站 H5 位于 `site/`，Vite 构建产物是 `site/dist/`，使用 `/site-static/` 资源路径，避免与后端图片的 `/assets/` Nginx 映射冲突。构建复用已安装的 `web/node_modules`。
- `/api/` 指向独立的 `TrashBox-Server/Backend`。脚本要求后端已包含 Radar 和 Web Auth 路由及 `.env`，并始终把 FastAPI 绑定到 `127.0.0.1:2026`。缺少路由或端口被其他进程占用时会明确失败，不会把残缺服务报告为成功。
- `deploy/nginx.conf` 中可能还要与现有 `/api/`、证书和其他站点规则合并，不要直接覆盖完整的 Nginx `server` 块。
- 修改 Nginx 配置后永远先执行 `nginx -t`；只有配置变化才 reload。普通网页发布不需要 reload。
- `.serve-public/` 是生成目录，不要手工编辑，也不要提交到 Git。
- `serve.sh` 用 `nohup` 和 PID 文件管理 FastAPI、Sniper，但不是进程守护器；服务器重启后要再次执行 `./serve.sh start`。
