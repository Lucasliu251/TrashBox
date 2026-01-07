Page({
  data: {
    isLogged: false, // 切换这里为 false 即可查看“未登录”状态
    userData: {
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
      nickname: 'S1mple_Fanboy',
      faceitLevel: 10,
      rating: 1.35,
      kd: 1.42,
      adr: 98.5,
      winRate: '62%'
    },
    matchHistory: [
      { map: 'Mirage', result: 'WIN', score: '13 : 9', rating: 1.52, date: '2小时前' },
      { map: 'Inferno', result: 'LOSE', score: '11 : 13', rating: 0.98, date: '昨天' },
      { map: 'Nuke', result: 'WIN', score: '13 : 5', rating: 1.21, date: '2天前' },
      { map: 'Ancient', result: 'WIN', score: '13 : 11', rating: 1.10, date: '3天前' },
      { map: 'Anubis', result: 'LOSE', score: '4 : 13', rating: 0.65, date: '1周前' }
    ]
  },

  // 跳转到注册页
  goToOnboarding() {
    wx.navigateTo({ url: '/pages/onboarding/onboarding' })
  }
})