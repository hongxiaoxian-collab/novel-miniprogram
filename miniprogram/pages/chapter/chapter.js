const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { runFinalize, runningText, runJob, jobText, progOf } = require('../../utils/task');

/**
 * 体检的三种口径：作者可以只查矛盾、只查撞车、或者两个一起查。
 * 为什么要分开：撞车要联网检索（慢），多数时候只想看看稿子有没有矛盾；
 * 反过来只想确认书名撞没撞时，也不该被"AI 重新找茬"把刚修干净的清单又搅一遍。
 */
const AUDIT_SCOPES = [
  { k: 'all', t: '查矛盾 + 查撞车（两个都查）' },
  { k: 'consistency', t: '只查矛盾（快，不联网）' },
  { k: 'dup', t: '只查撞车（只看书名撞没撞）' },
];

/** 续更可选章数：作者不用一章一章点，选 5 章就一次写完（后台任务，退出小程序也照写） */
const NEXT_COUNTS = [1, 3, 5, 10];

/** 章名去掉「第N章」前缀：章号是独立字段，带上就会显示成「第1章 第1章 刚重生…」 */
const stripNo = (s) => String(s || '')
  .replace(/^\s*第\s*[0-9０-９一二三四五六七八九十百千两]+\s*章\s*[·:：、,，.\-—－\s]*/, '')
  .trim();

