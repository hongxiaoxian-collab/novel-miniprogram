const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { runFinalize, runningText, waitJob, progOf } = require('../../utils/task');
const { getPen, setPen, getIntro, setIntro } = require('../../utils/pen');
const { isOwnerAccount } = require('../../utils/account');
const coverLib = require('../../utils/cover');

const READ_LABELS = ['主分类', '主题', '角色', '情节'];
const CONTENT_LABELS = ['情节', '情感', '人设', '世界观'];

// 封面虚拟画布：所有坐标按 600×800 写死，绘制时按实际尺寸等比缩放
const VW = 600;
const VH = 800;
const COVER_STYLES = 3; // 版式：居中经典 / 中部白带 / 左对齐大标题
// 两平台上传规格都是 600×800（3:4，≤5MB）；番茄要求含书名+笔名，七猫要求含书名+笔名+站点标识
const COVER_SIZE = { fanqie: [600, 800], qimao: [600, 800] };

/**
 * 封面配色（每组 2 套，供「换一换」切换）
 * bg 背景渐变 / accent 点缀 / cloth 衣服 / inner 内衬 / skin 肤色 / hair 发色
 */
const THEMES = [
  { k: ['悬疑', '灵异', '惊悚', '诡异', '推理'], c: [
    { bg: ['#191b22', '#383c47'], accent: '#c3ccdb', cloth: '#14161d', inner: '#e6e9ef', skin: '#eccfae', hair: '#171520' },
    { bg: ['#151520', '#3f3f52'], accent: '#d6d9e6', cloth: '#101018', inner: '#e9ebf2', skin: '#eccfae', hair: '#141420' },
  ] },
  { k: ['玄幻', '仙侠', '修真', '武侠'], c: [
    { bg: ['#221047', '#5b3fa8'], accent: '#cbb2ff', cloth: '#1a1033', inner: '#efe7ff', skin: '#f0cfae', hair: '#1b1229' },
    { bg: ['#2a1050', '#8a5fd0'], accent: '#e0d0ff', cloth: '#200f3e', inner: '#f3edff', skin: '#f0cfae', hair: '#1b1229' },
  ] },
  { k: ['科幻', '末世', '星际', '机械', '机甲', '赛博', '废土'], c: [
    { bg: ['#061428', '#10405e'], accent: '#55e6ff', cloth: '#0a1c2e', inner: '#d9f6ff', skin: '#e8cdb4', hair: '#101a26' },
    { bg: ['#0b2b2a', '#1f7a6a'], accent: '#7ff0d8', cloth: '#0a2322', inner: '#dcf7f1', skin: '#e8cdb4', hair: '#111d1c' },
  ] },
  { k: ['历史', '古代', '民国', '年代'], c: [
    { bg: ['#3b2a3f', '#7d6480'], accent: '#e2c9d8', cloth: '#2c1d2f', inner: '#f4e9f0', skin: '#f2d4b6', hair: '#181420' },
    { bg: ['#3a241d', '#8a6a52'], accent: '#f0d7b8', cloth: '#2b1a14', inner: '#f7ecdd', skin: '#f2d4b6', hair: '#171310' },
  ] },
  { k: ['古言', '古风', '宫斗', '宅斗', '宫廷'], c: [
    { bg: ['#4a1230', '#93384f'], accent: '#ffc2d4', cloth: '#3a1230', inner: '#f6e7ef', skin: '#f4d6bb', hair: '#1c1220' },
    { bg: ['#3a1220', '#a0526d'], accent: '#ffd0dd', cloth: '#2e0f1a', inner: '#f8eaf1', skin: '#f4d6bb', hair: '#1c1220' },
  ] },
];
// 都市/重生/豪门等现代题材（也含女频现言）
const URBAN = [
  { bg: ['#16233d', '#33507f'], accent: '#8fc0ff', cloth: '#1b2a45', inner: '#eef3fb', skin: '#f0cfae', hair: '#17181f' },
  { bg: ['#2a2440', '#5b4f8a'], accent: '#c9b8ff', cloth: '#221a36', inner: '#f3eefe', skin: '#f0cfae', hair: '#191622' },
];

const FEMALE_KW = ['女频', '女生', '甜宠', '总裁', '古言', '现言', '宫斗', '宅斗', '豪门', '婚恋', '医妃', '王妃', '千金'];
const ANCIENT_KW = ['玄幻', '仙侠', '修真', '武侠', '历史', '古代', '古言', '古风', '宫斗', '宅斗', '宫廷', '后宫',
  '架空', '江湖', '朝代', '王朝', '王爷', '侯府', '王妃', '民国'];
const SCI_KW = ['科幻', '末世', '星际', '机械', '机甲', '赛博', '废土', '未来'];

// 换行时不允许出现在行首的标点
const PUNCT_HEAD = '：，。、！？；）》」』”';

