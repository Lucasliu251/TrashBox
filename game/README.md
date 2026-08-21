# BLACKLINE / 狙击突围训练 v1

独立于仓库现有 Radar 前端的桌面浏览器多人训练游戏。一个 Node.js 进程同时提供 Vite 构建产物、`/ws` 与 `/healthz`；房间状态仅存内存，v1 只支持单实例。

## 当前实现

- 2–5 人私人房、6 位房间码、全员准备、每人依次担任狙击手。
- 56×12 米固定夜间工业地图，三条紧凑可交叉路线；普通掩体严格限制为人物宽度的 1–1.8 倍、高度为 1.25–2.7 米。
- 128 Hz 权威模拟、64 Hz 输入/快照、自身预测/校正、45–100 ms 自适应远端插值、最多 200 ms 受限回溯。
- Pointer Lock 原始鼠标输入优先；DPI、CS2 灵敏度、开镜灵敏度、eDPI 与 cm/360 校准。
- 栓动狙击枪状态：固定射击位、两档开镜、5 发弹匣、装填、1.455 秒射击周期、本地枪声/后坐即时反馈。
- 100 HP 统一伤害池：头部 100、躯干 55、四肢 45；保留独立命中区、断肢碰撞移除与伤残移动限制。
- 本地及远端距离衰减脚步声，静步和蹲伏具有更低音量与更长步频。
- 断线席位保留 15 秒；士兵未重连判失败，狙击手断线暂停，超时后存活士兵判突围。
- 回合与比赛结算按计划中的决胜顺序排序。

> `CS2_AWP_2026_08` 是可审计的校准快照，不代表 Valve 官方实现。数学映射与状态机已自动测试；本地游戏数据校对和三名熟练 AWP 玩家签字仍是严格训练认证的发布门槛，详见 [CALIBRATION.md](./CALIBRATION.md)。

## 本地运行

要求 Node.js 22+、pnpm 11+，建议桌面 Chrome 或 Edge。

```bash
cd game
pnpm install
pnpm dev
```

- 客户端：`http://localhost:5174`
- 权威服务器：`http://localhost:8080`
- 健康检查：`http://localhost:8080/healthz`

首次进入会显示内容提示。创建房间后复制邀请链接；至少两人且全员准备后，房主可启动训练。

## 操作

| 输入 | 行为 |
| --- | --- |
| `W A S D` | 移动 |
| `Shift` | 静步 |
| `Ctrl` | 蹲伏 / 双腿伤残时爬行 |
| `Space` | 跳跃（伤势允许时） |
| 鼠标左键 | 狙击手射击 |
| 鼠标右键 | 1 倍镜 / 2 倍镜 / 退出开镜 |
| `R` | 装填 |
| `Esc` | 释放鼠标 / 退出全屏（浏览器保留行为） |

## 架构

```mermaid
flowchart LR
  A["Vue 大厅 / HUD"] --> B["Three.js 单 Canvas"]
  C["Pointer Lock 原始输入"] --> D["128 Hz 客户端预测 / 64 Hz 批量发送"]
  D --> E["WebSocket /ws"]
  E --> F["Node.js 权威房间模拟"]
  F --> G["姿态历史 250 ms"]
  G --> H["回溯命中 + 静态遮挡"]
  H --> E
  I["shared 协议 / 规则"] --> D
  I --> F
```

工作区：

- `packages/shared`：协议类型、地图常量、伤残/计分规则、确定性移动。
- `packages/server`：房间、角色轮换、权威模拟、回溯命中、静态文件与 WebSocket 服务。
- `packages/client`：Vue 界面、Three.js 场景、输入、预测、HUD 与视觉特效。

客户端从不上报命中结果。它只发送输入、开镜/装填意图和射击命令；伤害、断肢、死亡与计分均由服务器广播确认。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

测试覆盖灵敏度/FOV、100 HP 混合伤害、伤残组合、计分排序、128 Hz 移动、固定狙击位、掩体尺寸约束、确定性误差、遮挡、五客户端满房、重连与完整角色轮换。

## 生产部署

推荐：本机 `pnpm` 监听 `127.0.0.1:8080`，由 Nginx 反代到子路径。`BASE_PATH` 必须在 **构建** 和 **启动** 时相同，否则静态资源和 WebSocket 会对不上。

```bash
cd game
pnpm install
export BASE_PATH=/trashbox/game/sniper
pnpm build
HOST=127.0.0.1 PORT=8080 NODE_ENV=production BASE_PATH=/trashbox/game/sniper pnpm start
```

确认本机探活：

```bash
curl http://127.0.0.1:8080/healthz
curl -I http://127.0.0.1:8080/trashbox/game/sniper/
```

将 `deploy/nginx.conf` 里的 `location /trashbox/game/sniper/` 贴进现有域名的 HTTPS `server` 块（不要单独再开一个抢占整站的 `location /`）。`/ws` 会落在 `https://你的域名/trashbox/game/sniper/ws`，Nginx 必须转发 WebSocket Upgrade。

浏览器打开 `https://你的域名/trashbox/game/sniper/`。

v1 的房间和重连令牌只存在当前进程内：不要开启多副本，不要让反向代理在多个进程间轮询。空房间 10 分钟销毁，服务重启会结束所有房间。

可选 Docker 路径：`docker compose up --build -d`，同样需要在构建参数里传入 `BASE_PATH`，并只把 `8080` 绑到本机回环。

## 内容与资源

当前可玩场景使用原创程序化几何、Web Audio 合成音效和项目专用分享封面。精细模型、动画、PBR 材质和 CC0 音效候选尚未打包，避免在完成切分、重定向、压缩和逐项许可证复核前把第三方内容带入分发包。完整清单见 [ATTRIBUTION.md](./ATTRIBUTION.md)。

本项目不使用 CS2 标志、地图、角色、武器模型、贴图或原始音频。“CS2 手感预设，非 Valve 官方产品”。
