const api = require('./utils/request');

App({
  globalData: {
    userInfo: null,
    hasLogin: false,
    accessToken: null,
    actorUuid: null, // Server-resolved UUID; it may differ from the WeChat OpenID.
    apiBase: 'https://trashbox.tech'
  },
  _loginPromise: null,
  _loginGeneration: 0,

  onLaunch() {
    this.globalData.accessToken = wx.getStorageSync('access_token') || null;
    this.globalData.actorUuid = wx.getStorageSync('user_uuid') || null;
    this.autoLogin().catch(() => {});
  },

  request(options) {
    return api.request(this, options);
  },

  uploadFile(options) {
    return api.uploadFile(this, options);
  },

  acceptLogin(result) {
    if (!result || !result.access_token || !result.uuid) {
      throw new Error('登录结果不完整，请重试');
    }
    // Store the token and canonical actor before any private API/profile request.
    this.globalData.accessToken = result.access_token;
    this.globalData.actorUuid = result.uuid;
    wx.setStorageSync('access_token', result.access_token);
    wx.setStorageSync('user_uuid', result.uuid);
    const prior = this.globalData.userInfo;
    this.globalData.userInfo = {
      ...(prior && prior.uuid === result.uuid ? prior : {}),
      uuid: result.uuid,
      steam_id: result.steam_id || null
    };
    this.globalData.hasLogin = true;
    return result.access_token;
  },

  ensureLogin(force = false) {
    if (this._loginPromise) return this._loginPromise;
    if (!force && this.globalData.accessToken) return Promise.resolve(this.globalData.accessToken);
    const generation = this._loginGeneration;
    let promise;
    promise = new Promise((resolve, reject) => {
      wx.login({
        success: result => result.code ? resolve(result.code) : reject(new Error('微信登录未完成')),
        fail: () => reject(new Error('微信登录未完成'))
      });
    }).then(code => this.request({
      url: `${this.globalData.apiBase}/api/v1/users/login`,
      method: 'POST',
      data: { loginCode: code }
    })).then(response => {
      if (generation !== this._loginGeneration) throw new Error('登录已取消');
      if (response.statusCode !== 200 || !response.data || response.data.code !== 200) {
        throw new Error('登录服务暂不可用');
      }
      return this.acceptLogin(response.data.data);
    }).catch(error => {
      if (generation === this._loginGeneration) {
        this.globalData.accessToken = null;
        this.globalData.actorUuid = null;
        this.globalData.hasLogin = false;
        this.globalData.userInfo = null;
        wx.removeStorageSync('access_token');
        wx.removeStorageSync('user_uuid');
      }
      throw error;
    }).finally(() => {
      if (this._loginPromise === promise) this._loginPromise = null;
    });
    this._loginPromise = promise;
    return promise;
  },

  fetchUserInfo() {
    return this.request({
      url: `${this.globalData.apiBase}/api/v1/users/me`,
      method: 'GET'
    }).then(response => {
      if (response.statusCode !== 200 || !response.data || response.data.code !== 200) {
        if (response.statusCode === 401) this.logout();
        throw new Error('无法读取账号资料');
      }
      this.globalData.userInfo = response.data.data;
      this.globalData.actorUuid = response.data.data.uuid;
      this.globalData.hasLogin = true;
      if (this.userCallback) this.userCallback(response.data.data);
      return response.data.data;
    });
  },

  autoLogin() {
    return this.ensureLogin(true).then(() => this.fetchUserInfo()).catch(error => {
      if (!this.globalData.accessToken && this.userCallback) this.userCallback(null);
      throw error;
    });
  },

  logout() {
    this._loginGeneration += 1;
    this._loginPromise = null;
    wx.removeStorageSync('user_uuid');
    wx.removeStorageSync('access_token');
    this.globalData.userInfo = null;
    this.globalData.hasLogin = false;
    this.globalData.accessToken = null;
    this.globalData.actorUuid = null;
  }
});