function hex2rgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** 两个颜色按比例混合，返回 #rrggbb（做暗部/中间调用） */
function mixHex(c1, c2, t) {
  const a = hex2rgb(c1); const b = hex2rgb(c2);
  const v = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `#${v.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
/** 点一下「换一换」是换版式，换满 3 款再把配色也换一套 */
function pickTheme(genre, variant) {
  const g = genre || '';
  const hit = THEMES.find((t) => t.k.some((k) => g.indexOf(k) >= 0));
  const list = hit ? hit.c : URBAN;
  return list[variant % list.length];
}
/** 按 AI 方案里的人物设定生成造型参数（人物造型由情节决定，而不是只按题材猜） */
function figureOfPlan(plan) {
  const f = plan.figure || {};
  return {
    female: f.gender === 'female',
    ancient: f.type === 'ancient',
    type: f.type || 'modern',
    hair: f.hair || 'short',
    outfit: f.outfit || 'worker',
    pose: f.pose || 'hold',
  };
}
/** 按题材与目标读者挑人物造型（男女 / 古装 / 科幻）—— 没有 AI 方案时的兜底 */
function figureOf(nov) {
  const txt = [nov.genre, nov.targetReader, nov.title, nov.outline].filter(Boolean).join(' ');
  const has = (ks) => ks.some((k) => txt.indexOf(k) >= 0);
  const female = has(FEMALE_KW);
  const scient = has(SCI_KW);
  const ancient = has(ANCIENT_KW);
  return {
    female,
    ancient,
    type: scient ? 'sci' : (ancient ? 'ancient' : 'modern'),
    hair: female ? 'long' : (ancient ? 'bun' : 'short'),
  };
}

Page({
  data: {
    id: '', nov: null, platform: 'fanqie', ready: false, hasBible: false,
    openBadge: 0,         // 上次体检还没修的矛盾数（角标提醒）
    coverSeed: 0,         // 老模板封面款式（0-5，无 AI 方案时用）
    coverPlan: null,      // 按情节生成的封面方案（场景/配色/构图/人物/道具）
    coverLayout: '',      // 版式：center / band / side
    coverBusy: false,     // 正在按情节生成封面
    coverImg: '',         // 后端出的「真图」封面 URL（有它就不画 canvas）
    coverPrompt: '',      // 这张真图用的画面脚本（可复现）
    coverTip: '',         // 出图时的进度提示
    penEdit: '',          // 作者笔名（封面必需）
    penList: [],          // AI 推荐的笔名候选（≥3 个，可换一批）
    penBusy: false,
    introEdit: '',        // 作者简介（可 AI 写 / 重写 / 自己写）
    introBusy: false,
    // 默认给全字段，避免后端未就绪时模板取到 undefined
    info: { intro: '', protagonists: [], contractMode: '', serialMode: '', readingTags: null, contentTags: null },
    readingList: [], contentList: [],
    // 「更多操作」默认收起：作者点进来只看到续更 + 被拒 / 过审
    moreOpen: false,
    // 被拒原因浮层
    rejectShow: false,
    rejectText: '',
    quickReasons: [
      '故事矛盾有些欠缺', '看点有些不足', '开篇的切入点缺乏足够的吸引力',
      '人设不够鲜明', '节奏偏慢', '情节套路化', '文字质量不达标', '题材与平台不符',
    ],
    feedbacks: [],   // 历次平台反馈（原始数据，只增不删）
    busyRestart: false,
    prog: { show: false, pct: 0, done: 0, total: 0, current: '', steps: [], stage: '' },
  },
  onLoad(q) {
    this.setData({ id: q.id || app.globalData.novelId });
    app.globalData.novelId = this.data.id;
  },
  async onShow() {
    const nov = await request(`/novel/${this.data.id}`);
    const saved = this.readCoverSaved(nov.coverImage);
    // 真图封面：后端已落盘就按 URL 取。带时间戳 —— 换过封面要立刻看到新图，不能被缓存掉
    const hasReal = !!nov.coverFile;
    this.setData({
      nov,
      platform: nov.platform,
      coverSeed: saved.seed,
      coverPlan: saved.plan,          // 已存的「按情节生成」的封面方案（canvas 兜底用）
      coverLayout: saved.layout,      // 版式（可与方案分开换）
      coverImg: hasReal
        ? `${app.globalData.baseUrl}/novel/${nov.id}/cover.jpg?v=${Date.now()}`
        : '',
      coverPrompt: nov.coverPrompt || '',
      hasBible: this.novelHasBible(nov),
      penEdit: nov.penName || getPen() || '', // 全局笔名兜底：定一次就自动带上封面
      introEdit: nov.authorIntro || getIntro() || '', // 全局作者简介兜底
      penList: [],
    });
    setTimeout(() => this.drawCover(), 200); // 先画封面，不等上架资料接口
    // 已经有真图就不用再让 AI 出方案了（省一次调用）；没有才退回 canvas 那套
    if (!hasReal) this.ensureCoverPlan();
    this.loadAuditBadge(); // 上次体检遗留问题的角标（不 await，不卡首屏）
    this.loadFeedbacks();  // 历次被拒 / 过审记录（不 await）
    await this.loadInfo();
  },

  // ---------- 平台反馈：被拒 / 过审 ----------
  toggleMore() { this.setData({ moreOpen: !this.data.moreOpen }); },

  async loadFeedbacks() {
    try {
      const list = await request(`/novel/${this.data.id}/feedbacks`);
      const arr = (list || []).map((f) => {
        const d = new Date(f.createdAt);
        const p = (x) => String(x).padStart(2, '0');
        return Object.assign({}, f, {
          createdAtText: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
        });
      });
      this.setData({ feedbacks: arr });
    } catch (e) { /* 拿不到就不显示 */ }
  },

  openReject() {
    this.setData({ rejectShow: true, rejectText: (this.data.nov && this.data.nov.rejectReason) || '' });
  },
  closeReject() { this.setData({ rejectShow: false }); },
  noop() { /* 阻止冒泡：点浮层内部不要关掉 */ },
  onRejectText(e) { this.setData({ rejectText: e.detail.value }); },
  pickReason(e) {
    const t = e.currentTarget.dataset.t || '';
    const cur = (this.data.rejectText || '').trim();
    this.setData({ rejectText: cur ? `${cur}；${t}` : t });
  },
  pasteReason() {
    wx.getClipboardData({
      success: (r) => {
        const t = (r.data || '').trim();
        if (!t) { wx.showToast({ title: '剪贴板是空的', icon: 'none' }); return; }
        const cur = (this.data.rejectText || '').trim();
        this.setData({ rejectText: cur ? `${cur}\n${t}` : t });
      },
      fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' }),
    });
  },
  copyReason() { copy(this.data.rejectText || '', '已复制'); },

  /** 提交被拒原因：后端留档（原文 + 作品快照 + AI 总结），并腾出该平台的在写名额 */
  async submitReject() {
    const reason = (this.data.rejectText || '').trim();
    if (!reason) { wx.showToast({ title: '填一下驳回原因再提交', icon: 'none' }); return; }
    wx.showLoading({ title: '正在留档…', mask: true });
    try {
      await request(`/novel/${this.data.id}/reject`, 'POST', { reason });
      const nov = await request(`/novel/${this.data.id}`);
      this.setData({ rejectShow: false, nov });
      this.loadFeedbacks();
      wx.hideLoading();
      // 被拒后二选一（作者 2026-10-12 定）：
      //   ① 新建一本 —— 旧作收进归档（只读，留档当避坑样本），AI 避开这次被拒原因重开一本；
      //   ② 改编这本 —— 这部接着改（重写章节/改设定都行），改完再投。
      // 作者本人的书不归档（他要留着反复试），所以给他的是老的两键提示。
      const owner = await isOwnerAccount();
      wx.showModal({
        title: '已记录',
        content: owner
          ? '驳回原因已连同这部作品的快照存成原始数据（以后开新书时 AI 会避开这个坑）。\n\n现在要自动重开一本吗？'
          : '驳回原因已连同这部作品的快照存成原始数据（以后开新书时 AI 会避开这个坑）。\n\n'
            + '接下来怎么办？\n'
            + '【新建一本】旧作收进归档（只读，留着当避坑样本），AI 避开这次原因重开一本；\n'
            + '【改编这本】这部接着改：重写章节、改设定都可以，改完再投。',
        confirmText: owner ? '重开一本' : '新建一本',
        cancelText: owner ? '先不改' : '改编这本',
        success: (r) => {
          if (r.confirm) this.restartNow();
          else if (!owner) wx.showToast({ title: '好，这部接着改（不会归档）', icon: 'none', duration: 2500 });
        },
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
    }
  },

  /** 过审：也留一条正向样本，以后拿"过与不过"这两批数据对表改规则 */
  async onPass() {
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '标记为过审 / 已签约',
        content: '平台通过了吗？我们会把这条记成一条成功样本（可填一句说明，也可以留空）。',
        editable: true,
        placeholderText: '例如：2 万字签约通过（可留空）',
        confirmText: '记录',
        success: (r) => resolve(r.confirm ? (r.content || '') : null),
        fail: () => resolve(null),
      });
    });
    if (res === null) return;
    wx.showLoading({ title: '记录中…', mask: true });
    try {
      await request(`/novel/${this.data.id}/pass`, 'POST', { reason: res });
      const nov = await request(`/novel/${this.data.id}`);
      this.setData({ nov });
      this.loadFeedbacks();
      wx.hideLoading();
      wx.showToast({ title: '已记为成功样本', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '记录失败，请重试', icon: 'none' });
    }
  },

  /** 被拒后自动重开一本：新书带着"上一部为什么被拒"的约束重新定方向 */
  async restartNow() {
    if (this.data.busyRestart) return;
    this.setData({ busyRestart: true, prog: progOf('被拒重开一本', { steps: [], stage: 'running' }) });
    wx.showLoading({ title: '正在开新书…', mask: true });
    try {
      const r = await request(`/novel/${this.data.id}/restart`, 'POST', {});
      app.globalData.novelId = r.id;
      wx.hideLoading();
      await waitJob(r.id, (p) => this.setData({ prog: progOf('被拒重开一本', p) }), 20 * 60 * 1000);
      wx.showToast({ title: '新书已开好', icon: 'success' });
      wx.redirectTo({ url: `/pages/intro/intro?id=${r.id}` });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: ((e && e.message) || '开新书失败').slice(0, 30), icon: 'none', duration: 3000 });
    }
    this.setData({ busyRestart: false });
  },
  /** 未解决矛盾数：退出小程序也不丢，回来就挂在「一键体检」入口上提醒 */
  async loadAuditBadge() {
    const id = this.data.id;
    if (!id) return;
    try {
      const r = await request(`/novel/${id}/audit`);
      // 稿子改过（指纹变了）之后旧结果作废，不挂角标（曾出现"整部重做了还挂着 125 处未修"）
      const cnt = (!r.stale && r.audit && r.audit.issues) ? r.audit.issues.length : 0;
      this.setData({ openBadge: cnt });
    } catch (e) { /* 没体检过就算了 */ }
  },

  /** 有没有真正的内容大纲（空对象 "{}" 不算，旧数据就踩过这个坑） */
  novelHasBible(nov) {
    try {
      const b = JSON.parse((nov && nov.bible) || '');
      return !!(b && Array.isArray(b.volumes) && b.volumes.length);
    } catch (e) { return false; }
  },
  /** 读取已存的封面数据：v2 是「按情节生成的方案」，v1 是老的 seed 模板 */
  readCoverSaved(coverImage) {
    try {
      const v = JSON.parse(coverImage || '');
      if (v && v.v === 2 && v.plan) return { plan: v.plan, layout: v.layout || v.plan.layout, seed: 0 };
      return { plan: null, layout: '', seed: Number(v && v.seed) || 0 };
    } catch (e) {
      return { plan: null, layout: '', seed: 0 };
    }
  },
  /** 打开页面时若还没有封面方案，就按当前情节生成一版（有章节后情节更准，可手动重设计） */
  async ensureCoverPlan() {
    if (this.data.coverPlan || this.data.coverBusy) return;
    if (!this.data.hasBible) return; // 没大纲就没情节，画不出来（后端也会拒绝）
    await this.replanCover(true);
  },
  /** 按情节重新设计封面：AI 出一套新的场景 / 配色 / 道具，可反复换 */
  replanCover(silent) {
    if (this.data.coverBusy) return;
    this.setData({ coverBusy: true });
    if (!silent) wx.showLoading({ title: 'AI 按情节设计封面…', mask: true });
    return request(`/novel/${this.data.id}/cover-plan`, 'POST', {
      exclude: this.data.coverPlan ? [JSON.stringify(this.data.coverPlan.palette), (this.data.coverPlan.props || []).join(',')] : [],
    }).then((plan) => {
      if (!silent) wx.hideLoading();
      this.setData({ coverPlan: plan, coverLayout: plan.layout, coverBusy: false, 'nov.coverImage': JSON.stringify({ v: 2, plan, layout: plan.layout }) });
      this.drawCover();
      if (!silent) wx.showToast({ title: '封面已按情节重画', icon: 'success' });
    }).catch((e) => {
      if (!silent) wx.hideLoading();
      this.setData({ coverBusy: false });
      if (!silent) wx.showToast({ title: (e && e.message) || '生成失败，请重试', icon: 'none', duration: 2500 });
    });
  },

  // ---------- 作者笔名（两平台封面硬性要求，缺了会被驳回） ----------
  onPen(e) { this.setData({ penEdit: e.detail.value }); },
  /** 点「保存」：用输入框里的内容（注意 bindtap 会把 event 传进来，必须走无参包装） */
  savePen() { return this.savePenName(this.data.penEdit); },
  /**
   * AI 推荐笔名：一次给 3 个以上；再点一次是「换一批」，
   * 会把已有候选作为 exclude 传给后端，避免又推回来同一批。
   */
  async recPen() {
    if (this.data.penBusy) return;
    this.setData({ penBusy: true });
    wx.showLoading({ title: this.data.penList.length ? '再想几个…' : 'AI 起笔名…', mask: true });
    try {
      const r = await request('/novel/author-assist', 'POST', {
        platform: this.data.platform,
        kind: 'pen',
        genre: (this.data.nov && this.data.nov.genre) || '',
        exclude: this.data.penList || [],
      });
      const pens = r.pens || [];
      this.setData({ penList: pens });
      wx.hideLoading();
      if (!pens.length) wx.showToast({ title: '没生成出来，再点一次', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败，再点一次', icon: 'none' });
    }
    this.setData({ penBusy: false });
  },
  /** 点选推荐笔名：立即采用并保存，不用再点「保存」 */
  usePen(e) { return this.savePenName(e.currentTarget.dataset.t); },
  async savePenName(name) {
    const penName = String(name || '').trim();
    if (!penName) { wx.showToast({ title: '笔名不能为空', icon: 'none' }); return; }
    this.setData({ penEdit: penName });
    setPen(penName); // 同步为全局笔名，之后的作品 / 封面自动带上
    try {
      await request(`/novel/${this.data.id}`, 'PUT', { penName });
      this.setData({ 'nov.penName': penName });
      this.drawCover();
      wx.showToast({ title: '笔名已保存（并设为默认）', icon: 'none', duration: 1800 });
    } catch (e) {
      this.drawCover(); // 后端没存上，本机封面照常显示新笔名
      wx.showToast({ title: '已设为默认笔名', icon: 'none' });
    }
    // 封面必须含书名 + 笔名（平台硬性要求）：已经出了真图的话，顺手把新笔名叠上去
    if (this.data.coverImg) setTimeout(() => this.retypeCover(), 800);
  },

  // ---------- 作者简介（可 AI 生成、可反复重写、可自己写） ----------
  onIntro(e) { this.setData({ introEdit: e.detail.value }); },
  saveIntro() { return this.saveIntroText(this.data.introEdit); },
  async saveIntroText(text) {
    const authorIntro = String(text || '').trim();
    if (!authorIntro) { wx.showToast({ title: '作者简介不能为空', icon: 'none' }); return; }
    setIntro(authorIntro);
    try {
      await request(`/novel/${this.data.id}`, 'PUT', { authorIntro });
      this.setData({ 'nov.authorIntro': authorIntro });
      wx.showToast({ title: '作者简介已保存（并设为默认）', icon: 'none', duration: 1800 });
    } catch (e) {
      wx.showToast({ title: '已设为默认作者简介', icon: 'none' });
    }
  },
  /** AI 写 / 重写作者简介：重写时明确要求换个写法，避免与上一版雷同 */
  async recIntro() {
    if (this.data.introBusy) return;
    const first = !(this.data.introEdit || '').trim();
    this.setData({ introBusy: true });
    wx.showLoading({ title: first ? 'AI 写简介…' : '重写中…', mask: true });
    try {
      const r = await request('/novel/author-assist', 'POST', {
        platform: this.data.platform,
        kind: 'intro',
        genre: (this.data.nov && this.data.nov.genre) || '',
        opinion: first ? '' : `换一个写法重写：角度、句式、用词都要和这一版不同，风格仍保持亲和可信。上一版是「${this.data.introEdit}」`,
      });
      this.setData({ introEdit: r.intro || '' });
      wx.hideLoading();
      wx.showToast({ title: '已生成，可直接编辑或保存', icon: 'none', duration: 2000 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败，再点一次', icon: 'none' });
    }
    this.setData({ introBusy: false });
  },
  /** 封面款式存在 coverImage 字段里（JSON），换设备也保持 */
  readCoverSeed(coverImage) {
    try {
      const v = JSON.parse(coverImage || '');
      return Number(v && v.seed) || 0;
    } catch (e) { return 0; }
  },

  // ---------- 上架资料 ----------
  async loadInfo() {
    try {
      this.applyInfo(await request(`/novel/${this.data.id}/publish`));
    } catch (e) { /* 后端未就绪时静默，页面显示"待生成" */ }
  },
  applyInfo(info) {
    this.setData({
      info,
      hasBible: !!info.hasBible,
      ready: !!info.ready,
      readingList: this.tagList(info.readingTags, READ_LABELS),
      contentList: this.tagList(info.contentTags, CONTENT_LABELS),
    });
    if (info.title) setTimeout(() => this.drawCover(), 300); // 等 canvas 节点就绪
  },
  tagList(obj, order) {
    return obj ? order.filter((k) => obj[k]).map((k) => ({ label: k, value: obj[k] })) : [];
  },
  async genInfo() {
    // 没有大纲就没有作品简介：简介必须按大纲写，否则就是凭空编一段与正文对不上的话
    if (!this.data.hasBible) {
      wx.showModal({
        title: '还没有大纲',
        content: '作品简介 / 主要人物 / 标签都要按《全书脉络》生成，现在还没有大纲，先生成大纲再回来。',
        confirmText: '去生成',
        success: (r) => { if (r.confirm) this.goWizardOutline(); },
      });
      return;
    }
    wx.showLoading({ title: 'AI 生成上架资料…', mask: true });
    try {
      this.applyInfo(await request(`/novel/${this.data.id}/publish`, 'POST', {}));
      wx.hideLoading();
      wx.showToast({ title: '资料已生成', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '生成失败，请重试', icon: 'none', duration: 2500 });
    }
  },
  copyAll() {
    const { nov, info, readingList, contentList } = this.data;
    const text = [
      `作品名称：${nov.title}`,
      `目标读者：${nov.targetReader || ''}`,
      `签约模式：${info.contractMode || ''}`,
      `连载模式：${info.serialMode || ''}`,
      '',
      '【作品简介】', info.intro || '',
      '',
      '【主要人物】',
      ...(info.protagonists || []).map((p) => `${p.name}（${p.role}）：${p.desc || ''}`),
      '',
      '【阅读标签】', ...readingList.map((t) => `${t.label}：${t.value}`),
      '',
      '【内容标签】', ...contentList.map((t) => `${t.label}：${t.value}`),
    ].join('\n');
    copy(text, '全部资料已复制');
  },

  // ---------- 封面（真图）：AI 出无字底图 + 服务端精确叠字 ----------
  /**
   * 出一条真图封面。
   *
   * 为什么必须由服务端叠字：AI 直接画中文书名 99% 是乱码/鬼画符（封面工坊技能里踩过的坑），
   * 而封面上的书名必须与后台作品名一字不差（平台会按"封面与内容不符"驳回）。
   * 所以流水线是：AI 只出「无字底图」→ 后端用字库把书名/笔名/题材标签精确压上去。
   */
  async genRealCover(payload, tip) {
    if (this.data.coverBusy) return null;
    this.setData({ coverBusy: true, coverTip: tip || '' });
    wx.showLoading({ title: tip || 'AI 正在出图…', mask: true });
    try {
      const r = await request(`/novel/${this.data.id}/cover-image`, 'POST', payload || {});
      wx.hideLoading();
      this.setData({
        coverBusy: false,
        coverTip: '',
        coverImg: `${app.globalData.baseUrl}${r.url}`,
        coverPrompt: r.prompt || '',
        'nov.coverFile': r.file,
        'nov.coverPrompt': r.prompt,
      });
      wx.showToast({ title: `真图封面已生成（${r.size}）`, icon: 'success' });
      return r;
    } catch (e) {
      wx.hideLoading();
      this.setData({ coverBusy: false, coverTip: '' });
      // 生图通道没通时至少回到方案图，别让作者对着空白框
      if (!this.data.coverImg && this.data.hasBible && !this.data.coverPlan) this.replanCover(true);
      wx.showModal({
        title: '出图失败',
        content: (e && e.message)
          || '生图通道没通：请到云开发控制台确认「生图模型」已开启，并重新部署云函数 ai-write。',
        showCancel: false,
      });
      return null;
    }
  },
  /** 「🎨 换一张画面」：换 seed 重新生图（消耗一次生图额度） */
  newCoverShot() {
    return this.genRealCover({ seed: Math.floor(Math.random() * 999999) }, 'AI 重画一张…');
  },
  /** 「🔤 只改字重出」：复用上次的底图，只重叠书名/笔名 —— 改笔名、改书名后立刻生效，不烧生图额度 */
  retypeCover() {
    return this.genRealCover(
      { reuseBase: true, title: (this.data.nov && this.data.nov.title) || '', author: this.data.penEdit || '' },
      '只改字，复用底图…',
    );
  },
  onCoverImgOk() { /* 加载成功：无需处理 */ },
  /** 真图加载不了（域名没通 / 文件被删）→ 退回 canvas 方案图，别给作者一个空白框 */
  onCoverImgErr() {
    this.setData({ coverImg: '' });
    setTimeout(() => this.drawCover(), 200);
    wx.showToast({ title: '真图加载失败，已退回方案图', icon: 'none', duration: 2500 });
  },

  // ---------- 封面：canvas 绘制 + 存相册 ----------
  drawCover() {
    wx.createSelectorQuery().in(this).select('#coverCanvas').fields({ node: true, size: true }).exec((res) => {
      const node = res[0] && res[0].node;
      if (!node || !res[0].width) return;
      const ctx = node.getContext('2d');
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2;
      node.width = res[0].width * dpr;
      node.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      this.paint(ctx, res[0].width, res[0].height);
    });
  },
  /**
   * 封面绘制。
   * 有「按情节生成的方案」时走 plan 分支：场景 / 配色 / 构图 / 人物造型 / 道具全部来自方案；
   * 没有方案（老作品或还没大纲）时退回题材模板，保证任何情况下都有封面可看。
   */
  paint(ctx, w, h) {
    const nov = this.data.nov || {};
    const plan = this.data.coverPlan;
    const t = {
      meta: [nov.targetReader, nov.genre].filter(Boolean).join(' · '),
      title: nov.title || '未命名作品',
      pen: nov.penName || getPen() || '',
      plat: this.data.platform === 'qimao' ? '七猫小说' : '番茄小说',
    };
    ctx.save();
    ctx.scale(h / VH, h / VH); // 统一在 600×800 虚拟画布上绘制，预览与导出同构
    ctx.textBaseline = 'middle';

    let style;
    let pal;
    let fig;
    if (plan) {
      style = Math.max(0, ['center', 'band', 'side'].indexOf(this.data.coverLayout || plan.layout));
      pal = plan.palette;
      fig = figureOfPlan(plan);
      ctx.fillStyle = this.planGradient(ctx, pal);
      ctx.fillRect(0, 0, VW, VH);
      coverLib.drawScenery(ctx, plan);
      coverLib.drawProps(ctx, plan);
      const cy = VH * (style === 1 ? 0.735 : 0.63);
      const heroY = Math.min(VH * 0.9, cy + (plan.horizon - 0.68) * VH * 0.35);
      this.paintFigure(ctx, fig, pal, style === 2 ? VW * 0.775 : VW / 2, heroY, plan.heroScale * (style === 2 ? 0.9 : 1));
    } else {
      const seed = this.data.coverSeed || 0;
      style = seed % COVER_STYLES;
      pal = pickTheme(nov.genre || '', Math.floor(seed / COVER_STYLES) % 2);
      fig = figureOf(nov);
      ctx.fillStyle = this.bgGradient(ctx, pal, style);
      ctx.fillRect(0, 0, VW, VH);
      this.paintScenery(ctx, fig, pal);
    }
    [this.paintClassic, this.paintBand, this.paintSide][style].call(this, ctx, t, pal, fig);
    this.drawAiMark(ctx); // 合规：封面属 AI 生成内容，必须带显式标识（保存/上传后仍可见）
    ctx.restore();
  },
  /**
   * 封面右下角"AI 生成"标识。
   * 三种构图共用一个出口，避免漏画；深底白字保证在任意配色上都清晰。
   */
  drawAiMark(ctx) {
    const text = 'AI 生成';
    ctx.save();
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 26;
    const h = 38;
    const x = VW - 18 - w;
    const y = VH - 18 - h;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    ctx.restore();
  },
  /** 方案配色的背景渐变（对角线，避免过于平板） */
  planGradient(ctx, pal) {
    const g = ctx.createLinearGradient(0, 0, VW * 0.6, VH);
    g.addColorStop(0, pal.bg[1]);
    g.addColorStop(1, pal.bg[0]);
    return g;
  },
  bgGradient(ctx, pal, style) {
    const c1 = pal.bg[0], c2 = pal.bg[1];
    const g = ctx.createLinearGradient(0, 0, style === 2 ? VW : 0, VH);
    if (style === 1 || style === 2) { g.addColorStop(0, c2); g.addColorStop(1, c1); }
    else { g.addColorStop(0, c1); g.addColorStop(1, c2); }
    return g;
  },
  /** 款 1：居中经典（书名在上，人物在下） */
  paintClassic(ctx, t, pal, fig) {
    this.paintFigure(ctx, fig, pal, VW / 2, VH * 0.63, 0.96);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.font = '32px sans-serif';
    ctx.fillText(t.meta, VW / 2, VH * 0.072);
    this.paintTitle(ctx, t, VH * 0.155, 'center', VW - 56, 0.088, 3);
    this.paintBrand(ctx, t, 'center');
  },
  /** 款 2：中部白色横带压书名，人物在带下方 */
  paintBand(ctx, t, pal, fig) {
    const top = VH * 0.09, bh = VH * 0.29;
    this.paintFigure(ctx, fig, pal, VW / 2, VH * 0.735, 1);
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.fillRect(0, top, VW, bh);
    ctx.textAlign = 'center';
    const fit = this.fitTitle(ctx, t.title, VW - 48, 2, VH * 0.072);
    ctx.fillStyle = pal.bg[0];
    ctx.font = `bold ${fit.size}px sans-serif`;
    let y = top + VH * 0.068;
    fit.lines.forEach((ln) => { ctx.fillText(ln, VW / 2, y); y += fit.size * 1.34; });
    ctx.fillStyle = 'rgba(0,0,0,.68)';
    ctx.font = '31px sans-serif';
    ctx.fillText(t.pen ? `${t.pen} 著` : '（请填笔名）', VW / 2, y - fit.size * 0.42);
    // 题材写在白带上方：白带上放深色字会被吃掉
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.font = '29px sans-serif';
    ctx.fillText(t.meta, VW / 2, top - VH * 0.045);
    this.paintBrand(ctx, t, 'center');
  },
  /** 款 3：左对齐大标题 + 人物在右 */
  paintSide(ctx, t, pal, fig) {
    this.paintFigure(ctx, fig, pal, VW * 0.775, VH * 0.66, 0.86);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '29px sans-serif';
    ctx.fillText(t.meta, VW * 0.1, VH * 0.085);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(VW * 0.062, VH * 0.17, 3, VH * 0.3);
    this.paintTitle(ctx, t, VH * 0.175, 'left', VW * 0.4, 0.072, 4);
    this.paintBrand(ctx, t, 'left');
  },
  // ---------- 封面：背景场景（按题材换景） ----------
  paintScenery(ctx, fig, pal) {
    if (fig.type === 'ancient') {
      for (let i = 0; i < 3; i++) {
        const y = VH * (0.42 + i * 0.13), k = 1 - i * 0.16;
        ctx.fillStyle = `rgba(8,10,16,${(0.28 + i * 0.22).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(-60, VH);
        ctx.lineTo(-60, y + 110);
        ctx.quadraticCurveTo(VW * 0.3, y - 90 * k, VW * 0.62, y + 70);
        ctx.quadraticCurveTo(VW * 0.88, y + 140, VW + 60, y + 40);
        ctx.lineTo(VW + 60, VH);
        ctx.closePath(); ctx.fill();
      }
    } else if (fig.type === 'sci') {
      ctx.fillStyle = 'rgba(255,255,255,.78)';
      for (let i = 0; i < 52; i++) {
        const x = (((i * 97) % 100) / 100) * VW, y = (((i * 61) % 52) / 100) * VH;
        ctx.beginPath(); ctx.arc(x, y, i % 4 ? 1.4 : 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = rgba(pal.accent, 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(VW * 0.74, VH * 0.2, VW * 0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(VW * 0.74, VH * 0.2, VW * 0.22, 0, Math.PI * 2); ctx.stroke();
    } else {
      const bs = [0.46, 0.68, 0.36, 0.82, 0.58, 0.3, 0.74, 0.5];
      const bw = VW / bs.length;
      bs.forEach((f, i) => {
        const bh = VH * 0.26 * f;
        ctx.fillStyle = `rgba(6,8,14,${(0.24 + (i % 3) * 0.07).toFixed(2)})`;
        ctx.fillRect(i * bw, VH * 0.7 - bh, bw * 0.86, bh + VH * 0.4);
      });
    }
  },
  /** 椭圆（部分基础库没有 ctx.ellipse，用缩放圆代替） */
  ellipsePath(ctx, cx, cy, rx, ry) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx / ry, 1);
    ctx.arc(0, 0, ry, 0, Math.PI * 2);
    ctx.restore();
  },
  // ---------- 封面：插画风半身人像（扁平插画，规避真人照片的版权/审核风险） ----------
  paintFigure(ctx, fig, pal, cx, cy, s) {
    const rx = 62 * s, ry = 76 * s;
    const hb = VH * 0.98;
    const skin = pal.skin;
    const skinSh = mixHex(pal.skin, '#78503c', 0.16);
    const hair = pal.hair, cloth = pal.cloth, inner = pal.inner, accent = pal.accent;

    // 头部光晕：把人物从背景里「托」出来
    ctx.beginPath();
    ctx.arc(cx, cy + 10 * s, 250 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fill();

    // ① 后层头发
    ctx.fillStyle = hair;
    ctx.beginPath();
    if (fig.hair === 'long') {
      ctx.moveTo(cx - rx * 1.24, cy - ry * 0.2);
      ctx.quadraticCurveTo(cx - rx * 2.3, cy + ry * 1.6, cx - rx * 2.05, cy + ry * 4.2);
      ctx.lineTo(cx + rx * 2.05, cy + ry * 4.2);
      ctx.quadraticCurveTo(cx + rx * 2.3, cy + ry * 1.6, cx + rx * 1.24, cy - ry * 0.2);
      ctx.quadraticCurveTo(cx, cy - ry * 1.72, cx - rx * 1.24, cy - ry * 0.2);
    } else {
      ctx.moveTo(cx - rx * 1.2, cy + ry * 0.1);
      ctx.quadraticCurveTo(cx - rx * 1.32, cy - ry * 1.34, cx, cy - ry * 1.5);
      ctx.quadraticCurveTo(cx + rx * 1.32, cy - ry * 1.34, cx + rx * 1.2, cy + ry * 0.1);
      ctx.quadraticCurveTo(cx, cy - ry * 0.5, cx - rx * 1.2, cy + ry * 0.1);
    }
    ctx.closePath();
    ctx.fill();
    if (fig.hair === 'bun') { // 古装发髻
      ctx.fillStyle = hair;
      ctx.beginPath();
      this.ellipsePath(ctx, cx, cy - ry * 1.62, rx * 0.52, rx * 0.44);
      ctx.fill();
    }

    // ② 脖子
    ctx.fillStyle = skinSh;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.4, cy + ry * 0.5);
    ctx.lineTo(cx - rx * 0.42, cy + ry * 1.5);
    ctx.lineTo(cx + rx * 0.42, cy + ry * 1.5);
    ctx.lineTo(cx + rx * 0.4, cy + ry * 0.5);
    ctx.closePath();
    ctx.fill();

    // ③ 上身（衣服）
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(cx - 182 * s, hb);
    ctx.quadraticCurveTo(cx - 180 * s, cy + ry * 3.0, cx - 106 * s, cy + ry * 2.15);
    ctx.quadraticCurveTo(cx - 78 * s, cy + ry * 1.72, cx - 28 * s, cy + ry * 1.26);
    ctx.lineTo(cx + 28 * s, cy + ry * 1.26);
    ctx.quadraticCurveTo(cx + 78 * s, cy + ry * 1.72, cx + 106 * s, cy + ry * 2.15);
    ctx.quadraticCurveTo(cx + 180 * s, cy + ry * 3.0, cx + 182 * s, hb);
    ctx.closePath();
    ctx.fill();

    // ④ 衣领（现代衬衫 V 领 / 古装交领 / 科幻内衬 + 发光胸线）
    if (fig.type === 'ancient') {
      // 内衬
      ctx.fillStyle = mixHex(inner, cloth, 0.12);
      ctx.beginPath();
      ctx.moveTo(cx - 54 * s, cy + ry * 1.3);
      ctx.lineTo(cx, cy + ry * 2.5);
      ctx.lineTo(cx + 54 * s, cy + ry * 1.3);
      ctx.closePath(); ctx.fill();
      // 右衽斜襟：一条压在内衬上的衣带，才是「交领」
      ctx.fillStyle = mixHex(inner, '#ffffff', 0.16);
      ctx.beginPath();
      ctx.moveTo(cx - 58 * s, cy + ry * 1.28);
      ctx.lineTo(cx - 14 * s, cy + ry * 2.92);
      ctx.lineTo(cx + 26 * s, cy + ry * 2.6);
      ctx.lineTo(cx - 20 * s, cy + ry * 1.3);
      ctx.closePath(); ctx.fill();
      // 领缘
      ctx.strokeStyle = rgba(accent, 0.45);
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(cx - 54 * s, cy + ry * 1.3);
      ctx.lineTo(cx, cy + ry * 2.5);
      ctx.lineTo(cx + 54 * s, cy + ry * 1.3);
      ctx.stroke();
    } else if (fig.type === 'sci') {
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(cx - 40 * s, cy + ry * 1.34);
      ctx.lineTo(cx, cy + ry * 2.24);
      ctx.lineTo(cx + 40 * s, cy + ry * 1.34);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba(accent, 0.82);
      ctx.beginPath();
      ctx.moveTo(cx - 30 * s, cy + ry * 1.42);
      ctx.lineTo(cx, cy + ry * 1.94);
      ctx.lineTo(cx + 30 * s, cy + ry * 1.42);
      ctx.lineTo(cx + 23 * s, cy + ry * 1.36);
      ctx.lineTo(cx, cy + ry * 1.78);
      ctx.lineTo(cx - 23 * s, cy + ry * 1.36);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(accent, 0.4);
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.moveTo(cx - 102 * s, cy + ry * 2.62);
      ctx.lineTo(cx + 102 * s, cy + ry * 2.62);
      ctx.stroke();
      ctx.strokeStyle = rgba(accent, 0.92);
      ctx.lineWidth = 2.6 * s;
      ctx.beginPath();
      ctx.moveTo(cx - 102 * s, cy + ry * 2.62);
      ctx.lineTo(cx + 102 * s, cy + ry * 2.62);
      ctx.stroke();
    } else {
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(cx - 52 * s, cy + ry * 1.32);
      ctx.lineTo(cx, cy + ry * 2.36);
      ctx.lineTo(cx + 52 * s, cy + ry * 1.32);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = mixHex(cloth, '#ffffff', 0.22);
      ctx.lineWidth = 2 * s;
      [-1, 1].forEach((sx) => {
        ctx.beginPath();
        ctx.moveTo(cx + sx * 52 * s, cy + ry * 1.32);
        ctx.lineTo(cx + sx * 104 * s, cy + ry * 2.36);
        ctx.stroke();
      });
    }

    // ⑤ 耳朵
    ctx.fillStyle = skinSh;
    [-1, 1].forEach((sx) => {
      ctx.beginPath();
      this.ellipsePath(ctx, cx + sx * rx * 0.99, cy + ry * 0.2, rx * 0.17, ry * 0.19);
      ctx.fill();
    });

    // ⑥ 脸
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.bezierCurveTo(cx + rx * 1.02, cy - ry * 0.94, cx + rx * 1.0, cy + ry * 0.2, cx + rx * 0.66, cy + ry * 0.78);
    ctx.quadraticCurveTo(cx, cy + ry * 1.24, cx - rx * 0.66, cy + ry * 0.78);
    ctx.bezierCurveTo(cx - rx * 1.0, cy + ry * 0.2, cx - rx * 1.02, cy - ry * 0.94, cx, cy - ry);
    ctx.closePath();
    ctx.fill();

    // ⑦ 刘海
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry * 0.28);
    ctx.quadraticCurveTo(cx - rx * 0.98, cy - ry * 1.18, cx, cy - ry * 1.2);
    ctx.quadraticCurveTo(cx + rx * 0.98, cy - ry * 1.18, cx + rx, cy - ry * 0.28);
    ctx.quadraticCurveTo(cx + rx * 0.8, cy - ry * 0.86, cx + rx * 0.26, cy - ry * 0.78);
    ctx.quadraticCurveTo(cx - rx * 0.5, cy - ry * 0.68, cx - rx, cy - ry * 0.28);
    ctx.closePath();
    ctx.fill();
    if (fig.hair === 'long') { // 两侧垂发压在肩上（往外让开脸）
      ctx.fillStyle = hair;
      [-1, 1].forEach((sx) => {
        ctx.beginPath();
        ctx.moveTo(cx + sx * rx * 1.3, cy - ry * 0.52);
        ctx.quadraticCurveTo(cx + sx * rx * 1.62, cy + ry * 1.3, cx + sx * rx * 1.24, cy + ry * 2.6);
        ctx.lineTo(cx + sx * rx * 0.82, cy + ry * 2.5);
        ctx.quadraticCurveTo(cx + sx * rx * 1.04, cy + ry * 1.1, cx + sx * rx * 0.86, cy - ry * 0.52);
        ctx.closePath(); ctx.fill();
      });
    } else if (fig.hair === 'bun') { // 发簪
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.62, cy - ry * 1.86);
      ctx.lineTo(cx + rx * 0.68, cy - ry * 1.5);
      ctx.stroke();
    }

    // ⑧ 五官（有五官才真的像人，而不是黑影）
    ctx.fillStyle = mixHex(hair, '#14141e', 0.4);
    [-1, 1].forEach((sx) => {
      ctx.beginPath();
      this.ellipsePath(ctx, cx + sx * rx * 0.42, cy + ry * 0.26, rx * 0.14, ry * 0.125);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    [-1, 1].forEach((sx) => {
      ctx.beginPath();
      ctx.arc(cx + sx * rx * 0.42 - rx * 0.06, cy + ry * 0.21, rx * 0.045, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = hair;
    ctx.lineWidth = 2.6 * s;
    [-1, 1].forEach((sx) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx * rx * 0.62, cy - ry * 0.06);
      ctx.quadraticCurveTo(cx + sx * rx * 0.42, cy - ry * 0.16, cx + sx * rx * 0.2, cy - ry * 0.08);
      ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(150,96,96,.75)';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.2, cy + ry * 0.58);
    ctx.quadraticCurveTo(cx, cy + ry * 0.68, cx + rx * 0.2, cy + ry * 0.58);
    ctx.stroke();

    this.paintOutfit(ctx, fig, pal, cx, cy, s, rx, ry);

    // ⑨ 轮廓光：左侧冷光，右侧暖光
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.bezierCurveTo(cx - rx * 1.02, cy - ry * 0.94, cx - rx, cy + ry * 0.2, cx - rx * 0.66, cy + ry * 0.78);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,219,160,.5)';
    ctx.lineWidth = 3.4 * s;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.bezierCurveTo(cx + rx * 1.02, cy - ry * 0.94, cx + rx, cy + ry * 0.2, cx + rx * 0.66, cy + ry * 0.78);
    ctx.quadraticCurveTo(cx, cy + ry * 1.24, cx - rx * 0.66, cy + ry * 0.78);
    ctx.stroke();
  },
  /**
   * 服装点缀：让"工人 / 西装 / 风衣 / 甲胄 / 长袍 / 连衣裙"在画面里真的能区分开。
   * 只在已有躯干上叠加细节，不改动基础轮廓，避免破坏人像比例。
   */
  paintOutfit(ctx, fig, pal, cx, cy, s, rx, ry) {
    const outfit = fig.outfit || 'worker';
    const accent = pal.accent;
    if (outfit === 'suit' || outfit === 'coat') {
      // 西装/风衣：翻领 + 领带或扣子；风衣多一条腰带
      ctx.strokeStyle = mixHex(pal.cloth, '#ffffff', 0.32);
      ctx.lineWidth = 3 * s;
      [-1, 1].forEach((sx) => {
        ctx.beginPath();
        ctx.moveTo(cx + sx * 14 * s, cy + ry * 1.3);
        ctx.lineTo(cx + sx * 74 * s, cy + ry * 2.06);
        ctx.stroke();
      });
      ctx.fillStyle = rgba(accent, 0.9);
      ctx.beginPath();
      ctx.moveTo(cx, cy + ry * 1.36);
      ctx.lineTo(cx + 12 * s, cy + ry * 1.72);
      ctx.lineTo(cx, cy + ry * 2.1);
      ctx.lineTo(cx - 12 * s, cy + ry * 1.72);
      ctx.closePath(); ctx.fill();
      if (outfit === 'coat') {
        ctx.strokeStyle = rgba(pal.cloth, 0.95);
        ctx.lineWidth = 9 * s;
        ctx.beginPath();
        ctx.moveTo(cx - 96 * s, cy + ry * 2.3);
        ctx.lineTo(cx + 96 * s, cy + ry * 2.3);
        ctx.stroke();
        ctx.fillStyle = rgba(accent, 0.95);
        ctx.fillRect(cx - 12 * s, cy + ry * 2.2, 24 * s, 20 * s);
      }
    } else if (outfit === 'armor') {
      // 甲胄：双肩护肩 + 胸前护心镜
      ctx.fillStyle = rgba(accent, 0.55);
      [-1, 1].forEach((sx) => {
        ctx.beginPath();
        this.ellipsePath(ctx, cx + sx * 104 * s, cy + ry * 1.62, 44 * s, 26 * s);
        ctx.fill();
      });
      ctx.fillStyle = rgba(accent, 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy + ry * 1.92, 26 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (outfit === 'robe' || outfit === 'dress') {
      // 长袍/连衣裙：下摆放宽 + 一道竖向褶皱
      ctx.fillStyle = rgba(pal.cloth, 0.96);
      ctx.beginPath();
      ctx.moveTo(cx - 118 * s, cy + ry * 2.6);
      ctx.quadraticCurveTo(cx, cy + ry * 3.15, cx + 118 * s, cy + ry * 2.6);
      ctx.lineTo(cx + 120 * s, cy + ry * 3.4);
      ctx.lineTo(cx - 120 * s, cy + ry * 3.4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(accent, 0.55);
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(cx, cy + ry * 1.5);
      ctx.lineTo(cx, cy + ry * 3.3);
      ctx.stroke();
    } else {
      // 工装：胸前口袋 + 一条工具挂带，年代感最足
      ctx.strokeStyle = rgba(accent, 0.7);
      ctx.lineWidth = 6 * s;
      ctx.beginPath();
      ctx.moveTo(cx - 92 * s, cy + ry * 1.42);
      ctx.lineTo(cx + 60 * s, cy + ry * 2.34);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.cloth, 0.9);
      ctx.fillRect(cx + 34 * s, cy + ry * 1.86, 46 * s, 32 * s);
      ctx.strokeStyle = rgba(accent, 0.5);
      ctx.lineWidth = 2 * s;
      ctx.strokeRect(cx + 34 * s, cy + ry * 1.86, 46 * s, 32 * s);
    }
  },
  /** 长标题自适应缩字号，避免挤爆版面 */
  fitTitle(ctx, text, maxW, maxLines, base) {
    let size = base;
    for (let i = 0; i < 3; i++) {
      ctx.font = `bold ${Math.round(size)}px sans-serif`;
      const lines = this.wrap(ctx, text, maxW, maxLines + 1);
      if (lines.length <= maxLines) return { size: Math.round(size), lines };
      size *= 0.84;
    }
    ctx.font = `bold ${Math.round(size)}px sans-serif`;
    return { size: Math.round(size), lines: this.wrap(ctx, text, maxW, maxLines) };
  },
  /** 书名 + 笔名（两平台都强制要求封面上有书名与笔名） */
  paintTitle(ctx, t, y, align, maxW, baseRatio, maxLines) {
    const x = align === 'center' ? VW / 2 : VW * 0.105;
    ctx.textAlign = align;
    const fit = this.fitTitle(ctx, t.title, maxW, maxLines, VH * baseRatio);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fit.size}px sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = fit.size * 0.32;
    let cy = y;
    fit.lines.forEach((ln) => { ctx.fillText(ln, x, cy); cy += fit.size * 1.36; });
    ctx.shadowBlur = 0;
    ctx.font = '31px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText(t.pen ? `${t.pen} 著` : '（请填笔名）', x, cy + VH * 0.012);
  },
  paintBrand(ctx, t, align) {
    ctx.textAlign = align;
    ctx.font = '29px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.68)';
    ctx.fillText(t.plat, align === 'center' ? VW / 2 : VW * 0.105, VH * 0.955);
  },
  wrap(ctx, text, maxW, maxLines) {
    // 按 token 断行：连续字母数字算一个整体，避免把「1998」拆成 19|98；
    // 标点不落行首（「：」跑到下一行会很难看）
    const tokens = String(text).match(/[A-Za-z0-9]+|[\s\S]/g) || [];
    const lines = [];
    let cur = '';
    for (const tk of tokens) {
      const next = cur + tk;
      if (cur && ctx.measureText(next).width > maxW && !(cur && PUNCT_HEAD.indexOf(tk) >= 0)) {
        lines.push(cur);
        if (lines.length === maxLines) return lines;
        cur = tk;
      } else cur = next;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  },
  /** 换封面：换版式/配色重绘，并把款式存回后端（不满意可一直点） */
  /**
   * 换构图：有 AI 方案时在「居中 / 横带 / 左对齐」三种版式间轮换（画面情节不变，只换排版）；
   * 没有方案才走老的 6 款模板轮换。
   */
  async changeCover() {
    if (this.data.coverPlan) {
      const next = (['center', 'band', 'side'].indexOf(this.data.coverLayout) + 1) % 3;
      const layout = ['center', 'band', 'side'][next];
      const val = JSON.stringify({ v: 2, plan: this.data.coverPlan, layout });
      this.setData({ coverLayout: layout, 'nov.coverImage': val });
      this.drawCover();
      wx.showToast({ title: `构图 ${next + 1} / 3`, icon: 'none', duration: 1200 });
      try { await request(`/novel/${this.data.id}`, 'PUT', { coverImage: val }); } catch (e) { /* 存不上不影响预览 */ }
      return;
    }
    const seed = ((this.data.coverSeed || 0) + 1) % (COVER_STYLES * 2);
    this.setData({ coverSeed: seed });
    this.drawCover();
    wx.showToast({ title: `封面款式 ${seed + 1} / ${COVER_STYLES * 2}`, icon: 'none', duration: 1200 });
    try {
      await request(`/novel/${this.data.id}`, 'PUT', { coverImage: JSON.stringify({ v: 1, seed }) });
      this.setData({ 'nov.coverImage': JSON.stringify({ v: 1, seed }) });
    } catch (e) { /* 存不上不影响本机预览 */ }
  },
  /** 「✨ 出真图封面」：AI 读这部作品的情节 → 无字底图 → 精确叠字（已经有图再点就是重出一张） */
  redesignCover() {
    return this.genRealCover({ seed: Math.floor(Math.random() * 999999) }, 'AI 按情节出图…');
  },
  /** 保存到相册：真图直接下回来存；没有真图才走 canvas 离屏重绘 */
  saveCover() {
    if (this.data.coverImg) {
      wx.showLoading({ title: '下载封面…', mask: true });
      wx.downloadFile({
        url: this.data.coverImg,
        success: (r) => {
          wx.hideLoading();
          if (r.statusCode === 200) this.saveToAlbum(r.tempFilePath);
          else wx.showToast({ title: `下载失败 ${r.statusCode}`, icon: 'none' });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '下载失败，检查网络', icon: 'none' });
        },
      });
      return;
    }
    const [TW, TH] = COVER_SIZE[this.data.platform] || [600, 800];
    let off = null;
    try {
      off = wx.createOffscreenCanvas({ type: '2d', width: TW, height: TH });
    } catch (e) { off = null; }
    if (!off || !off.getContext) { this.exportScreenCanvas(); return; }
    this.paint(off.getContext('2d'), TW, TH);
    wx.canvasToTempFilePath({
      canvas: off, x: 0, y: 0, width: TW, height: TH, destWidth: TW, destHeight: TH,
      success: (r) => this.saveToAlbum(r.tempFilePath),
      fail: () => this.exportScreenCanvas(),
    });
  },
  /** 兜底：基础库过低不支持离屏画布时，直接放大导出屏幕画布 */
  exportScreenCanvas() {
    const [TW, TH] = COVER_SIZE[this.data.platform] || [600, 800];
    wx.createSelectorQuery().in(this).select('#coverCanvas').fields({ node: true }).exec((res) => {
      const canvas = res[0] && res[0].node;
      if (!canvas) { wx.showToast({ title: '封面还没准备好', icon: 'none' }); return; }
      wx.canvasToTempFilePath({
        canvas, destWidth: TW, destHeight: TH,
        success: (r) => this.saveToAlbum(r.tempFilePath),
        fail: () => wx.showToast({ title: '导出图片失败', icon: 'none' }),
      });
    });
  },
  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (e) => {
        const msg = String((e && e.errMsg) || '');
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请允许「保存到相册」后再试一次。',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  // ---------- 导航与其他 ----------
  copy(e) { copy(e.currentTarget.dataset.text); },
  goBible() { wx.navigateTo({ url: `/pages/bible/bible?id=${this.data.id}` }); },
  goChapters() { wx.navigateTo({ url: `/pages/chapter/chapter?id=${this.data.id}&openDir=1` }); },
  goHype() { wx.navigateTo({ url: `/pages/hype/hype?id=${this.data.id}` }); },
  /** 没有全书脉络时，回到向导第④步补生成大纲（否则章节页无内容可写） */
  goWizardOutline() { wx.navigateTo({ url: `/pages/wizard/wizard?id=${this.data.id}&step=4` }); },
  goWrite() {
    const n = this.data.nov || {};
    // 归档 = 只读：入口直接说明，别让作者点进去才被后端一句"已归档"打回
    if (n.archived) {
      wx.showToast({ title: '这部已归档，只能查看，不能更新', icon: 'none', duration: 3000 });
      return;
    }
    if (n.bibleStatus !== 'done') {
      wx.showModal({
        title: '还没生成全书脉络',
        content: '这份作品还没生成大纲 / 全书脉络，直接去写作页会没有章节可写。先去生成？',
        confirmText: '去生成',
        success: (r) => { if (r.confirm) this.goWizardOutline(); },
      });
      return;
    }
    // 先问续更几章：作者不想一章一章点。上限 4 章 —— 每天最多写 1 万字（约 4 章），
    // 给超过上限的选项只会让作者点完才被"今天额度用完了"打回。
    wx.showActionSheet({
      itemList: ['续更 1 章', '一次续更 2 章', '一次续更 3 章', '一次续更 4 章（今天的上限）'],
      success: (r) => {
        const c = [1, 2, 3, 4][r.tapIndex] || 1;
        // auto=next：进来就直接开写，不用再点一次；count 带过去决定连写几章
        wx.navigateTo({ url: `/pages/chapter/chapter?id=${this.data.id}&auto=next&count=${c}` });
      },
      fail: () => {}, // 点了取消：什么都不做
    });
  },
  goAudit() {
    const n = this.data.nov || {};
    if (n.bibleStatus !== 'done') {
      wx.showToast({ title: '先生成全书脉络再体检', icon: 'none', duration: 2200 });
      return;
    }
    // auto=audit：进写作页直接开跑体检，结果卡片复用章节页那套
    wx.navigateTo({ url: `/pages/chapter/chapter?id=${this.data.id}&auto=audit` });
  },
  delNovel() {
    const id = this.data.id;
    const title = (this.data.nov && this.data.nov.title) || '该作品';
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
          setTimeout(() => wx.navigateBack(), 600);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },
  // 未审核·调整整部小说（重新定版，不带失败上下文）
  adjustPre(e) { this.regenBible('pre_review', e.currentTarget.dataset.opinion || ''); },
  // 审核未过·重新调整整部小说（带失败上下文，规避红线）
  adjustFailed(e) { this.regenBible('review_failed', e.currentTarget.dataset.opinion || ''); },
  async regenBible(reason, opinion) {
    wx.showLoading({ title: '重新调整整部…', mask: true });
    try {
      await runFinalize(this.data.id, { reason, opinion }, (p) => {
        wx.showLoading({ title: runningText(p.steps).slice(0, 13), mask: true });
      });
      wx.hideLoading();
      wx.showToast({ title: '整部已重新调整', icon: 'success' });
      wx.navigateTo({ url: `/pages/bible/bible?id=${this.data.id}` });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '调整失败', icon: 'none' });
    }
  },
});
