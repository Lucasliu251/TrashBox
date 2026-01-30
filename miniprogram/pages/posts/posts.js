const app = getApp();

Page({
    data: {
        postList: [],    // 存储所有文章的大数组
        isLoading: false, // 防止重复请求锁
        isEnd: false,     // 标记是否已经加载完所有数据

        // 分页参数
        limit: 10,
        offset: 0
    },

    onLoad: function () {
        this.loadPosts();
    },

    // --- 核心函数：加载数据 ---
    loadPosts: function (isRefresh = false) {
        // 1. 如果正在加载中，或者已经到底了（且不是刷新操作），就停止
        if (this.data.isLoading || (this.data.isEnd && !isRefresh)) return;

        this.setData({ isLoading: true });

        wx.request({
            url: `${app.globalData.apiBase}/api/v1/posts`,
            method: 'GET',
            data: {
                limit: this.data.limit,
                offset: isRefresh ? 0 : this.data.offset // 如果是刷新，从0开始；否则接续offset
            },
            success: (res) => {
                if (res.data.code === 200) {
                    const newPosts = res.data.data;

                    // 2. 核心逻辑：拼接数组
                    // 如果是刷新，直接覆盖；如果是加载更多，拼接到后面
                    const finalPosts = isRefresh ? newPosts : this.data.postList.concat(newPosts);

                    this.setData({
                        postList: finalPosts,
                        // 更新偏移量：原来的 offset + 这次拿到的数量
                        offset: (isRefresh ? 0 : this.data.offset) + newPosts.length,
                        // 如果拿到的数据少于 limit (比如要求10条只回了5条)，说明没数据了
                        isEnd: newPosts.length < this.data.limit
                    });
                }
            },
            complete: () => {
                this.setData({ isLoading: false });
                if (isRefresh) wx.stopPullDownRefresh(); // 停止下拉刷新的动画
            }
        });
    },

    // --- 监听用户下拉刷新 (顶部下拉) ---
    onPullDownRefresh: function () {
        // 重置所有状态
        this.setData({ isEnd: false });
        // 发起刷新请求
        this.loadPosts(true);
    },

    // --- 监听用户触底 (无限滚动) ---
    onReachBottom: function () {
        // 用户滑到底部了，加载下一页
        this.loadPosts(false);
    }
});