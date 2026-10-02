const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    novelId: '', novelTitle: '', hasBible: false,
    instruction: '', loading: false, result: '', wordCount: 2000,
    tags: ['扫榜选题', '黄金三章', '六大状态锁', '十维审查', '情绪曲线', '去AI润色'],
  },
  async onShow() {
    const id = app.globalData.novelId;
    if (!id) { wx.showToast({ title: '请先选择作品', icon: 'none' }); return; }
    this.setData({ novelId: id });
    const nov = await request(`/novel/${id}`);
    this.setData({ novelTitle: nov.title, hasBible: nov.bibleStatus === 'done', wordCount: nov.chapterWords || 2000 });
  },
  onInput(e) { this.setData({ instruction: e.detail.value }); },
  onWords(e) { this.setData({ wordCount: Number(e.detail.value) || 2000 }); },
  async send() {
    if (!this.data.instruction.trim()) { wx.showToast({ title: '请输入写稿指令', icon: 'none' }); return; }
    if (!this.data.hasBible) { wx.showToast({ title: '请先定版生成全书脉络', icon: 'none' }); return; }
    this.setData({ loading: true, result: '' });
    wx.showLoading({ title: '扣子写稿中…' });
    try {
      const ch = await request(`/novel/${this.data.novelId}/chapter`, 'POST', { instruction: this.data.instruction, wordCount: this.data.wordCount });
      this.setData({ result: `第${ch.order}章 ${ch.title}\n\n${ch.content || ''}`, loading: false });
      wx.hideLoading();
      wx.showToast({ title: '已生成，去章节页查看', icon: 'success' });
    } catch (e) {
      this.setData({ loading: false });
      wx.hideLoading();
      wx.showToast({ title: '生成失败，检查后端/Coze 配置', icon: 'none' });
    }
  },
});
