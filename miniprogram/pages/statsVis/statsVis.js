// pages/stats_vis/stats_vis.js
const app = getApp();

Page({
    data: {
        isLogged: true, // 强制展示内容
        canEdit: false, // 强制不可编辑
        userInfo: null,
        userData: {
            avatar: '/assets/icons/cs-logo-grey.avif',
            nickname: 'Loading...',
            faceitLevel: '?',
            rating: '-',
            kd: '-',
            adr: '-',
            winRate: '-',
            totalKills: '-'
        },
        matchHistory: []
    },

    // 图表状态 (必须保留以支持交互)
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
        if (options.steamid) {
            this.fetchPlayerData(options.steamid);
        } else {
            wx.showToast({ title: '缺少参数', icon: 'none' });
        }
    },

    // 纯数据获取，不检查登录
    fetchPlayerData(steamId) {
        wx.showLoading({ title: '加载战绩...' });
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
            fail: () => wx.showToast({ title: '网络请求失败', icon: 'none' }),
            complete: () => wx.hideLoading()
        });
    },

    processData(data) {
        const { summary, history } = data;
        const hoursPlayed = ((summary.time_played || 0) / 3600).toFixed(1);
        const rawKD = Number(summary.avg_kd || 0);
        const rawADR = Number(summary.avg_ADR || 0);

        this.setData({
            userInfo: { steam_id: data.steam_id },
            'userData.nickname': data.nickname || data.steam_id,
            // 只读页面直接使用 API 头像
            'userData.avatar': data.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.steam_id}`,
            'userData.kd': rawKD.toFixed(2),
            'userData.rating': '-',
            'userData.totalKills': summary.period_kills,
            'userData.adr': rawADR.toFixed(2),
            'userData.winRate': summary.avg_WR,
            'userData.timePlayed': hoursPlayed
        });

        // 初始化图表
        this.chartState.history = history;
        this.chartState.startIndex = Math.max(0, history.length - this.chartState.visibleCount);
        this.chartState.tooltipIndex = -1;

        setTimeout(() => this.initChart(), 200);

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

    // --- 图表绘制与交互 (完全复用) ---
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

        // X轴
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        renderData.forEach((item, i) => {
            ctx.fillText(item.date.substring(5), getPoint(i).x, height - 5);
        });

        // Tooltip
        if (tooltipIndex >= startIndex && tooltipIndex < startIndex + visibleCount) {
            const p = getPoint(tooltipIndex - startIndex);
            const text = `KD: ${p.item.kd.toFixed(2)}`;
            const textW = ctx.measureText(text).width + 20;

            ctx.beginPath();
            ctx.moveTo(p.x, padding.top);
            ctx.lineTo(p.x, height - padding.bottom);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#de9b35';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            const bubbleY = Math.max(p.y - 35, 10);
            ctx.fillStyle = 'rgba(40, 40, 40, 0.9)';
            ctx.fillRect(p.x - textW / 2, bubbleY, textW, 24);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(text, p.x, bubbleY + 16);
        }
    },

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