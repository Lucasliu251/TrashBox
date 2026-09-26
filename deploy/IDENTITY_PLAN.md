# TrashBox 账号整合记录（暂不实施）

## 当前状态

- `users.uuid` 存放微信小程序 OpenID，已绑定的 Steam ID 在 `users.steam_id`。
- Radar 当前支持已绑定 Steam 登录，或由已登录小程序扫描 TrashBox 一次性登录码。
- 后端只有小程序 `WX_APP_ID` / `WX_APP_SECRET`；没有微信开放平台网站应用的凭据。当前二维码不是微信开放平台网页扫码登录。

## 微信扫一扫过渡方案

- 使用现有小程序凭据生成 `getwxacodeunlimit` 小程序码，`scene` 只放短期随机登录票据。微信扫一扫直接打开 `pages/radar/radar`，用户在小程序内明确确认电脑登录，再由网页轮询取得短期登录结果。原有小程序内扫码保留为后备。
- 该流程使用现有小程序 OpenID 和 `users.uuid`，不创建新账号，也不是微信开放平台的网站 OAuth。
- 代码由 `WECHAT_MINI_QR_ENABLED=1` 启用；默认关闭，直到带有 `scene` 确认逻辑的小程序发布到正式版。生产保持 `WECHAT_MINI_QR_CHECK_PATH=1`。

## 微信网页扫码接入前提

1. 在微信开放平台申请并审核通过“网站应用”，取得该网站应用的 AppID 和 AppSecret，配置 `trashbox.tech` 的授权回调域。小程序 AppID 不能替代网站应用 AppID。
2. 将网站应用和现有小程序绑定到同一个微信开放平台账号，确认能否取得同一用户的 UnionID。
3. 服务端发起 `snsapi_login` 授权，用随机 `state` 绑定浏览器会话；回调时先校验 `state`，再用 `code` 在服务端换取微信身份。AppSecret 不进入前端。
4. 在账号映射尚未建立时，不凭昵称、头像或未经验证的 Steam ID 自动合并或创建第二个 TrashBox 账号。提示用户先用已有方式登录并完成绑定。

## 后续统一账号模型

- 使用独立的内部用户 ID 作为稳定主键；增加身份映射表，唯一键为 `(provider, provider_app_id, provider_subject)`，分别容纳微信小程序、微信网站应用、Steam、KOOK 等身份。
- 保留现有 `users.uuid` 到内部用户 ID 的映射，逐步迁移旧登录态和数据外键。Steam 与 KOOK 身份须通过各自的官方回调验证后才允许绑定。
- 登录只查找已绑定身份；首次见到的新身份须显式注册或绑定。账号合并必须要求现有账号再次认证，禁止仅按同名资料合并。
- 正式迁移前先盘点重复 Steam ID、微信 OpenID、缺失 UnionID 和孤立账号，再设计可回滚的数据迁移。
