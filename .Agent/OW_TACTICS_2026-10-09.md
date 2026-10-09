# 游戏切换与 OW 克制 / 阵容功能

日期：2026-10-09。下文为 D018 的首轮本地记录；后续 D019 已发布到服务器，最新验证见 `OW_DEPLOYMENT_2026-10-09.md`。目前仍本轮用户已要求提交并推送，实际提交状态见 Git 记录。重做角色校正后为 51 个可评估英雄 / 498 条边，原 53 / 545 为暂停旧关系前的历史数据。

## 修改位置

- `site/src/CommunityApp.vue`、`game-navigation.css`：两种游戏主题共用 header 网格与按钮位置，背景滑块 320ms 切换、按压反馈，减少动态效果时关闭动效。
- `features/ow/OwHome.vue`：加入克制 / 阵容区域和导航；“免登录”文案改为“公开英雄数据”，保留实际外层账号门禁。
- `OwTactics.vue`、`OwHeroPicker.vue`、`tactics.css`：54 英雄有向图、所选 / 全部关系模式、搜索、评分来源链接、两侧五人选择、移除及批量名称输入、锁定与三套推荐结果。关系名单独立滚动，手机没有整页横向溢出。
- `tactics-counter-table.ts`：53 个公开英雄条目的数字评分快照。`tactics-data.ts` 保留职责 / 搜索别名及少量基础风格配合规则，不再生成技能推断克制边。
- `tactics.ts`：原表方向转换、镜像去重、未知关系、职责限制与锁定补齐。
- `scripts/check-ow-tactics.mjs`：真实纯函数验证，不访问数据库；`ow:check-tactics` 脚本已加入。

## 网络来源与口径

来源 [CounterPickGG](https://counterpickgg.com/)，[FAQ](https://counterpickgg.com/faq)。示例原页：[D.VA](https://counterpickgg.com/heroes/dva)、[源氏](https://counterpickgg.com/heroes/genji)、[雾子](https://counterpickgg.com/heroes/kiriko)。核对 53 个英雄详情页公开“countered by”列，只保存英雄 ID、数字评分和来源，不复制攻略或技能文本。弗蕾娅在该来源使用 `freya`，飞天猫使用 `jetpack-cat`。

1–10 分为对方针对当前英雄的社区参考评分：大于 5 表示对方占优，小于 5 表示当前英雄占优。低分转换为反向 `10 - rating`；镜像重复只算一次。本次观测镜像数值一致、无相反方向冲突，形成 545 条唯一优势边。只保存公开显示的非中立行，隐藏 / 省略关系保持未知。全部 54 位目录英雄仍可搜索，血律没有来源条目；允许锁定并按职责补齐，但不计其未知克制贡献。

首页“Stats Last Updated”并非克制表更新时间，本页仅标核对日期 2026-10-09。不称为最新补丁或国服统计，未按段位 / 地图分层，也无运行时跨站请求和每日自动刷新承诺。

交叉研究 [Counterwatch 方法说明](https://www.counterwatch.gg/methodology)：相对对抗指标来自社区击杀 / 团战记录，会遗漏伤害吸收等作用；不与社区 1–10 分强行混合。也研究了 [minmax-watch](https://github.com/MaikBuse/minmax-watch)，其 MIT 代码许可不涵盖上游数据；未导入该项目代码、混合数据或攻略原文，不把第三方内容标为本站原创 / MIT 数据。

## 推荐边界

保持全部锁定英雄，枚举可补齐的 1 重装 / 2 输出 / 2 支援阵容。对每个敌方使用最强应对加少量第二应对，避免堆叠只针对一个敌人；扣除被敌方克制风险，加入较低权重的人工基础风格 / 加速 / 空中护航配合。最多三套有英雄差异的结果，单空位也能提供多方案。

匹配分只用于同次输入排序，不能作为胜率或最优阵容。未建模熟练度、地图、禁用、特殊威能、冷却及团队站位。无敵方时只提供职责与基础配合建议；未知敌方不计作已覆盖。适用推荐框架为 5v5 基础职责队列，不混入角斗领域或 6v6 数据。

## 实际验证

- `node site/scripts/check-ow-tactics.mjs` 通过：54 个可搜索英雄、53 个来源英雄、545 条唯一边；查莉娅→D.VA 8/10 且不反转，出处、未知、别名、重复 / 非法 ID / 超额职责、锁定保留、完整队伍、单空位多方案均检查。最后多场景样本耗时约 766ms。
- 在 `site/` 执行 `node node_modules/vue-tsc/bin/vue-tsc.js -b` 通过；`node site/node_modules/vite/bin/vite.js build --config site/vite.config.ts site` 通过，34 个模块。未安装依赖。pnpm 包装命令因在线依赖检查 / 非交互环境中止，直接使用已有工具完成检查和构建。
- 隔离 fixture：API 21936 / Vite 5186，假用户与社区数据；故意让官网实时读取失败，历史快照保留正确标识。未连接或写入生产 PG。
- 1280px 电脑两个主题切换控件均 x=524、文档 y=13.625、232×42.5px；390px 手机均 x=79、文档 y=51.75、232×42.5px。
- 搜索“源氏”：10 个应对方向 / 11 个针对方向；图节点 54。敌方温斯顿 / 源氏 / 法老之鹰 / 安娜 / 天使，己方锁定 D.VA / 雾子，网页生成三套完整且保留锁定的阵容，第一套匹配分 21.7。
- 390px 网页宽度等于 viewport，3 套结果与五张卡片可读。修复 span 的 flex 规则误伤头像，关系卡头像实测 40×40px。
- fixture 会话返回 401 后，OW 入口跳到 `/login?return_to=...`，门禁仍生效。
- 预览：`previews/ow-tactics-desktop.jpg`、`previews/ow-tactics-mobile.jpg`。测试 Vite / fixture 已关闭，临时标签关闭、viewport 恢复；不关闭原有进程或服务器服务。

血律与未显示关系待来源补充，源表更新需要重新核对。本次未改小程序、数据库、服务端、机器人或独立站点。
