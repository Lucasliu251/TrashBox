const app = getApp();

Page({
  data: {
    isLogged: false, // 登录状态、默认为 false，等待校验
    userData: {
      avatar: '/assets/icons/cs-logo-grey.avif',
      nickname: '未登录...',
      faceitLevel: '?',
      rating: '-',
      kd: '-',
      adr: '-',
      winRate: '-'
    },
    matchHistory: [] // 比赛记录
  },

  onShow() {
    this.checkLoginStatus();
  },

  checkLoginStatus() {
    // 情况 A: App.js 已经拿到用户信息了
    if (app.globalData.hasLogin && app.globalData.userInfo) {
      console.log('Stats页: 检测到已登录');
      this.updateUI(app.globalData.userInfo);
    }
    // 情况 B: App.js 还没跑完 (比如刚冷启动)
    else {
      console.log('Stats页: 等待 App.js 验证登录...');
      // 注册回调，等 App.js 好了通知我
      app.userCallback = (userInfo) => {
        if (userInfo) {
          this.updateUI(userInfo);
        } else {
          // 确认没登录，保持 isLogged: false
          this.setData({ isLogged: false });
          console.log('Stats页: 用户未登录');
        }
      }
    }
  },

  updateUI(userInfo) {
    // 注意：目前数据库里只有 steam_id, auth_code 等基础信息
    this.setData({
      isLogged: true,
      'userData.nickname': userInfo.steam_id || 'Unknown Player',
      'userData.avatar': userInfo.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + userInfo.steam_id, // 用 SteamID 生成个随机头像

      // 下面这些数据暂时还保持“默认”或“假数据”，
      // 等我们写完 Python 爬虫，再把真实数据填进去
      'userData.rating': 'PENDING',
      'userData.kd': '...',
    });
  },

  // 跳转到注册页
  goToOnboarding() {
    wx.navigateTo({ url: '/pages/onboarding/onboarding' })
  }
})