// pages/index/index.js
const app = getApp();

Page({
    data: {
        isLogin: false,
        canEdit: false,
        userInfo: null, // 存头像、昵称等
        recentPosts: [], // 用于存储最新的4篇文章
        // 轮播图数据 (模拟 CS2 新闻)
        banners: [
            { id: 1, image: 'https://trashbox.tech/assets/static/budapest.png', title: 'Major: 布达佩斯激战开启' },
            { id: 2, image: 'https://trashbox.tech/assets/static/2026.png', title: '更新日志: 2026年服役勋章' },
            { id: 3, image: 'https://trashbox.tech/assets/static/XANTARES.jpg', title: 'Top #14 XANTARES' }
        ],

        // 榜单数据
        topPlayers: [],
        // 搜索内容
        searchValue: ''
    },

    onShow() {
        this.checkLogin();
        this.getRecentPosts();
        this.fetchLeaderboard();
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
        const hasEditPermission = user.canEdit === 1 || user.canEdit === true;
        this.setData({
            isLogin: true,
            canEdit: hasEditPermission,
            userInfo: {
                nickname: user.steam_id || 'CSer',
                // 如果后端没存头像，暂时随机生成一个，保证界面不崩
                avatar: user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.steam_id}`
            }
        });
    },
    getRecentPosts: function () {
        wx.request({
            // 假设你的后端支持 limit 参数，如果不支持，我们在 success 里截取
            url: `${app.globalData.apiBase}/api/v1/posts?limit=4`,
            method: 'GET',
            success: (res) => {
                if (res.statusCode === 200) {
                    // 假设后端返回的数据格式是 { data: [List...] }
                    let posts = res.data.data || res.data;

                    // 如果后端没做排序，前端由于是 demo 可以简单的反转一下(最新的在最后的情况)
                    // 但最好是后端 SQL 用 ORDER BY created_at DESC

                    // 简单格式化一下时间 (可选，只取日期部分 YYYY-MM-DD)
                    // 假设 created_at 是 "2026-01-10 12:00:00"
                    // posts.forEach(post => {
                    //     if (post.created_at) {
                    //         post.created_at = post.created_at.substring(0, 10);
                    //     }
                    // });

                    this.setData({
                        recentPosts: posts
                    });
                }
            }
        });
    },

    fetchLeaderboard() {
        // 1. 计算昨天日期 (格式 YYYY-MM-DD)
        // 因为数据是每晚 23:30 更新，所以默认拉取昨天的榜单最稳妥
        const date = new Date();
        date.setDate(date.getDate() - 1);

        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        wx.request({
            url: `${app.globalData.apiBase}/api/v1/rankings/daily`,
            data: { date: dateStr },
            success: (res) => {
                if (res.statusCode === 200 && res.data.rankings) {
                    // 取前 5 名
                    const list = res.data.rankings.slice(0, 5).map(item => ({
                        rank: item.rank,
                        name: item.nickname || 'Unknown',
                        steam_id: item.steam_id,
                        // 如果 API 没给头像，用 DiceBear 生成兜底
                        avatar: item.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.steam_id}`,

                        // 丰富的数据展示
                        rating: Number(item.daily_Rating).toFixed(2), // 主数据 Rating
                        adr: Number(item.daily_adr).toFixed(1),   // 副数据 ADR
                        mvp: item.daily_mvp,                      // 荣誉数据
                        kills: item.daily_kills                   // 击杀数
                    }));

                    this.setData({ topPlayers: list });
                }
            },
            fail: (err) => {
                console.error("榜单获取失败", err);
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
        const query = this.data.searchValue.trim();
        if (!query) {
            return wx.showToast({ title: '请输入搜索内容', icon: 'none' });
        }

        wx.showLoading({ title: '搜索中...' });

        wx.request({
            url: `${app.globalData.apiBase}/api/v1/users/search`,
            method: 'GET',
            data: { q: query },
            success: (res) => {
                wx.hideLoading();

                if (res.statusCode === 200 && res.data.code === 200) {
                    const list = res.data.data;

                    // 情况 1: 未找到
                    if (!list || list.length === 0) {
                        wx.showToast({ title: '未找到该玩家', icon: 'none' });
                        return;
                    }

                    // 情况 2: 只有一个结果 -> 直接跳转
                    if (list.length === 1) {
                        const target = list[0];
                        this.navigateToStats(target.steam_id);
                    }
                    // 情况 3: 多个结果 -> 让用户选择
                    else {
                        this.showSelectionSheet(list);
                    }
                } else {
                    wx.showToast({ title: '搜索出错', icon: 'none' });
                }
            },
            fail: (err) => {
                wx.hideLoading();
                console.error(err);
                wx.showToast({ title: '网络异常', icon: 'none' });
            }
        });
    },
    // 辅助函数：显示多选列表
    showSelectionSheet(userList) {
        // 构造显示的文字，例如: "Lucas (12345...)"
        const sheetItems = userList.map(u => {
            // 简单截取一下 SteamID 避免太长
            const shortId = u.steam_id.substring(0, 15) + '...';
            return `${u.nickname} (${shortId})`;
        });

        wx.showActionSheet({
            itemList: sheetItems,
            alertText: `找到 ${userList.length} 位相关玩家`,
            success: (res) => {
                // res.tapIndex 对应 itemList 的索引
                const selectedUser = userList[res.tapIndex];
                this.navigateToStats(selectedUser.steam_id);
            }
        });
    },

    // 辅助函数：跳转
    navigateToStats(steamId) {
        wx.navigateTo({
            url: `/pages/statsVis/statsVis?steamid=${steamId}`,
            fail: (err) => {
                // 容错：如果跳转失败（例如 statsVis 没注册），提示一下
                console.error("跳转失败", err);
                wx.showToast({ title: '无法查看详情', icon: 'none' });
            }
        });
    }
})