/**
 * 统一请求。
 * 注意：getApp() 必须**延迟**取——app.js 顶部 require 本模块时 App() 还没注册，
 * 顶层就取值会拿到 undefined，后面所有请求都会挂。
 */
function gd() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return (app && app.globalData) || {};
}

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    const g = gd();
    const token = g.token || wx.getStorageSync('token') || '';
    // 游客匿名标识：后端靠它统计"这个游客建了几本、今天写了几章"。
    // 不带上它，所有游客共用一个池，A 建了一本就会把 B 卡死。
    const guestKey = g.guestKey || wx.getStorageSync('guestKey') || '';
    wx.request({
      url: (g.baseUrl || '') + path,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(guestKey ? { 'x-guest-key': guestKey } : {}),
      },
      timeout: 120000, // 写章/重写要 40-90 秒，默认 60 秒会误报失败
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) resolve(res.data);
        else reject(res.data || res);
      },
      fail: reject,
    });
  });
}

module.exports = { request };
