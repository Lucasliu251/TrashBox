// pages/index/index.js
const app = getApp();

Page({
    data: {
        isLogin: false,
        userInfo: null, // 存头像、昵称等
        // 轮播图数据 (模拟 CS2 新闻)
        banners: [
            { id: 1, image: '/assets/banners/budapest.png', title: 'Major: 布达佩斯激战开启' },
            { id: 2, image: '/assets/banners/2026.png', title: '更新日志: 2026年服役勋章' },
            { id: 3, image: '/assets/banners/XANTARES.jpg', title: 'Top #14 XANTARES' }
        ],

        // 热门榜单数据 (模拟 Top 5)
        topPlayers: [
            { rank: 1, name: 'ZywOo', rating: 1.45, change: '+0.02', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ZywOo' },
            { rank: 2, name: 'm0NESY', rating: 1.38, change: '+0.05', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=m0NESY' },
            { rank: 3, name: 'donk', rating: 1.35, change: '-0.01', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=donk' },
            { rank: 4, name: 'NiKo', rating: 1.29, change: '+0.00', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NiKo' },
            { rank: 5, name: 'ropz', rating: 1.25, change: '+0.01', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ropz' }
        ],
        // 社区动态/新闻数据
        newsList: [
            { id: 1, tag: '更新', title: 'Release Notes for 1/8/2026', date: '2小时前', views: 2304 },
            { id: 2, tag: '赛事', title: 'FaZe Clan 成功晋级 Major 传奇组', date: '5小时前', views: 5102 },
            { id: 3, tag: '讨论', title: '现在的经济局到底该怎么打？', date: '昨天', views: 899 },
            { id: 4, tag: '八卦', title: 's1mple 锐评新版本 AWP 改动', date: '昨天', views: 12055 }
        ],

        // 搜索内容
        searchValue: ''
    },

    onShow() {
        this.checkLogin();
    },
    checkLogin() {
        // 1. 也是先问全局 App.js 有没有数据
        if (app.globalData.hasLogin && app.globalData.userInfo) {
            this.setUserInfo(app.globalData.userInfo);
        }
        // 2. 如果 App.js 还没准备好，就注册回调
        else {
            app.userCallback = (userInfo) => {
                if (userInfo) {
                    this.setUserInfo(userInfo);
                } else {
                    this.setData({ isLogin: false, userInfo: null });
                }
            }
        }
    },

    setUserInfo(user) {
        this.setData({
            isLogin: true,
            userInfo: {
                nickname: user.steam_id || 'CSer',
                // 如果后端没存头像，暂时随机生成一个，保证界面不崩
                avatar: user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.steam_id}`
            }
        });
    },

    // 跳转到发布页
    goToCreatePost() {
        if (this.data.isLogin) {
            wx.navigateTo({ url: '/pages/post/create' });
        } else {
            wx.showToast({ title: '请先登录', icon: 'none' });
            this.goToLogin(); // 或者跳转去绑定页
        }
    },
    // 跳转到绑定页
    goToLogin() {
        wx.navigateTo({ url: '/pages/onboarding/onboarding' });
    },
    // 处理搜索输入
    onSearchInput(e) {
        this.setData({ searchValue: e.detail.value });
    },

    // 执行搜索
    doSearch() {
        if (!this.data.searchValue) return;
        wx.showToast({ title: '搜索: ' + this.data.searchValue, icon: 'none' });
        // 实际逻辑：跳转到搜索结果页
    },
})