// pages/index/index.js
Page({
    data: {
        // 1. 轮播图数据 (模拟 CS2 新闻)
        banners: [
            { id: 1, image: '/assets/banners/budapest.png', title: 'Major: 布达佩斯激战开启' },
            { id: 2, image: '/assets/banners/2026.png', title: '更新日志: 2026年服役勋章' },
            { id: 3, image: '/assets/banners/XANTARES.jpg', title: 'Top #14 XANTARES' }
        ],

        // 2. 热门榜单数据 (模拟 Top 5)
        topPlayers: [
            { rank: 1, name: 'ZywOo', rating: 1.45, change: '+0.02', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ZywOo' },
            { rank: 2, name: 'm0NESY', rating: 1.38, change: '+0.05', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=m0NESY' },
            { rank: 3, name: 'donk', rating: 1.35, change: '-0.01', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=donk' },
            { rank: 4, name: 'NiKo', rating: 1.29, change: '+0.00', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NiKo' },
            { rank: 5, name: 'ropz', rating: 1.25, change: '+0.01', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ropz' }
        ],

        // 3. 搜索内容
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
    }
})