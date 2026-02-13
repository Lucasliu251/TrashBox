// pages/rank/rank.js
const app = getApp()
const TEMPLATE_ID = '_JuPoyWJByf2jpbbbxMwqCtP7JCRBhseMtvG0Opr7Tg'; 

Page({
    data: {
        currentDate: '',
        maxDate: '',     // 限制不能选明天
        rankings: [],
        isLoading: false,
        myRank: null,     // 如果登录了，可以在底部悬浮显示自己的排名(可选)

        isSubscribed: false
    },

    onLoad() {
        // 默认看昨天 (因为今天还在打)
        const yesterday = this.calculateDate(-1)
        const today = this.calculateDate(0)

        this.setData({
            currentDate: yesterday,
            maxDate: today
        })

        this.fetchRankings(yesterday)

        // [可选] 检查一下今天是否已经订阅过 (如果有本地缓存逻辑的话)
        const todaySub = wx.getStorageSync('daily_sub_' + this.calculateDate(0));
        this.setData({ isSubscribed: !!todaySub });
    },

    // 辅助：计算日期
    calculateDate(offset) {
        const date = new Date()
        date.setDate(date.getDate() + offset)
        const y = date.getFullYear()
        const m = (date.getMonth() + 1).toString().padStart(2, '0')
        const d = date.getDate().toString().padStart(2, '0')
        return `${y}-${m}-${d}`
    },

    // 请求 API
    fetchRankings(date) {
        this.setData({ isLoading: true })
        wx.showNavigationBarLoading()

        wx.request({
            url: `${app.globalData.apiBase}/api/v1/rankings/daily`,
            data: { date: date },
            success: (res) => {
                if (res.statusCode === 200 && res.data.rankings) {
                    const list = res.data.rankings.map(item => ({
                        ...item,
                        // 格式化数据
                        rating: Number(item.daily_Rating).toFixed(2),
                        adr: Number(item.daily_adr).toFixed(1),
                        avatar: item.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.steam_id}`
                    }))
                    this.setData({ rankings: list })
                } else {
                    this.setData({ rankings: [] })
                }
            },
            complete: () => {
                this.setData({ isLoading: false })
                wx.hideNavigationBarLoading()
                wx.stopPullDownRefresh()
            }
        })
    },

    // 日期改变
    bindDateChange(e) {
        this.setData({ currentDate: e.detail.value })
        this.fetchRankings(e.detail.value)
    },

    onPullDownRefresh() {
        this.fetchRankings(this.data.currentDate)
    },

    onToggleSubscribe() {
    // 如果已经是打开状态，点击则是“关闭”（仅视觉关闭，实际上无法撤回订阅次数）
    if (this.data.isSubscribed) {
      this.setData({ isSubscribed: false });
      return;
    }

    // 发起订阅请求
    const that = this;
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success(res) {
        // 用户点了“允许”
        if (res[TEMPLATE_ID] === 'accept') {
          that.setData({ isSubscribed: true });
          wx.showToast({ title: '日报已开启', icon: 'success' });
          
          // 1. 上报给后端 (存入数据库)
          that.reportSubscription();
          
          // 2. [可选] 本地记录一下，避免重复点击（可选逻辑）
          wx.setStorageSync('daily_sub_' + that.calculateDate(0), true);
        } 
        // 用户点了“拒绝”
        else if (res[TEMPLATE_ID] === 'reject') {
           that.setData({ isSubscribed: false });
           wx.showToast({ title: '已取消', icon: 'none' });
        }
      },
      fail(err) {
        console.error(err);
        wx.showToast({ title: '订阅失败', icon: 'none' });
        that.setData({ isSubscribed: false });
      }
    });
  },

  // 上报后端
  reportSubscription() {
    if (!app.globalData.userInfo) return;
    
    wx.request({
        url: `${app.globalData.apiBase}/api/v1/notifications/subscribe`,
        method: 'POST',
        data: {
            openid: app.globalData.userInfo.uuid,
            template_id: TEMPLATE_ID
        }
    });
  }
})