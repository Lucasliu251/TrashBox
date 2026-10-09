# TrashBox 本人对局接入

状态：功能源码已实现，独立 PostgreSQL 合成测试、桥接验证及浏览器测试通过；真实国服 OAuth / 大神凭据尚未配置。不要把准备状态视为已能采集真实用户。

## 资源预算

核对版本：`AddOneSecondL/Overstats@4403cbd5006764551ede35c7d70b9907ade105c5`。固定版本源码 / 资源总计约 23.4 MiB，主要资源约 18.2 MiB；依赖为 httpx、Pillow、tzdata。JSON 路径不需要 GPU，不启用图片或 AI 分析。

小规模试点建议预留约 1 核 / 1 GiB 可用内存 / 1–2 GiB 空间，包含独立运行环境和初期记录 / 备份；这是预算，尚无真实用户负载实测。当前 Ubuntu-Shanghai 为 2 核、总内存约 3.6 GiB、可用约 2.5 GiB、磁盘剩余 53 GiB，暂不需要为试点扩容。对局数和保留时间决定后续数据库增长，不能承诺任意用户规模都够用。

## 账号与资格

站内有效账号 + 国服战网 OAuth 身份 + 明确开启同步，三者缺一不采集。用户可继续用 KOOK / Steam 等登录，再在“我的对局”连接战网。注册与登录共用现有账号系统，不通过昵称 / 头像相似度猜测绑定，也不接受浏览器指定目标 BattleTag 或用户 ID。

通过官方国服用户信息取得本人 BattleTag，首次解析只接受近期已验证身份且精确匹配资料名称；之后使用确认过的稳定源 ID，不反复用旧昵称搜索。实际 OAuth 与大神资料的对应关系还须用本人授权样本验收，无法匹配时保持拒绝。

仅本人可见；暂停后停止新增采集并隐藏列表，保留本人已同步记录。身份解除 / 合并 / 权限版本变化后的在途结果不能写入。其他已注册玩家也必须分别验证与开启，不从队友 / 对手名单带入采集队列。

## 1. 申请并配置国服战网 OAuth

从战网官方开发者后台创建支持**国服用户授权**的应用。不同区域的应用 / 账号支持必须现场确认；不能用国际服授权证明国服账号，也不能把 client_credentials 的应用 Token 当成个人授权。

国服官方发现端点已读取：<https://oauth.battlenet.com.cn/.well-known/openid-configuration>。

- 授权：`https://oauth.battlenet.com.cn/authorize`
- 换取 Token：`https://oauth.battlenet.com.cn/token`
- 用户信息：`https://oauth.battlenet.com.cn/userinfo`
- 生产回调白名单：`https://trashbox.tech/api/v1/auth/callback/battlenet`

把以下两项写入服务器或 Mac 对应的 `TrashBox-Server/Backend/.env`（600 权限），不要发到聊天或 Git：

```dotenv
BATTLE_NET_CLIENT_ID=
BATTLE_NET_CLIENT_SECRET=
```

本地真实 OAuth 测试需额外注册实际主站地址的回调，并让 `TRASHBOX_AUTH_BASE_URL` 使用同一地址；端口以 `serve.sh` 输出为准。若平台不接受本地回调，只在正式域名完成个人授权验证，不绕过回调检查。

## 2. 准备私有 Overstats

服务器主仓库内执行 `bash deploy/prepare-overstats.sh`。它准备外置固定版本与独立 venv，不启动服务、不修改数据库、不覆盖已存在配置。

填写 `~/.config/trashbox/overstats-credentials.json` 中**你拥有并获授权使用**的大神服务账号 role_id / token。获取方式遵循 [上游配置指引](https://github.com/AddOneSecondL/Overstats/blob/4403cbd5006764551ede35c7d70b9907ade105c5/Faststart.md)。服务凭据与目标玩家身份是两回事，Token 本身不证明任意用户归属。

生成的 `~/.config/trashbox/overstats.env` 含内部桥接密钥。把同一个 `OVERSTATS_BRIDGE_SECRET` 安全复制到后端 `.env`，不要输出到终端日志。后端还需要：

```dotenv
OVERSTATS_BRIDGE_URL=http://127.0.0.1:18081
OVERSTATS_BRIDGE_SECRET=
OVERSTATS_ENABLED=0
```

本次使用自有 `overstats_bridge.py`，只导入 JSON 所需模块，不运行原生完整服务 / 网页控制台 / 图片 / AI / 全员详情。原版默认完整存档被强制关闭；SQL 请求统计、玩家身份和整局存档不启用。桥接端口只监听回环地址，HMAC 和短时一次性请求验证阻止任意目标调用。不要在 Nginx 开放 18081 或代理原生 Overstats 查询接口。

只有公共英雄 / 地图名称进入必要元数据；源客户令牌不入数据库，不返回浏览器。原始响应和其他参与者字段在桥接输出及后端入库两层剔除。

## 3. 数据库与启动（待正式发布授权）

先在独立数据库验证迁移与合成测试，再备份正式数据库。在后端目录显式执行 `python migrate_ow.py --apply`，对应 `migrations/20261009_ow_collection_up.sql`；仅新增三张私人表：绑定、本人对局、同步任务。不能在默认生产库上跑测试。

部署主站 / 统一账号前端、后端新增模块，执行已审阅的迁移，配置并安装：

- `deploy/trashbox-overstats-bridge.service`
- `deploy/trashbox-ow-collection.service`
- `deploy/trashbox-ow-collection.timer`

服务端 Python 路径与现有部署一致，其他服务器应先调整 unit。准备 `TrashBox/.run-local/`。桥接健康检查为 `http://127.0.0.1:18081/healthz`，应明确 `storage:false`；配置缺失时服务拒绝启动。

验证服务与本人 OAuth 对应关系之后，才将 `OVERSTATS_ENABLED=1` 并重启后端 / 启用 timer。用户自己点击“开启我的战绩同步”；不要替用户写入授权。

队列每 5 分钟检查一次，已启用的用户约每 15 分钟进入同步候选；主动同步也会启动即时后台处理。低并发和排队意味着不能保证 15 分钟内全部更新。上游默认收取近期两个赛季、最多 48 个列表条目，不承诺全部历史；仅使用本人列表指标，不调用全员详情。

## 4. 验证与停用

- 本人连接后授权，检查地图 / 英雄 / 胜负 / 比分与消灭、助攻、死亡、伤害、治疗。
- 确认另一账号不能读取其对局；暂停后列表隐藏且新结果不入库。
- 数据库与日志不应含其他参与者、客户令牌或原始 payload。
- 上游凭据过期时保留最后已保存的有效记录，提示来源不可用。
- 回滚先停 collection timer / bridge，并设置 `OVERSTATS_ENABLED=0`，不回滚整个账号 / CS2 服务或自动删除存量私人数据。
