// Per-app API client. Native wx.request remains available for third-party services.
function apiPath(app, url) {
  const base = String(app.globalData.apiBase || '').replace(/\/+$/, '');
  const target = String(url || '');
  if (target.startsWith('/api/v1/')) return target.split(/[?#]/)[0];
  if (!target.startsWith(`${base}/api/v1/`)) return null;
  return target.slice(base.length).split(/[?#]/)[0];
}

function publicPath(path) {
  return path === '/api/v1/users/login' || path === '/api/v1/users/onboarding';
}

function authHeader(header, token) {
  const result = { ...header };
  Object.keys(result).forEach(key => {
    if (key.toLowerCase() === 'authorization') delete result[key];
  });
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

function nativeRequest(method, options) {
  return new Promise((resolve, reject) => {
    wx[method]({ ...options, success: resolve, fail: reject });
  });
}

function send(app, options, nativeMethod) {
  const path = apiPath(app, options.url);
  const authenticated = path !== null && !publicPath(path);
  const execute = async () => {
    let token = authenticated ? await app.ensureLogin() : null;
    const attempt = () => {
      const nativeOptions = { ...options };
      delete nativeOptions.success;
      delete nativeOptions.fail;
      delete nativeOptions.complete;
      if (path !== null) {
        if (String(options.url).startsWith('/')) {
          nativeOptions.url = `${app.globalData.apiBase.replace(/\/+$/, '')}${options.url}`;
        }
        nativeOptions.header = authHeader(options.header, token);
        if (typeof options.data === 'function') nativeOptions.data = options.data();
      }
      return nativeRequest(nativeMethod, nativeOptions);
    };
    let response = await attempt();
    if (authenticated && response.statusCode === 401) {
      // A concurrent request may already have refreshed this rejected token.
      const current = app.globalData.accessToken;
      token = await app.ensureLogin(!current || current === token);
      response = await attempt(); // One retry; a second 401 reaches the caller.
    }
    return response;
  };
  const promise = execute().then(response => {
    try { if (options.success) options.success(response); }
    finally { if (options.complete) options.complete(response); }
    return response;
  }, error => {
    // Do not expose login codes, response bodies or JWTs through callback logs.
    const failure = new Error('登录或网络连接未完成');
    failure.errMsg = 'request:fail 登录或网络连接未完成';
    try { if (options.fail) options.fail(failure); }
    finally { if (options.complete) options.complete(failure); }
    throw failure;
  });
  // Existing wx-style callers use callbacks; Promise callers can still await/reject.
  promise.catch(() => {});
  return promise;
}

module.exports = {
  request: (app, options) => send(app, options, 'request'),
  uploadFile: (app, options) => send(app, options, 'uploadFile'),
};
