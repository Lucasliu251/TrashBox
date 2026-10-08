# TrashBox 统一账号

## 已实现的流程

- 主站、Radar、Music、Sniper 使用同一服务器会话，统一从 `/login` 登录，在 `/account` 管理登录方式和设备。首次成功授权自动创建内部 UUID，无密码、手机号或单独注册页面。
- KOOK 为推荐入口，使用主机器人的 OAuth 客户端；机器人 Bot Token 与 OAuth Client Secret 分开配置。Steam 使用官方 OpenID，登录不需要 Web API Key、采集码或提前收录用户。
- 微信网站 OAuth 仅在已审核的网站应用凭据配置后启用；小程序凭据不能替代它。保留 TrashBox 小程序扫码作为独立备用入口。原生小程序码仍需正式版页面和 `WECHAT_MINI_QR_ENABLED=1`。
- 任何成功登录的用户都可进入四个应用；音乐推荐仍校验其 KOOK 服务器成员身份。各网站保持独立入口。

## 数据归属

`auth_accounts.id` 是内部用户 ID；`auth_identities` 对 `(provider, namespace, subject)` 建唯一映射；`auth_sessions` 只保存随机 Cookie 的摘要，可按设备撤销；`auth_flows` 将短期一次性 OAuth state 绑定到发起浏览器。

旧 `users.uuid`、战绩和微信订阅接收身份保留。Steam 授权成功后精确匹配历史 SteamID，直接显示已有战绩；不从旧手填 SteamID 推断微信账号归属，也不复制旧账号权限、采集码或私密资料。新用户没有战绩时显示空状态，之后采集的数据按 SteamID 出现。

退出状态下使用未添加的第三方身份，会先创建独立账号。在个人资料页添加该身份时，验证当前账号和对方身份，然后明确确认合并。合并在事务中完成，保留旧账号别名、历史记录和审计，撤销双方原会话。不同平台同名不合并；同平台不同身份、权限不同或 Steam 采集码归属冲突时拒绝自动合并，保留原数据待人工核实。

## 会话与门禁

- Cookie 为 `trashbox_session`，`HttpOnly`、生产 `Secure`、`SameSite=Lax`、`Path=/`，不在 localStorage 保存访问令牌。
- 每个设备会话闲置 90 天过期，最长 365 天。前台导航/真实交互静默延长闲置期限；轮询和会话查询不续期。过期不会删除用户数据。
- Cookie 写操作要求中央 CSRF；添加登录方式与合并要求 10 分钟内重新验证。
- Nginx 保护应用页面/资源，FastAPI 保护业务 API，Music 与 Sniper 在服务器端检查直接 HTTP 和 WebSocket。认证不可用时拒绝访问；小程序 API 兼容有效 Bearer JWT。
- 内部页面标记 noindex。登录门禁会阻止未登录者读取应用，已被收录的旧搜索结果不会立即消失。

## 配置

仅在各项目的忽略 `.env` 内保存凭据，权限设为 0600：

| 项目 | 配置键 |
| --- | --- |
| TrashBox-Server/Backend | `KOOK_OAUTH_APP_ID`、`KOOK_OAUTH_CLIENT_ID`、`KOOK_OAUTH_CLIENT_SECRET`、`TRASHBOX_AUTH_BASE_URL`、`TRASHBOX_AUTH_ORIGINS` |
| KBot 根目录 | `MAIN_BOT_TOKEN`、`DATA_BOT_TOKEN` |
| KBot/MusicBot | `MUSIC_BOT_TOKEN`、`TRASHBOX_AUTH_SESSION_URL` |
| GitBot | `MAIN_BOT_TOKEN`，兼容 `KOOK_BOT_TOKEN` |

KOOK 授权链接沿用官方生成器参数，包含数字应用编号 `id`（配置为 `KOOK_OAUTH_APP_ID`），以及 `client_id`、`scope=get_user_info`、`redirect_uri` 和一次性 `state`。

生产 KOOK 回调为 `https://trashbox.tech/api/v1/auth/callback/kook`。平台白名单/域名须审核允许该回调，code 交换使用完全相同的地址。当前本地回调无法审批；Mac 可测试页面和会话，完整 KOOK 授权在生产域名上测试。

微信网站应用配置 `WECHAT_WEB_APP_ID` / `WECHAT_WEB_APP_SECRET`，回调为 `/api/v1/auth/callback/wechat`。不同微信应用的 OpenID 分别映射，跨应用归属通过明确身份验证/合并完成，不按昵称或未核实的 UnionID 推断。

迁移由 `Backend/migrate_identity.py` 执行，记录在 `trashbox_migrations`，启动时重复执行为无操作。部署前保留数据库备份；不要在已产生新账号数据后直接删除身份表回滚。启动、停止和反向代理说明见 [README.md](README.md)。
