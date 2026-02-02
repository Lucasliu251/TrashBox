// pages/stats/stats.js
const app = getApp();

Page({
  data: {
    isLogged: false,
    canEdit: false,
    userInfo: null,
    userData: {
      avatar: '/assets/icons/cs-logo-grey.avif',
      nickname: '点击编辑昵称',
      faceitLevel: '?',
      rating: '-',
      kd: '-',
      adr: '-',
      winRate: '-',
      totalKills: '-'
    },
    matchHistory: [] // chartData 不再需要放入 data，因为由 chartState 管理
  },

  // 图表运行时状态
  chartState: {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    dpr: 1,
    history: [],
    startIndex: 0,
    visibleCount: 7,
    itemWidth: 0,
    touchStartX: 0,
    startOffset: 0,
    tooltipIndex: -1
  },

  onLoad(options) {
    // 兼容逻辑：带参查看他人
    if (options.steamid) {
      this.setData({ isLogged: true, canEdit: false });
      this.fetchPlayerData(options.steamid);
    } else {
      this.setData({ canEdit: true });
      this.checkLoginStatus();
    }
  },

  onShow() {
    // 仅在查看自己时检查登录状态
    if (this.data.canEdit) {
      this.checkLoginStatus();
    }
  },

  checkLoginStatus() {
    if (app.globalData.hasLogin && app.globalData.userInfo) {
      this.updateUI(app.globalData.userInfo);
    } else {
      app.userCallback = (userInfo) => {
        userInfo ? this.updateUI(userInfo) : this.setData({ isLogged: false });
      }
    }
  },

  updateUI(userInfo) {
    this.setData({ isLogged: true, userInfo: userInfo });
    if (userInfo.steam_id) this.fetchPlayerData(userInfo.steam_id);
  },

  fetchPlayerData(steamId) {
    wx.showLoading({ title: '加载数据...' });
    wx.request({
      url: `${app.globalData.apiBase}/api/v1/players/${steamId}/history`,
      method: 'GET',
      data: { days: 30 },
      success: (res) => {
        if (res.statusCode === 200) {
          this.processData(res.data);
        } else {
          wx.showToast({ title: '暂无数据', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '网络错误', icon: 'none' }),
      complete: () => wx.hideLoading()
    });
  },

  processData(data) {
    const { summary, history } = data;

    const hoursPlayed = ((summary.time_played || 0) / 3600).toFixed(1);
    const rawKD = Number(summary.avg_kd || 0);
    const rawADR = Number(summary.avg_ADR || 0);

    // 1. 更新UI数据
    this.setData({
      'userData.nickname': data.nickname || data.steam_id,
      'userData.avatar': (this.data.canEdit && app.globalData.userInfo.avatar) ? app.globalData.userInfo.avatar : (data.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.steam_id}`),
      'userData.kd': rawKD.toFixed(2),
      'userData.rating': '-',
      'userData.totalKills': summary.period_kills,
      'userData.adr': rawADR.toFixed(2),
      'userData.winRate': summary.avg_WR,
      'userData.timePlayed': hoursPlayed
    });

    // 2. 初始化图表状态
    this.chartState.history = history;
    this.chartState.startIndex = Math.max(0, history.length - this.chartState.visibleCount);
    this.chartState.tooltipIndex = -1;

    // [关键修复] 调用 initChart 而不是 drawTrendChart，确保 Context 存在
    setTimeout(() => this.initChart(), 200);

    // 3. 列表映射
    const matchList = history.slice().reverse().map(item => {
      const rounds = item.rounds_played || 1;
      return {
        map: 'Daily',
        result: item.kd >= 1.0 ? 'POS' : 'NEG',
        score: `${item.kills} / ${item.deaths}`,
        date: item.date.substring(5),
        rating: item.kd,
        kd: item.kd,
        mvp: item.mvp,
        dmg: item.dmg,
        adr: item.adr,
        hsr: item.hsr,
        winRate: item.win_rate,
        rounds: item.rounds_played
      };
    });
    this.setData({ matchHistory: matchList });
  },

  // --- 交互功能 (编辑) ---
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ 'userData.avatar': avatarUrl });
    this.uploadAvatar(avatarUrl);
  },

  onNicknameChange(e) {
    const nickName = e.detail.value;
    if (nickName) {
      this.setData({ 'userData.nickname': nickName });
      this.updateUserProfile({ nickname: nickName });
    }
  },

  uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...' });
    wx.uploadFile({
      url: `${app.globalData.apiBase}/api/v1/users/avatar`,
      filePath: filePath,
      name: 'file',
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (data.code === 200) this.updateUserProfile({ avatar: data.url });
        } catch (e) { console.error(e); }
      },
      complete: () => wx.hideLoading()
    });
  },

  updateUserProfile(data) {
    const openid = (app.globalData.userInfo && app.globalData.userInfo.uuid) ? app.globalData.userInfo.uuid : null;
    if (!openid) return;
    wx.request({
      url: `${app.globalData.apiBase}/api/v1/users/update`,
      method: 'PUT',
      data: { openid, ...data },
      success: (res) => {
        if (res.statusCode === 200 && res.data.code === 200) {
          wx.showToast({ title: '保存成功', icon: 'success' });
          Object.assign(app.globalData.userInfo, data);
        }
      }
    });
  },

  goToOnboarding() {
    wx.navigateTo({ url: '/pages/onboarding/onboarding' });
  },

  // --- 图表核心逻辑 ---
  initChart() {
    const query = wx.createSelectorQuery();
    query.select('#trendCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;

      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);

      this.chartState.canvas = canvas;
      this.chartState.ctx = ctx;
      this.chartState.width = res[0].width;
      this.chartState.height = res[0].height;

      this.drawTrendChart();
    });
  },

  drawTrendChart() {
    const { ctx, width, height, history, startIndex, visibleCount, tooltipIndex } = this.chartState;
    if (!ctx || !history.length) return;

    const renderData = history.slice(startIndex, startIndex + visibleCount);
    const padding = { top: 20, bottom: 30, left: 10, right: 10 };
    const graphW = width - padding.left - padding.right;
    const graphH = height - padding.top - padding.bottom;
    const globalMaxVal = Math.max(...history.map(i => i.kd), 2.0);
    const stepX = graphW / (visibleCount - 1 || 1);
    this.chartState.itemWidth = stepX;

    ctx.clearRect(0, 0, width, height);

    // 参考线
    const y1 = (height - padding.bottom) - (1.0 / globalMaxVal) * graphH;
    ctx.beginPath();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.moveTo(padding.left, y1);
    ctx.lineTo(width - padding.right, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    // 折线
    ctx.beginPath();
    ctx.strokeStyle = '#de9b35';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPoint = (idx) => ({
      x: padding.left + idx * stepX,
      y: (height - padding.bottom) - (renderData[idx].kd / globalMaxVal) * graphH,
      item: renderData[idx]
    });

    renderData.forEach((_, i) => {
      const p = getPoint(i);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // 渐变
    ctx.lineTo(getPoint(renderData.length - 1).x, height - padding.bottom);
    ctx.lineTo(getPoint(0).x, height - padding.bottom);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(222, 155, 53, 0.2)');
    gradient.addColorStop(1, 'rgba(222, 155, 53, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // X轴标签
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    renderData.forEach((item, i) => {
      ctx.fillText(item.date.substring(5), getPoint(i).x, height - 5);
    });

    // 高亮 Tooltip
    if (tooltipIndex >= startIndex && tooltipIndex < startIndex + visibleCount) {
      const p = getPoint(tooltipIndex - startIndex);
      const text = `KD: ${p.item.kd.toFixed(2)}`;
      const textW = ctx.measureText(text).width + 20;

      // 辅助线
      ctx.beginPath();
      ctx.moveTo(p.x, padding.top);
      ctx.lineTo(p.x, height - padding.bottom);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 圆点
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#de9b35';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 气泡
      const bubbleY = Math.max(p.y - 35, 10);
      ctx.fillStyle = 'rgba(40, 40, 40, 0.9)';
      // 兼容写法: fillRect 替代 roundRect
      ctx.fillRect(p.x - textW / 2, bubbleY, textW, 24);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(text, p.x, bubbleY + 16);
    }
  },

  // --- 触摸事件 ---
  onTouchChartStart(e) {
    this.chartState.touchStartX = e.touches[0].x;
    this.chartState.startOffset = this.chartState.startIndex;
  },
  onTouchChartMove(e) {
    const deltaX = e.touches[0].x - this.chartState.touchStartX;
    const deltaIndex = Math.round(deltaX / (this.chartState.itemWidth / 1.5));
    let newStart = this.chartState.startOffset - deltaIndex;
    const maxStart = Math.max(0, this.chartState.history.length - this.chartState.visibleCount);

    newStart = Math.max(0, Math.min(newStart, maxStart));
    if (newStart !== this.chartState.startIndex) {
      this.chartState.startIndex = newStart;
      this.drawTrendChart();
    }
  },
  onTouchChartEnd(e) {
    const x = e.changedTouches[0].x;
    if (Math.abs(x - this.chartState.touchStartX) < 5) this.handleChartTap(x);
  },
  handleChartTap(x) {
    const { itemWidth, startIndex, visibleCount } = this.chartState;
    let relIndex = Math.round((x - 10) / itemWidth);
    relIndex = Math.max(0, Math.min(relIndex, visibleCount - 1));
    this.chartState.tooltipIndex = startIndex + relIndex;
    this.drawTrendChart();
    wx.vibrateShort({ type: 'light' });
  }
});