# 品牌图标发布记录

日期：2026-10-09。用户明确授权附件战网图标替换、Git 提交 / 推送与服务器发布。

已用原 PNG 替换通用战网符号；新文件 battlenet.png 为 148×148，原像素保持。上一轮用户提供的六张原图同样逐字节保持。共享 BrandIcon 处理尺寸 / 圆角 / 留白，UiIcon 处理搜索 / 箭头等功能图标；禁用登录方式有灰化状态。

## 提交与发布边界

- TrashBox e14702c：此前本人对局前端 / 私有桥接 / 部署准备。
- TrashBox-Server 55c1a1c：对应后端、迁移入口与合成测试。
- 本轮图标使用独立中文 feat(ui) 提交，实际提交 / 远程状态见 Git 记录。
- 服务器以 D019 当前账号 + OW 基线组合图标构建，仅发布主站 / 中央登录 / Radar favicon。不包含私人对局页面、后端、迁移或 Overstats 服务，不开启真实采集。
- auth 增加的战网行在后端缺配置时仍禁用；原 KOOK / Steam / 微信逻辑复用。

## 服务器发布

目标：Ubuntu-Shanghai，/home/ubuntu/TrashBox。

发布目录：`.ow-releases/brand-20261009-battlenet/`，`before/` 保存三份入口与被修改源码、`source-state.json` 标注新文件，`stage/` 保存实际发布物，`published.json` 保存时间和哈希。

发布时间：2026-10-09 14:04:16 +08:00。旧哈希资源保留、新资源先追加，三份 HTML 分别原子切换。只改变 Radar 的 favicon 引用，不重构 / 替换其业务 JS/CSS。没有触碰 `.serve-public/ow-data`，小时更新的补丁缓存继续工作。

新入口 SHA256：

```text
index.html       6f2fc7d8003b820b121520fd932ce02a0612d2251a9c68e6ccefb3cd9c4b8c14
auth/index.html  246e77f67f968955db1b9ee7ecd26df0d0688060bffc553facf5b012a0958d39
radar/index.html c58a409ed48ac9b88c22ffc4badd56c16c7e03b8e3ddfe5c7e913a81bf6f8c90
```

账号基线 App.vue 9fc154a4...、shared/auth.ts b2e7adde... 与发布前相同。未改变 Nginx 路由 / 登录门禁；nginx -t 通过，Nginx 和 trashbox-ow-patches.timer active。

## 验证

- 附件战网原图在隔离登录页加载，390px 宽度无溢出，图标 32×32 渲染。
- 实际将发布的组合版本 vue-tsc 与 Vite 构建通过，主站 47 模块、登录 76 模块。
- 发布包检查：主站 JS 不含 `/api/v1/me/ow`，导航没有“我的对局”；暂不将私人准备功能暴露为失效入口。
- 无 Cookie 的公网 /login、auth-static JS/CSS/favicon、战网 PNG 均 200。
- 真实登录态 /account 加载 `/auth/auth-static/battlenet-qgFlljDH.png`，原生尺寸 148×148。
- 真实主站 OW/CS2 切换图标加载，favicon 使用自身哈希静态 URL；统计仍 2026.10.08 官方 API。
- 共享补丁仍 2026-10-07 / ok，后台核对时间已前进到 14:01:37，未覆盖旧缓存。
- 凭据检查无真实 Token、私钥或 GitHub Token。favicon SVG 中的原 PNG base64 与原文件逐字节核对，避免图像编码被误报为 Token。

预览：`previews/brand-icons-login-battlenet.jpg`（隔离假账号）、`previews/brand-icons-production-ow.jpg`（线上公共英雄区域）。未保存实际账号页的个人资料截图。

若回滚，先核对后续发布，再仅恢复对应三份入口和本轮受影响源码。不要覆盖后续账号改动或 OW 动态数据。当前 Git 主分支含未来本人对局准备代码，发布整个主站前必须配合对应后端 / 配置 / 迁移授权，不能直接以全量重建代替本次图标组合。
