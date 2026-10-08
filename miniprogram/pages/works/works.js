const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { getPen, setPen } = require('../../utils/pen');

/** 首次进入的 AI 生成内容声明（只弹一次，版本号变更时会重新弹） */
const AI_NOTICE_KEY = 'aiNoticeV1';
const AI_NOTICE_TEXT =
  '本小程序提供人工智能（AI）辅助创作服务：作品名、大纲、作品简介、封面、人物设定与章节正文均由 AI 生成，仅供参考。\n\n' +
  '发布前请自行核校内容，勿用于违法违规或侵犯他人权益的用途。';

Page({
  data: { platform: 'fanqie', novels: [], pen: '' },
  onShow() {
    this.setData({ platform: app.globalData.platform, pen: getPen() });
    this.loadNovels();
    this.aiNotice();
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
  async loadNovels() {
    try {
      const list = await request(`/novel?platform=${this.data.platform}`);
      this.setData({ novels: list || [] });
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
  // 新建小说 = 全新一本：带 fresh=1 进去，向导页不会再恢复上一部作品的草稿
  // （以前不带参数，进去会自动恢复上次没走完的进度，作者点"新建"却看到旧小说，以为删不掉）
  goWizard() { wx.navigateTo({ url: '/pages/wizard/wizard?fresh=1' }); },
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
