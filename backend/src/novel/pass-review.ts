/**
 * 【过审体检】平台审核判据（番茄 / 七猫）
 *
 * 为什么单开一个文件、和「一致性体检」分开：
 *   一致性体检查的是**矛盾**（人名前后不一、时间线穿帮），是"故事对不对"的问题；
 *   过审体检查的是**平台判据**（AI 指纹、结构失常、格式混乱），是"能不能签约"的问题。
 *   两者判据来源完全不同：前者来自稿子自身，后者来自平台审核规则。混在一起会让
 *   "没有矛盾"被误读成"能过审"——2026-10-08 实战就是这么栽的：
 *   安全审核秒过，签约评估 95 分钟被机器拒，理由是"作品质量暂未达到签约标准"。
 *
 * ── 判据来源（均为一手规则，非推测）────────────────────────────
 *
 * 番茄《作品签约标准说明》与《低质治理公告》，2026 年 5 月 / 8 月两次升级后明确四类严禁：
 *   ① AI粗制滥造类：内容缺乏原创性与完整性，整体质量低劣
 *   ② 格式混乱类：分章异常、标点错乱、排版紊乱、文体不符
 *   ③ 结构失常类：提纲式写文、复述剧情、句式重复堆砌、模板化拼接
 *   ④ 空洞水文类：流水账叙事、无意义内容堆砌、剧情拖沓、可读性极差
 *   8 月单月：拒绝签约 16.3 万本、处置 6.1 万本；叠加 5 月共处置超 21 万本。
 *
 * 番茄签约机制（机器审）：2 万 / 5 万 / 8 万字各一次机会，**三次全败永久失去签约资格**。
 *   拒签通常在 1-2 小时内出结果 → 说明判定主体是机器，抓的是**文本结构指纹**，不读故事好坏。
 *
 * 番茄算法分发（冲榜用）：8 万字申请推荐评估 → 7 天验证期（吸量：300+ 合格 / 500+ 倾斜）
 *   → 首秀期 14-21 天（10 万字完读率 16%-17% 为均线，>17% 优秀；追更比理想 2:1）。
 *
 * 七猫（人工审，要求与番茄相反）：
 *   投稿 = 开篇 2 万字正文 + 大纲（要写到 30 万字后的剧情）+ 投稿申请表；
 *   看重文笔与逻辑完整性；AI **严格限制使用、需提前报备**，纯 AI 生成一律删除、检测为 AI 算法+人工。
 *
 * ── 本模块的设计原则 ────────────────────────────────────────
 * 所有指标都是**代码可算的确定性数字**，不依赖 AI 判断（AI 判断每次结果会飘）。
 * 每个指标给"健康区间"，落区间外才扣分。区间值取自公开的作者实战统计与网文通行写法，
 * 属于经验值，会随平台规则演进 —— 版本敏感，改动时请一并更新本段注释与 SCORE_RULES。
 */

/** 单个指标 */
export interface PassMetric {
  key: string;
  name: string;
  /** 实测值 */
  value: number;
  /** 展示用的实测值文本（带单位） */
  valueText: string;
  /** 健康区间文本，如 '32-45%' —— 展示给作者看"该是多少" */
  healthy: string;
  /** 0-100，该指标得分 */
  score: number;
  /** 权重（同一本内各项权重之和为 1） */
  weight: number;
  /** 是否达标 */
  pass: boolean;
  /** 实际命中平台哪一类违规（不达标时才给） */
  violation?: string;
  /** 人话说明：为什么这个值有问题 */
  why: string;
  /** 怎么改（给 AI 改写器当指令） */
  how: string;
}

export interface PassReport {
  /** 综合分 0-100（过审为底线，过不了审则冲榜分再高也被压住） */
  score: number;
  level: string;
  /** 过审分：能不能签约（机器审口径） */
  passScore: number;
  passLevel: string;
  /** 冲榜分：算法愿不愿意推（分发口径） */
  rankScore: number;
  rankLevel: string;
  /** 闸门说明：为什么综合分被压住 */
  gateNote: string;
  metrics: PassMetric[];
  /** 冲榜判据（与过审判据刻意分开：一个管"能不能发"，一个管"能不能起"） */
  rankMetrics: PassMetric[];
  /** 逐章明细 */
  chapters: ChapterPass[];
  /** 摘要（作者看这一段就够） */
  summary: string;
  /** 平台差异提示 */
  platformNote: string;
  at: number;
}

