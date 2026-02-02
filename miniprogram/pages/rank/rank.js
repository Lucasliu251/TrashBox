// pages/rank/rank.js
const app = getApp()

Page({
    data: {
        currentDate: '',
        maxDate: '',     // 限制不能选明天
        rankings: [],
        isLoading: false,
        myRank: null     // 如果登录了，可以在底部悬浮显示自己的排名(可选)
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
                        rating: Number(item.daily_kd).toFixed(2),
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
    }
})