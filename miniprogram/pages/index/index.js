// pages/index/index.js
const app = getApp();

Page({
    data: {
        isLogin: false,
        steamId: '',
        matchCode: '',
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

        // 搜索内容
        searchValue: ''
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

    onLoad() {
        // 页面加载时，分两种情况：

        // 情况A: app.js 跑得比我快，或者我是从别的页面跳过来的 -> 全局数据里已经有了
        if (app.globalData.hasLogin && app.globalData.userInfo) {
            console.log('首页: 直接从全局读取到了用户信息');
            this.setData({
                isLogin: true,
                steamId: app.globalData.userInfo.steam_id,
                matchCode: app.globalData.userInfo.match_code
            });
        }
        // 情况B: app.js 还没跑完 (比如刚冷启动)，网络请求还在路上 -> 我得注册一个回调等着
        else {
            console.log('首页: 全局还没数据，注册回调等待 App.js...');
            app.userCallback = (userInfo) => {
                if (userInfo) {
                    this.setData({
                        isLogin: true,
                        steamId: userInfo.steam_id,
                        matchCode: userInfo.match_code
                    });
                } else {
                    // 这里的 else 意味着 app.js 确认了“没登录”
                    this.setData({ isLogin: false });
                }
            }
        }
    }
})