export interface ChapterPass {
  order: number;
  title: string;
  words: number;
  score: number;
  /** 本章不达标的指标 key */
  bad: string[];
}

/**
 * 指标定义表。
 *
 * weight 是"这个指标有多致命"的经验权重：直接对标番茄点名的四类违规的指标权重最高。
 * 之所以不用"全部都重要"：作者改稿精力有限，必须告诉他先修哪个。
 */
export const SCORE_RULES = {
  /** 段落长度离散度（标准差/均值）。AI 生成文本的典型缺陷：长短段落无规律地跳。 */
  paraRhythm: { key: 'paraRhythm', weight: 0.18, healthy: [0.55, 1.35], label: '段落节奏' },
  /** 对话占比。网文通行 32%-45%；过高是"对话体凑字数"，过低是"说明文"。 */
  dialogue: { key: 'dialogue', weight: 0.16, healthy: [0.28, 0.5], label: '对话占比' },
  /** 段落长度中位数（字）。切得过碎（<18）正是"模板化拼接"的画像。 */
  paraMedian: { key: 'paraMedian', weight: 0.14, healthy: [18, 70], label: '段落长度' },
  /** 「了」字密度。偏高 = 句式呆板（番茄 8 月点名"句式呆板"直接拒签）。 */
  leDensity: { key: 'leDensity', weight: 0.12, healthy: [0, 0.032], label: '句式重复度' },
  /** 句长变异系数。AI 文本句长趋同 → 读起来平。 */
  sentVar: { key: 'sentVar', weight: 0.1, healthy: [0.4, 1.6], label: '句长变化' },
  /** 开篇钩子位置：首个高冲突信号出现在前多少字内。 */
  hookAt: { key: 'hookAt', weight: 0.14, healthy: [0, 300], label: '开篇钩子' },
  /** 章末钩子：结尾是否落了"具体发生的事"。 */
  endHook: { key: 'endHook', weight: 0.1, healthy: [1, 1], label: '章末钩子' },
  /** 机械排比（"第一条/第二天/首先其次"式）。 */
  machineParallel: { key: 'machineParallel', weight: 0.06, healthy: [0, 0], label: '机械排比' },
} as const;

/**
 * 【冲榜判据】算法分发口径 —— 和过审判据刻意分成两组。
 *
 * 为什么要分：过审判据是"能不能发"（违规类，违反直接拒），冲榜判据是"能不能起"
 * （分发类，不违规但没量）。两者失败后果完全不同，混在一张表里作者会不知道该先救哪个。
 *
 * 依据番茄算法分发链路：8 万字申请推荐 → 7 天验证期（吸量 300+ 合格 / 500+ 倾斜）
 *   → 首秀 14-21 天（10 万字完读率均线 16%-17%，>17% 为优秀；追更比理想 2:1）。
 * 这条链路只认三个可观测的东西：**读者点不点开**（开篇）、**读不读完**（章内密度）、
 * **追不追下一章**（章末钩子）。所以冲榜判据全部围绕这三点，其余都是次要的。
 */
export const RANK_RULES = {
  /** 黄金三章强度：前三章（开篇钩子 + 章末钩子 + 冲突密度）的平均分。
   *  平台验证期给新书的曝光几乎全压在前三章，这一项最致命。 */
  golden3: { key: 'golden3', weight: 0.24, healthy: [70, 100], label: '黄金三章', zeroFatal: true },
  /** 爽点密度：每千字强情绪/冲突信号命中数。太低 = 平，太高 = 狗血疲劳。
   *  zeroFatal：0 个爽点是最致命的（整章平铺），不能因为区间宽就被算成"差一点点"。 */
  climax: { key: 'climax', weight: 0.2, healthy: [1.5, 14], label: '爽点密度', zeroFatal: true },
  /** 章首钩子覆盖率：前 300 字内有冲突信号的章占比。决定每章的"起点留存"。 */
  hookRate: { key: 'hookRate', weight: 0.18, healthy: [0.6, 1], label: '章首钩子覆盖', zeroFatal: true },
  /** 水段占比：连续 ≥200 字既无对白也无冲突信号的字数占比。这是完读率的头号杀手。 */
  dry: { key: 'dry', weight: 0.16, healthy: [0, 0.25], label: '水段占比' },
  /** 章末钩子覆盖率：章末 150 字落了"具体发生的事"的章占比。决定追更比。 */
  endRate: { key: 'endRate', weight: 0.14, healthy: [0.8, 1], label: '章末钩子覆盖', zeroFatal: true },
  /** 章节字数稳定性（变异系数）。忽长忽短会让读者预期失控，也影响日更观感。 */
  wordStability: { key: 'wordStability', weight: 0.08, healthy: [0, 0.3], label: '字数稳定性' },
} as const;

