# CS2_AWP_2026_08 校准记录

## 状态

- 实施快照日期：2026-08-20（Asia/Shanghai）
- Web 预设 ID：`CS2_AWP_2026_08`
- CS2 本地构建 ID：`PENDING_LOCAL_VERIFICATION`
- 参数状态：`PROVISIONAL / 不能宣称完成严格对照认证`

仓库没有获得或复制任何 Valve 资源，也没有在实现过程中读取本机 CS2 安装。下表按设计输入固化，使后续校准差异能通过单个版本化预设审计，而不是散落在渲染或网络代码中。

## 固化参数

| 参数 | 值 | 自动验证 |
| --- | ---: | --- |
| `m_yaw` | `0.022` | 是 |
| 4:3 基准 FOV | `90` | 是 |
| 一档 / 二档 FOV | `40 / 10` | 是 |
| 一档 / 二档开镜时间 | `300 / 200 ms` | 状态值锁定 |
| 弹匣 / 备弹 | `5 / 25` | 服务器状态锁定 |
| 射击周期 | `1455 ms` | 服务器状态锁定 |
| 完整装填 | `3700 ms` | 服务器状态锁定 |
| 模式内狙击手移动速度 | `0 m·s⁻¹`（固定射击位） | 128 Hz 模拟测试 |

角度输入不乘帧间隔：

```text
degrees = raw_mouse_count × sensitivity × m_yaw × scope_factor × zoom_ratio
eDPI = DPI × sensitivity
cm/360 = 360 ÷ (DPI × sensitivity × m_yaw) × 2.54
vertical_fov = 2 × atan(tan(source_fov / 2) ÷ (4 / 3))
```

原始输入请求失败时，HUD 显示 `RAW FALLBACK`；该会话不应计入严格训练验收。

## 来源边界

- 设计参数来源：[GameTracking-CS2](https://github.com/SteamTracking/GameTracking-CS2) 所跟踪的公开游戏文件、实施计划提供的数值与后续本地合法安装实测。
- 输入机制：[MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)。
- 渲染 FOV：[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)。
- 命中输入顺序参考：[Valve Counter-Strike 2 更新记录](https://store.steampowered.com/news/app/730)。

Valve 未公开足以一比一复刻所有误差恢复、动画和网络细节的完整规范。因此当前代码不能单凭公开常量证明“严格符合”；正式分发前必须完成下述实测。

## 严格训练发布门槛

- [ ] 在合法本地 CS2 安装中记录构建 ID与采样日期。
- [ ] 未开镜、两档开镜各完成至少 20 次角度扫描，误差 ≤ 1%。
- [ ] 站立、移动、跳跃、落地与开镜恢复误差逐项录制并回填预设。
- [ ] 连续射击周期误差 ≤ 1 个 128 Hz 步长。
- [ ] 本地点击到声音/后坐 ≤ 当前渲染的一帧。
- [ ] 100 ms RTT、20 ms 抖动下复核遮挡、重复伤害与回溯边界。
- [ ] 三名熟悉 CS2 AWP 的玩家以同 DPI、灵敏度与倍率完成盲测签字。

验收产生新数据时，新建预设 ID；不要静默修改 `CS2_AWP_2026_08`。
