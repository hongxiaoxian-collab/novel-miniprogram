const app = getApp();
const { request } = require('../../utils/request');
const { copy } = require('../../utils/clipboard');
const { runFinalize, runningText, runJob, waitJob, jobText, progOf } = require('../../utils/task');
const { getPen, ensurePen } = require('../../utils/pen');

const DEFAULT_TOPICS = ['都市', '玄幻', '悬疑', '历史', '科幻', '重生', '机械'];
// 命中这些关键词的题材，倾向推荐女频
const FEMALE_HINTS = ['甜宠', '总裁', '古言', '现言', '空间', '种田', '甜妻'];
/** 后端「严重撞车中断定版」的错误前缀（与 backend/src/novel/novel.service.ts 的 DUP_HIGH 必须一致） */
const DUP_HIGH = 'DUP_HIGH｜';
/** 「存在相似」也中断定版（后端 DUP_MID，前缀必须一致） */
const DUP_MID = 'DUP_MID｜';
// 向导草稿：小程序被系统回收 / 用户误退出后，回来接着填
const DRAFT_KEY = 'wizardDraft';
/** 书名不带书名号：AI 常顺手带上《》，落库/展示前统一洗掉 */
const cleanTitleText = (t) => String(t || '').replace(/[《》<>【】\[\]]/g, '').trim();

// 按已选题材推荐目标读者
function pickReaderBy(genres, platform) {
  const isFemale = genres.some((g) => FEMALE_HINTS.some((h) => g.indexOf(h) >= 0));
  return isFemale ? (platform === 'qimao' ? '女生' : '女频')
                  : (platform === 'qimao' ? '男生' : '男频');
}