Page({
  data: {
    novelId: '', novelTitle: '', platform: 'fanqie',
    cur: null,            // 当前章 {order,title,content,id}
    flat: [],             // 所有章扁平列表
    volumes: [],          // 按卷分组 [{volume, chapters:[...]}]
    showDir: false,
    showRewrite: false,
    rewriteReason: '',
    editing: false,
    bibleStatus: '',      // done 表示已有全书脉络
    steps: [],            // 定版任务进度
    taskText: '',
    jobText: '',          // 续写进度文案
    busy: false,
    auditing: false,      // 一致性体检中
    auditText: '',        // 体检进度文案
    auditResult: null,    // 体检结果 {score, summary, checkedChapters, issues[], autoFix[], human[], dup, options[]}
    showAudit: false,     // 体检结果全屏层（不弹层就会"点了没反应"）
    fixBusy: false,       // 批量自动修复中
    fixingIdx: -1,        // 正在单条修复的那一条下标（-1=没有）。不能共用 fixBusy：否则一条在修，整列都显示"修复中"
    fixText: '',          // 修复进度文案
    openBadge: 0,         // 未解决矛盾数（退出再进来也还在，提醒作者）
    openAudit: null,      // 服务端存的最近一次体检结果
    auditScope: 'all',    // 本次体检查什么：all / consistency / dup（下次「重新体检」沿用）
    prog: null,           // 统一进度条：体检 / 续写 / 定版 / 撞车修复 共用
  },
  onLoad(q) {
    this.enterId = (q && q.id) || ''; // 跳转带过来的作品 id，优先于全局缓存
    this.autoNext = q.auto === 'next'; // 从「继续写 / 续更」进来：进来就直接开写下一章，不用再点一次
    this.autoCount = Math.max(1, Math.min(20, Number((q && q.count) || 1))); // 作品资料页选了「续更 5 章」带过来的
    this.autoAudit = q.auto === 'audit'; // 从作品资料页点「一致性体检」进来：进来直接开跑
    this.setData({ showDir: q.openDir === '1' });
  },
  onUnload() { this.setData({ fixingIdx: -1, fixBusy: false }); },
  onHide() { this.setData({ fixingIdx: -1, fixBusy: false }); },
  async onShow() {
    await this.ensureNovel();
    await this.loadChapters();
    await this.loadAuditBadge(); // 上次体检还没修的问题数：入口挂角标，退出小程序也不丢
    if (this.autoAudit && !this.data.busy) {
      this.autoAudit = false; // 只自动触发一次
      this.pickAudit(); // 进来先问"查什么"，别默认替作者决定
      return;
    }
    if (!this.autoNext || this.data.busy) return;
    this.autoNext = false; // 只自动触发一次，否则每次回到本页都会再写一章
    if (this.data.bibleStatus !== 'done') {
      wx.showToast({ title: '先点下面按钮生成全书脉络', icon: 'none', duration: 2500 });
      return;
    }
    this.nextChapter(this.autoCount);
  },
  /** 起一根进度条：title 是任务名，之后每次轮询用 onProg 推进它 */
  startProg(title) { this.setData({ prog: { show: true, title, pct: 0, done: 0, total: 0, current: '启动…', steps: [] } }); },
  /** 轮询回调：把后端进度铺到进度条上 */
  onProg(title, p) { this.setData({ prog: progOf(title, p) }); },
  endProg() { this.setData({ prog: null }); },
  /** 兜底：全局缓存也丢了才用，取最近更新的作品（顺序不一定对，仅救命） */
  async latestNovelId() {
    const list = await request(`/novel?platform=${app.globalData.platform}`);
    return (list && list.length && list[0].id) || '';
  },
  async ensureNovel() {
    const id = this.enterId || app.globalData.novelId || await this.latestNovelId();
    if (!id) { wx.showToast({ title: '请先新建作品', icon: 'none' }); return; }
    app.globalData.novelId = id;
    const nov = await request(`/novel/${id}`);
    this.setData({
      novelId: id, novelTitle: nov.title, platform: nov.platform,
      bibleStatus: nov.bibleStatus || '', chapterWords: nov.chapterWords || 2000,
    });
  },

  /** 空作品出口①：一键把「全书脉络 + 上架资料 + 黄金 1-3 章」补齐 */
  async genAll() {
    if (!this.data.novelId || this.data.busy) return;
    const onlyGolden = this.data.bibleStatus === 'done';
    this.setData({ busy: true, steps: [], taskText: '启动…' });
    this.startProg('定版（全书脉络 + 资料 + 黄金三章）');
    try {
      await runFinalize(this.data.novelId, { onlyGolden }, (p) => {
        this.setData({ steps: p.steps || [], taskText: runningText(p.steps) });
        this.onProg('定版（全书脉络 + 资料 + 黄金三章）', p);
      });
      this.endProg();
      this.setData({ busy: false });
      await this.ensureNovel();
      await this.loadChapters();
      wx.showToast({ title: '章节已生成', icon: 'success' });
    } catch (e) {
      this.endProg();
      this.setData({ busy: false });
      wx.showToast({ title: '生成失败，可再点一次', icon: 'none', duration: 2500 });
    }
  },

  /** 空作品出口②：回到向导第④步生成 / 调整大纲 */
  goOutline() { wx.navigateTo({ url: `/pages/wizard/wizard?id=${this.data.novelId}&step=4` }); },
  async loadChapters() {
    const id = this.data.novelId;
    if (!id) return;
    const vols = await request(`/novel/${id}/chapters`);
    const flat = [];
    (vols || []).forEach((v) => v.chapters.forEach((c) => flat.push(c)));
    const cur = flat.length ? flat[flat.length - 1] : null;
    this.setData({ volumes: vols || [], flat, cur });
  },
  openDir() { this.setData({ showDir: true }); },
  closeDir() { this.setData({ showDir: false }); },
  selectChapter(e) {
    const ch = e.currentTarget.dataset.ch;
    this.setData({ cur: ch, showDir: false, editing: false });
  },
  noop() {},
  prev() {
    const i = this.data.flat.findIndex((c) => c.id === this.data.cur.id);
    if (i > 0) this.setData({ cur: this.data.flat[i - 1], editing: false });
  },
  next() {
    const i = this.data.flat.findIndex((c) => c.id === this.data.cur.id);
    if (i < this.data.flat.length - 1) this.setData({ cur: this.data.flat[i + 1], editing: false });
  },
  onContent(e) { this.setData({ ['cur.content']: e.detail.value }); },
  async save() {
    const len = (this.data.cur.content || '').length;
    const min = this.data.chapterWords || 2000;
    if (len < min) {
      const ok = await new Promise((res) => {
        wx.showModal({
          title: '字数不足',
          content: `当前正文约 ${len} 字，平台要求每章最少 2000 字。仍要保存？`,
          success: (r) => res(!!r.confirm),
        });
      });
      if (!ok) return;
    }
    const title = stripNo(this.data.cur.title);
    await request(`/novel/${this.data.novelId}/chapter/${this.data.cur.id}`, 'PUT', {
      title, content: this.data.cur.content, status: 'done',
    });
    wx.showToast({ title: '已保存', icon: 'success' });
    // 顺手把脏前缀从内存里也洗掉，避免继续显示「第1章 第1章 …」
    this.setData({ editing: false, 'cur.title': title });
  },
  copyName() { copy(stripNo(this.data.cur.title)); },
  copyContent() { copy(this.data.cur.content || ''); },
  /** 点「续写」先选续更几章：作者不想一章一章点，选 5 章就一次写完 */
  pickNextCount() {
    if (this.data.busy) return;
    const that = this;
    wx.showActionSheet({
      itemList: NEXT_COUNTS.map((c) => (c === 1 ? '续更 1 章' : `一次续更 ${c} 章`)),
      success(r) {
        const c = NEXT_COUNTS[r.tapIndex];
        if (c) that.nextChapter(c);
      },
      fail() {}, // 作者点了取消：什么都不做
    });
  },
  /**
   * 续更：连写 N 章（承接上章章末钩子，@param n 章数，默认 1）。
   * 走后台任务：一章要跑 40 秒以上，挂在单次请求上退出小程序就断了；
   * 现在退出也照写，回来还能看到"写到第几步"。每章写完顺带自检矛盾并当场改。
   */
  async nextChapter(n) {
    const id = this.data.novelId;
    if (!id || this.data.busy) return;
    const count = Math.max(1, Math.min(20, Number(n) || 1));
    const order = this.data.flat.length + 1;
    const range = count > 1 ? `第 ${order}~${order + count - 1} 章` : `第 ${order} 章`;
    this.setData({ busy: true, editing: false, jobText: `准备写${range}…` });
    const pTitle = `续写${range}`;
    this.startProg(pTitle);
    try {
      // 章数越多给的时间越长：一章约 40~90 秒（含自检），10 章差不多要 15 分钟
      const job = await runJob(id, 'chapter', (jb) => {
        const txt = jobText(jb);
        this.setData({ jobText: txt });
        this.onProg(pTitle, jb);
      }, { wordCount: this.data.chapterWords || 2000, count, maxMs: (20 + count * 4) * 60000 });
      this.endProg();
      await this.loadChapters();
      const flat = this.data.flat;
      const res = (job && job.result) || {};
      const heal = res.heal || '';
      const hinfo = res.healInfo || {};
      this.setData({ cur: flat[flat.length - 1], busy: false, jobText: '' });
      const title = count > 1 && res.count ? `已续更 ${res.count} 章（${res.from}~${res.to}）` : `第 ${order} 章已生成`;
      // 续更就是发布：写完已经做过"发布前自检"，把查到并改了什么直接告诉作者
      if (heal.indexOf('自检发现') === 0) {
        const tail = hinfo.left
          ? `。还有 ${hinfo.left} 处程序改不了，建议先处理再发布。`
          : '。已修干净，可以发布。';
        wx.showModal({ title, content: `共 ${res.words || 0} 字。发布前自检：${heal}${tail}`, showCancel: false, confirmText: '知道了' });
      } else {
        wx.showToast({ title: `${title}·自检通过`, icon: 'success', duration: 2500 });
      }
    } catch (e) {
      this.endProg();
      this.setData({ busy: false, jobText: '' });
      wx.showToast({ title: (e && e.message) || '生成失败，再点一次', icon: 'none', duration: 2500 });
    }
  },
  goBot() { wx.navigateTo({ url: '/pages/bot/bot' }); },

  /**
   * 一键体检（后台任务）：代码硬扫 + AI 语义核对 + 撞车比对。
   * 结果既存服务端也留在页面：退出小程序再进来，入口上仍挂着"还有 N 处没修"的角标。
   * @param {boolean} force true=忽略缓存重算（稿子改了要重算）
   */
  /**
   * 体检。结果既存服务端也留在页面：退出小程序再进来，入口上仍挂着"还有 N 处没修"的角标。
   *
   * @param {boolean} full false（默认）= 收敛式复检：代码核验旧清单 + AI 只审刚改动过的地方。
   *                          清单只会因为"真修掉了"而变短，不会每点一次又冒出一批新的。
   *                        true = 全书重新审一遍（慢、烧额度），作者想彻底重查时才用。
   */
  /** 点「一键体检」先选查什么：查矛盾 / 查撞车 / 两个都查 */
  pickAudit() {
    if (this.data.auditing) return;
    const that = this;
    wx.showActionSheet({
      itemList: AUDIT_SCOPES.map((s) => s.t),
      success(r) {
        const it = AUDIT_SCOPES[r.tapIndex];
        if (it) that.audit(false, it.k);
      },
      fail() {}, // 作者取消：什么都不做
    });
  },
  async audit(full, scope) {
    const id = this.data.novelId;
    if (!id || this.data.auditing) return;
    const sc = scope || this.data.auditScope || 'all';
    this.setData({ auditScope: sc }); // 记住选择：下次「重新体检」沿用同一口径
    const name = (AUDIT_SCOPES.find((s) => s.k === sc) || AUDIT_SCOPES[0]).t;
    const title = full ? '全书重新审一遍' : name;
    this.setData({ auditing: true, auditResult: null, auditText: '启动体检…' });
    this.startProg(title);
    try {
      await runJob(id, 'audit', (jb) => {
        this.setData({ auditText: jobText(jb) });
        this.onProg(title, jb);
      }, { force: !!full, scope: sc });
      this.endProg();
      // 后台任务里已跑完并存库（含 autoFix / human / dup / options 四块），这里只取结果，不重复烧额度。
      // 注意 GET /audit 返回的是 {audit, stale} 外壳，真正的报告在 .audit 里 —— 取错层会被误判成"没结果"
      const got = await request(`/novel/${id}/audit`);
      let data = (got && got.audit) || null;
      // 兜底：任务跑完了却没读到结果（写入时序 / 旧数据被清），同步再算一次，绝不让作者"点了没反应"
      if (!data) data = await request(`/novel/${id}/audit?scope=${sc}`, 'POST', {});
      if (!data || !data.issues) throw new Error('体检没有返回结果，请再点一次');
      // 稿子改过 → 这份清单是旧的（页面上要明确提示，别让作者拿旧清单反复修）
      if (got && got.stale) data.stale = true;
      this.applyAudit(data);
    } catch (e) {
      this.endProg();
      this.setData({ auditing: false, auditText: '' });
      wx.showToast({ title: (e && e.message) || '体检失败，可再点一次', icon: 'none', duration: 2500 });
    }
  },
  /**
   * 把体检结果铺到页面：分组（可自动修 / 需你拍板）+ 未解决角标。
   * 撞车候选名一并整理成 picks：[{title, risk, note, plot}]，
   * plot 是这个名配套的"已预检差异化剧情"，改名时一起写进大纲，避免换个名还是撞。
   */
  applyAudit(r) {
    const issues = (r && r.issues) || [];
    if (r && r.dup) {
      r.dup.picks = this.buildDupPicks(r.dup);
      if (r.scope === 'consistency') r.dup.kept = true; // 只查矛盾：撞车沿用上次结论，页面要写明
    }
    this.setData({
      auditing: false,
      auditText: '',
      auditResult: r,
      showAudit: true, // 直接全屏弹出来，绝不"点了没反应/看不到"
      openBadge: issues.length,
      openAudit: r,
      fixingIdx: -1, // 新一轮体检：清掉上一轮可能卡住的"修复中"
    });
    const dup = r && r.dup && r.dup.risk !== 'low';
    const fixable = (r && r.fixableCount) || 0;
    const cleared = Number((r && r.resolvedCount) || 0);
    wx.showToast({
      title: issues.length
        ? `还剩 ${issues.length} 处（可自动修 ${fixable}）${dup ? ' + 撞车' : ''}`
        : (cleared ? `已清掉 ${cleared} 处，全清了` : '没发现明显矛盾'),
      icon: 'none',
      duration: 2500,
    });
  },
  /** 候选书名整理成统一结构；没有预检数据时用剧情建议兜底，保证永远有得选（不卡死） */
  buildDupPicks(dup) {
    const checks = dup.titleChecks || [];
    if (checks.length) return checks.map((c) => ({ title: c.title, risk: c.risk || '', note: c.note || '', plot: c.plot || dup.plotAdvice || '' }));
    return (dup.titleSuggestions || []).map((t) => ({ title: t, risk: '', note: '', plot: dup.plotAdvice || '' }));
  },
  /** 换一批推荐名：作者嫌这批不好就再取一批（同样逐个预检过） */
  async moreTitles() {
    const id = this.data.novelId;
    const dup = this.data.auditResult && this.data.auditResult.dup;
    if (!id || !dup) return;
    wx.showLoading({ title: '换一批推荐名…', mask: true });
    try {
      const r = await request(`/novel/${id}/title-suggest`, 'POST', {
        exclude: (dup.picks || []).map((x) => x.title),
      });
      const d = Object.assign({}, dup, { titleChecks: r.titleChecks || [], titleSuggestions: r.titleSuggestions || [], picks: this.buildDupPicks(Object.assign({}, dup, r)) });
      this.setData({ 'auditResult.dup': d });
      wx.hideLoading();
      if (!d.picks.length) wx.showToast({ title: '没取到新名字，再点一次', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '换名失败，再点一次', icon: 'none' });
    }
  },
  /**
   * 进入页面时把"上次体检还没修的问题数"拉回来（退出小程序也不丢）。
   * 【坑·已修】稿子改过（指纹变了）之后旧结果已作废 —— 以前照样把 125 处挂成角标，
   * 而那批矛盾其实早就随整部重做消失了。现在 stale=true 一律不挂角标。
   */
  async loadAuditBadge() {
    const id = this.data.novelId;
    if (!id) return;
    try {
      const r = await request(`/novel/${id}/audit`);
      const cnt = (!r.stale && r.audit && r.audit.issues) ? r.audit.issues.length : 0;
      this.setData({ openBadge: cnt, openAudit: r.stale ? null : (r.audit || null) });
    } catch (e) { /* 没体检过就算了 */ }
  },
  openAudit() {
    if (this.data.auditResult) this.setData({ showAudit: true });
    else if (this.data.openAudit) this.applyAudit(this.data.openAudit);
    else this.audit();
  },
  closeAudit() { this.setData({ showAudit: false }); },
  /** 重新体检：默认走收敛式复检（快、清单只减不增，不会每点一次又冒一批新的） */
  /** 重新体检：沿用上次选的口径（只查矛盾就还是只查矛盾，不会偷偷把撞车也查一遍） */
  reAudit() { return this.audit(false, this.data.auditScope || 'all'); },
  /** 全书重新审一遍：作者想彻底重查时才用（慢、烧额度，可能报出新的主观问题） */
  reAuditAll() {
    const that = this;
    wx.showModal({
      title: '全书重新审一遍',
      content: '会把这 3 章从头到尾重新交给 AI 找问题。注意：AI 每次都能找出一些新的"可优化"意见，'
        + '所以重审后条数可能变多 —— 这不是之前白修了。日常只要点「重新体检」就够了。',
      confirmText: '仍然重审',
      success(r) { if (r.confirm) that.audit(true, that.data.auditScope || 'all'); },
    });
  },

  /**
   * 一键修复（后台任务，带进度）：**后台连跑最多 3 轮"定点修复 → 复检 → 再修"，一次修到干净。**
   * opinion 有值时表示作者已选定方向 → 连"需要拍板"的问题一起修。
   */
  async fixAll(e) {
    const id = this.data.novelId;
    const opinion = (e && e.currentTarget && e.currentTarget.dataset.opinion) || '';
    if (!id || this.data.fixBusy) return;
    // 已有单条在修时不让批量插队：两个重写任务同时改同一章会互相覆盖
    if (this.data.fixingIdx >= 0) { wx.showToast({ title: '正在单条修复，稍等', icon: 'none' }); return; }
    const r0 = this.data.auditResult || {};
    const total = (r0.issues || []).length;
    const n = opinion
      ? (r0.issues || []).filter((x) => x.chapter).length
      : (r0.fixableCount || 0);
    if (!n) { wx.showToast({ title: '没有可自动修复的问题', icon: 'none' }); return; }
    const humanN = Math.max(0, total - n);
    const ok = await new Promise((res) => wx.showModal({
      title: opinion ? '按选定方向修复' : '一键修复（修到干净）',
      content: `本次修「可自动修」的 ${n} 处${humanN ? `；体检共 ${total} 处，另有 ${humanN} 处需要你拍板（不在本次范围）` : ''}。`
        + `\n改法是逐句定点替换：只改有问题的那一句，其余正文一字不动。`
        + `\n后台会自动连跑最多 3 轮"修复 → 复检 → 再修"，争取一次修完，不用你反复点。`
        + `\n耗时可能几分钟，期间可退出小程序，任务在服务端继续跑。`,
      confirmText: '开始修复',
      success: (r) => res(!!r.confirm),
    }));
    if (!ok) return;
    this.setData({ fixBusy: true, fixingIdx: -1, fixText: '启动修复…' });
    const pTitle = opinion ? '按选定方案修复' : '一键修复';
    this.startProg(pTitle);
    try {
      const jb = await runJob(id, 'fix', (j) => {
        this.setData({ fixText: jobText(j) });
        this.onProg(pTitle, j);
      }, { opinion });
      this.endProg();
      await this.loadChapters();
      /**
       * 读回服务端清单（已按"修一条划一条"记好账）。
       * 【坑·已修】以前修完立刻 `?force=1` 全量重体检 —— AI 换一批说法就变成
       * "刚修完又变回 5 项"，作者以为白修了。现在只读回账本，不主动重算；
       * 想复核由作者自己点顶部的「重新体检」（收敛复检，不会再冒新的一批）。
       */
      const got = await request(`/novel/${id}/audit`, 'GET');
      const data = (got && got.audit) || null;
      this.setData({ fixBusy: false, fixText: '' });
      if (data) this.applyAudit(data);
      const res = (jb && jb.result) || {};
      const bad = (res.msgs || []).slice(0, 5);
      const left = Number((data && data.fixableCount) || 0);
      wx.showModal({
        title: res.done ? '✅ 已修到干净' : '本轮修复完成',
        content: `${res.note || `已处理 ${n} 处`}`
          + (bad.length ? `\n\n这几条没能改掉（正文未动）：\n${bad.join('\n')}` : '')
          + (left && !res.done ? `\n\n还剩 ${left} 条可自动修的，再点一次「一键修复」即可继续。` : '')
          + `\n\n想复核就点顶部的「重新体检」（只复审，不会又冒出一批新的）。`,
        showCancel: false,
        confirmText: '知道了',
      });
    } catch (e2) {
      this.endProg();
      this.setData({ fixBusy: false, fixingIdx: -1, fixText: '' });
      wx.showToast({ title: (e2 && e2.message) || '修复失败，可再试', icon: 'none', duration: 2500 });
    }
  },
  /**
   * 单条修复：只修一处（后端按这一条的 fix 重写它所在的章）。
   * 【坑·已修】以前用全局 fixBusy 控制文案，点第 3 条时第 1/2/4 条也一起变成"修复中…"，
   * 而且一旦那个任务卡住，整列按钮永远停在"修复中"再也点不动。
   * 现在改成 fixingIdx：只有真正在修的那一条显示"修复中"，其它照旧可点。
   * 【坑·已修2】"显示修复中但其实没修掉"：改完拿正文做前后比对验收，
   * AI 一个字没动的，不给划掉、不加分，直接告诉作者这条没改成功。
   */
  async fixOne(e) {
    const idx = Number(e.currentTarget.dataset.i);
    const list = (this.data.auditResult && this.data.auditResult.autoFix) || [];
    const x = list[idx];
    if (!x || !x.chapter) return;
    if (this.data.fixingIdx === idx) return; // 这一条正在修，重复点忽略
    if (this.data.fixBusy) { wx.showToast({ title: '批量修复中，稍等', icon: 'none' }); return; }
    const ch = (this.data.flat || []).find((c) => c.order === x.chapter);
    if (!ch) { wx.showToast({ title: '找不到这一章', icon: 'none' }); return; }
    this.setData({ fixingIdx: idx });
    wx.showLoading({ title: '正在改这一句…', mask: true });
    try {
      // 【定点替换】只改正文里出问题的那一句，其余整章一个字节不动。
      // 以前走"重写整章"：AI 顺手改几十句 → 修一处冒三处（实测 60 处 → 修完 99 处）。
      const r = await request(`/novel/${this.data.novelId}/chapter/${ch.id}/patch`, 'POST', {
        quote: x.quote, why: x.why, fix: x.fix, level: x.level, type: x.type, chapter: x.chapter,
      });
      wx.hideLoading();
      this.setData({ fixingIdx: -1 });
      if (!r || !r.ok) {
        // 没真改掉就不划掉、不加分 —— 直接告诉作者为什么（不再假装"已修复"）
        wx.showModal({
          title: '这条没能改掉',
          content: (r && r.reason) || 'AI 没给出可用的改法，你的正文没有被改动。',
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      await this.loadChapters();
      const gain = await this.dropIssue(x);
      // 把"改前 → 改后"直接摆出来，作者自己核验真的改了
      wx.showModal({
        title: `已改掉 · 分数 +${gain}`,
        content: `原句：${r.oldText}\n\n改后：${r.newText}`,
        showCancel: false,
        confirmText: '好',
      });
    } catch (err) {
      wx.hideLoading();
      this.setData({ fixingIdx: -1 });
      wx.showToast({ title: (err && err.message) || '修复失败', icon: 'none', duration: 2500 });
    }
  },
  /**
   * 修完一条，当场把这一条从清单里划掉并重算分（360 体检那种"修一个加一点"的手感）。
   * 同时同步给服务端，退出小程序再进来角标也是减过的。
   * @returns {number} 本次加了多少分
   */
  async dropIssue(x) {
    const P = { 高: 8, 中: 4, 低: 2 };
    const r = this.data.auditResult || {};
    const same = (it) => String((it && it.quote) || '') === String((x && x.quote) || '');
    const issues = (r.issues || []).filter((it) => !same(it));
    const autoFix = (r.autoFix || []).filter((it) => !same(it));
    const human = (r.human || []).filter((it) => !same(it));
    // 旧体检报告的分是 AI 印象分，和扣分制不是一个基准 —— 保留偏移量，才不会"修好一条反而降分"
    const offset = (Number(r.score) || 0) - this.scoreOf(r.issues || [], r.dup);
    const score = Math.max(0, Math.min(100, this.scoreOf(issues, r.dup) + offset));
    let gain = P[x.level] || 2;
    const nr = Object.assign({}, r, {
      issues, autoFix, human, score,
      fixableCount: autoFix.length,
      resolvedCount: (Number(r.resolvedCount) || 0) + 1,
    });
    this.setData({ auditResult: nr, openBadge: issues.length, openAudit: nr });
    try {
      // 以服务端为准（它算的才是最终落库的分），本地先乐观更新保证手感
      const res = await request(`/novel/${this.data.novelId}/audit-resolve`, 'POST', { quote: x.quote });
      if (res && res.ok) {
        gain = res.gain || gain;
        const fixed = Object.assign({}, nr, { score: res.score });
        this.setData({ auditResult: fixed, openBadge: issues.length, openAudit: fixed });
      }
    } catch (e) { /* 同步失败不影响页面上的即时反馈 */ }
    return gain;
  },
  /** 360 式打分：每处矛盾按等级扣分，撞车另扣。修一条就把这分加回来 */
  scoreOf(issues, dup) {
    const P = { 高: 8, 中: 4, 低: 2 };
    const pen = (issues || []).reduce((s, it) => s + (P[it.level] || 2), 0);
    const dupPen = (dup && dup.risk) === 'high' ? 12 : (dup && dup.risk) === 'mid' ? 5 : 0;
    return Math.max(0, Math.min(100, 100 - pen - dupPen));
  },
  /** 体检发现"脉络是空的"时，一键回向导第④步补生成大纲（没有大纲就没有中轴线） */
  goReoutline() {
    const id = this.data.novelId;
    if (!id) return;
    wx.navigateTo({ url: `/pages/wizard/wizard?id=${id}&step=4` });
  },
  /**
   * 体检里查出撞车，点「用这个」换名：改名 → 按差异化建议重出大纲 → 回向导重新定版。
   * 换名会让大纲与旧章节整体作废（后端自动处理），所以必须引导回向导定版，而不是留在本页。
   */
  async applyDupTitle(e) {
    const title = e.currentTarget.dataset.t;
    const id = this.data.novelId;
    if (!id || !title || this.data.busy) return;
    const dup = (this.data.auditResult && this.data.auditResult.dup) || {};
    // 用这个名**配套的**已预检差异化剧情（不是通用建议），改名+重写大纲一次做到位
    const pick = ((dup.picks) || []).find((x) => x.title === title);
    const advice = (pick && pick.plot) || dup.plotAdvice || '';
    this.setData({ busy: true, jobText: '启动撞车修复…' });
    wx.showLoading({ title: '启动撞车修复…', mask: true });
    try {
      // 完整流水线：换名 → 重出大纲 → 重建脉络 → 重出作品简介 → 重写黄金三章 → 重出封面 → 复查重
      await request(`/novel/${id}/dup-fix`, 'POST', { title, plot: advice });
      const job = await runJob(id, 'dupfix', (j) => {
        const t = jobText(j);
        this.setData({ jobText: t });
        wx.showLoading({ title: t.slice(0, 13), mask: true });
      });
      wx.hideLoading();
      this.setData({ busy: false, jobText: '', auditResult: null, showAudit: false, novelTitle: title });
      const note = ((job && job.steps) || []).map((s) => `${s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '○'} ${s.label}`).join('\n');
      wx.showModal({
        title: '撞车修复完成',
        content: `${note}\n\n大纲 / 全书脉络 / 作品简介 / 黄金三章 / 封面 都已按《${title}》重新生成。`,
        confirmText: '知道了',
        showCancel: false,
      });
      await this.loadChapters();
    } catch (err) {
      wx.hideLoading();
      this.setData({ busy: false });
      wx.showModal({
        title: '换名失败',
        content: ((err && err.message) || '未知错误') + '\n\n可稍等几秒再点一次；若提示"已有任务在跑"，等上一个任务结束再试。',
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },
  // 重写：填原因 -> AI 按意图改写本章
  openRewrite() { this.setData({ showRewrite: true, rewriteReason: '' }); },
  closeRewrite() { this.setData({ showRewrite: false }); },
  onRewriteReason(e) { this.setData({ rewriteReason: e.detail.value }); },
  async doRewrite() {
    const reason = this.data.rewriteReason.trim();
    if (!reason) { wx.showToast({ title: '请填写重写原因', icon: 'none' }); return; }
    this.setData({ showRewrite: false });
    wx.showLoading({ title: 'AI 重写中…' });
    try {
      const ch = await request(`/novel/${this.data.novelId}/chapter/${this.data.cur.id}/rewrite`, 'POST', { reason });
      const flat = this.data.flat.map((c) => (c.id === ch.id ? ch : c));
      this.setData({ cur: ch, flat, loading: false });
      wx.hideLoading();
      wx.showToast({ title: '已重写', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '重写失败', icon: 'none' });
    }
  },
});
