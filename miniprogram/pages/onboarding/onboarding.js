// pages/onboarding/onboarding.js
const app = getApp();

Page({
  data: {
    steamId: '',
    authCode: '',
    matchCode: '',
    canSubmit: false, // 控制按钮是否亮起

    showModal: false,   // 控制弹窗显示/隐藏
    modalType: '',      // 'steam' 或 'auth'，决定显示哪块内容
    steamIdInput: ''
  },

  // onLoad() {
  //   // 如果已经登录了，就没必要再注册一遍了
  //   if (app.globalData.hasLogin) {
  //     wx.showModal({
  //       title: '提示',
  //       content: `您已绑定 Steam ID: ${app.globalData.userInfo.steam_id}，是否重新绑定？`,
  //       success: (res) => {
  //         if (res.confirm) {
  //           // 用户坚持要重新绑定，允许继续
  //         } else {
  //           wx.navigateBack(); // 返回上一页
  //         }
  //       }
  //     })
  //   }
  // },

  // 输入绑定
  onInputSteamId(e) { this.setData({ steamId: e.detail.value }); this.checkForm(); },
  onInputAuthCode(e) { this.setData({ authCode: e.detail.value }); this.checkForm(); },
  onInputMatchCode(e) { this.setData({ matchCode: e.detail.value }); this.checkForm(); },

  // 检查表单是否填完 (决定按钮是否变色)
  checkForm() {
    const { steamId, authCode, matchCode } = this.data;
    // 简单判断：两个必填项都不为空
    const isValid = steamId.length > 0 && authCode.length > 0 && matchCode.length > 0;
    this.setData({ canSubmit: isValid });
  },

  // 提交表单
  submitForm() {
    if (!this.data.canSubmit) return;

    // A. 显示加载动画
    wx.showLoading({ title: '验证身份中...' });
    // B. 发送请求到后端
    this.postToBackend();
  },

  postToBackend() {
    console.log("准备发送，UserInfo:", app.globalData.userInfo);
    wx.request({
      url: `${app.globalData.apiBase}/api/v1/users/onboarding`,
      method: 'POST',
      data: {
        loginCode: app.globalData.userInfo.uuid, // 临时身份证传给后端
        steamId: this.data.steamId,
        authCode: this.data.authCode,
        matchCode: this.data.matchCode
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200 && res.data.code === 200) {
          wx.showToast({ title: '绑定成功', icon: 'success' });
          // 将 OpenID 存入本地缓存，以后打开小程序就知道“我是谁”了
          //wx.setStorageSync('user_uuid', res.data.data.uuid);

          const responseData = res.data.data;

          // 1. 存入全局变量
          app.globalData.userInfo = {
            uuid: responseData.uuid,          // OpenID
            steam_id: responseData.steam_id,  // 解析后的 17位 ID
            // 其他初始默认值
            nickname: responseData.steam_id,
            avatar: null
          };
          setTimeout(() => { wx.navigateBack() }, 1500);
        } else {
          // 处理 FastAPI 抛出的 HTTPException
          let msg = res.data.detail || res.data.message || '未知错误';
          wx.showToast({ title: '失败: ' + msg, icon: 'none', duration: 3000 });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络连接失败', icon: 'none' });
      }
    });
  },

  // 复制 Steam 帮助链接
  copySteamHelpLink() {
    const url = "https://help.steampowered.com/zh-cn/wizard/HelpWithGameIssue/?appid=730&issueid=128";

    wx.setClipboardData({
      data: url,
      success: () => {
        // 微信自带的 toast 提示有时候太快，或者被弹窗遮挡
        wx.showModal({
          title: '链接已复制',
          content: '由于微信限制，请打开手机浏览器 (Safari/Chrome) 粘贴并访问该链接。',
          showCancel: false,
          confirmText: '我知道了'
        });
      }
    });
  },
  // --- 帮助弹窗逻辑 ---
  // 显示 Steam ID 帮助
  showHelp() {
    this.setData({
      showModal: true,
      modalType: 'steam'
    });
  },
  // 显示 Auth Code 帮助
  showAuthHelp() {
    this.setData({
      showModal: true,
      modalType: 'auth'
    });
  },
  // 统一关闭函数
  hideModal() {
    this.setData({
      showModal: false,
      // 延迟清空 type 防止关闭动画时内容突然消失
      // modalType: '' (可选，不清空也没事)
    });
  },
  // 点击图片放大预览
  onPreviewImage(e) {
    // 获取图片链接
    const src = e.currentTarget.dataset.src;

    wx.previewImage({
      current: src, // 当前显示图片的http链接
      urls: [src]   // 需要预览的图片http链接列表（这里只有一张）
    });
  }
});