Page({
  data: {
    platform: 'fanqie',
    step: 1,
    topics: DEFAULT_TOPICS,
    genres: [], genreText: '', genre: '',
    reader: '', readerOptions: [], contract: '',
    chapterWords: 2000,
    customTopic: '', recTopics: [], showRec: false,
    novelId: '', outline: null, loading: false,
    opinion: '',
    titleEdit: '',        // 作品名（可直接编辑）
    dupReport: null,      // 撞车检测报告
    dupAccepted: '',      // 作者已选定的书名（重出大纲时锁死，不让 AI 再改回别的名）
    dupRound: 0,           // 已换过几轮名字（撞车循环计数，给作者看进度）
    dupFixSteps: [],       // 撞车一键修复的流水线进度
    prog: null,            // 统一进度条（定版 / 出大纲 / 撞车修复 共用）
    myTitle: '',           // 作者自己起的书名
    myTitleCheck: null,    // 自己起的书名的预检结果
    checking: false,      // 查重中
    steps: [],            // 定版任务进度
    taskText: '',         // 当前阶段文案
    taskError: '',        // 定版失败原因
    draftTip: '',         // 恢复进度提示
    staleTip: '',         // 换名/改大纲后旧章节作废提示
    pen: '',
    // ---- AI 扫榜选题：作者只给平台，书名/男女频/题材/金手指全由 AI 定 ----
    planMode: false,      // true=正在看 AI 给的 3-5 个方案
    plan: null,           // {board:{...}, cheats:[...], plans:[...]}
    planId: '',
    planLoading: false,
    planOpinion: '',      // 作者的一句话想法（可选，其余全交给 AI）
    polishNote: '',       // 黄金三章打磨结果
  },
  onLoad(q) {
    this.enterId = (q && q.id) || ''; // 进入时的作品 id，页面状态被回收时可兜底
    this.setData({ platform: app.globalData.platform, pen: getPen() });
    this.syncReaderOptions();
    if (q && q.id) this.resume(q.id);        // 从作品列表点进来：恢复该作品，直接停在④生成大纲
    else if (q && q.fresh) this.freshStart(); // 点「新建小说」进来：全新一本，绝不带出上一部
    else this.restoreDraft();                 // 其它情况（被系统回收后回来）：接着上次没填完的填
  },
  /**
   * 全新开始：清草稿 + 断掉"上一部作品"的所有关联。
   * 【作者反馈】点「新建小说」却再次出现刚删掉的那部小说，就是因为草稿里存着旧作品 id，
   * 连同 app.globalData.novelId 一起被继承下来（curId() 还会回退到它），于是新建流程全程对着旧作品操作。
   */
  freshStart() {
    this.clearDraft();
    app.globalData.novelId = '';
    this.setData({
      novelId: '', draftTip: '', step: 1, outline: null, titleEdit: '', dupReport: null,
      planMode: false, plan: null, planId: '', polishNote: '',
    });
  },
  /**
   * 当前作品 id。三级回退：页面状态 → 全局 → 进入时的 URL 参数。
   * 【教训】曾经只有 resume() 设了 app.globalData.novelId 而漏设 this.data.novelId，
   * 导致第④步的「立即查重 / 定版 / 重来」全部失效（前两个静默 return，看起来像按钮坏了）。
   */
  curId() {
    const id = this.data.novelId || app.globalData.novelId || this.enterId || '';
    if (id && id !== this.data.novelId) this.setData({ novelId: id }); // 自愈回写，后续调用直接命中
    return id;
  },
  /** 取不到作品时统一提示（绝不静默失败） */
  needId() {
    const id = this.curId();
    if (!id) wx.showToast({ title: '作品未关联，请返回重新进入', icon: 'none', duration: 2500 });
    return id;
  },

  // ---------- 进度持久化：小程序随时可能被回收，填一半不能白填 ----------
  saveDraft() {
    const d = this.data;
    const draft = {
      platform: d.platform, step: d.step, genres: d.genres, genre: d.genre,
      genreText: d.genreText, reader: d.reader, contract: d.contract,
      chapterWords: d.chapterWords, novelId: d.novelId, outline: d.outline,
      titleEdit: d.titleEdit, planId: d.planId, planMode: d.planMode, ts: Date.now(),
    };
    try { wx.setStorageSync(DRAFT_KEY, draft); } catch (e) { /* 忽略 */ }
  },
  async restoreDraft() {
    let d = null;
    try { d = wx.getStorageSync(DRAFT_KEY); } catch (e) { d = null; }
    if (!d || !d.genres || !d.genres.length) return;
    // 【实战事故·死循环】草稿里记的作品可能已被作者删掉。直接恢复 → 后面每一步都对着一个不存在的 id
    // 操作（重出大纲必失败），作者看到的就是"删了重做还是这部、卡在这里出不去"。
    // 所以先问服务端这个作品还在不在：不在了就丢弃草稿，干净地从第①步重新开始。
    if (d.novelId && !(await this.novelAlive(d.novelId))) {
      this.clearDraft();
      app.globalData.novelId = '';
      this.setData({ novelId: '', step: 1 });
      wx.showToast({ title: '上次的作品已删除，已开始新的一本', icon: 'none', duration: 2500 });
      return;
    }
    this.setData({
      platform: d.platform || this.data.platform,
      step: d.step || 1,
      genres: d.genres,
      genre: d.genre || d.genres.join('·'),
      genreText: d.genreText || d.genres.join('、'),
      reader: d.reader || '',
      contract: d.contract || 'signing',
      chapterWords: d.chapterWords || 2000,
      novelId: d.novelId || '',
      outline: d.outline || null,
      titleEdit: d.titleEdit || '',
      planId: d.planId || '',
      planMode: !!d.planMode,
      draftTip: '已恢复上次没走完的进度',
    });
    if (d.novelId) app.globalData.novelId = d.novelId;
    // 恢复到"正在看 AI 方案"这一步：方案存在服务端，拉回来接着挑，不用重新扫一遍榜
    if (d.planId && d.planMode) {
      request(`/novel/plan/${d.planId}`).then((plan) => {
        if (plan && (plan.plans || []).length) this.setData({ plan, planMode: true });
        else this.setData({ planMode: false });
      }).catch(() => this.setData({ planMode: false }));
    }
    this.setData({ readerOptions: d.platform === 'qimao' ? ['男生', '女生'] : ['男频', '女频'] });
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: d.platform === 'qimao' ? '#2b6cff' : '#07c160',
    });
  },
  clearDraft() {
    this.setData({ draftTip: '' });
    try { wx.removeStorageSync(DRAFT_KEY); } catch (e) { /* 忽略 */ }
  },
  /**
   * 作品是否还在服务端。只有明确 404（作品不存在）才算"被删了"，
   * 网络抖动 / 后端没起来都当作还在，免得一次超时就把作者填了一半的草稿弄丢。
   */
  async novelAlive(id) {
    try { await request(`/novel/${id}`); return true; }
    catch (e) { return !(e && e.statusCode === 404); }
  },

  /** 恢复已有作品：题材/读者/签约/字数/作品名/大纲，未定版的可在这里接着定版 */
  async resume(id) {
    wx.showLoading({ title: '读取作品…' });
    try {
      const n = await request(`/novel/${id}`);
      const platform = n.platform || this.data.platform;
      const genres = (n.genre || '').split('·').filter(Boolean);
      app.globalData.platform = platform;
      app.globalData.novelId = id;
      this.setData({
        novelId: id,          // 【必须】否则第④步的查重/定版/重来全没反应
        platform,
        readerOptions: platform === 'qimao' ? ['男生', '女生'] : ['男频', '女频'],
        topics: this.data.topics.concat(genres.filter((g) => this.data.topics.indexOf(g) < 0)),
        genres,
        genreText: genres.join('、'),
        genre: n.genre || '',
        reader: n.targetReader || '',
        contract: n.contractStatus || 'signing',
        chapterWords: n.chapterWords || 2000,
        step: 4,
        outline: { title: n.title, sellPoint: n.sellPoint || '', outline: n.outline || '' },
        titleEdit: n.title || '',
        pen: n.penName || this.data.pen,
      });
      wx.setNavigationBarColor({
        frontColor: '#ffffff',
        backgroundColor: platform === 'qimao' ? '#2b6cff' : '#07c160',
      });
    } catch (e) {
      // 作品已被删除（草稿/全局还留着旧 id）→ 清干净回到第①步，别让作者对着一个不存在的作品反复点
      if (e && e.statusCode === 404) {
        this.clearDraft();
        app.globalData.novelId = '';
        this.setData({ novelId: '', step: 1 });
        wx.showToast({ title: '该作品已删除，请重新选题材', icon: 'none', duration: 2500 });
      } else {
        wx.showToast({ title: '作品读取失败', icon: 'none' });
      }
    }
    wx.hideLoading();
  },
  onPlatformChange(e) {
    this.setData({ platform: e.detail.platform });
    app.globalData.platform = e.detail.platform;
    try { wx.setStorageSync('platform', e.detail.platform); } catch (err) { /* 忽略 */ }
    this.syncReaderOptions();
    this.saveDraft();
  },
  syncReaderOptions() {
    const opts = this.data.platform === 'qimao' ? ['男生', '女生'] : ['男频', '女频'];
    const reader = this.data.genres.length ? pickReaderBy(this.data.genres, this.data.platform) : '';
    this.setData({ readerOptions: opts, reader });
  },

  // ---------- 题材：多选 ----------
  toggleGenre(t) {
    if (!t) return;
    const genres = this.data.genres.indexOf(t) >= 0
      ? this.data.genres.filter((v) => v !== t)
      : this.data.genres.concat([t]);
    this.setData({
      genres,
      genreText: genres.join('、'),
      genre: genres.join('·'), // 拼成展示串传给后端/AI
      reader: pickReaderBy(genres, this.data.platform),
    });
    this.saveDraft();
    wx.vibrateShort({ type: 'light', fail() {} });
  },
  pickTopic(e) { this.toggleGenre(e.currentTarget.dataset.t); },
  pickRec(e) { this.toggleGenre(e.currentTarget.dataset.t); }, // 点爆款题材不收起列表，可继续多选
  addTopic() {
    const v = this.data.customTopic.trim();
    if (!v) { wx.showToast({ title: '请先输入题材', icon: 'none' }); return; }
    const topics = this.data.topics.indexOf(v) >= 0 ? this.data.topics : this.data.topics.concat([v]);
    this.setData({ topics, customTopic: '' });
    this.toggleGenre(v);
  },
  onCustom(e) { this.setData({ customTopic: e.detail.value }); },
  onWords(e) { this.setData({ chapterWords: Number(e.detail.value) || 2000 }); this.saveDraft(); },
  async aiRecommend() {
    wx.showLoading({ title: 'AI 扫榜中…' });
    try {
      const r = await request('/novel/recommend-topic', 'POST', { platform: this.data.platform });
      this.setData({ recTopics: r.topics || [], showRec: true });
    } catch (e) {
      wx.showToast({ title: '推荐失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  // ---------- AI 扫榜选题：书名 / 男女频 / 题材 / 金手指 全部由 AI 定 ----------
  onPlanOpinion(e) { this.setData({ planOpinion: e.detail.value }); },
  /**
   * 一键：真扫榜（番茄/七猫男频女频）→ 找差异化金手指 → 出 3-5 个完整方案。
   * 作者在这一步只选平台（可选一句话想法），其余全交给 AI，最后从卡片里挑一本。
   */
  async aiPlan() {
    if (this.data.planLoading) return;
    this.setData({ planLoading: true });
    const pTitle = 'AI 扫榜选题（扫榜 → 金手指 → 出方案）';
    this.startProg(pTitle);
    wx.showLoading({ title: 'AI 扫榜中…', mask: true });
    try {
      const r = await request('/novel/plan', 'POST', {
        platform: this.data.platform,
        opinion: this.data.planOpinion || undefined,
        chapterWords: this.data.chapterWords,
      });
      const id = r.id;
      app.globalData.novelId = id;
      this.setData({ planId: id, novelId: id });
      const job = await waitJob(id, (j) => {
        const t = jobText(j);
        this.setData({ taskText: t });
        this.onProg(pTitle, j);
        wx.showLoading({ title: String(t).slice(0, 13), mask: true });
      }, 12 * 60 * 1000);
      const plan = (job && job.result) || await request(`/novel/plan/${id}`);
      this.endProg();
      wx.hideLoading();
      this.setData({ plan, planMode: true, planLoading: false, taskText: '' });
      this.saveDraft();
    } catch (e) {
      this.endProg();
      wx.hideLoading();
      this.setData({ planLoading: false, taskText: '' });
      wx.showToast({ title: (e && e.message) || '扫榜失败，再点一次', icon: 'none', duration: 2500 });
    }
  },
  backToTopic() { this.setData({ planMode: false }); },

  /** 选定第 i 个方案：落到作品上（书名/频道/题材/金手指/大纲），占位转正，进第④步可定版 */
  async pickPlan(e) {
    const idx = Number(e.currentTarget.dataset.i);
    const id = this.data.planId || this.curId();
    const plans = (this.data.plan && this.data.plan.plans) || [];
    if (!id || !plans[idx] || this.data.planLoading) return;
    this.setData({ planLoading: true });
    wx.showLoading({ title: '正在落定这本…', mask: true });
    try {
      const n = await request(`/novel/plan/${id}/pick`, 'POST', { idx, title: plans[idx].title });
      wx.hideLoading();
      app.globalData.novelId = id;
      this.setData({
        novelId: id,
        planMode: false,
        planLoading: false,
        plan: null,
        genres: String(n.genre || '').split('·').filter(Boolean),
        genre: n.genre || '',
        genreText: String(n.genre || '').replace(/·/g, '、'),
        reader: n.targetReader || '',
        contract: n.contractStatus || 'signing',
        step: 4,
      });
      this.applyOutline({ title: n.title, sellPoint: n.sellPoint || '', outline: n.outline || '', staleCount: 0 });
      this.saveDraft();
      wx.showToast({ title: '已选定，可点定版', icon: 'success', duration: 2000 });
      this.runCheckDup(true);
    } catch (err) {
      wx.hideLoading();
      this.setData({ planLoading: false });
      wx.showToast({ title: (err && err.message) || '选定失败，再点一次', icon: 'none', duration: 2500 });
    }
  },

  /** 精写打磨黄金三章：定版之后把开篇磨到能直接上架（字数/分段/去 AI 味/章末钩子） */
  async polishGolden() {
    const id = this.needId();
    if (!id) return;
    this.setData({ loading: true });
    const pTitle = '精写打磨黄金三章';
    this.startProg(pTitle);
    try {
      const job = await runJob(id, 'polish', (j) => {
        this.setData({ taskText: jobText(j) });
        this.onProg(pTitle, j);
      });
      this.endProg();
      const note = ((job && job.steps) || [])
        .map((s) => `${s.status === 'done' ? '✓' : '○'} ${s.label}：${s.note || s.error || ''}`).join('\n');
      this.setData({ loading: false, polishNote: note, taskText: '' });
      wx.showModal({ title: '黄金三章已打磨', content: note || '已完成', showCancel: false, confirmText: '知道了' });
    } catch (e) {
      this.endProg();
      this.setData({ loading: false, taskText: '' });
      wx.showToast({ title: (e && e.message) || '打磨失败，再点一次', icon: 'none', duration: 2500 });
    }
  },

  // ---------- 步骤 2/3 ----------
  pickReader(e) { this.setData({ reader: e.currentTarget.dataset.r }); this.saveDraft(); },
  pickContract(e) { this.setData({ contract: e.currentTarget.dataset.c }); this.saveDraft(); },
  /** 每一步都必须选好了才能往下走，缺什么就提示什么 */
  next() {
    const d = this.data;
    const miss = {
      1: !d.genres.length && '请至少选一个题材',
      2: !d.reader && '请先选择目标读者',
      3: !d.contract && '请选择签约模式',
    }[d.step];
    if (miss) { wx.showToast({ title: miss, icon: 'none' }); return; }
    this.setData({ draftTip: '' });
    if (d.step < 3) { this.setData({ step: d.step + 1 }); this.saveDraft(); return; }
    this.generateOutline();
  },
  back() {
    if (this.data.step <= 1) return;
    this.setData({ step: this.data.step - 1, draftTip: '' });
    this.saveDraft();
  },

  // ---------- 步骤 4：起名 + 大纲 ----------
  async generateOutline() {
    if (!this.data.genre) { wx.showToast({ title: '请先选题材', icon: 'none' }); return; }
    const existId = this.curId();
    this.setData({ loading: true });
    wx.showLoading({ title: existId ? '按新设定重做…' : '创建作品…' });
    try {
      // 笔名全局只确认一次，这里直接带入（封面必须含书名 + 笔名）
      const pen = getPen() || await ensurePen();
      const base = {
        platform: this.data.platform,
        genre: this.data.genre,
        targetReader: this.data.reader,
        contractStatus: this.data.contract || 'signing',
        chapterWords: this.data.chapterWords,
        penName: pen || undefined,
      };
      // 已有作品（如撞车后换题材重来）→ 按新设定更新重做；没有才新建，绝不能又建一部。
      // 【死循环·已修】旧 id 指向的作品可能已被删除：以前这里直接 PUT → 抛错 → 整段 catch 成
      // "生成失败，检查后端"，无论点多少次都失败。现在识别 404，当作没关联、自动新建一部。
      let id = existId;
      if (id) {
        try {
          await request(`/novel/${id}`, 'PUT', base);
        } catch (e) {
          if (!(e && e.statusCode === 404)) throw e;
          id = '';
          app.globalData.novelId = '';
        }
      }
      if (!id) id = (await request('/novel', 'POST', { ...base, title: this.data.genre + '作品' })).id;
      app.globalData.novelId = id;
      this.setData({ novelId: id, pen: pen || '' });
      // 出大纲走后台任务：要跑一两分钟，退出小程序也照出，回来能看到进度
      const job = await runJob(id, 'outline', (j) => {
        const t = jobText(j);
        this.setData({ taskText: t });
        wx.showLoading({ title: t.slice(0, 13), mask: true });
      });
      this.applyOutline((job && job.result) || await request(`/novel/${id}`));
      this.setData({ step: 4, loading: false, taskText: '' });
      this.saveDraft();
      wx.hideLoading();
      this.runCheckDup(true); // 【前置查重】书名一出就联网比对，不等定版才发现撞车
    } catch (e) {
      this.setData({ loading: false });
      wx.hideLoading();
      wx.showToast({ title: '生成失败，检查后端', icon: 'none' });
    }
  },
  applyOutline(out) {
    this.setData({
      outline: out,
      titleEdit: out.title || '',
      dupReport: null,   // 换了名/大纲，旧查重结果作废
      steps: [],
      taskError: '',
      draftTip: '',
      // 换了书名/大纲，旧章节自动作废：必须明确告诉作者，否则他会以为旧稿还在
      staleTip: out && Number(out.staleCount) > 0
        ? `已换书名 / 重出大纲：原有 ${out.staleCount} 章因设定变更被作废，定版后会按新设定从第 1 章重起。`
        : '',
    });
    this.saveDraft();
  },
  /**
   * 出大纲（后台任务 + 进度）：AI 起名 + 分卷章纲要跑一两分钟，
   * 挂在单次请求上一退出就断，现在退出小程序服务端照样出完。
   */
  async regen() {
    const id = this.curId();
    if (!id) { // 还没建过作品：直接送回第①步，不让用户在这页干卡着
      wx.showToast({ title: '还没有作品，先选题材', icon: 'none' });
      this.setData({ step: 1 });
      return;
    }
    this.setData({ loading: true, taskText: '启动…' });
    const pTitle = 'AI 起名 + 出大纲';
    this.startProg(pTitle);
    try {
      const job = await runJob(id, 'outline', (j) => {
        const t = jobText(j);
        this.setData({ taskText: t });
        this.onProg(pTitle, j);
      }, { opinion: this.data.opinion });
      this.endProg();
      const out = (job && job.result) || await request(`/novel/${id}`);
      this.applyOutline(out);
      this.setData({ opinion: '', loading: false, taskText: '' });
      wx.showToast({ title: '大纲已生成，可点定版', icon: 'success', duration: 2000 });
      this.runCheckDup(true); // 换了名字/大纲，立刻重新联网查一遍
    } catch (e) {
      wx.hideLoading();
      this.setData({ loading: false, taskText: '' });
      wx.showToast({ title: (e && e.message) || '生成失败，再点一次', icon: 'none', duration: 2500 });
    }
  },

  // ---------- 作品名：可编辑 ----------
  onTitle(e) { this.setData({ titleEdit: e.detail.value }); },
  async saveTitle() {
    const title = (this.data.titleEdit || '').trim();
    if (!title) { wx.showToast({ title: '作品名不能为空', icon: 'none' }); return; }
    if (this.data.outline && title === this.data.outline.title) {
      wx.showToast({ title: '名称没有改动', icon: 'none' });
      return;
    }
    const id = this.curId();
    if (!id) { wx.showToast({ title: '作品未关联，请返回重新进入', icon: 'none' }); return; }
    try {
      await request(`/novel/${id}`, 'PUT', { title });
      this.setData({ 'outline.title': title });
      wx.showToast({ title: '名称已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
  /** 定版前静默保存改名，失败不阻断流程 */
  async saveTitleSilent() {
    const title = (this.data.titleEdit || '').trim();
    const id = this.curId();
    if (!id || !title || !this.data.outline || title === this.data.outline.title) return;
    try {
      await request(`/novel/${id}`, 'PUT', { title });
      this.setData({ 'outline.title': title });
    } catch (e) { /* 忽略 */ }
  },

  // ---------- 撞车检测（番茄 / 七猫 / 全网书名比对） ----------
  checkDup() { return this.runCheckDup(false); },
  /**
   * 联网查重。silent=true 用于「刚生成书名后的自动预检」：
   * 中低风险不打扰作者，只有严重撞车才弹窗（此时定版也会被拦下）。
   */
  async runCheckDup(silent) {
    if (this.data.checking) return null;
    const id = this.needId();
    if (!id) return null;
    this.setData({ checking: true });
    wx.showLoading({ title: '联网比对书名…', mask: true });
    let rep = null;
    try {
      rep = await request(`/novel/${id}/check-duplicate`, 'POST', {});
      this.setData({ dupReport: this.withPicks(rep) });
    } catch (e) {
      if (!silent) wx.showToast({ title: '查重失败，请重试', icon: 'none' });
    }
    wx.hideLoading(); // 必须先关 loading，否则下面的弹窗会被遮住
    this.setData({ checking: false });
    if (!rep) return null;
    if (rep.risk === 'high') {
      wx.showModal({
        title: '⚠ 严重撞车，请先换书名',
        content: `${rep.riskNote}\n\n下方已列出可选新书名，点「用这个」即可换名并自动重出大纲。`,
        showCancel: false,
        confirmText: '知道了',
      });
    } else if (!silent) {
      wx.showToast({
        title: { mid: '存在相似，建议差异化', low: '未发现明显撞车' }[rep.risk] || '查重完成',
        icon: 'none',
        duration: 2500,
      });
    }
    return rep;
  },

  // ---------- 定版：启动后台任务链 + 轮询进度 ----------
  finalize() { return this.runFinalizeFlow(false); },
  /** 作者已看过撞车报告、明确选择"仍要定版" */
  forceFinalize() { return this.runFinalizeFlow(true); },
  async runFinalizeFlow(accept) {
    const id = this.needId();
    if (!id) return;
    // 已查出撞车（严重 或 存在相似）且未确认 → 不启动定版，把处置面板留给他选。
    // 作者要求：只要"建议修改"就必须停下来，先给 3 个新名让他选，不能默默生成。
    // 只要还撞车就继续拦：选名 → 按新名重出大纲 → 再查重 → 还撞就再给一批，直到不撞车。
    const rk = this.data.dupReport && this.data.dupReport.risk;
    if (!accept && (rk === 'high' || rk === 'mid')) {
      wx.showToast({ title: rk === 'high' ? '严重撞车：先换书名或换题材' : '存在相似：先选一个新书名', icon: 'none', duration: 3000 });
      return;
    }
    this.setData({ loading: true, taskError: '', steps: [], taskText: '启动定版任务…' });
    const pTitle = '定版（查重 → 全书脉络 → 上架资料 → 黄金三章）';
    this.startProg(pTitle);
    try {
      await this.saveTitleSilent();
      await runFinalize(id, accept ? { acceptDup: true } : {}, (p) => {
        this.setData({
          steps: p.steps || [],
          taskText: runningText(p.steps),
          // 定版进度里回传的报告也要转成可点的候选名，否则面板只剩文字没有「用这个」按钮 = 卡死
          dupReport: this.withPicks(p.dupReport || this.data.dupReport),
        });
        this.onProg(pTitle, p);
      });
      this.endProg();
      this.setData({ loading: false, taskText: '定版完成' });
      this.clearDraft(); // 定版成功：草稿使命完成，否则下次「新建小说」会误恢复上一部的进度
      wx.navigateTo({ url: `/pages/intro/intro?id=${id}` });
    } catch (e) {
      this.endProg();
      // 后端查重判为撞车（严重 或 相似）时，定版是「被中断」而不是「失败」——
      // 要给出可操作的处置（3 个备选名 + 仍要定版出口），不是一句报错
      const msg = String(e.message || '');
      const isHigh = msg.indexOf(DUP_HIGH) >= 0;
      const blocked = isHigh || msg.indexOf(DUP_MID) >= 0;
      this.setData({ loading: false, taskError: blocked ? '' : (msg || '定版失败') });
      if (blocked) await this.loadDupReport(id);
      wx.showToast({
        title: blocked ? (isHigh ? '严重撞车，定版已中断' : '存在相似，定版已中断') : '定版失败，可再点一次重试',
        icon: 'none',
        duration: 3000,
      });
    }
  },
  /** 定版被撞车中断后，把最新撞车报告拉回页面（后端已落库） */
  async loadDupReport(id) {
    try {
      const n = await request(`/novel/${id}`);
      const rep = n.dupReport ? JSON.parse(n.dupReport) : null;
      if (rep) {
        this.setData({ dupReport: this.withPicks(rep) });
        // 判为撞车却一个候选名都没有 = 作者彻底没得选（正是之前「卡在这里」的样子），自动补一批
        if (rep.risk !== 'low' && !(rep.picks || []).length) await this.moreTitles();
      }
    } catch (e) { /* 拉不到就沿用页面上已有的报告 */ }
  },
  /** 候选名整理成统一结构 [{title,risk,note,plot}]，永远给得出可点的项（面板不能卡死） */
  withPicks(rep) {
    if (!rep) return rep;
    const checks = rep.titleChecks || [];
    rep.picks = checks.length
      ? checks.map((c) => ({
          title: c.title, risk: c.risk || '', note: c.note || '', plot: c.plot || rep.plotAdvice || '',
          // 书名判据（过审 + 吸量）：撞车查的是"跟别人像不像"，这一层查的是"平台收不收、读者点不点"
          titleScore: c.titleReview ? c.titleReview.score : null,
          titleVerdict: c.titleReview ? c.titleReview.verdict : '',
          titleIssues: c.titleReview && c.titleReview.issues ? c.titleReview.issues.join('；') : '',
          titleTips: c.titleReview && c.titleReview.tips ? c.titleReview.tips.join('；') : '',
        }))
      : (rep.titleSuggestions || []).map((t) => ({ title: t, risk: '', note: '', plot: rep.plotAdvice || '' }));
    return rep;
  },
  /** 进度条（与章节页同一套）：定版 / 出大纲 / 撞车修复 都要让作者看见在跑 */
  startProg(title) { this.setData({ prog: { show: true, title, pct: 0, done: 0, total: 0, current: '启动…', steps: [] } }); },
  onProg(title, p) { this.setData({ prog: progOf(title, p) }); },
  endProg() { this.setData({ prog: null }); },
  onMyTitle(e) { this.setData({ myTitle: e.detail.value }); },
  /** 预检作者自己起的书名：通过就能直接「用这个」（AI 一批都挑不出来时至少还有这条路） */
  async checkMyTitle() {
    const id = this.needId();
    // 两处入口共用：撞车面板里的自填框（myTitle）、步骤4 的作品名输入框（titleEdit）
    const t = String(this.data.myTitle || this.data.titleEdit || '').trim();
    if (!id || !t) { wx.showToast({ title: '先填一个书名', icon: 'none' }); return; }
    wx.showLoading({ title: '预检中…', mask: true });
    try {
      const r = await request(`/novel/${id}/title-check`, 'POST', { title: t });
      wx.hideLoading();
      // 数组直接进 wxml 会渲染成 a,b,c —— 展示层转成中文顿号
      if (r && r.titleReview) {
        const rev = r.titleReview;
        rev.issuesText = (rev.issues || []).join('；');
        rev.tipsText = (rev.tips || []).join('；');
        rev.hitsText = (rev.hits || []).join('；');
      }
      this.setData({ myTitleCheck: r });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '预检失败，再试一次', icon: 'none', duration: 2500 });
    }
  },
  /** 换一批推荐名：作者对这批不满意就再取一批（同样逐个联网预检） */
  async moreTitles() {
    const id = this.needId();
    if (!id || this.data.checking) return;
    const dup = this.data.dupReport || {};
    this.setData({ checking: true });
    wx.showLoading({ title: '换一批推荐名…', mask: true });
    try {
      const r = await request(`/novel/${id}/title-suggest`, 'POST', {
        exclude: (dup.picks || dup.titleSuggestions || []).map((x) => x.title || x),
      });
      wx.hideLoading();
      const next = Object.assign({}, dup, r);
      this.setData({ dupReport: this.withPicks(next), checking: false });
      if (!(next.picks || []).length) wx.showToast({ title: '没取到新名字，再点一次', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      this.setData({ checking: false });
      wx.showToast({ title: '换名失败，再点一次', icon: 'none' });
    }
  },

  // ---------- 撞车处置 ----------
  /** 采用 AI 推荐书名：改名 → 按差异化方向重出大纲 → 重新查重（闭环，防止"换个名还是撞"） */
  /**
   * 采用推荐书名 = 一键走完整条修复流水线（后端 dupfix 任务，退出小程序也继续跑）：
   * 换名 → 重出大纲 → 重建全书脉络 → 重出作品简介 → 重写黄金三章 → 重出封面 → 复查重。
   * 以前只做"改名 + 出大纲"，简介/封面/正文都还是旧的，作者还得自己再点定版一遍。
   */
  async applyDupTitle(e) {
    const title = e.currentTarget.dataset.t;
    const id = this.needId();
    if (!id || !title || this.data.loading) return;
    const dup = this.data.dupReport || {};
    // 用这个名**配套的**已预检差异化剧情（不是通用建议），改名 + 改剧情一次做到位
    const pick = (dup.picks || []).find((x) => x.title === title);
    const plot = (e.currentTarget.dataset.p) || (pick && pick.plot) || dup.plotAdvice || '';
    this.setData({ loading: true, taskText: '启动修复…', dupFixSteps: [] });
    const pTitle = '撞车修复（换名 → 大纲 → 脉络 → 简介 → 黄金三章 → 封面 → 复查重）';
    this.startProg(pTitle);
    try {
      await request(`/novel/${id}/dup-fix`, 'POST', { title, plot });
      const job = await runJob(id, 'dupfix', (j) => {
        const t = jobText(j);
        this.setData({ taskText: t, dupFixSteps: j.steps || [] });
        this.onProg(pTitle, j);
      });
      this.endProg();
      this.setData({ titleEdit: cleanTitleText(title), dupRound: (this.data.dupRound || 0) + 1, loading: false, taskText: '' });
      await this.refreshAfterFix(id);
      const note = ((job && job.steps) || []).map((s) => `${s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '○'} ${s.label}：${s.note || s.error || ''}`).join('\n');
      wx.showModal({
        title: '撞车修复完成',
        content: `${note}\n\n大纲 / 全书脉络 / 作品简介 / 黄金三章 / 封面 都已按新书名重新生成。`,
        showCancel: false,
        confirmText: '知道了',
      });
    } catch (err) {
      this.endProg();
      // 把真实原因说出来：以前只弹"重做失败"，作者根本不知道卡在哪一步
      const msg = (err && err.message) || '未知错误';
      wx.showModal({ title: '修复失败', content: msg + '\n\n可稍等几秒再点一次；若提示"已有任务在跑"，等上一个任务结束再试。', showCancel: false, confirmText: '知道了' });
      this.setData({ loading: false, taskText: '' });
    }
  },
  /** 修复流水线跑完后把页面刷新一遍：大纲、简介、封面都换成新的 */
  async refreshAfterFix(id) {
    try {
      const out = await request(`/novel/${id}`);
      this.applyOutline({ title: out.title, sellPoint: out.sellPoint, outline: out.outline, staleCount: 0 });
      this.setData({ titleEdit: out.title || '' });
      await this.runCheckDup(true); // 用后端最后那次复查结果刷新面板
    } catch (e) { /* 刷新失败不影响主流程 */ }
  },
  /** 换题材重做：回第①步；改完题材走到第④步会「更新本作品」而不是新建一部 */
  goTopicAgain() {
    this.setData({
      step: 1,
      dupReport: null,
      draftTip: '改完题材后一路点「下一步」，会按新题材重出书名和大纲',
    });
    this.saveDraft();
  },
  copy(e) { copy(e.currentTarget.dataset.text); },
  onOpinion(e) { this.setData({ opinion: e.detail.value }); },
});