/** 强情绪 / 爽点信号：打脸、反击、获得、揭示、危机 —— 爽点密度与黄金三章都用它 */
const CLIMAX_WORDS = /(打脸|反杀|反击|翻身|逆袭|报复|报应|跪|求饶|认输|服了|愣住|傻眼|震惊|哗然|沸腾|爆|赚|到账|到账|入账|翻倍|暴涨|升级|突破|觉醒|激活|解锁|获得|到手|拿下|拿下|收服|碾压|秒杀|一招|全场|满堂|哗|中奖|中奖|中签|签下|签约|录取|录取|考上|逆转|翻盘|救命|危机|危险|来不及|快逃|跑|完了|糟了|出事|暴露|揭穿|真相|居然|竟然|没想到|万万没想到|凭什么|你算什么东西|给老子)/;

/** 高冲突信号词：开篇前 300 字里出现任一，就算钩子到位 */
const HOOK_WORDS = /(死|杀|血|刀|枪|逃|跑|跪|打|砸|撕|吼|哭|滚|抢|夺|骗|叛|债|牢|狱|尸|鬼|毒|炸|崩|塌|断|痛|疼|昏迷|睁眼|醒来|重生|穿越|穿越|魂穿|离婚|退婚|被赶|净身|顶包|替嫁|冲喜|流放|入狱|出狱|绑定|激活|觉醒|系统|金手指)/;

/** 章末"具体发生的事"信号：动作 / 对白 / 强标点 */
const END_ACTION = /(说|喊|道|问|吼|喝|笑|骂|答|开口|回头|转身|推门|踹|抓|拽|递|甩|拍|站起|坐下|跑|冲|扑)[：:"“”]?|[“"「]|！|\?|？/;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 把一个值按健康区间映射成 0-100 分：区间内 = 100，越远越低（用相对偏差衰减） */
function scoreInRange(v: number, lo: number, hi: number): number {
  if (v >= lo && v <= hi) return 100;
  const span = Math.max(hi - lo, 1e-6);
  const d = v < lo ? (lo - v) / span : (v - hi) / span;
  // 偏差 1 个区间宽度 → 扣到 55；2 个 → 30；3 个 → 15（衰减曲线，避免一个指标把总分打穿）
  return Math.max(0, Math.round(100 / (1 + d * d * 1.6)));
}

/** 数一段里的对话字数（引号内） */
function dialogueChars(t: string): number {
  let n = 0;
  const re = /[“"「『]([^”"」』]{1,400})[”"」』]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) n += m[1].length;
  return n;
}

/**
 * 分析**一章**正文，产出这一章的原始指标值。
 * 抽成独立函数是为了"逐章给分"——作者要看到"第 7 章拖后腿"，而不是一个整体分。
 */
