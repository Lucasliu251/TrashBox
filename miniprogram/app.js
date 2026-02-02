// app.js
App({
  // 1. 全局数据：所有页面都能访问这里
  globalData: {
    userInfo: null,   // 存用户的 SteamID, 头像等
    hasLogin: false,  // 明确的登录标记
    apiBase: 'https://trashbox.tech' // 方便你以后一键改回域名 (改成你的真实IP)
  },

  // 2. 小程序启动时执行
  onLaunch() {
    this.autoLogin();
    // 检查本地缓存有没有 UUID (OpenID)
    // const uuid = wx.getStorageSync('user_uuid');
    // if (uuid) {
    //   console.log('App启动: 发现本地 UUID，正在去后端验证...', uuid);
    //   this.fetchUserInfo(uuid);
    // } else {
    //   console.log('App启动: 本地无 UUID，视为未登录');
    //   // 如果页面已经在等结果了，告诉它们“没登录”
    //   if (this.userCallback) {
    //     this.userCallback(null);
    //   }
    // }
  },

  // 3. 封装一个去后端拉取资料的方法
  fetchUserInfo(uuid) {
    wx.request({
      url: `${this.globalData.apiBase}/api/v1/users/me`,
      method: 'GET',
      data: { openid: uuid },
      success: (res) => {
        if (res.statusCode === 200 && res.data.code === 200) {
          console.log('登录成功，用户信息:', res.data.data);

          // A. 更新全局变量
          this.globalData.userInfo = res.data.data;
          this.globalData.hasLogin = true;

          // B. 极其重要：如果这时候页面已经加载完了，正在等我的回调，我就执行它
          if (this.userCallback) {
            this.userCallback(res.data.data);
          }

        } else {
          // 比如后端数据库里把人删了，但前端还有缓存
          console.log('登录失效，清除缓存');
          this.logout();
        }
      },
      fail: (err) => {
        console.error('连接服务器失败', err);
        // 这里可以做个容错，比如提示网络错误
      }
    });
  },

  autoLogin() {
    const that = this;
    // 1. 微信原生静默登录
    wx.login({
      success: res => {
        if (res.code) {
          // 2. 发送 code 给后端
          wx.request({
            url: `${that.globalData.apiBase}/api/v1/users/login`,
            method: 'POST',
            data: {
              loginCode: res.code
            },
            success(apiRes) {
              if (apiRes.statusCode === 200 && apiRes.data.code === 200) {
                const result = apiRes.data.data;

                if (result.is_registered) {
                  // 【老用户归来】
                  console.log('App: 自动登录成功', result.steam_id);

                  // 存入全局变量
                  that.fetchUserInfo(result.uuid);
                  that.globalData.hasLogin = true;

                  // 3. 执行回调（通知首页或Stats页更新UI）
                  if (that.userCallback) {
                    that.userCallback(that.globalData.userInfo);
                  }

                } else {
                  // 【新用户】
                  console.log('App: 未注册，需要去绑定');
                  that.globalData.hasLogin = false;
                  // 这里不主动跳转，让用户在 Stats 页点击“去绑定”
                  if (that.userCallback) {
                    that.userCallback(null);
                  }
                }
              }
            },
            fail(err) {
              console.error('登录接口请求失败', err);
            }
          })
        }
      }
    })
  },

  // 4. 提供一个退出登录的方法
  logout() {
    wx.removeStorageSync('user_uuid');
    this.globalData.userInfo = null;
    this.globalData.hasLogin = false;
  }
})