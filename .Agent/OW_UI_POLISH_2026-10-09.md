# OW 页面体验优化记录

日期：2026-10-09。主站发布目标 Ubuntu-Shanghai / 1.117.229.156。

## 实际修改

- site/src/features/ow/patch-link.ts：按北京时间生成国服当月补丁链接；重新交互时重算月份。
- OwHome.vue / ow.css：首页文案、有效轮播入口、可点击英雄头像、独立页签路由与动画、简短来源说明。
- OwTactics.vue / tactics.css：独立实验室、精简参考说明、手机完整图与放大操作。
- site/src/CommunityApp.vue：账号入口回跳地址随 OW 页签更新，CS2 的查询参数导航同步维护。
- site/public/ow-data/balance-patch.json：已有官方采集器刷新本地公开记录，当前国服 2026-10-07，40 位英雄，三组 5 / 1 / 38；服务器自己的小时任务也已自动取得该国服版本，没有覆盖在线动态缓存。

## 验证

- 本地当前主站 vue-tsc / Vite 构建通过；公共发布组合构建通过（48 模块）。账号 App.vue 与 shared/auth.ts 哈希保持服务器原值。
- 月份检查：北京时间 9/30→10/1、10/31 午夜前、12/31→次年 1/1 均生成正确路径。
- 原有阵容验证：54 可搜索英雄、51 已收录英雄、498 关系；角色限制、锁定、未知输入、别名及替代阵容检查通过。
- 隔离假账号预览：实验室直达、首页与实验室互不混排、浏览器返回保留三组推荐、搜索查莉娅成功；未连接生产数据库。
- 线上登录态：实验室独立标题与内容显示，首页隐藏；近期调整来源为网易国服，日期 2026.10.07；点击 D.Va 后新标签 URL 为 https://ow.blizzard.cn/news/patch-notes/live/2026/10/。
- 国服正文通过系统证书的 HTTP 读取确认标题 2026 年 10 月 7 日。最后一次浏览器读取该外部标签时自动审批超时，未继续绕过审批读取；头像链接、新标签 URL 与之前的官方正文均已确认。
- 1280px / 390px 页面宽度与视口一致；手机放大图为 660px，在内部滚动区域浏览，页面仍为 390px。
- 匿名请求新主站 JS 返回 401，线上已登录浏览器可加载；账号门禁保留。
- nginx 与 trashbox-ow-patches.timer 均 active。截图为公共 OW 区域，无个人资料或私人战绩。

## 发布与恢复

发布时间：2026-10-09 18:18:27 +08:00。

发布备份：/home/ubuntu/TrashBox/.ow-releases/ow-polish-20261009/。before 保存入口与受影响源码，source-state.json 记录新文件，stage 保存实际包，published.json 记录入口哈希。新哈希资产先追加，主站 index.html 原子切换；旧哈希资产保留。没有替换 auth / Radar / Sniper 入口，没有重启服务或覆盖动态 ow-data。

主站新入口 SHA256：d3c5efca91be93e49b19d25f38408b5f818cc9f90da9a658c978b005b4756670。

本地生产组合：/private/tmp/trashbox-ow-polish-release，源自主站现有公开版；排除尚未启用的 OwMyMatches 与 /api/v1/me/ow。仓库源码仍保留先前准备的私人功能，因此不要将仓库全量构建直接代替公共发布组合。恢复时先确认后续发布，仅恢复本轮入口与受影响源码；新建 patch-link.ts 是否移除以 source-state 为准，不覆盖后续动态数据或账号配置。

预览：previews/ow-polish-lab-desktop.jpg、previews/ow-polish-lab-mobile.jpg。

本轮未执行 Git 提交 / 推送。测试服务结束后关闭；线上既有服务继续运行。
