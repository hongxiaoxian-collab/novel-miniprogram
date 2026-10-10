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
    guestKey: '',       // 游客匿名标识（未登录时用它统计自己的用量）
    me: null,           // 我的信息：等级 / 到期 / 用量
    plan: null,         // 当前生效套餐（含 limits）
    loggedIn: false,
  },
  onLaunch() {
    try {
      this.globalData.platform = wx.getStorageSync('platform') || 'fanqie';
      this.globalData.penName = wx.getStorageSync('penName') || '';
      this.globalData.authorIntro = wx.getStorageSync('authorIntro') || '';
      this.globalData.token = wx.getStorageSync('token') || '';
    } catch (e) { /* 首次启动无缓存 */ }
    this.ensureGuestKey();
    this.login();
  },

  /**
   * 游客匿名标识。第一次进小程序时生成一个随机串存本地，之后一直复用。
   * 它不能反推到具体的人（只是随机串），也不上传任何设备信息 —— 只用来把
   * "这个游客建的作品/写的章节"归到一起，好算他自己的配额。
   */
  ensureGuestKey() {
    let k = '';
    try { k = wx.getStorageSync('guestKey') || ''; } catch (e) { /* 无缓存 */ }
    if (!k) {
      k = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { wx.setStorageSync('guestKey', k); } catch (e) { /* 存不了就本次会话内有效 */ }
    }
    this.globalData.guestKey = k;
    return k;
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
            this.setLogin(res);
          })
          .catch(() => { /* 静默降级 */ });
      },
      fail: () => { /* 静默降级 */ },
    });
  },

  /**
   * 主动登录（作者点「登录」按钮时调）。和静默登录的唯一区别是会把结果告诉调用方，
   * 好让界面提示"成功 / 为什么失败"—— 以前静默失败了作者只会看到"游客"却不知道怎么修。
   */
  loginNow() {
    return new Promise((resolve) => {
      wx.login({
        success: (r) => {
          if (!r.code) { resolve({ ok: false, msg: '微信登录不可用，请检查网络后重试' }); return; }
          request('/auth/login', 'POST', { code: r.code })
            .then((res) => {
              if (!res || res.enabled === false) {
                resolve({ ok: false, msg: '后端暂未开启登录，功能不受影响' }); return;
              }
              this.setLogin(res);
              resolve({ ok: true, claimed: res.claimed || 0, plan: res.plan || null });
            })
            .catch((e) => resolve({ ok: false, msg: (e && e.message) || '登录失败，请重试' }));
        },
        fail: () => resolve({ ok: false, msg: '微信登录失败，请检查网络后重试' }),
      });
    });
  },

  setLogin(res) {
    this.globalData.token = res.token || '';
    this.globalData.me = res.me || null;
    this.globalData.plan = res.plan || null;
    this.globalData.loggedIn = true;
    try { wx.setStorageSync('token', res.token || ''); } catch (e) { /* 忽略 */ }
  },
});
