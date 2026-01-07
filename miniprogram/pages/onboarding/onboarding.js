// pages/onboarding/onboarding.js
Page({
  data: {
    steamId: '',
    authCode: '',
    matchCode: '',
    canSubmit: false // 控制按钮是否亮起
  },

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

    wx.login({
      success: (loginRes) => {
        if (loginRes.code) {
          // 拿到 code 了，现在发起请求
          this.postToBackend(loginRes.code);
        } else {
          wx.showToast({ title: '微信登录失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error(err);
        wx.showToast({ title: '无法获取微信授权', icon: 'none' });
      }
    });
  },

  postToBackend(loginCode) {
    wx.request({
      url: 'https://trashbox.tech/api/v1/users/onboarding',
      method: 'POST',
      data: {
        loginCode: loginCode, // 临时身份证传给后端
        steamId: this.data.steamId,
        authCode: this.data.authCode,
        matchCode: this.data.matchCode
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200 && res.data.code === 200) {
          wx.showToast({ title: '绑定成功', icon: 'success' });
          // 将 OpenID 存入本地缓存，以后打开小程序就知道“我是谁”了
          wx.setStorageSync('user_uuid', res.data.data.uuid);

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
  }
});