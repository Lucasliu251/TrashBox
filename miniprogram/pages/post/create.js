const app = getApp();

Page({
    data: {
        title: '',
        formats: {},
        keyboardHeight: 0,
        isIOS: false,

        tags: ['讨论', '更新', '赛事', '吐槽'],
        tagIndex: 0,
    },

    onLoad() {
        const sys = wx.getSystemInfoSync();
        this.setData({ isIOS: sys.system.indexOf('iOS') > -1 });
        // 监听键盘高度变化，让工具栏跟随键盘
        wx.onKeyboardHeightChange(res => {
            this.setData({ keyboardHeight: res.height })
        })
    },

    onEditorReady() {
        const that = this
        wx.createSelectorQuery().select('#editor').context(function (res) {
            that.editorCtx = res.context
        }).exec()
    },

    // 标题输入
    onTitleInput(e) {
        this.setData({ title: e.detail.value })
    },

    // 样式状态更新
    onStatusChange(e) {
        this.setData({ formats: e.detail })
    },

    // Tag选择
    onTagChange: function (e) {
        this.setData({
            tagIndex: e.detail.value
        });
    },

    // --- 核心：插入图片 ---
    insertImage() {
        const that = this;
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            success(res) {
                const tempFilePath = res.tempFiles[0].tempFilePath;

                wx.showLoading({ title: '上传中...' });

                // 上传到你的 Python FastAPI
                wx.uploadFile({
                    url: `${app.globalData.apiBase}/api/v1/posts/upload`,
                    filePath: tempFilePath,
                    name: 'file',
                    success(uploadRes) {
                        wx.hideLoading();
                        // 处理 FastAPI 返回的 JSON 字符串
                        const result = JSON.parse(uploadRes.data);

                        if (result.code === 200) {
                            // 插入到编辑器光标处
                            that.editorCtx.insertImage({
                                src: result.url,
                                width: '100%',
                                alt: result.alt,
                                success: function () {
                                    // 插入后自动换行，体验更好
                                    that.editorCtx.insertText({ text: '\n' });
                                }
                            })
                        } else {
                            wx.showToast({ title: '上传失败', icon: 'none' });
                        }
                    },
                    fail(err) {
                        wx.hideLoading();
                        console.error(err);
                        wx.showToast({ title: '网络异常', icon: 'none' });
                    }
                })
            }
        })
    },

    toggleBold() { this.editorCtx.format('bold') },
    toggleQuote() { this.editorCtx.format('blockquote') },

    // --- 提交帖子 ---
    submitPost() {
        if (!this.data.title.trim()) {
            return wx.showToast({ title: '请输入标题', icon: 'none' });
        }

        // 获取编辑器内容 (HTML)
        this.editorCtx.getContents({
            success: (res) => {
                const htmlContent = res.html;
                const textContent = res.text; // 用于提取摘要
                const selectedTag = this.data.tags[this.data.tagIndex];

                if (textContent.trim().length < 5) {
                    return wx.showToast({ title: '多写点内容吧', icon: 'none' });
                }

                // 从全局变量获取当前用户 UUID
                const userInfo = app.globalData.userInfo;
                const openid = userInfo ? userInfo.uuid : '';
                // 如果没有登录信息，拦截请求
                if (!openid) {
                    wx.showToast({ title: '登录状态失效，请重新登录', icon: 'none' });
                    // 可选：跳转去登录页
                    setTimeout(() => wx.navigateTo({ url: '/pages/onboarding/onboarding' }), 1000);
                    return;
                }
                console.log("准备发布，当前用户UUID:", openid);

                wx.request({
                    url: `${app.globalData.apiBase}/api/v1/posts`, // 对应 @router.post("/")
                    method: 'POST',
                    data: {
                        openid: openid, // 必须传! 从本地缓存拿登录时的 openid
                        title: this.data.title,
                        content: htmlContent, // 编辑器生成的 HTML
                        tag: selectedTag // 可选
                    },
                    success: (response) => {
                        if (response.data.code === 200) {
                            wx.showToast({ title: '发布成功' });
                            setTimeout(() => wx.navigateBack(), 1000);
                        } else {
                            wx.showToast({ title: '发布失败', icon: 'none' });
                        }
                    },
                    fail: (err) => {
                        console.error(err);
                        wx.showToast({ title: '网络异常', icon: 'none' });
                    }
                });
            }
        })
    }
})