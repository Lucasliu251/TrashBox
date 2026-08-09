const app = getApp();

Page({
  data: {
    // 状态枚举: idle(闲置), waiting(红), ready(绿), early(抢跑), done(完成)
    gameState: 'idle', 
    bgColor: '#2b2d31', // 默认深灰
    mainText: '反应力测试',
    subText: '点击屏幕任意区域开始',
    
    results: [],     // 保存多次测试的成绩
    maxTests: 5,     // 一次测试包含的回合数
    average: 0,
    evaluation: ''   // 评价文字 (如 "职业哥水平")
  },

  timer: null,       // 随机变绿的定时器
  startTime: 0,      // 变绿的瞬间时间戳

  // 统一处理整个屏幕的点击事件
  handleTap() {
    const state = this.data.gameState;

    if (state === 'idle' || state === 'early') {
      // 1. 开始测试 -> 进入等待(红)
      this.startWaiting();
    } 
    else if (state === 'waiting') {
      // 2. 抢跑了 (还没变绿就按了)
      this.handleEarlyClick();
    } 
    else if (state === 'ready') {
      // 3. 成功反应 (变绿后按了)
      this.handleValidClick();
    }
    // done 状态不处理屏幕点击，由重试按钮处理
  },

  startWaiting() {
    this.setData({
      gameState: 'waiting',
      bgColor: '#eb4b4b', // CS T阵营红色
      mainText: '等待变绿...',
      subText: '准备好你的手指'
    });

    // 随机 2000ms 到 5000ms 之间变绿
    const delay = Math.floor(Math.random() * 3000) + 2000;
    
    this.timer = setTimeout(() => {
      this.turnGreen();
    }, delay);
  },

  turnGreen() {
    this.startTime = Date.now(); // 记录变绿的绝对时间
    this.setData({
      gameState: 'ready',
      bgColor: '#50c878', // 翡翠绿
      mainText: '点击！',
      subText: ''
    });
  },

  handleEarlyClick() {
    // 清除定时器，防止它自己变绿
    if (this.timer) clearTimeout(this.timer);
    
    this.setData({
      gameState: 'early',
      bgColor: '#2b2d31',
      mainText: '太早了！',
      subText: '点击屏幕重试'
    });
    // 抢跑不计入成绩，直接重试当前回合
  },

  handleValidClick() {
    const reactionTime = Date.now() - this.startTime;
    const currentResults = this.data.results;
    currentResults.push(reactionTime);

    if (currentResults.length >= this.data.maxTests) {
      // 测试全部完成
      this.finishTest(currentResults);
    } else {
      // 准备下一回合
      this.setData({
        gameState: 'idle',
        bgColor: '#2b2d31',
        mainText: `${reactionTime} ms`,
        subText: '点击屏幕继续下一回合',
        results: currentResults
      });
    }
  },

  finishTest(results) {
    // 计算平均值
    const sum = results.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / results.length);
    
    // 生成骚话评价
    let evalText = '';
    if (avg < 180) evalText = 'NiKo 附体！这是人类的极限吗？';
    else if (avg < 220) evalText = '职业哥水平，你的大狙一定很准。';
    else if (avg < 260) evalText = '正常水平，打打竞技完全够用。';
    else evalText = '老年人反应...建议玩道具辅助位。';

    this.setData({
      gameState: 'done',
      bgColor: '#1e1e1e', // 回到主背景色
      mainText: '测试完成',
      subText: '',
      results: results,
      average: avg,
      evaluation: evalText
    });
  },

  resetTest() {
    this.setData({
      gameState: 'idle',
      bgColor: '#2b2d31',
      mainText: '反应力测试',
      subText: '点击屏幕任意区域开始',
      results: [],
      average: 0
    });
  },

  // --- API 预留：保存成绩到数据库 ---
  submitResult() {
    const avg = this.data.average;
    if (!avg) return;

    wx.showLoading({ title: '保存中...' });

    // 假设你有 app.globalData.userInfo.steam_id
    const steamId = app.globalData.userInfo ? app.globalData.userInfo.steam_id : 'guest';

    wx.request({
      url: `${app.globalData.apiBase}/api/v1/reaction/submit`, // 预留的后端接口
      method: 'POST',
      data: {
        steam_id: steamId,
        average_ms: avg,
        test_date: new Date().toISOString()
      },
      success: (res) => {
        wx.showToast({ title: '成绩已保存', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  }
});