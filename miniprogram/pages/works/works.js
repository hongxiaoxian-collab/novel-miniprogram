const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { getPen, setPen } = require('../../utils/pen');
const { loadMe, loginNow } = require('../../utils/account');
const { waitJob, progOf } = require('../../utils/task');

/** 首次进入的 AI 生成内容声明（只弹一次，版本号变更时会重新弹） */
const AI_NOTICE_KEY = 'aiNoticeV1';
const AI_NOTICE_TEXT =
  '本小程序提供人工智能（AI）辅助创作服务：作品名、大纲、作品简介、封面、人物设定与章节正文均由 AI 生成，仅供参考。\n\n' +
  '发布前请自行核校内容，勿用于违法违规或侵犯他人权益的用途。';

Page({
  data: {
    platform: 'fanqie',
    novels: [],     // 在写（该平台最多 1 部）
    rejected: [],   // 被拒的（不占名额，留着当样本与教训）
    archived: [],   // 已归档（老作品升级过来的，不占名额但一律保留、可转回在写）
    pen: '',
    acct: null,
    prog: { show: false, pct: 0, done: 0, total: 0, current: '', steps: [], stage: '' },
    busy: false,
  },
  onShow() {
    this.setData({ platform: app.globalData.platform, pen: getPen() });
    this.loadNovels();
    this.loadAccount();
    this.aiNotice();
  },
  /** 顶部账号条：登录态 + 当前等级 + 作品数。以前登录是"隐形"的，作者根本看不到自己登没登 */
  async loadAccount() {
    try {
      const acct = await loadMe();
      this.setData({ acct });
      // 【新架构】首次进入强制走开书向导：下载 App → 注册 → 实名 → 笔名 → 未签约 → 一键开书。
      // 登录用户以后端为准（换手机也只走一次）；游客看本地，避免每次进来都被拦。
      const remote = acct && acct.onboard && acct.onboard.onboarded;
      const local = !!wx.getStorageSync('onboardDone');
      if (!remote && !local) wx.redirectTo({ url: '/pages/onboard/onboard' });
    } catch (e) { /* 静默：账号信息拿不到不影响写稿 */ }
  },
  async onLogin() {
    const r = await loginNow();
    if (!r.ok) { wx.showToast({ title: r.msg || '登录失败', icon: 'none', duration: 2500 }); return; }
    await this.loadAccount();
    await this.loadNovels(); // 登录后能看到自己名下的作品（含刚认领的游客作品）
    wx.showToast({
      title: r.claimed ? `已登录，归拢了 ${r.claimed} 本作品` : '已登录',
      icon: 'none', duration: 2500,
    });
  },
  /** 首次进入的 AI 生成声明：让用户明确知悉「内容由 AI 生成」 */
  aiNotice() {
    if (wx.getStorageSync(AI_NOTICE_KEY)) return;
    try { wx.setStorageSync(AI_NOTICE_KEY, 1); } catch (e) { /* 写不上就下次再弹 */ }
    wx.showModal({
      title: 'AI 生成内容说明',
      content: AI_NOTICE_TEXT,
      showCancel: false,
      confirmText: '我知道了',
    });
  },
  /**
   * 列表按「在写 / 已拒」分开。
   * 每个平台同时只准 1 部在写，被拒的自动腾出名额 —— 但被拒稿要留着：
   * 它带着平台真实的驳回原因，是下次开书最重要的避坑依据。
   */
  async loadNovels() {
    try {
      const list = await request(`/novel?platform=${this.data.platform}`);
      const all = list || [];
      this.setData({
        novels: all.filter((n) => (n.status || 'writing') === 'writing'),
        rejected: all.filter((n) => n.status === 'rejected'),
        archived: all.filter((n) => n.status === 'archived'),
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },
  onPlatformChange(e) {
    app.globalData.platform = e.detail.platform;
    try { wx.setStorageSync('platform', e.detail.platform); } catch (err) { /* 忽略 */ }
    this.setData({ platform: e.detail.platform });
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: e.detail.platform === 'qimao' ? '#2b6cff' : '#07c160',
    });
    this.loadNovels();
  },
  /** 全局笔名：只在这里确认一次，之后建作品 / 生成封面自动带上 */
  editPen() {
    wx.showModal({
      title: '设置笔名',
      content: '番茄和七猫都要求封面出现「书名 + 笔名」，这里定一次，后面所有作品自动带上。',
      editable: true,
      placeholderText: '例如：青山不改',
      confirmText: '保存',
      success: (r) => {
        if (!r.confirm) return;
        const v = (r.content || '').trim();
        if (!v) { wx.showToast({ title: '笔名不能为空', icon: 'none' }); return; }
        this.setData({ pen: setPen(v) });
        wx.showToast({ title: '笔名已保存', icon: 'success' });
      },
    });
  },
  /**
   * 归档作品转回「在写」。
   * 老作品升级后被归档了，作者想接着写它时点这个 —— 会先确认该平台没有别的在写作品。
   */
  async backToWriting(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title || '这部作品';
    if ((this.data.novels || []).length > 0) {
      wx.showToast({ title: '该平台已有一部在写的作品，先把它标记被拒或归档', icon: 'none', duration: 2800 });
      return;
    }
    wx.showLoading({ title: '转回在写…', mask: true });
    try {
      await request(`/novel/${id}`, 'PUT', { status: 'writing' });
      wx.hideLoading();
      wx.showToast({ title: '已转回在写', icon: 'success' });
      this.loadNovels();
      this.loadAccount();
    } catch (err) {
      wx.hideLoading();
      const msg = (err && err.message) || '操作失败';
      wx.showToast({ title: msg.slice(0, 30), icon: 'none', duration: 2800 });
    }
  },

  /**
   * 【被拒了 → 自动重开一本】
   * 旧作品保留（带着驳回原因当样本），该平台名额腾出后立刻开一本新的，
   * AI 会拿到"上一部为什么被拒"，强制换方向，而不是只换个书名重写一遍。
   */
  async restart(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title || '这部作品';
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '被拒后自动重开一本',
        content: `《${title}》会保留在下面（驳回原因一起留档，作为以后开书的避坑依据）。\n\n现在在同一平台开一部新书，AI 会避开这次被拒的原因重新定书名、题材和大纲。要开始吗？`,
        confirmText: '开新书',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!res) return;
    this.setData({ busy: true, prog: progOf('被拒重开一本', { steps: [], stage: 'running' }) });
    wx.showLoading({ title: '正在开新书…', mask: true });
    try {
      const r = await request(`/novel/${id}/restart`, 'POST', {});
      app.globalData.novelId = r.id;
      wx.hideLoading();
      await waitJob(r.id, (p) => this.setData({ prog: progOf('被拒重开一本', p) }), 20 * 60 * 1000);
      wx.showToast({ title: '新书已开好', icon: 'success' });
      this.setData({ prog: { show: false, steps: [] } });
      this.loadNovels();
      wx.navigateTo({ url: `/pages/intro/intro?id=${r.id}` });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: ((err && err.message) || '开新书失败').slice(0, 30), icon: 'none', duration: 3000 });
    }
    this.setData({ busy: false });
  },

  // 新建小说 = 全新一本：带 fresh=1 进去，向导页不会再恢复上一部作品的草稿
  // （以前不带参数，进去会自动恢复上次没走完的进度，作者点"新建"却看到旧小说，以为删不掉）
  goWizard() {
    // 同平台最多 1 部在写：已有就直接说明，别让作者点进去填半天才被后端一句"超限"打回
    if ((this.data.novels || []).length > 0) {
      wx.showToast({
        title: '同平台最多 1 部在写。这部被拒就去作品页点「被拒」，会自动重开一本',
        icon: 'none', duration: 3000,
      });
      return;
    }
    wx.navigateTo({ url: '/pages/wizard/wizard?fresh=1' });
  },
  goOnboard() { wx.navigateTo({ url: '/pages/onboard/onboard' }); },
  goGuide() { wx.navigateTo({ url: '/pages/guide/guide' }); },
  goMe() { wx.navigateTo({ url: '/pages/me/me' }); },
  /**
   * 点作品分流：没生成《全书脉络》的作品进「作品资料页」会无路可走（无章节、续更卡住），
   * 所以先回到向导第④步把大纲和定版走完。
   */
  goIntro(e) {
    const nov = e.currentTarget.dataset.nov || {};
    const id = nov.id || e.currentTarget.dataset.id;
    if (!id) return;
    app.globalData.novelId = id;
    const done = nov.bibleStatus === 'done';
    wx.navigateTo({
      url: done ? `/pages/intro/intro?id=${id}` : `/pages/wizard/wizard?id=${id}&step=4`,
    });
  },
  /** 导出整部小说为 Word：后端出 .docx，小程序下载后直接用微信内置预览打开（可转发/保存） */
  exportWord(e) {
    const nov = e.currentTarget.dataset.nov || {};
    if (!nov.id) return;
    wx.showLoading({ title: '生成 Word…', mask: true });
    wx.downloadFile({
      url: `${app.globalData.baseUrl}/novel/${nov.id}/export`,
      timeout: 120000,
      success: (r) => {
        wx.hideLoading();
        if (r.statusCode !== 200) { wx.showToast({ title: `导出失败(${r.statusCode})`, icon: 'none' }); return; }
        wx.openDocument({
          filePath: r.tempFilePath,
          fileType: 'docx',
          showMenu: true, // 右上角「…」可转发给微信好友 / 用其他应用打开
          fail: () => this.exportFallback(nov),
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败，检查后端', icon: 'none' }); },
    });
  },
  /** 兜底：设备打不开 docx 时，把整部小说文字复制到剪贴板 */
  exportFallback(nov) {
    wx.showModal({
      title: '打不开 Word 文件',
      content: '可以改成把整部小说的文字复制出来，粘贴到 Word / 备忘录里。要复制吗？',
      confirmText: '复制全文',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '整理全文…', mask: true });
        try {
          const vols = await request(`/novel/${nov.id}/chapters`);
          const lines = [`《${nov.title}》`, ''];
          (vols || []).forEach((v) => {
            lines.push(`—— 第 ${v.volume} 卷 ——`);
            (v.chapters || []).forEach((c) => {
              lines.push('', `第 ${c.order} 章 ${c.title}`, c.content || '（本章尚未创作）');
            });
          });
          wx.hideLoading();
          copy(lines.join('\n'), `已复制整部小说（约 ${lines.join('').length} 字）`);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '获取正文失败', icon: 'none' });
        }
      },
    });
  },
  copy(e) { copy(e.currentTarget.dataset.text); },
  delNovel(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title || '该作品';
    wx.showModal({
      title: '删除作品',
      content: `确定删除《${title}》？其下所有章节会一并删除，且不可恢复。`,
      confirmColor: '#e64340',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中…' });
        try {
          await request(`/novel/${id}`, 'DELETE');
          if (app.globalData.novelId === id) app.globalData.novelId = '';
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadNovels();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },
});
