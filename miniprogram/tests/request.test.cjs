const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const settle = () => new Promise(resolve => setImmediate(resolve));
const ok = data => ({ statusCode: 200, data: { code: 200, data } });
const loginResult = (token = 'fixture-new-token', uuid = 'fixture-surviving-uuid') => ok({
  access_token: token, uuid, steam_id: null, is_registered: true,
});

function fixture() {
  const calls = { login: [], request: [], upload: [], storage: [] };
  const storage = new Map();
  const wx = {
    login: options => calls.login.push(options),
    request: options => calls.request.push(options),
    uploadFile: options => calls.upload.push(options),
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => { storage.set(key, value); calls.storage.push(key); },
    removeStorageSync: key => storage.delete(key),
  };
  const context = vm.createContext({ wx, setTimeout, clearTimeout });
  const helper = vm.runInContext(`(function () { const module = {exports:{}};\n${fs.readFileSync(path.join(root, 'utils/request.js'), 'utf8')}\nreturn module.exports; })()`, context);
  let app;
  context.require = name => { assert.equal(name, './utils/request'); return helper; };
  context.App = definition => { app = definition; };
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  return { app, calls, storage };
}

test('concurrent startup requests wait for one login and token storage precedes profile', async () => {
  const { app, calls, storage } = fixture();
  let callbackUser;
  app.userCallback = user => { callbackUser = user; };
  const launched = app.autoLogin();
  const posts = app.request({ url: '/api/v1/posts' });
  const ranks = app.request({ url: '/api/v1/rankings/daily' });
  assert.equal(calls.login.length, 1);
  assert.equal(calls.request.length, 0);
  calls.login[0].success({ code: 'fixture-wx-proof' });
  await settle();
  assert.equal(calls.request.length, 1);
  assert.ok(calls.request[0].url.endsWith('/api/v1/users/login'));
  assert.equal(calls.request[0].header.Authorization, undefined);
  calls.request[0].success(loginResult());
  await settle();
  assert.equal(storage.get('access_token'), 'fixture-new-token');
  assert.equal(storage.get('user_uuid'), 'fixture-surviving-uuid');
  assert.equal(calls.login.length, 1);
  assert.equal(callbackUser, undefined);
  const privateRequests = calls.request.slice(1);
  assert.equal(privateRequests.length, 3);
  privateRequests.forEach(request => {
    assert.equal(request.header.Authorization, 'Bearer fixture-new-token');
    request.success(ok(request.url.endsWith('/users/me') ? { uuid: 'fixture-surviving-uuid', nickname: 'Fixture' } : []));
  });
  await Promise.all([launched, posts, ranks]);
  assert.equal(callbackUser.uuid, 'fixture-surviving-uuid');
});

test('staggered concurrent 401s share one refresh and replay with resolved actor UUID', async () => {
  const { app, calls } = fixture();
  app.acceptLogin({ access_token: 'fixture-old-token', uuid: 'fixture-old-openid' });
  const first = app.request({ url: '/api/v1/users/update', method: 'PUT',
    data: () => ({ openid: app.globalData.actorUuid, nickname: 'Fixture' }) });
  const second = app.request({ url: '/api/v1/notifications/subscribe', method: 'POST',
    data: () => ({ openid: app.globalData.actorUuid, template_id: 'fixture-template' }) });
  await settle();
  assert.equal(calls.request.length, 2);
  assert.equal(calls.request[0].data.openid, 'fixture-old-openid');
  calls.request[0].success({ statusCode: 401, data: {} });
  await settle();
  assert.equal(calls.login.length, 1);
  calls.login[0].success({ code: 'fixture-refresh-proof' });
  await settle();
  calls.request[2].success(loginResult());
  await settle();
  // This old-token failure arrives after the first refresh already finished.
  calls.request[1].success({ statusCode: 401, data: {} });
  await settle();
  assert.equal(calls.login.length, 1);
  const replayed = calls.request.slice(3);
  assert.equal(replayed.length, 2);
  replayed.forEach(request => {
    assert.equal(request.header.Authorization, 'Bearer fixture-new-token');
    assert.equal(request.data.openid, 'fixture-surviving-uuid');
    request.success(ok({}));
  });
  await Promise.all([first, second]);
});

