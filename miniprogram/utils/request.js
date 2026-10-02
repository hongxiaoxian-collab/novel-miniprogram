const app = getApp();
function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: (app.globalData.baseUrl || '') + path,
      method,
      data,
      header: { 'Content-Type': 'application/json' },
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
