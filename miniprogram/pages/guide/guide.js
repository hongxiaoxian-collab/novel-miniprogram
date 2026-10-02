const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { getPen, setPen, getIntro, setIntro } = require('../../utils/pen');

Page({
  data: {
    platform: 'fanqie',
    platformName: '番茄',
    pen: '',          // 当前选定/输入的笔名
    pens: [],         // AI 推荐候选（≥3 个，可换一批）
    penBusy: false,
    intro: '',        // 作者简介（AI 可写可重写，也可自己输入）
    introBusy: false,
    novelId: '',      // 有关联作品时，确认后直接同步过去
    novelTitle: '',
    genre: '',
  },
  onLoad() {
    const p = app.globalData.platform;
    this.setData({
      platform: p,
      platformName: p === 'qimao' ? '七猫' : '番茄',
      pen: getPen(),
      intro: getIntro(),
    });
  },
  /** 带着当前作品进来时，把已有笔名/简介回填，避免重复确认 */
  async onShow() {
    const id = app.globalData.novelId;
    if (!id) return;
    try {
      const n = await request(`/novel/${id}`);
      this.setData({
        novelId: id,
        novelTitle: n.title,
        genre: n.genre || '',
        pen: this.data.pen || n.penName || '',
        intro: this.data.intro || n.authorIntro || '',
      });
    } catch (e) { /* 作品可能已被删除，忽略即可 */ }
  },

  // ---------- 笔名：AI 推荐 ≥3 个，可换一批 ----------
  onPen(e) { this.setData({ pen: e.detail.value }); },
  async recPen() {
    if (this.data.penBusy) return;
    this.setData({ penBusy: true });
    wx.showLoading({ title: this.data.pens.length ? '再想几个…' : 'AI 起笔名…', mask: true });
    try {
      const r = await request('/novel/author-assist', 'POST', {
        platform: this.data.platform,
        kind: 'pen',
        genre: this.data.genre,
        exclude: this.data.pens, // 换一批：让后端避开已给过的名字
      });
      const pens = r.pens || [];
      this.setData({ pens });
      wx.hideLoading();
      if (!pens.length) wx.showToast({ title: '没生成出来，再点一次', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败，再点一次', icon: 'none' });
    }
    this.setData({ penBusy: false });
  },
  usePen(e) { this.setData({ pen: e.currentTarget.dataset.t || '' }); },

  // ---------- 作者简介：AI 写 / 重写 / 自己写 ----------
  onIntro(e) { this.setData({ intro: e.detail.value }); },
  async recIntro() {
    if (this.data.introBusy) return;
    const cur = (this.data.intro || '').trim();
    this.setData({ introBusy: true });
    wx.showLoading({ title: cur ? '重写中…' : 'AI 写简介…', mask: true });
    try {
      const r = await request('/novel/author-assist', 'POST', {
        platform: this.data.platform,
        kind: 'intro',
        genre: this.data.genre,
        opinion: cur ? `换一个写法重写：角度、句式、用词都要和这一版不同，风格仍保持亲和可信。上一版是「${cur}」` : '',
      });
      this.setData({ intro: r.intro || '' });
      wx.hideLoading();
      wx.showToast({ title: '已生成，可继续修改', icon: 'none', duration: 2000 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败，再点一次', icon: 'none' });
    }
    this.setData({ introBusy: false });
  },

  /** 确认：写全局默认 + 直接关联到当前作品（作品资料页 / 封面立刻生效） */
  async confirm() {
    const pen = (this.data.pen || '').trim();
    const intro = (this.data.intro || '').trim();
    if (!pen) { wx.showToast({ title: '先定一个笔名', icon: 'none' }); return; }
    setPen(pen);
    if (intro) setIntro(intro);
    const id = this.data.novelId;
    if (!id) {
      wx.showToast({ title: '已记为默认，之后的作品自动带上', icon: 'none', duration: 2500 });
      return;
    }
    wx.showLoading({ title: '关联到作品…', mask: true });
    try {
      await request(`/novel/${id}`, 'PUT', { penName: pen, authorIntro: intro || undefined });
      wx.hideLoading();
      wx.showToast({ title: `已关联到《${this.data.novelTitle}》`, icon: 'success', duration: 2500 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '已记为默认，稍后可在作品页再保存', icon: 'none', duration: 2500 });
    }
  },

  copy(e) { copy(e.currentTarget.dataset.text); },
  close() { wx.navigateBack(); },
});
