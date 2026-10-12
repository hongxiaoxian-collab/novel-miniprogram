const app = getApp();
const { request } = require('../../utils/request');

/**
 * 【爽点卡】M18 会诊结论。
 * 大纲回答「剧情从哪儿来」，这页回答「读者为什么追」。
 * 写稿时后台会把「本章所在卷」的爽点锚点与存货强制注入提示词，作者不用手动带。
 */
Page({
  data: {
    id: '', platform: 'fanqie',
    status: 'none', card: null, busy: false,
  },
  onLoad(q) {
    this.setData({ id: q.id || app.globalData.novelId });
    app.globalData.novelId = this.data.id;
  },
  async onShow() {
    await this.load();
  },
  async load() {
    try {
      const r = await request(`/novel/${this.data.id}/hype`);
      this.setData({ status: r.status || 'none', card: r.card || null });
      const n = await request(`/novel/${this.data.id}`);
      this.setData({ platform: n.platform || 'fanqie' });
      if (r.card && r.card.core) {
        wx.setNavigationBarTitle({ title: '爽点卡' });
      }
    } catch (e) {
      this.setData({ status: 'none' });
    }
  },
  /** 重跑会诊：大纲改过之后必须重跑，否则爽点还挂在旧卷上 */
  async rebuild() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '会诊中…', mask: true });
    try {
      const c = await request(`/novel/${this.data.id}/hype`, 'POST', {});
      wx.hideLoading();
      if (!c || !c.core) {
        wx.showToast({ title: 'AI 这次给的答案不合格，请再点一次', icon: 'none', duration: 3000 });
      } else {
        wx.showToast({ title: '爽点卡已更新', icon: 'success' });
      }
      await this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: ((e && e.message) || '会诊失败').slice(0, 30), icon: 'none', duration: 3000 });
    }
    this.setData({ busy: false });
  },
  goWrite() { wx.navigateTo({ url: `/pages/chapter/chapter?id=${this.data.id}` }); },
});
