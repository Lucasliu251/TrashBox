const app = getApp();

const STATUS_META = {
  in_match: { label: '疑似对局中', tone: 'danger' },
  in_cs2: { label: 'CS2 中', tone: 'warning' },
  online: { label: 'Steam 在线', tone: 'online' },
  offline: { label: '离线', tone: 'muted' },
  unknown: { label: '未知', tone: 'muted' }
};

const PRESET_TAGS = ['优质队友', '高手', '避免撞车', '疑似外挂', '重点关注'];

Page({
  data: {
    loading: true,
    scanning: false,
    error: '',
    targets: [],
    groups: [],
    tags: [],
    selectedTag: '',
    session: null,
    remainingText: '',
    lastUpdated: '',
    showAddPanel: false,
    resolveValue: '',
    preview: null,
    presetTags: PRESET_TAGS,
    medalOptions: ['未知', '有服役勋章', '无服役勋章'],
    medalValues: ['unknown', 'yes', 'no'],
    addDraft: { alias: '', tags: '', manual_cs_level: '', service_medal: 'unknown', note: '' },
    editingId: null,
    editDraft: null
  },

  onShow() {
    this._visible = true;
    this.initializeRadar();
  },

  onHide() {
    this._visible = false;
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  onPullDownRefresh() {
    this.loadTargets().finally(() => wx.stopPullDownRefresh());
  },

  waitForToken(attempt = 0) {
    return new Promise((resolve, reject) => {
      const token = app.globalData.accessToken || wx.getStorageSync('access_token');
      if (token) return resolve(token);
      if (attempt >= 20) return reject(new Error('请先完成 TrashBox 登录'));
      setTimeout(() => this.waitForToken(attempt + 1).then(resolve).catch(reject), 250);
    });
  },

  async request(path, options = {}) {
    const token = await this.waitForToken();
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${app.globalData.apiBase}${path}`,
        method: options.method || 'GET',
        data: options.data,
        header: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
          else reject(new Error((res.data && res.data.detail) || `请求失败 (${res.statusCode})`));
        },
        fail: () => reject(new Error('网络连接失败'))
      });
    });
  },

  async initializeRadar() {
    if (this._initializing) return;
    this._initializing = true;
    this.setData({ loading: true, error: '' });
    try {
      await this.loadTargets();
      await this.triggerSnapshot();
      await this.loadSession();
      this.startPolling();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this._initializing = false;
      this.setData({ loading: false });
    }
  },

  normalizeTargets(targets) {
    const groupCounts = {};
    targets.forEach(target => {
      if (target.group_key) groupCounts[target.group_key] = (groupCounts[target.group_key] || 0) + 1;
    });
    return targets.map(target => {
      const meta = STATUS_META[target.status] || STATUS_META.unknown;
      const observed = target.observed_at ? new Date(target.observed_at) : null;
      return {
        ...target,
        displayName: target.alias || target.personaname || target.steam_id,
        statusLabel: meta.label,
        statusTone: meta.tone,
        tags: Array.isArray(target.tags) ? target.tags : [],
        risk_signals: Array.isArray(target.risk_signals) ? target.risk_signals : [],
        playtimeHours: target.cs2_playtime_minutes == null ? '未知' : Math.round(target.cs2_playtime_minutes / 60),
        sameMatchCount: target.group_key ? groupCounts[target.group_key] || 0 : 0,
        observedText: observed && !Number.isNaN(observed.getTime()) ? this.formatTime(observed) : '尚未扫描'
      };
    });
  },

  buildGroups(targets) {
    const filtered = this.data.selectedTag ? targets.filter(target => target.tags.includes(this.data.selectedTag)) : targets;
    const order = ['in_match', 'in_cs2', 'online', 'offline', 'unknown'];
    return order.map(status => ({
      status,
      label: STATUS_META[status].label,
      tone: STATUS_META[status].tone,
      items: filtered.filter(target => (target.status || 'unknown') === status)
    })).filter(group => group.items.length > 0);
  },

  applyTargets(rawTargets) {
    const targets = this.normalizeTargets(rawTargets || []);
    const tagSet = new Set();
    targets.forEach(target => target.tags.forEach(tag => tagSet.add(tag)));
    this.setData({
      targets,
      tags: Array.from(tagSet),
      groups: this.buildGroups(targets),
      lastUpdated: this.formatTime(new Date())
    });
  },

  async loadTargets() {
    const response = await this.request('/api/v1/radar/targets');
    this.applyTargets(response.data || []);
  },

  async triggerSnapshot() {
    this.setData({ scanning: true });
    try {
      const response = await this.request('/api/v1/radar/snapshot', { method: 'POST' });
      if (response.data && response.data.targets) this.applyTargets(response.data.targets);
      if (response.data && response.data.session) this.setSession(response.data.session);
    } finally {
      this.setData({ scanning: false });
    }
  },

  async loadSession() {
    const response = await this.request('/api/v1/radar/sessions');
    this.setSession(response.data || null);
  },

  setSession(session) {
    this.setData({ session });
    this.updateRemaining();
  },

  async startContinuousScan() {
    this.setData({ scanning: true, error: '' });
    try {
      const response = await this.request('/api/v1/radar/sessions', {
        method: 'POST',
        data: { duration_seconds: 600 }
      });
      this.setSession(response.data);
      wx.showToast({ title: response.joined ? '已加入扫描' : 'Radar 已开启', icon: 'success' });
      this.startPolling();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ scanning: false });
    }
  },

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(async () => {
      if (!this._visible) return;
      try {
        await Promise.all([this.loadTargets(), this.loadSession()]);
      } catch (error) {
        this.setData({ error: error.message });
      }
    }, 5000);
    this._clockTimer = setInterval(() => this.updateRemaining(), 1000);
  },

  stopPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._clockTimer) clearInterval(this._clockTimer);
    this._pollTimer = null;
    this._clockTimer = null;
  },

  updateRemaining() {
    if (!this.data.session || !this.data.session.expires_at) {
      this.setData({ remainingText: '' });
      return;
    }
    const seconds = Math.max(0, Math.ceil((new Date(this.data.session.expires_at).getTime() - Date.now()) / 1000));
    this.setData({ remainingText: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` });
  },

  selectTag(e) {
    const tag = e.currentTarget.dataset.tag || '';
    const selectedTag = this.data.selectedTag === tag ? '' : tag;
    this.setData({ selectedTag }, () => this.setData({ groups: this.buildGroups(this.data.targets) }));
  },

  toggleAddPanel() {
    this.setData({ showAddPanel: !this.data.showAddPanel, preview: null, error: '' });
  },

  async readClipboard() {
    try {
      const clipboard = await new Promise((resolve, reject) => wx.getClipboardData({ success: resolve, fail: reject }));
      const value = (clipboard.data || '').trim();
      if (!value) throw new Error('剪贴板为空');
      this.setData({ resolveValue: value });
      await this.resolveTarget();
    } catch (error) {
      this.setData({ error: error.message || '无法读取剪贴板' });
    }
  },

  onResolveInput(e) { this.setData({ resolveValue: e.detail.value }); },

  async resolveTarget() {
    if (!this.data.resolveValue.trim()) return;
    this.setData({ scanning: true, error: '' });
    try {
      const response = await this.request('/api/v1/radar/resolve', {
        method: 'POST',
        data: { value: this.data.resolveValue.trim() }
      });
      this.setData({ preview: response.data, 'addDraft.alias': response.data.personaname || '' });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ scanning: false });
    }
  },

  updateAddField(e) { this.setData({ [`addDraft.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  updateAddMedal(e) { this.setData({ 'addDraft.service_medal': this.data.medalValues[Number(e.detail.value)] }); },

  async confirmAdd() {
    if (!this.data.preview) return;
    const draft = this.data.addDraft;
    try {
      await this.request('/api/v1/radar/targets', {
        method: 'POST',
        data: {
          steam_id: this.data.preview.steam_id,
          alias: draft.alias.trim() || null,
          tags: draft.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
          note: draft.note.trim() || null,
          manual_cs_level: draft.manual_cs_level === '' ? null : Number(draft.manual_cs_level),
          service_medal: draft.service_medal
        }
      });
      this.setData({
        showAddPanel: false,
        preview: null,
        resolveValue: '',
        addDraft: { alias: '', tags: '', manual_cs_level: '', service_medal: 'unknown', note: '' }
      });
      await this.triggerSnapshot();
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  beginEdit(e) {
    const target = this.data.targets.find(item => item.id === Number(e.currentTarget.dataset.id));
    if (!target) return;
    this.setData({
      editingId: target.id,
      editDraft: {
        alias: target.alias || '',
        tags: target.tags.join(', '),
        manual_cs_level: target.manual_cs_level == null ? '' : String(target.manual_cs_level),
        service_medal: target.service_medal || 'unknown',
        note: target.note || ''
      }
    });
  },

  updateEditField(e) { this.setData({ [`editDraft.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  updateEditMedal(e) { this.setData({ 'editDraft.service_medal': this.data.medalValues[Number(e.detail.value)] }); },
  cancelEdit() { this.setData({ editingId: null, editDraft: null }); },

  async saveEdit() {
    const draft = this.data.editDraft;
    try {
      await this.request(`/api/v1/radar/targets/${this.data.editingId}`, {
        method: 'PATCH',
        data: {
          alias: draft.alias.trim() || null,
          tags: draft.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
          note: draft.note.trim() || null,
          manual_cs_level: draft.manual_cs_level === '' ? null : Number(draft.manual_cs_level),
          service_medal: draft.service_medal
        }
      });
      this.cancelEdit();
      await this.loadTargets();
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  removeTarget(e) {
    const targetId = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '移出 Radar？',
      content: '该玩家的共享标注和扫描记录将被删除。',
      success: async result => {
        if (!result.confirm) return;
        try {
          await this.request(`/api/v1/radar/targets/${targetId}`, { method: 'DELETE' });
          await this.loadTargets();
        } catch (error) {
          this.setData({ error: error.message });
        }
      }
    });
  },

  scanWebLogin() {
    wx.scanCode({
      onlyFromCamera: false,
      success: async result => {
        const match = String(result.result || '').match(/^trashbox:\/\/web-login\/(.+)$/);
        if (!match) return wx.showToast({ title: '不是 TrashBox 登录码', icon: 'none' });
        try {
          await this.request(`/api/v1/web-auth/challenges/${encodeURIComponent(match[1])}/confirm`, { method: 'POST' });
          wx.showToast({ title: '登录已确认', icon: 'success' });
        } catch (error) {
          this.setData({ error: error.message });
        }
      }
    });
  },

  formatTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }
});