test('a second 401 ends retry and callbacks complete exactly once', async () => {
  const { app, calls } = fixture();
  app.acceptLogin({ access_token: 'fixture-old-token', uuid: 'fixture-user' });
  let successes = 0;
  let completed = 0;
  const pending = app.request({ url: '/api/v1/posts', success: response => {
    successes += 1; assert.equal(response.statusCode, 401);
  }, complete: () => { completed += 1; } });
  await settle();
  calls.request[0].success({ statusCode: 401, data: {} });
  await settle();
  calls.login[0].success({ code: 'fixture-proof' });
  await settle();
  calls.request[1].success(loginResult());
  await settle();
  calls.request[2].success({ statusCode: 401, data: {} });
  const result = await pending;
  assert.equal(result.statusCode, 401);
  assert.equal(calls.login.length, 1);
  assert.equal(calls.request.length, 3);
  assert.equal(successes, 1);
  assert.equal(completed, 1);
});

test('public bootstrap and third-party destinations never receive our Bearer token', async () => {
  const { app, calls } = fixture();
  app.acceptLogin({ access_token: 'fixture-private-token', uuid: 'fixture-user' });
  app._loginPromise = new Promise(() => {}); // Bootstrap must bypass a pending login.
  const targets = [
    '/api/v1/users/login', '/api/v1/users/onboarding',
    'https://trashbox.tech.evil.invalid/api/v1/private',
    'http://trashbox.tech/api/v1/private', 'https://third-party.invalid/api/v1/private',
  ];
  const pending = targets.map(url => app.request({ url, header: { 'X-Fixture': 'yes' } }));
  await settle();
  assert.equal(calls.login.length, 0);
  assert.equal(calls.request.length, targets.length);
  calls.request.forEach(request => {
    assert.equal(request.header.Authorization, undefined);
    assert.equal(request.header['X-Fixture'], 'yes');
    request.success(ok({}));
  });
  await Promise.all(pending);
});

test('avatar upload waits for login and failures expose no native URL/code details', async () => {
  const { app, calls } = fixture();
  const upload = app.uploadFile({ url: '/api/v1/users/avatar', filePath: '/fixture-avatar.png', name: 'file' });
  assert.equal(calls.upload.length, 0);
  calls.login[0].success({ code: 'fixture-proof' });
  await settle();
  calls.request[0].success(loginResult());
  await settle();
  assert.equal(calls.upload.length, 1);
  assert.equal(calls.upload[0].header.Authorization, 'Bearer fixture-new-token');
  calls.upload[0].success({ statusCode: 200, data: '{"code":200}' });
  await upload;
  let failCount = 0;
  let completeCount = 0;
  const failed = app.request({ url: '/api/v1/posts', fail: error => {
    failCount += 1; assert.ok(!error.errMsg.includes('private-code'));
  }, complete: () => { completeCount += 1; } });
  const rejected = assert.rejects(failed, error => !error.message.includes('private-code'));
  await settle();
  calls.request[1].fail({ errMsg: 'request:fail https://fixture.invalid/private-code' });
  await rejected;
  assert.equal(failCount, 1);
  assert.equal(completeCount, 1);
});

test('logout during login prevents the pending result from restoring credentials', async () => {
  const { app, calls, storage } = fixture();
  const pending = app.ensureLogin();
  const rejected = assert.rejects(pending, /登录已取消/);
  calls.login[0].success({ code: 'fixture-proof' });
  await settle();
  app.logout();
  calls.request[0].success(loginResult());
  await rejected;
  assert.equal(app.globalData.accessToken, null);
  assert.equal(app.globalData.actorUuid, null);
  assert.equal(storage.get('access_token'), undefined);
});
