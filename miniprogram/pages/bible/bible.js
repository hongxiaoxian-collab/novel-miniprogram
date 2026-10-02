const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    id: '', platform: 'fanqie',
    status: 'none', bible: null,
    characterRoleColor: { 主角: '#07c160', 女主: '#ff7eb3', 反派: '#e57373', 配角: '#888', 导师: '#888' },
  },
  onLoad(q) {
    this.setData({ id: q.id || app.globalData.novelId });
    app.globalData.novelId = this.data.id;
  },
  async onShow() {
    const r = await request(`/novel/${this.data.id}/bible`);
    this.setData({ status: r.bibleStatus, bible: r.bible });
    if (r.bible) {
      this.setData({ platform: (await request(`/novel/${this.data.id}`)).platform });
      wx.nextTick(() => { this.drawRelGraph(); this.drawFactionMap(); });
    }
  },
  goChapters() { wx.navigateTo({ url: `/pages/chapter/chapter?id=${this.data.id}&openDir=1` }); },
  goWrite() { wx.navigateTo({ url: `/pages/chapter/chapter?id=${this.data.id}` }); },

  drawRelGraph() {
    const chars = (this.data.bible.characters || []).filter((c) => c.name);
    if (!chars.length) return;
    this.drawOnCanvas('relCanvas', (ctx, w, h) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 30;
      const n = chars.length;
      const pos = chars.map((_, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
      });
      // 关系连线
      chars.forEach((c, i) => {
        (c.relations || []).forEach((rel) => {
          const j = chars.findIndex((x) => x.name === rel.to);
          if (j < 0) return;
          ctx.strokeStyle = rel.type === '宿敌' ? '#e57373' : '#bbb';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
        });
      });
      // 节点
      chars.forEach((c, i) => {
        const col = this.data.characterRoleColor[c.role] || '#888';
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(pos[i].x, pos[i].y, 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.name.slice(0, 4), pos[i].x, pos[i].y);
      });
    });
  },

  drawFactionMap() {
    const facs = (this.data.bible.factions || []).filter((f) => f.name);
    if (!facs.length) return;
    this.drawOnCanvas('facCanvas', (ctx, w, h) => {
      const colMap = { 正派: '#2b6cff', 反派: '#e53935', 中立: '#07c160' };
      const bw = w - 40, bh = 46, gap = 14;
      facs.forEach((f, i) => {
        const x = 20, y = 16 + i * (bh + gap);
        ctx.fillStyle = (colMap[f.side] || '#888') + '22';
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = colMap[f.side] || '#888'; ctx.lineWidth = 2; ctx.strokeRect(x, y, bw, bh);
        ctx.fillStyle = colMap[f.side] || '#888'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(f.name + '（' + (f.side || '未知') + '）', x + 12, y + bh / 2);
      });
    });
  },

  drawOnCanvas(id, fn) {
    const q = wx.createSelectorQuery();
    q.select('#' + id).fields({ node: true, size: true }).exec((res) => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
      canvas.width = res[0].width * dpr; canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      fn(ctx, res[0].width, res[0].height);
    });
  },
});