export function analyzeChapter(content: string, title = ''): {
  words: number; metrics: Record<string, number>; bad: string[];
} {
  const raw = String(content || '');
  const t = raw.replace(/\s/g, '');
  const words = t.length;
  const out: Record<string, number> = {};
  if (words < 50) return { words, metrics: out, bad: ['字数'] };

  const paras = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const lens = paras.map((p) => p.length);

  // ① 段落节奏：段长标准差 / 段长均值
  const m = mean(lens);
  out.paraRhythm = m > 0 ? std(lens) / m : 0;
  // ② 对话占比
  out.dialogue = words > 0 ? dialogueChars(raw) / words : 0;
  // ③ 段落长度中位数
  out.paraMedian = median(lens);
  // ④ 「了」密度
  out.leDensity = words > 0 ? (t.match(/了/g) || []).length / words : 0;
  // ⑤ 句长变异系数（按句末标点切）
  const sents = raw.split(/[。！？!?…]+/).map((s) => s.replace(/\s/g, '')).filter((s) => s.length > 1);
  const slens = sents.map((s) => s.length);
  const sm = mean(slens);
  out.sentVar = sm > 0 ? std(slens) / sm : 0;
  // ⑥ 开篇钩子位置
  const head = raw.slice(0, 600);
  const hm = head.match(HOOK_WORDS);
  out.hookAt = hm ? hm.index ?? 999 : 999;
  // ⑦ 章末钩子：末 150 字是否有对话/强动作
  const tail = raw.slice(-150);
  out.endHook = END_ACTION.test(tail) ? 1 : 0;
  // ⑧ 机械排比：**只看相邻堆叠**，单次出现不算。
  //    踩过的坑：`(第[一二三四五六七八九]|其次|然后)[条天点步名]` 这种写法会把
  //    「第三天」「第二天」这种正常的**时间推进**全判成机械排比——网文里"第三天"太常见了，
  //    实测正常稿被误扣到 1 处。真正的机械排比症状是"连着来"：
  //    `第一天…第二天…第三天…` 三连才是提纲式写文。所以改成"同一句式在 120 字窗口内出现 ≥3 次"。
  const parallels = (raw.match(/(第[一二三四五六七八九]|[首其]次|首先|然后|接着|最后)[条天点步名]/g) || []);
  let stacks = 0;
  for (let i = 0; i < parallels.length; i++) {
    const window = parallels.slice(i, i + 3);
    if (window.length === 3) {
      const at = raw.indexOf(window[0]);
      const end = raw.indexOf(window[2]);
      // 三连且彼此距离够近（同 120 字内）才算堆叠
      if (at >= 0 && end >= 0 && end - at <= 120) { stacks++; i += 2; }
    }
  }
  out.machineParallel = stacks;

  const bad: string[] = [];
  const rules = Object.values(SCORE_RULES);
  rules.forEach((r: any) => {
    const v = out[r.key];
    if (v === undefined) return;
    if (scoreInRange(v, r.healthy[0], r.healthy[1]) < 100) bad.push(r.label);
  });
  return { words, metrics: out, bad };
}

/**
 * 分析**一章**的冲榜指标（章级可算的那些）。
 * 全书级指标（黄金三章 / 各覆盖率 / 字数稳定性）在 analyzeBook 里算。
 */
