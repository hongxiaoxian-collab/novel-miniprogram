const { request } = require('../../utils/request');

Page({
  data: {
    loading: true,
    loggedIn: false,
    me: null,
    plan: null,
    limits: null,
    usage: null,
    novelCount: 0,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      const r = await request('/auth/me');
      this.setData({
        loading: false,
        loggedIn: !!r.loggedIn,
        me: r.me || null,
        plan: r.plan || null,
        limits: r.limits || null,
        usage: r.usage || null,
        novelCount: r.novelCount || 0,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  /** 打开微信官方隐私指引（内容来自后台配置的《用户隐私保护指引》） */
  openPrivacy() {
    if (!wx.openPrivacyContract) {
      wx.showToast({ title: '当前版本不支持', icon: 'none' });
      return;
    }
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '后台尚未配置隐私指引', icon: 'none' }),
    });
  },

  /** 注销：删掉账号和名下全部作品，不可恢复，必须二次确认 */
  destroy() {
    const that = this;
    wx.showModal({
      title: '注销账号',
      content: '将永久删除你的全部作品、章节和体检记录，且无法恢复。建议先导出作品再注销。确定继续吗？',
      confirmText: '确认注销',
      confirmColor: '#e64340',
      success(res) {
        if (!res.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '这是最后一次确认，点击确认后数据立即删除。',
          confirmText: '我已备份，删除',
          confirmColor: '#e64340',
          success(r2) {
            if (!r2.confirm) return;
            request('/auth/me', 'DELETE', {})
              .then((ret) => {
                wx.removeStorageSync('token');
                getApp().globalData.token = '';
                getApp().globalData.me = null;
                wx.showToast({ title: `已注销，删除 ${ret.deletedNovels} 部作品`, icon: 'none', duration: 2500 });
                setTimeout(() => wx.reLaunch({ url: '/pages/works/works' }), 1500);
              })
              .catch(() => wx.showToast({ title: '注销失败，请重试', icon: 'none' }));
          },
        });
      },
    });
  },

  goBack() { wx.navigateBack(); },
});
