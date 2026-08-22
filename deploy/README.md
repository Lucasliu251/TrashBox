# TrashBox 生产部署

## 首次部署

1. 确保 Node.js、pnpm 和 Nginx 已安装，仓库位于一个 Nginx 可以读取的固定绝对路径。
2. 在仓库根目录创建环境文件并发布：

   ```bash
   cp -n .env.example .env
   # 编辑 .env，至少填写 DOMAIN
   ./serve.sh restart
   ```

3. 执行 `pwd` 得到仓库绝对路径，把 `deploy/nginx.conf` 中所有 `/ABSOLUTE/PATH/TO/TrashBox` 替换为该路径。
4. 将配置放进域名现有的 HTTPS `server { ... }`，保留已有的证书和 `/api/` 规则，然后检查并重载：

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. 检查三个入口和 Sniper 探活：

   ```bash
   curl -I https://你的域名/
   curl -I https://你的域名/radar/
   curl -I https://你的域名/game/sniper/
   curl http://127.0.0.1:8003/healthz
   ```

## 日常更新

拉取代码后执行：

```bash
./serve.sh restart
./serve.sh status
```

`restart` 会重新构建 Radar 和 Sniper，把主站及 Radar 放入 `.serve-public/`，然后重启 Sniper。Nginx 会自动读取新静态文件，不需要 reload。Sniper 重启会结束当前内存房间，建议在无人游戏时发布。

如果只更新主站或 Radar，可执行 `./serve.sh restart web` 或 `./serve.sh restart radar`，这样不会中断 Sniper 房间。

## 必须注意

- Nginx 运行用户必须能读取 `.serve-public/`，并能穿过仓库路径上的父目录。推荐把生产仓库放在 `/srv/trashbox` 一类服务目录；不要为了省事把整个个人主目录开放写权限。
- 防火墙或云安全组只开放 80/443。8003 继续绑定 `127.0.0.1`，不要直接暴露公网；8001 和 8002 已不再使用。
- Radar 必须以 `RADAR_BASE_PATH=/radar` 构建，Sniper 必须以 `SNIPER_BASE_PATH=/game/sniper` 构建。`serve.sh` 会自动检查。
- `deploy/nginx.conf` 中可能还要与现有 `/api/`、证书和其他站点规则合并，不要直接覆盖完整的 Nginx `server` 块。
- 修改 Nginx 配置后永远先执行 `nginx -t`；只有配置变化才 reload。普通网页发布不需要 reload。
- `.serve-public/` 是生成目录，不要手工编辑，也不要提交到 Git。
- `serve.sh` 用 `nohup` 管理单个 Sniper 进程，但不是进程守护器；服务器重启后要再次执行 `./serve.sh start`。需要自动拉起或崩溃重启时，再把 Sniper 接入 systemd/PM2。
