# Asset attribution / 资源许可

所有进入正式构建的第三方资源必须下载锁版、自托管，并记录作者、原始链接、许可证、下载日期与修改。运行时禁止热链第三方 CDN。

## 当前构建内资源

| 资源 | 作者 / 来源 | 许可与说明 |
| --- | --- | --- |
| Three.js 程序化工业场景、人物基础几何、原创栓动枪外形 | 本项目代码生成 | 项目原创；不包含 Valve 资产 |
| 射击、开镜与枪栓反馈 | Web Audio 运行时合成 | 项目原创；不含采样音频 |
| `packages/client/public/og.png` | OpenAI 图像生成，2026-08-20 | 为本项目生成；无品牌、无第三方游戏资产，仅作站点分享封面 |
| `packages/client/public/favicon.svg` | 本项目 | 项目原创 SVG |

## 已评估但尚未打包的候选资源

以下内容不在当前分发包中。引入前必须重新核对下载页许可证与模型内含贴图，完成 Blender 切分/重定向、性能压缩并在上表登记固定文件哈希。

| 候选 | 原始链接 | 页面标注许可 | 计划修改 |
| --- | --- | --- | --- |
| Rigged military soldier | [Sketchfab](https://sketchfab.com/3d-models/free-military-soldier-rigged-e9c56308a67d4a3db62e914fafa4d198) | CC BY | 切分头/躯干/四肢、补断面、重整权重与命中节点 |
| Universal Animation Library | [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) | CC0 | 重定向跑、走、蹲、跳、跛行、爬行与死亡 |
| Factory Kit | [Kenney](https://kenney.nl/assets/factory-kit) | CC0 | 组合掩体、合批、LOD 与碰撞代理 |
| Concrete / metal materials | [Poly Haven](https://polyhaven.com/license) | CC0 | 统一纹理尺寸、通道打包与 KTX2 |
| Original bolt-action rifle candidate | [Sketchfab](https://sketchfab.com/3d-models/sniper-rifle-6fca3919df104af28005084ed98b8ee7) | 页面标注 CC BY，需下载时复核 | 压缩至约 40k 三角面、2K PBR、删除任何品牌标识 |
| Sniper shot candidate | [Freesound / qubodup](https://freesound.org/people/qubodup/sounds/815477/) | 页面标注 CC0，需下载时复核 | 重新混音、响度限制、导出 OGG/MP3 |
| Bolt action candidate | [Freesound / Danwardvs](https://freesound.org/people/Danwardvs/sounds/204204/) | 页面标注 CC0，需下载时复核 | 裁切、降噪、重新混音 |

## 商标声明

Counter-Strike、CS2 与 Valve 是其各自权利人的商标。本项目与 Valve 无关联，也不受其认可。`CS2_AWP_2026_08` 仅是输入与武器状态校准预设的描述性标识。
