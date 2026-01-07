// index.js
Page({
  // 1. data: 页面的初始数据（状态）
  data: {
    nickName: "设计狮小明",
    bio: "热爱前端 UI 设计，正在学习小程序开发。这里是我的个人简介区域。",
    isEditing: false // 标记当前是否处于编辑模式
  },

  // 2. 切换编辑状态的函数
  toggleEdit() {
    // 获取当前状态
    const currentStatus = this.data.isEditing;
    
    // 如果是保存操作（从 true 变 false），你可以在这里写代码把数据发给服务器
    if (currentStatus) {
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
    }

    // 修改数据：必须使用 setData，界面才会刷新！
    this.setData({
      isEditing: !currentStatus
    });
  },

  // 3. 监听昵称输入
  onNameChange(e) {
    // e.detail.value 就是用户输入的内容
    this.setData({
      nickName: e.detail.value
    });
  },

  // 4. 监听简介输入
  onBioChange(e) {
    this.setData({
      bio: e.detail.value
    });
  }
})