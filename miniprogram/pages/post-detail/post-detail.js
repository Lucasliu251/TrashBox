const app = getApp();

Page({
    data: {
        id: null,
        post: null, // 存放文章详情数据
        comments: null,
        commentVal: '' // 绑定输入框内容
    },

    onLoad: function (options) {
        // 1. 获取从列表页传过来的 id
        const { id } = options;
        this.setData({ id });

        // 2. 请求详情
        this.getPostDetail(id);
    },

    getPostDetail: function (id) {
        wx.showLoading({ title: '加载中...' });

        wx.request({
            url: `${app.globalData.apiBase}/api/v1/posts/${id}`,
            method: 'GET',
            success: (res) => {
                if (res.data.code === 200) {
                    // 处理一下富文本里的图片宽度，防止太宽撑破
                    // 简单的正则替换，给 img 标签加个 class 或 style
                    let content = res.data.data.info.content;
                    if (content) {
                        content = content.replace(/\<img/gi, '<img style="max-width:100%;height:auto"');
                    }
                    res.data.data.info.content = content;

                    this.setData({
                        post: res.data.data.info,
                        comments: res.data.data.comments
                    });
                }
            },
            complete: () => {
                wx.hideLoading();
            }
        });
    },

    // 绑定输入框
    onInput: function (e) {
        this.setData({ commentVal: e.detail.value });
    },

    // 发送评论
    sendComment: function () {
        const content = this.data.commentVal.trim();
        if (!content) return;

        if (!app.globalData.hasLogin) {
            wx.showToast({ title: '请先登录', icon: 'none' });
            return;
        }

        wx.showLoading({ title: '发送中' });

        wx.request({
            url: `${app.globalData.apiBase}/api/v1/posts/${this.data.id}/comment`,
            method: 'POST',
            data: {
                uuid: wx.getStorageSync('user_uuid'),
                content: content
            },
            success: (res) => {
                if (res.data.code === 200) {
                    wx.showToast({ title: '评论成功' });
                    this.setData({ commentVal: '' }); // 清空输入框

                    // 刷新详情页（或者手动把新评论 push 到 post.comments 数组里，更流畅）
                    this.getPostDetail(this.data.id);
                } else {
                    wx.showToast({ title: '失败: ' + res.data.message, icon: 'none' });
                }
            },
            complete: () => wx.hideLoading()
        });
    }
});