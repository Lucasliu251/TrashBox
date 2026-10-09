# OW 克制 / 阵容与官方中文补丁发布记录

日期：2026-10-09（Asia/Shanghai）。状态：**已上线 Ubuntu-Shanghai，真实登录态浏览器验收通过，服务器服务继续运行。** 本轮用户已要求提交并推送，实际提交状态见 Git 记录。

## 用户授权与范围

用户要求完成 banner 切换动画、克制图 / 阵容功能后发布；本轮另明确减少每个访客的官网检查，改用日期更新的国服或国际服官方中文补丁，不自行翻译并自动更新。保留统一登录、账号 / Radar / Music / Sniper；未改数据库、小程序、机器人或其他仓库。

入口：<https://trashbox.tech/?game=ow&view=heroes>。未登录仍 302 到统一登录页；既有 Chrome 登录态可正常进入。

## 数据事实与实现

- 国服第 5 赛季竞技全部段位 API 为 54 行，`ds=2026-10-08`；index 的 `patch_desc.date` 仍为 `2026/7/15`。API 成功不等于各字段同步更新。
- 国服正式十月补丁地址 404，九月页面最新平衡记录为 9/18，9/23 仅错误修复。国际服官方 zh-TW 十月正文可读，标题日期为 10/7；其发布标签 / URL 锚点日期为 10/6。字段分别保存，没有改写或自行翻译。
- 共享 `/ow-data/balance-patch.json` 目前为国际服官方繁体中文 2026-10-07、40 位英雄，三组 5 / 1 / 39，可重叠。分类是明确数值方向整理，混合、重做、命中区域等列调整，不声称是官网提供的净强弱判断；完整内容直达官方原文。
- 浏览器复用一小时有效公共统计缓存，10:15 官方日更新窗口提前到期，保留源日期 / 读取时间；取消五分钟、focus 与 visibility 轮询。手动刷新绕过本机统计缓存。
- 后台每小时处理一次官方中文月度页面，利用 ETag / Last-Modified 条件请求；国服 / 国际服更新日期优先，同日国服优先。过滤角斗领域、仅 6v6 的条目、纯修复 / 活动内容；未知英雄名称保留。上游失败不覆盖空文件、不倒退到更旧日期，标记保留记录。更新有小时级检查间隔，不能比上游更实时。
- 当前英雄职责优先使用英雄配置。官方国服新闻及配置的黑影已是支援，但统计 API 仍返回输出，原始统计值保留；重做后的黑影 / 路霸不使用旧技能克制表。现为 54 个图节点、51 个可评估英雄、498 条优势关系；血律仍缺社区表。
- 公开快照脚本 `refresh-ow-data.mjs` 的尾斜杠导致原子 rename 目标落入源目录，发布区实际复现 EINVAL 后改用规范化路径。复验成功刷新 11 个有效组合 / 543 行，缺失段位不伪造数据。

## 生产更新任务

源码：`site/scripts/refresh-ow-patches.py`，标准库 Python，无新依赖和私人凭据。

安装：`/etc/systemd/system/trashbox-ow-patches.service`、`.timer`；以 ubuntu 运行，小时计划加最多两分钟错峰。`flock` 防止重叠；只写公共数据和 `.run-local` 缓存，无特权 / 私人数据采集。

两份输出同步原子写入：`site/public/ow-data/balance-patch.json`（后续构建使用）和 `.serve-public/ow-data/balance-patch.json`（访客读取）。任务状态为 enabled / active；首次运行 `Result=success`、`ExecMainStatus=0`，最近核对 11:41:09，首次计划时间 12:01:50 CST。

查看：`systemctl list-timers trashbox-ow-patches.timer`。手动更新：`sudo systemctl start trashbox-ow-patches.service`。主服务仍用原 `./serve.sh start`，本次没有连带重启其他服务。

## 发布与恢复

发布目录：`/home/ubuntu/TrashBox/.ow-releases/ow-20261009-tactics-patches/`。

`before/` 保存先前入口、OW 公共 JSON、构建、改动源码及新文件状态；`stage/` 是已验证输入，`published.json` 记录时间和哈希。旧哈希资源保留，只追加资源，再原子切换根 `index.html`，不重发 Radar / auth。

- 发布时间：2026-10-09 11:41:08 +08:00。
- 新首页 SHA256：`ce0534a9ec1cc7b8857a73e4cd77b806757f47dc1d53c76fe94ef8e02608f773`。
- 旧首页 SHA256：`6606a5fad9092a15d8466e6180795c1e5ed0793f038c0689f6f45d6f8f75614e`。
- 账号基线 `App.vue`、`shared/auth.ts`、`main.ts` 与本地逐字节一致，发布前后均校验。
- auth 入口 SHA256 保持 `fd536b221d74870288cf7a8c4b4f07e064b214dc38b50e6ff04fb0222f92dc59`，Radar 入口保持 `9fb6470f921b7dd6ea378edc9e1a52b5466157f89c6b4816ecbb4e69b4f9e0a0`。
- 没有改变 Nginx 路由 / 门禁。`nginx -t` 通过，Nginx active。

若回滚，先确认后续发布并停止补丁 timer，避免旧源码 / 新写入竞争；按 source-state 恢复受影响源码及旧入口 / OW JSON，再检查构建和门禁。不要整树覆盖后来账号、其他服务或 Git 工作区变动。

## 验收

- vue-tsc、Vite 构建通过，34 模块。
- `check-ow-data.mjs`：54 英雄 / 11 组合 / 543 汇总行通过。
- `check-ow-live.mjs`：新赛季、历史降级、独立 CDN 失败、生产代理、超时 / 取消；新增重访 / 重载复用、强制刷新、到期和错误赛季缓存拒绝通过。
- `check-ow-patches.py`：最新平衡与修复分离、数值方向、混合 / 重做、6v6 / 角斗排除、最新来源比较、同日国服优先、来源失败保留、两份原子输出通过。
- `check-ow-tactics.mjs`：锁定、职责、别名、非法输入、多方案、未知与重做英雄、498 唯一优势边通过。
- 实际公网三条 JSON 接口 200：统计 10/8，初始化旧标签 7/15，中文补丁 10/7 / global / ok / 40 英雄。
- 实际 Chrome 已登录页面：统计“官方数据 2026.10.08 官方 API”；补丁“暴雪国际服 · 官方繁体中文 / 补丁日期 2026.10.07”。CS2→OW 返回后读取时间仍 11:43，复用缓存。
- 390px 页面宽度等于 viewport，三组完整 5 / 1 / 39 头像。线上例子保留 D.VA / 雾子两位锁定，生成三套完整阵容，第一套分 21.7。
- 未登录根页面仍 302 登录，登录页 / Radar 发布文件未变；服务与小时 timer 保持运行。隔离 Mac Vite 5186 / fixture 21936 测试进程关闭。

截图：[服务器补丁区域](previews/ow-production-20261009-patches.jpg)。
