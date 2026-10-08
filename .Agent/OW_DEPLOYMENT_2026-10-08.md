# OW v1.1 服务器发布记录

日期：2026-10-08（Asia/Shanghai）。状态：**已发布并完成真实公网浏览器验证**。

## 用户授权与发布范围

用户明确要求把 OW 页面上线服务器。发布主站 OW 页面、必要公开数据代理和回退 JSON；保留现有账号门禁、CS2、Radar、其他独立站点。没有修改数据库、后端账号逻辑、Overstats 或小程序，也没有向另一会话发送消息。

线上入口：[OW 板块](https://trashbox.tech/?game=ow&view=heroes)。当前整个主站沿用账号会话刚上线的登录门禁；登录后进入 OW。公开 OW 数据来源与两条只读代理无需战网或网易大神登录。

## 账号兼容合入

服务器已有未提交的账号系统更新，不能把本工作树的旧版主站构建直接覆盖上线。发布时以当前账号版 `site/` 和 `shared/auth.ts` 为基线，组合 OW 增量后独立构建：

- 保留 `App.vue` 会话门禁、`shared/auth.ts`、携带 Cookie 的 CS2 请求与 401 登录跳转。
- 保留“我的账号”、已绑定 Steam 默认数据入口、登录页与 noindex 设置。
- 仅合入 OW 游戏切换、独立模块、样式、公开快照与采集/验证脚本。
- 增补带账号入口的手机头部布局；390 / 360px 实测无横向溢出。
- 原主检出目录没有被修改。本工作树的单独 demo 仍保留；生产组合由 `deploy/compose-ow-release.py` 可复现，不能把它误认为已合并 master。

账号基线关键 SHA256：

```text
site/src/CommunityApp.vue  4be0e8f10cb1731cefcbcbb160cbf36483bb8dda2101ba9b86cd40e45e437c0e
site/src/App.vue           9fc154a407740be1665cd952c97142f6353e6664e160ff2046109dc87cd628f8
shared/auth.ts            b2e7addec1d1bf8a05be29503a30d035da383b3be5e7398065703d1310cb8880
```

发布前校验了 18 个基线文件；基线变化则停止并重新组合。账号 App 与 shared helper 发布后 SHA 未变。

## 服务器与代理

- SSH 主机：`Ubuntu-Shanghai`。
- 主仓库：`/home/ubuntu/TrashBox`；静态发布目录：`.serve-public/`。
- 发布 ID：`ow-20261008-v1.1`。
- 备份目录：`/home/ubuntu/TrashBox/.ow-releases/ow-20261008-v1.1/`。
- 新入口 SHA256：`6606a5fad9092a15d8466e6180795c1e5ed0793f038c0689f6f45d6f8f75614e`。

Nginx 主配置只追加 OW location include，未移除或重写账号/其他站点路由：

- `/etc/nginx/conf.d/trashbox-ow-limit.conf`：合计 2 请求/秒，允许短暂突发。
- `/etc/nginx/snippets/trashbox-ow-proxy.conf`：固定官方 HTTPS 上游，SNI 与证书验证开启，不转发 Cookie / Authorization / Origin / Referer，不缓存上游响应。
- `/etc/nginx/snippets/trashbox-ow-locations.conf`：只开放 `/ow-live/index`、`/ow-live/hero_leaderboard` 的 GET；统计只允许当前首页使用的竞技、正整数赛季、全部段位参数。
- `/ow-data/` 只提供本项目公开英雄 JSON，保证 `credentials:omit` 的冷启动和降级可用；主站页面及私有资源门禁保留。

没有使用 `serve.sh restart web`，因为该脚本会连带重新发布 Radar。新哈希资源先追加，保留旧资源；最终原子切换 `index.html`。`auth/index.html` 和 `radar/index.html` 与备份逐字节一致。只 reload Nginx，未重启后端或其他游戏服务。

## 实测结果

- 本地组合版本构建、`ow:check`、`ow:check-live` 通过；`nginx -t` 发布前后通过。
- 公网 `/ow-live/index` 与动态赛季统计均 HTTP 200 / `code=0`，54 位英雄，统计日期 2026-10-07；响应 no-store，不带 Set-Cookie。
- 官网标签日期仍为 2026/7/15，三类分别 8 / 5 / 4；真实来源日期没有改写。
- 非允许路径 404、附加任意 URL 参数 400、POST 405。
- 未登录主站和 Radar 仍跳转登录；登录页 200，Journal / Skybound 仍 200。
- 使用已有登录的 Chrome 会话验证真实 `https://trashbox.tech/` OW 页面、官网刷新和头像，显示“官网已检查”。
- 390 / 360px 实测页面宽度等于视口宽度，账号入口正常，三组头像完整显示。
- 线上 CS2 切换、“反应测试”旧 URL、账号入口和切回 OW 均正常。

[线上截图](previews/ow-production-20261008.jpg)

## 回滚与后续发布

`published-before/`、`dist-before/`、`source-before/`、`nginx-before.conf` 与发布 manifest 保留在备份目录。发布异常时脚本已设计自动恢复；若后续主动回滚，先核对有无新的其他会话更新，再恢复入口与对应源码/配置，`nginx -t` 通过后 reload。不得直接用旧整树覆盖后续账号或其他服务更新。

服务器源码已经含账号 + OW 的组合，但本机主目录 `master` 尚未自动合入 OW。另一个会话以后发布时应以该组合为基线或先合并 OW，不能直接发布不含 OW 的旧主目录版本。工作树隔离本地文件；共享 Git 历史、服务器、数据库及发布目录不隔离。
