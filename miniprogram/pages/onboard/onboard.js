const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { getPen, setPen } = require('../../utils/pen');
const { waitJob, progOf } = require('../../utils/task');

/**
 * 首次进入的开书向导：下载 App → 注册 → 实名 → 笔名 → 默认未签约 → 一键开书。
 *
 * 为什么强制走一遍：这几步不做，后面开出来的书根本没法投稿（没账号、没实名、封面没笔名会被驳回）。
 * 进度存后端（登录后换手机也只走一次）；游客存本地。
 */
const LOCAL_KEY = 'onboardV1';

Page({
  data: {
    platform: 'fanqie',
    steps: { download: false, register: false, realname: false, pen: false, contract: false },
    pen: '',
    pens: [],
    penBusy: false,
    starting: false,
    prog: { show: false, pct: 0, done: 0, total: 0, current: '', steps: [], stage: '' },
    novelId: '',
  },

  onLoad() {
    const saved = wx.getStorageSync(LOCAL_KEY) || {};
    this.setData({
      platform: app.globalData.platform || 'fanqie',
      pen: getPen() || '',
      steps: Object.assign(this.data.steps, saved.steps || {}),
    });
    this.syncNav();
    this.pullRemote();
  },

  /** 登录后以账号里的进度为准（换设备也只走一次） */
  async pullRemote() {
    try {
      const r = await request('/auth/me');
      const ob = r && r.onboard;
      if (!ob) return;
      const steps = Object.assign({}, this.data.steps, ob.steps || {});
      this.setData({ steps, ...(ob.penName ? { pen: ob.penName } : {}) });
    } catch (e) { /* 拿不到就走本地 */ }
  },

  syncNav() {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: this.data.platform === 'qimao' ? '#2b6cff' : '#07c160',
    });
  },

  pickPlatform(e) {
    const p = e.currentTarget.dataset.p;
    app.globalData.platform = p;
    try { wx.setStorageSync('platform', p); } catch (err) { /* 忽略 */ }
    this.setData({ platform: p });
    this.syncNav();
  },

  copyKw(e) { copy(e.currentTarget.dataset.kw || '', '已复制，去应用商店粘贴搜索'); },

  onPen(e) { this.setData({ pen: e.detail.value }); },
  usePen(e) { this.setData({ pen: e.currentTarget.dataset.t || '' }); },

  async recPen() {
    if (this.data.penBusy) return;
    this.setData({ penBusy: true });
    wx.showLoading({ title: this.data.pens.length ? '再想几个…' : 'AI 起笔名…', mask: true });
    try {
      const r = await request('/novel/author-assist', 'POST', {
        platform: this.data.platform, kind: 'pen', exclude: this.data.pens,
      });
      this.setData({ pens: r.pens || [] });
      wx.hideLoading();
      if (!(r.pens || []).length) wx.showToast({ title: '没生成出来，再点一次', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败，再点一次', icon: 'none' });
    }
    this.setData({ penBusy: false });
  },

  /** 勾掉一步：立刻把笔名/进度同步到后端，作者中途退出也不丢 */
  async ok(e) {
    const step = e.currentTarget.dataset.step;
    if (step === 'pen') {
      const v = (this.data.pen || '').trim();
      if (!v) { wx.showToast({ title: '先填或选一个笔名', icon: 'none' }); return; }
      setPen(v);
      app.globalData.penName = v;
    }
    const steps = Object.assign({}, this.data.steps, { [step]: true });
    this.setData({ steps });
    this.save(steps, step === 'pen');
  },

  async save(steps, withPen) {
    try {
      wx.setStorageSync(LOCAL_KEY, { steps });
      await request('/auth/onboard', 'POST', {
        steps,
        ...(withPen ? { penName: (this.data.pen || '').trim() } : {}),
      });
    } catch (e) { /* 存不下不影响继续 */ }
  },

  /** 一键开书：先结向导，再让 AI 把书名/大纲/全书脉络/时间线/简介/标签/黄金三章/封面一次生成完 */
  async start() {
    const s = this.data.steps;
    const miss = ['download', 'register', 'realname', 'pen', 'contract'].filter((k) => !s[k]);
    if (miss.length) {
      const name = { download: '下载 App', register: '注册', realname: '实名', pen: '笔名', contract: '签约状态' }[miss[0]];
      wx.showToast({ title: `先完成：${name}`, icon: 'none', duration: 2200 });
      return;
    }
    const pen = (this.data.pen || '').trim();
    this.setData({ starting: true, prog: progOf('一键开书', { steps: [], stage: 'running' }) });
    wx.showLoading({ title: '正在开书…', mask: true });
    try {
      await request('/auth/onboard', 'POST', { steps: s, penName: pen, done: true });
      // 游客（未登录）没有账号可存，落本地：不然每次进列表都会被重定向回向导
      try { wx.setStorageSync('onboardDone', 1); } catch (err) { /* 忽略 */ }
      const r = await request('/novel/quick-start', 'POST', { platform: this.data.platform, penName: pen });
      const id = r.id;
      this.setData({ novelId: id });
      app.globalData.novelId = id;
      wx.hideLoading();
      // 定位→大纲→脉络+时间线→上架资料→黄金3章→封面，六步串行，留足 30 分钟
      await waitJob(id, (p) => this.setData({ prog: progOf('一键开书', p) }), 30 * 60 * 1000);
      wx.showToast({ title: '开书完成', icon: 'success' });
      this.goIntro();
    } catch (e) {
      wx.hideLoading();
      const msg = (e && e.message) || '开书失败';
      this.setData({ prog: Object.assign({}, this.data.prog, { stage: 'failed', current: msg }) });
      wx.showToast({ title: msg.slice(0, 30), icon: 'none', duration: 3000 });
    }
  },

  goIntro() {
    const id = this.data.novelId;
    if (!id) return;
    wx.redirectTo({ url: `/pages/intro/intro?id=${id}` });
  },
});
