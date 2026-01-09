Page({
    data: {
        title: '',
        formats: {},
        keyboardHeight: 0,
        isIOS: false
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
                    url: '${this.globalData.apiBase}/api/upload/image',
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

                if (textContent.trim().length < 5) {
                    return wx.showToast({ title: '多写点内容吧', icon: 'none' });
                }

                // TODO: 调用发布接口，把 title, htmlContent 传给后端
                console.log('提交数据:', {
                    title: this.data.title,
                    content: htmlContent,
                    author_id: 'current_user_id'
                });

                wx.showToast({ title: '发布成功' });
                setTimeout(() => wx.navigateBack(), 1000);
            }
        })
    }
})