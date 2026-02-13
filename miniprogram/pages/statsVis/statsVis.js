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
            totalKills: '-',
            style_tag: '無',
        },
        matchHistory: [],
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
        tooltipIndex: -1,

        adarData: {},
        serverAvg: {}
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
        const rawRating = Number(summary.avg_Rating || 0);
        const style_tag = data.style_tag || '無';

        this.setData({
            userInfo: { steam_id: data.steam_id },
            'userData.nickname': data.nickname || data.steam_id,
            // 只读页面直接使用 API 头像
            'userData.avatar': data.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.steam_id}`,
            'userData.kd': rawKD.toFixed(2),
            'userData.rating': rawRating.toFixed(2),
            'userData.totalKills': summary.period_kills,
            'userData.adr': rawADR.toFixed(2),
            'userData.winRate': summary.avg_WR,
            'userData.timePlayed': hoursPlayed,
            'userData.style_tag': style_tag
        });

        // 初始化图表
        this.chartState.history = history;
        this.chartState.startIndex = Math.max(0, history.length - this.chartState.visibleCount);
        this.chartState.tooltipIndex = -1;

        const radarData = {
        kpr: summary.avg_KPR,
        adr: rawADR,
        spr: summary.avg_SPR,
        wr: summary.avg_WR / 100,
        mpr: summary.avg_MPR,
        hsr: summary.avg_HSR / 100
        }
        const serverAvg = summary.server_avg

        this.chartState.radarData = radarData;
        this.chartState.serverAvg = serverAvg;

        setTimeout(() => {
            this.initChart();
            this.initRadarChart();
        }, 200);

        const matchList = history.slice().reverse().map(item => {
            const rounds = item.rounds_played || 1;
            return {
                map: 'Daily',
                result: item.kd >= 1.0 ? 'POS' : 'NEG',
                score: `${item.kills} / ${item.deaths}`,
                date: item.date.substring(5),
                Rating: item.Rating,
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

    initRadarChart() {
        const query = wx.createSelectorQuery();
        query.select('#radarCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;

        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);

        // 绘制配置
        const config = {
            width: res[0].width,
            height: res[0].height,
            radius: Math.min(res[0].width, res[0].height) / 2 * 0.65, // 半径占画布的 65%
            center: { x: res[0].width / 2, y: res[0].height / 2 },
            // 定义 6 个轴的配置：label=名称, key=数据字段名, max=该项数据的理论上限(用于归一化)
            axes: [
            { label: 'KPR', key: 'kpr', min: 0, max: 4 },   // 击杀
            { label: 'ADR', key: 'adr', min: 0, max: 150 },   // 伤害
            { label: 'SPR', key: 'spr', min: -3, max: 1 },   // 生存 (注意SPR通常小于1)
            { label: 'WR',  key: 'wr',  min: 0, max: 0.8 },   // 胜率
            { label: 'MPR', key: 'mpr', min: 0, max: 0.8 },   // MVP
            { label: 'HSR', key: 'hsr', min: 0, max: 1.0 }    // 爆头
            ]
        };

        this.drawRadar(ctx, config);
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

    drawRadar(ctx, config) {
        const { width, height, radius, center, axes } = config;
        const { radarData, serverAvg } = this.chartState;

        ctx.clearRect(0, 0, width, height);
        const angleSlice = (Math.PI * 2) / axes.length;

        // 1. 绘制网格 (保持不变)
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        for (let level = 1; level <= 4; level++) {
        const r = radius * (level / 4);
        ctx.beginPath();
        for (let i = 0; i < axes.length; i++) {
            const angle = i * angleSlice - Math.PI / 2;
            ctx.lineTo(center.x + r * Math.cos(angle), center.y + r * Math.sin(angle));
        }
        ctx.closePath();
        ctx.stroke();
        }

        // 2. 绘制轴线 & 文字 (保持不变)
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (let i = 0; i < axes.length; i++) {
        const angle = i * angleSlice - Math.PI / 2;
        const x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle);
        
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.stroke();

        const labelDist = radius * 1.25;
        const lx = center.x + labelDist * Math.cos(angle);
        const ly = center.y + labelDist * Math.sin(angle);
        ctx.fillText(axes[i].label, lx, ly);
        }

        // --- [修改点 2] 核心坐标计算函数 ---
        const getPoints = (dataObj) => {
        return axes.map((axis, i) => {
            let val = dataObj[axis.key];
            
            // 容错：如果数据不存在，用 min 兜底，而不是 0
            if (val === undefined || val === null) val = axis.min;

            // 获取该轴的范围
            const min = axis.min;
            const max = axis.max;
            const range = max - min;

            // 计算比例：(当前值 - 最小值) / (最大值 - 最小值)
            // 例如 SPR：(-1.5 - (-3)) / (0.6 - (-3)) = 1.5 / 3.6 = 0.41 (41% 半径处)
            let ratio = (val - min) / range;

            // 钳制在 0~1 之间，防止爆表画到圆外面去
            ratio = Math.max(0, Math.min(1, ratio));

            const r = radius * ratio;
            const angle = i * angleSlice - Math.PI / 2;
            return {
            x: center.x + r * Math.cos(angle),
            y: center.y + r * Math.sin(angle)
            };
        });
        };

        // 3. 绘制全服平均线 (保持不变)
        const avgPoints = getPoints(serverAvg);
        ctx.beginPath();
        avgPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.strokeStyle = '#666';
        ctx.setLineDash([3, 3]); 
        ctx.stroke();
        ctx.setLineDash([]); 

        // 4. 绘制玩家数据 (保持不变)
        const playerPoints = getPoints(radarData);
        ctx.beginPath();
        playerPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#de9b35';
        ctx.stroke();
        ctx.fillStyle = 'rgba(222, 155, 53, 0.4)';
        ctx.fill();

        // 5. 绘制顶点 (保持不变)
        ctx.fillStyle = '#fff';
        playerPoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
        });
        
        // 6. 绘制图例 (Legend) - 可选
        const legendY = height - 15;
        // 平均
        ctx.fillStyle = '#666';
        ctx.fillRect(center.x - 60, legendY, 10, 10);
        ctx.fillText('平均', center.x - 30, legendY + 5);
        // 玩家
        ctx.fillStyle = '#de9b35';
        ctx.fillRect(center.x + 20, legendY, 10, 10);
        ctx.fillText('我的', center.x + 50, legendY + 5);
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