const { request } = require('./utils/request');

App({
  globalData: {
    // 测试服后端地址（部署后改这里；微信开发者工具里需在本小程序「开发设置」勾选不校验合法域名）
    baseUrl: 'http://120.79.174.44:3001',
    platform: 'fanqie', // fanqie | qimao
    novelId: '',        // 当前作品
    chapterId: '',      // 当前章节
    penName: '',        // 全局笔名（两平台封面硬性要求，只确认一次）
    authorIntro: '',    // 全局作者简介（作家页/上架资料用，只确认一次）
    token: '',          // 登录凭证（后端返回，本地缓存一份）
    me: null,           // 我的信息：等级 / 到期 / 用量
  },
  onLaunch() {
    try {
      this.globalData.platform = wx.getStorageSync('platform') || 'fanqie';
      this.globalData.penName = wx.getStorageSync('penName') || '';
      this.globalData.authorIntro = wx.getStorageSync('authorIntro') || '';
      this.globalData.token = wx.getStorageSync('token') || '';
    } catch (e) { /* 首次启动无缓存 */ }
    this.login();
  },

  /**
   * 静默登录：只换 openid，不弹任何授权框、不要头像昵称手机号（最小必要原则）。
   * 任何一步失败都静默降级为游客 —— 登录是为了数据隔离，绝不能因为登录失败就用不了写稿。
   */
  login() {
    wx.login({
      success: (r) => {
        if (!r.code) return;
        request('/auth/login', 'POST', { code: r.code })
          .then((res) => {
            // enabled=false：后端没配小程序密钥，整套账号功能停用，行为与加登录前完全一致
            if (!res || res.enabled === false) return;
            this.globalData.token = res.token;
            this.globalData.me = res.me;
            wx.setStorageSync('token', res.token);
          })
          .catch(() => { /* 静默降级 */ });
      },
      fail: () => { /* 静默降级 */ },
    });
  },
});
