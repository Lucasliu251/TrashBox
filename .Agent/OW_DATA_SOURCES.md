# OW 数据源与素材证据

核对日期：2026-10-08（Asia/Shanghai）。以下是当日观察，不代表接口永久稳定；施工前复核响应和配置。公开来源可保存短样例，个人战绩和凭据不进入本目录。

## S1：国服官网英雄榜

- [官方页面](https://ow.blizzard.cn/herolist/)
- [初始化接口](https://webapi.blizzard.cn/ow-armory-server/index)
- [当前竞技全部段位样本](https://webapi.blizzard.cn/ow-armory-server/hero_leaderboard?game_mode=jingji&season=5&mmr=-127)
- [官方榜单客户端脚本](https://ld5.res.netease.com/pc/zt/20250326092201/js/1_619c50cd.js)

当日初始化、竞技全部段位、竞技 Gold、快速比赛均匿名请求成功，业务 `code=0`；统计响应均为 54 行，`ds=2026-10-07`。无需 Cookie、Token 或 API Key。准确性质是“官网公开页面使用的 JSON 接口”，尚未找到正式开发者 API 文档、额度或稳定性承诺。

调用顺序：读取 `/index` → 检查 HTTP / `code===0` / 结构 → 从 `data.seasons` 与 `data.hero_configs` 取得当前赛季及配置 → 请求 `/hero_leaderboard?game_mode=<mode>&season=<id>&mmr=<tier>` → 校验完整批次后发布快照。只检查 HTTP 200 不够。

| 参数 / 字段 | 当日证据与处理 |
|---|---|
| `season` | 当前字符串 ID `5`、上期 `4`；动态读取，不写死 |
| `game_mode` | `jingji` 竞技、`kuaisu` 快速已实测；`juedou` 角斗在客户端存在，尚未实测 |
| `mmr` | `-127` 全部；常规段位含 Bronze / Silver / Gold / Platinum / Emerald / Diamond / Master / Grandmaster / Champion，仅 Gold 单独实测 |
| `hero_type` | `1` 输出、`2` 重装、`3` 支援；官网按响应过滤，不自行增加上游 role 参数 |
| `selection_ratio` | 官网“选取率”，网页可称“出场率（官方选取率）”；数值已是百分数 |
| `ban_ratio` | 百分数；官网仅竞技展示，快速源值 0 保存但 UI 显示“不适用” |
| `win_ratio` | 百分数，不再乘 100 |
| `kda` | 保留源值；公式、分母及样本数未确认，不补造解释 |
| `ds` | 官方统计日期，不能替代抓取时间或补丁日期 |

短样例（公开英雄汇总，不是玩家资料）：

```json
{"hero_id":"kiriko","hero_type":"3","selection_ratio":5.32,"ban_ratio":0.34,"win_ratio":46.67,"kda":3.8,"ds":"2026-10-07"}
```

官方客户端说明榜单每日上午 10 点更新，统计范围为预设职责对局。蓝图初定北京时间 10:15 采集，失败有界重试；这不是接口 SLA。日期未前进时保留旧数据并显示时效。其他模式的段位限制独立确认，不能把竞技枚举无条件套给角斗。

历史：旧社区代码写死 `season=20` 曾返回 HTTP 200 / 业务 `20008` / “系统维护中”；使用 `/index` 返回的 `5` 即成功。这是参数和业务校验问题，不能继续据此称整个源不可用。

## S2：近期调整标签

来源为 `/index` → `data.patch_desc`，`enhances[]` / `weakens[]` / `adjusts[]` 对应“近期增强 / 近期削弱 / 近期调整”；`date` 为官方标签记录日期。元素是英雄 ID，连接配置 `id`。

当日 `sigma` 同时出现在 `weakens` 与 `adjusts`。采用多标签关系，不能用互斥 enum 覆盖其中一类。`patch_desc.date=2026/7/15`，明显早于当前赛季与统计日期，必须原样保留并解释来源日期。

该响应未提供详细技能改动、改动量或明确补丁版本。[官方补丁说明入口](https://ow.blizzard.cn/news/patch-notes/)可作通用查看链接，但未验证标签到某篇文章的精确关联。不能按指标涨跌、抓取时间或 LLM 推测生成最新增强/削弱。

## S3：英雄配置与头像

- 当日 [heroConfigs.json](https://ld5.res.netease.com/pc/zt/20241115153332/static/heroConfigs.json) 为 `{ "heroConfigs": [...] }`；54 个唯一 `id` 均可连接统计 ID。URL 优先从初始化动态读取。
- 首版字段：`id`、`name`、`headSrc`、`type`、`typeName`、`isNew`；`bgColor` 非全部都有。`desc`、`picList`、技能/视频/故事暂不扩展为百科。
- [安娜头像样本](https://ld5.res.netease.com/images/20260206/1770343745482_5dbfa340a7.png) HEAD 为 200 / `image/png`，约 189 KB；当日全部 `headSrc` 都是 HTTPS `ld5.res.netease.com`。

manifest 记录 hero key、源 ID、资源类型、URL、来源页面、观察时间、hash/版本、使用范围状态、缓存位置（如采用缓存）。公开可访问与使用范围分别核对；引用/缓存方式在施工时确认。下载只接受已确认官方域名，不把任意上游 URL 当通用代理。失效用 OW 占位，不用 CS2 图标。

**已知冲突：** 配置 `sombra` 为 `Support / 支援`，统计却为 `hero_type="1"`（输出）。catalog role 与 stats role 分存并记录质量问题；榜单采用统计行职责，不静默改源值。未知新 ID 保留数据并降级展示，不因没有本地头像丢弃。

## S4：样式及装饰素材

[官网 CSS](https://ld5.res.netease.com/pc/zt/20250326092201/css/index_c2358b2d.css)可参考浅蓝灰、深蓝文字、头像、徽标与统计条的关系；OW 样式在独立作用域重写，不复制整站全局 CSS。

以下文件已确认 CSS 引用，**未逐个下载验收**。前缀 `https://ld5.res.netease.com/pc/zt/20250326092201/assets/`：

| 用途 | 文件名 |
|---|---|
| 增强 / 削弱 / 调整 | `icon-jqzq_86bd6ec2.png` / `icon-jqxr_d6e51b7e.png` / `icon-jqtz_d411a3e2.png` |
| 输出 / 重装 / 支援 | `icon-sc_5cba6026.png` / `icon-zz_5a3502eb.png` / `icon-zy_1f3c3d2a.png` |
| 头像底板 / 顶部背景 | `head-bg2_f3575813.png` / `kv-2560_6027b981.jpg` |

候选不等于已批准缓存或已集成；hash 文件名会变，不能作长期英雄主键。

## S5：Overstats（待授权实测）

- [项目仓库](https://github.com/AddOneSecondL/Overstats)
- [接入条件](https://github.com/AddOneSecondL/Overstats/blob/main/Faststart.md)
- [API 文档](https://github.com/AddOneSecondL/Overstats/blob/main/OVERSTATS_API.md)
- [上游客户端与记录逻辑](https://github.com/AddOneSecondL/Overstats/blob/main/src/client/apiclient.py)

它是大神上游的第三方封装，需要已登录并绑定战网的大神账号标识和业务令牌。服务凭据与目标 `customer_token` 不同，不能证明目标账号归属。

候选适配端点为 `POST /api/v2/dashen-profile`、`POST /api/v2/dashen-match`、`POST /api/v2/dashen-match/detail`。样例包含比赛 ID、时间、地图、模式、英雄、结果与个人指标；实际字段语义、分页、赛季编号、多英雄粒度和历史覆盖须用一名合格注册测试用户验证。

源码有身份及对局自动落库路径，以 `is_database_write_enabled()` 等控制。施工时固定版本，核实并关闭不受 TrashBox 白名单约束的持久化/后台写入；不能只在自家最终入库过滤，而让第三方先保存整局玩家。

只提交经核验的本人绑定，不把原始端点暴露为任意玩家查询代理。响应进入日志/缓存/数据库前裁剪其他参与者身份；凭据不上前端、不写文档。官网与大神的赛季保留各自命名空间，不按编号相等连接。

本轮未运行服务、未配置凭据、未查询私人战绩。公共阶段不依赖 Overstats，海外 OverFast 也不作为已验证国服来源替代。


## S6：2026-10-09 复核与官方中文补丁共享缓存

当日国服 `/index` 仍返回 2026/7/15 的 patch_desc，而第 5 赛季竞技全部段位 API 的 ds 已为 2026-10-08，共 54 行。新英雄血律存在，因此不能把初始化标签日期解释为当前游戏版本日期，也不能把成功读到 API 解释为所有字段已更新。

国服入口脚本依次试当前月、上月，均不存在才回退 2025/02。实际国服 `live/2026/10/` 为 404，`live/2026/09/` 可读；9/23 仅错误修复，最新英雄平衡为 9/18。暴雪国际服 [官方繁体中文十月记录](https://overwatch.blizzard.com/zh-tw/news/patch-notes/live/2026/10/#patch-2026-10-06) 可读取：官方中文标题日期 10/7，发布标签与锚点为 10/6，保持两者原值。没有自行翻译国际服正文。

`refresh-ow-patches.py` 只读取固定官方中文 URL，并利用 ETag / Last-Modified 条件读取；解析正式英雄更新，排除角斗领域、仅 6v6 的项目和纯修复新闻。明确数值变更可归方向，混合 / 重做 / 命中区域项归调整，原文直达链接用于完整核对。输出仅为公共英雄身份、分类、标题、出处和日期；未知英雄名称保留，不伪造映射。当前含 40 位英雄，三组 5 / 1 / 39（可重叠）。

后台每小时比较可读来源，最新日期优先，同日国服优先；国际服不可用时不得覆盖已确认更新的日期，保留最近成功结果并标记 retained。全部不可用时同样保留，不覆盖空文件。JSON 原子写入，网页不访问官方补丁 HTML，也不会每次访客打开都发起官方补丁采集。

网页统计采用可验证的一小时本机公共缓存，并保留真实 API 日期与读取时间；取消 D015 的页面五分钟、focus、visibility 检查。测试覆盖重访复用、重新加载复用、手动刷新、到期和错误赛季缓存拒绝。服务 / 缓存不能保证比上游更实时；显示数据日期比声称“始终最新”准确。

黑影在国服新赛季新闻与英雄配置为支援，但 10/8 统计仍返回 hero_type=1。当前阵容职责使用配置（Support），统计原始数据保持不改。社区表仍存在重做前技能说明，因此暂停黑影 / 路霸的旧克制边；血律尚无该社区表条目。