export function analyzeChapterRank(content: string): {
  words: number;
  /** 每千字爽点命中数 */
  climax: number;
  /** 水段（连续 ≥200 字无对白无冲突）占总字数比例 */
  dry: number;
  /** 章首 300 字内是否有冲突信号：1/0 */
  headHook: number;
  /** 章末 150 字是否有"具体发生的事"：1/0 */
  endHook: number;
  /** 爽点信号命中数（黄金三章评分用） */
  climaxHits: number;
} {
  const raw = String(content || '');
  const t = raw.replace(/\s/g, '');
  const words = t.length;
  if (words < 50) return { words, climax: 0, dry: 1, headHook: 0, endHook: 0, climaxHits: 0 };

  // 爽点 = 情绪/冲突词 + 强标点（！？）。
  // 踩过的坑：只用词表会**漏判好稿** —— 实测一段强冲突的正常网文（"我不签""老周现在在哪？"）
  // 被判成"爽点密度 0"，和真正的平铺稿子得分几乎一样（65 vs 68），完全没有判别力。
  // 原因是紧张感经常落在问句、感叹、突然的短句上，而这些写法不在词表里。
  // 所以把强标点一并计入：问号/感叹号本身就是"这里有戏"的强信号。
  // 强标点按 0.5 个折算：网文里 ？！ 本就密集（实测真实稿每千字可达 14+），
  // 1:1 计入会把数值顶到区间外，出现"超标却满分"的自相矛盾。它只是辅助信号，不该盖过真爽点词。
  const climaxHits = (raw.match(new RegExp(CLIMAX_WORDS, 'g')) || []).length
    + (raw.match(/[！？!?]/g) || []).length * 0.5;
  const climax = (climaxHits / words) * 1000;
  // 章首钩子同理：对白开局（引号）、疑问开局同样是强开局，不能只认冲突词
  const head300 = raw.slice(0, 300);
  const headHook = (HOOK_WORDS.test(head300) || /[“"「『！？!?]/.test(head300)) ? 1 : 0;
  const endHook = END_ACTION.test(raw.slice(-150)) ? 1 : 0;

  // 水段：把正文按 40 字切成窗口，连续 ≥5 个窗口（≈200 字）既无对白标点也无爽点信号 → 记水
  const step = 40;
  const flags: boolean[] = [];
  for (let i = 0; i < t.length; i += step) {
    const seg = raw.slice(i, i + step);
    flags.push(/[“"「『]/.test(seg) || CLIMAX_WORDS.test(seg));
  }
  let dryChars = 0;
  let run = 0;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) {
      run += 1;
      if (run >= 5) dryChars += step;
    } else {
      run = 0;
    }
  }
  const dry = Math.min(1, dryChars / words);
  return { words, climax, dry, headHook, endHook, climaxHits };
}

/** 展示用：把某个指标的实测值格式化成带单位的文本 */
function fmtValue(k: string, v: number): string {
  switch (k) {
    case 'dialogue': return (v * 100).toFixed(1) + '%';
    case 'leDensity': return (v * 100).toFixed(2) + '%';
    case 'dry': case 'hookRate': case 'endRate': return (v * 100).toFixed(0) + '%';
    case 'hookAt': return v > 600 ? '开篇 600 字内无冲突' : `第 ${Math.round(v)} 字`;
    case 'endHook': return v >= 1 ? '有' : '无';
    case 'machineParallel': return v ? `${Math.round(v)} 处` : '无';
    case 'climax': return v.toFixed(1) + ' 个/千字';
    case 'golden3': return Math.round(v) + ' 分';
    case 'paraMedian': return Math.round(v) + ' 字';
    default: return v.toFixed(2);
  }
}

/** 展示用：把健康区间格式化成"该是多少" */
function fmtHealthy(k: string, lo: number, hi: number): string {
  switch (k) {
    case 'dialogue': return `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`;
    case 'leDensity': return `≤${(hi * 100).toFixed(1)}%`;
    case 'dry': return `≤${(hi * 100).toFixed(0)}%`;
    case 'hookRate': case 'endRate': return `≥${(lo * 100).toFixed(0)}%`;
    case 'hookAt': return '≤300 字';
    case 'endHook': return '必须有';
    case 'machineParallel': return '0 处';
    case 'climax': return `${lo}-${hi} 个/千字`;
    case 'golden3': return `≥${lo} 分`;
    case 'paraMedian': return `${lo}-${hi} 字`;
    case 'wordStability': return `≤${hi}`;
    default: return `${lo}-${hi}`;
  }
}

/** 按规则表把"全书各指标实测值"打包成指标明细（过审、冲榜两组共用） */
function buildMetrics(values: Record<string, number>, rules: any): PassMetric[] {
  const out: PassMetric[] = [];
  Object.values(rules).forEach((r: any) => {
    const v = values[r.key];
    if (v === undefined) return;
    const lo = r.healthy[0] as number;
    const hi = r.healthy[1] as number;
    const pass = v >= lo && v <= hi;
    const valueText = fmtValue(r.key, v);
    let sc = scoreInRange(v, lo, hi);
    // zeroFatal：这类指标"越接近 0 越致命"，但健康区间往往很宽
    // （如爽点密度 1.5-14，0 只算差 12%），相对衰减会把"完全没有"算成"差一点点"。
    // 实测踩过：爽点密度 0 个/千字竟给到 98 分。所以低于下界时按"到下界的比例"绝对扣分。
    if (r.zeroFatal && v < lo) sc = Math.min(sc, Math.max(0, Math.round((v / lo) * 100)));
    // 越界就扣分，哪怕只超一点点：否则会出现"显示不达标/偏弱、却给 100 分"的自相矛盾
    if (!pass) sc = Math.min(sc, 99);
    out.push({
      key: r.key,
      name: r.label,
      value: v,
      valueText,
      healthy: fmtHealthy(r.key, lo, hi),
      score: sc,
      weight: r.weight,
      pass,
      violation: pass ? undefined : violationOf(r.key),
      why: pass ? '' : whyOf(r.key, valueText),
      how: pass ? '' : howOf(r.key),
    });
  });
  return out;
}

function scoreOf(metrics: PassMetric[]): number {
  const w = metrics.reduce((s, m) => s + m.weight, 0) || 1;
  return Math.round(metrics.reduce((s, m) => s + m.score * m.weight, 0) / w);
}

const PASS_LEVELS: Array<[number, string]> = [[88, '可提交'], [75, '接近合格'], [60, '风险偏高'], [0, '大概率被拒']];
const RANK_LEVELS: Array<[number, string]> = [[85, '有冲榜相'], [70, '可培养'], [55, '平庸'], [0, '难起量']];

function levelOf(score: number, table: Array<[number, string]>): string {
  return (table.find(([lo]) => score >= lo) || table[table.length - 1])[1];
}

/** 一本的汇总：过审判据 + 冲榜判据各出一组，再合成综合分 */
export function analyzeBook(
  chapters: Array<{ order: number; title?: string; content: string }>,
): PassReport {
  const per = chapters.map((c) => ({
    order: c.order,
    title: c.title || '',
    ...analyzeChapter(c.content || '', c.title || ''),
    rk: analyzeChapterRank(c.content || ''),
  }));
  const usable = per.filter((p) => p.words >= 50);

  // ── 过审组：全书值 = 按字数加权平均（长章节更能代表这本书的写法）──
  const passValues: Record<string, number> = {};
  Object.values(SCORE_RULES).forEach((r: any) => {
    let sum = 0; let wsum = 0;
    usable.forEach((p) => {
      const v = p.metrics[r.key];
      if (v === undefined) return;
      sum += v * p.words; wsum += p.words;
    });
    if (wsum > 0) passValues[r.key] = sum / wsum;
  });
  const metrics = buildMetrics(passValues, SCORE_RULES);
  const passScore = scoreOf(metrics);
  const passLevel = levelOf(passScore, PASS_LEVELS);

  // ── 冲榜组：章级指标加权 + 全书级指标单独算 ──
  const rankValues: Record<string, number> = {};
  const weighted = (pick: (p: any) => number): number => {
    let sum = 0; let wsum = 0;
    usable.forEach((p) => { sum += pick(p) * p.words; wsum += p.words; });
    return wsum > 0 ? sum / wsum : 0;
  };
  rankValues.climax = weighted((p) => p.rk.climax);
  rankValues.dry = weighted((p) => p.rk.dry);
  rankValues.hookRate = usable.length ? usable.filter((p) => p.rk.headHook).length / usable.length : 0;
  rankValues.endRate = usable.length ? usable.filter((p) => p.rk.endHook).length / usable.length : 0;
  const wlens = usable.map((p) => p.words);
  const wm = mean(wlens);
  rankValues.wordStability = wlens.length >= 2 && wm > 0 ? std(wlens) / wm : 0;
  // 黄金三章：前三章各自按「章首钩子 40 + 章末钩子 30 + 爽点密度 30」打分后取平均
  const first3 = [...usable].sort((a, b) => a.order - b.order).slice(0, 3);
  rankValues.golden3 = first3.length
    ? mean(first3.map((p) => p.rk.headHook * 40 + p.rk.endHook * 30
      + Math.min(1, p.rk.climax / 6) * 30))
    : 0;

  const rankMetrics = buildMetrics(rankValues, RANK_RULES);
  const rankScore = scoreOf(rankMetrics);
  const rankLevel = levelOf(rankScore, RANK_LEVELS);

  // ── 综合分：过审是底线。过不了审，冲榜分再高也发不出去 ──
  const rawTotal = passScore * 0.45 + rankScore * 0.55;
  const gated = passScore < 75;
  const score = gated ? Math.min(Math.round(rawTotal), 70) : Math.round(rawTotal);
  const level = levelOf(score, PASS_LEVELS);
  const gateNote = gated
    ? `过审分 ${passScore}（${passLevel}）未达 75 的底线，综合分已被压到 70 以内 —— 机器审这一关过不去，冲榜分再高也发不出去。先把过审项修到达标。`
    : `过审 ${passScore}（${passLevel}）已过底线，当前主要看冲榜 ${rankScore}（${rankLevel}）。`;

  // 逐章明细：过审分照旧，同时带上这一章的冲榜要点，方便定位"哪一章既拖过审又拖冲榜"
  const keys = Object.values(SCORE_RULES).map((r) => r.key) as string[];
  const chaptersOut: ChapterPass[] = per.map((p) => {
    let s = 0;
    keys.forEach((k) => {
      const r: any = (SCORE_RULES as any)[k];
      const v = p.metrics[k];
      if (v === undefined) return;
      s += scoreInRange(v, r.healthy[0], r.healthy[1]) * r.weight;
    });
    const bad = [...p.bad];
    if (p.words >= 50) {
      if (!p.rk.headHook) bad.push('章首无钩子');
      if (!p.rk.endHook) bad.push('章末无钩子');
      if (p.rk.dry > 0.25) bad.push('水段偏多');
    }
    return { order: p.order, title: p.title, words: p.words, score: Math.round(s), bad };
  });

  const bads = metrics.filter((m) => !m.pass);
  const rankBads = rankMetrics.filter((m) => !m.pass);
  const summary = (bads.length ? `过审：命中 ${bads.length} 项不合规（${bads.map((b) => b.name).join('、')}），先修权重最高的「${bads[0].name}」。 ` : '过审：8 项判据全部达标。 ')
    + (rankBads.length ? `冲榜：${rankBads.length} 项偏弱（${rankBads.map((b) => b.name).join('、')}），先补「${rankBads[0].name}」。` : '冲榜：6 项判据全部达标。');

  return {
    score,
    level,
    passScore,
    passLevel,
    rankScore,
    rankLevel,
    gateNote,
    metrics,
    rankMetrics,
    chapters: chaptersOut,
    summary,
    platformNote: '番茄为机器审（1-2 小时出结果，抓文本结构指纹），本表判据按番茄口径；'
      + '七猫是人工审且严格要求 AI 报备，同一稿投七猫还需另补 30 万字大纲。',
    at: Date.now(),
  };
}

/** 命中番茄哪一类违规（写进报告让作者知道严重性来源） */
function violationOf(key: string): string {
  switch (key) {
    case 'paraRhythm':
    case 'paraMedian':
      return '结构失常类（模板化拼接）';
    case 'dialogue':
      return '空洞水文类（对话体凑字数）';
    case 'leDensity':
      return '结构失常类（句式重复堆砌）';
    case 'sentVar':
      return '结构失常类（句式呆板）';
    case 'machineParallel':
      return '结构失常类（提纲式写文 / 机械排比）';
    case 'hookAt':
      return '作品质量（开篇未快速进入主线）';
    case 'endHook':
      return '作品质量（节奏与追读）';
    // ── 冲榜组：不违规，但直接影响算法给不给量 ──
    case 'golden3':
      return '分发·验证期（新书曝光几乎全压在前三章）';
    case 'climax':
      return '分发·完读率（爽点太稀，读者中途弃书）';
    case 'dry':
      return '分发·完读率（大段无对白无冲突 = 掉量点）';
    case 'hookRate':
      return '分发·起点留存（每章开头平 → 打开就走）';
    case 'endRate':
      return '分发·追更比（章末没钩子 → 不点下一章）';
    case 'wordStability':
      return '分发·更新观感（章节字数忽长忽短）';
    default:
      return '格式混乱类';
  }
}

function whyOf(key: string, v: string): string {
  switch (key) {
    case 'paraRhythm':
      return `段落长短跳动过大（实测 ${v}）。机器看到的是"模板化拼接"——正常写出来的稿子段落长度是有规律的。`;
    case 'paraMedian':
      return `段落中位长度 ${v} 字。切得过碎是"提纲式写文"的画像，读者在手机上连不成段落。`;
    case 'dialogue':
      return `对话占比 ${v}。网文通行 32%-45%，过高等于用对白凑字数、没有场景与心理，正对番茄点名的"空洞水文"。`;
    case 'leDensity':
      return `「了」字密度 ${v}。偏高读起来发飘，是番茄 8 月公告里"句式呆板"直接拒签的原因之一。`;
    case 'sentVar':
      return `句长变化 ${v}，句子长度过于趋同，读起来平、没有节奏起伏。`;
    case 'hookAt':
      return `开篇 ${v}。番茄验证期第一关看"吸量"，前 300 字没冲突，80% 读者在前三行就走了。`;
    case 'endHook':
      return `章末没有"具体发生的事"，只有景物或感慨。完读率靠章末钩子，钩子软就直接掉量。`;
    case 'machineParallel':
      return `出现 ${v} 机械排比（"第一条/其次/然后"式）。这是番茄点名的"提纲式写文"。`;
    // ── 冲榜组 ──
    case 'golden3':
      return `黄金三章 ${v}。验证期给新书的曝光几乎全压在前三章，这三章抓不住人，后面写得再好也拿不到量。`;
    case 'climax':
      return `爽点密度 ${v}。太稀读者觉得平、中途弃书，完读率掉到均线（16%-17%）以下就没量了。`;
    case 'dry':
      return `水段占比 ${v}。连续大段既无对白也无冲突，是完读率的头号杀手——读者就在这里划走。`;
    case 'hookRate':
      return `章首钩子覆盖 ${v}。每章开头 300 字没冲突，读者点开就走，起点留存上不去。`;
    case 'endRate':
      return `章末钩子覆盖 ${v}。章末没落具体的事，读者不会点下一章，追更比（理想 2:1）拉不起来。`;
    case 'wordStability':
      return `章节字数波动 ${v}。忽长忽短会让追更读者的预期失控，也影响日更观感。`;
    default:
      return '不达标';
  }
}

function howOf(key: string): string {
  switch (key) {
    case 'paraRhythm':
      return '把过长段落拆成 2-3 句一段，让段长回到 18-70 字；不要整章统一成同一长度。';
    case 'paraMedian':
      return '把过碎的段落按语义合并（同一场景/同一动作合并），中位长度回到 18-70 字。';
    case 'dialogue':
      return '把部分对白改成带动作与心理的叙述；保留能推动情节的对白，删掉纯寒暄。';
    case 'leDensity':
      return '替换"了"字句式为其他时态表达（"他走进去"→"他踏进屋里"），优先改句末的"了"。';
    case 'sentVar':
      return '长短句交替：把连续的中长句拆出一两个短句（4-8 字）打断节奏。';
    case 'hookAt':
      return '把前 300 字内与冲突无关的环境/背景描写删掉或后移，让第一个冲突信号出现在 300 字内。';
    case 'endHook':
      return '章末 150 字换成一件具体发生的事：一句对白、一个动作、一条新信息，去掉心情感慨。';
    case 'machineParallel':
      return '把"第一条/其次/然后"这类连接词去掉，按事情发生的顺序自然叙述。';
    // ── 冲榜组 ──
    case 'golden3':
      return '优先重做前三章：第一章开篇 300 字内直接进冲突，三章各自章末必须落一件具体的事，每章至少 2 个爽点或强情绪高点。';
    case 'climax':
      return '每千字补 1-2 个强情绪点（打脸/反击/获得/揭示/危机），或删掉不推动剧情的过渡段落把密度提上来。';
    case 'dry':
      return '把连续超过 200 字无对白无冲突的段落拆开：插入一句对白、一个动作，或一个让局面变化的新信息。';
    case 'hookRate':
      return '把每章开头 300 字里的环境/背景描写后移，让第一个冲突或反差信号出现在 300 字内。';
    case 'endRate':
      return '逐章检查结尾 150 字，换成一句对白、一个动作或一条新信息，去掉心情感慨与景物收束。';
    case 'wordStability':
      return '把章节字数拉到同一档（如统一 2000-2500 字），补短章或拆分长章。';
    default:
      return '按健康区间调整。';
  }
}

/** 逐章指标值（给 AI 改写器用：告诉它"这一章哪几项超标、超到多少"） */
export function chapterFindings(content: string, words: number): string[] {
  const a = analyzeChapter(content);
  const out: string[] = [];
  if (a.words < words * 0.9) out.push(`字数不足：现在 ${a.words} 字，目标 ${words} 字`);
  const keys = Object.values(SCORE_RULES).map((r) => r.key) as string[];
  keys.forEach((k) => {
    const r: any = (SCORE_RULES as any)[k];
    const v = a.metrics[k];
    if (v === undefined) return;
    if (scoreInRange(v, r.healthy[0], r.healthy[1]) < 100) {
      out.push(`${r.label}不达标（实测 ${k === 'dialogue' || k === 'leDensity' ? (v * 100).toFixed(1) + '%' : v.toFixed(2)}，`
        + `应 ${r.healthy[0]}-${r.healthy[1]}）：${howOf(k)}`);
    }
  });
  return out;
}

/**
 * 逐章**冲榜**问题（给打磨器用）。
 * 与 chapterFindings 分开的原因同前：过审项是"不改会被拒"，冲榜项是"不改没量"。
 * 打磨时两条一起下发给模型，它才知道既要把关底线、也要把爽点补上。
 */
export function rankFindings(content: string, isGolden = false): string[] {
  const rk = analyzeChapterRank(content);
  const out: string[] = [];
  if (rk.words < 50) return ['本章没有正文'];
  if (!rk.headHook) out.push('章首 300 字内没有冲突或反差信号，读者点开就走：' + howOf('hookRate'));
  if (!rk.endHook) out.push('章末 150 字没有落一件具体发生的事，追更拉不起来：' + howOf('endRate'));
  if (rk.dry > 0.25) out.push(`水段占比 ${(rk.dry * 100).toFixed(0)}%（应 ≤25%）：` + howOf('dry'));
  // 黄金三章对爽点密度的要求比普通章更高（验证期全压在这三章上）
  const lo = isGolden ? 3 : (RANK_RULES.climax.healthy[0] as number);
  if (rk.climax < lo) {
    out.push(`爽点密度 ${rk.climax.toFixed(1)} 个/千字${isGolden ? '（黄金三章要求 ≥3）' : ''}：` + howOf('climax'));
  }
  return out;
}
