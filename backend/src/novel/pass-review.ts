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
  /** 总分 0-100 */
  score: number;
  level: string;
  metrics: PassMetric[];
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

/** 一本的汇总：各指标取全书加权，出总分与逐章明细 */
export function analyzeBook(
  chapters: Array<{ order: number; title?: string; content: string }>,
): PassReport {
  const per = chapters.map((c) => {
    const a = analyzeChapter(c.content || '', c.title || '');
    return { order: c.order, title: c.title || '', ...a };
  });
  const usable = per.filter((p) => p.words >= 50);
  const totalWords = usable.reduce((s, p) => s + p.words, 0) || 1;

  const metrics: PassMetric[] = [];
  const keys = Object.values(SCORE_RULES).map((r) => r.key) as string[];
  keys.forEach((k) => {
    const r: any = (SCORE_RULES as any)[k];
    const lo = r.healthy[0] as number;
    const hi = r.healthy[1] as number;
    // 全书值 = 按字数加权平均（长章节更能代表这本书的写法）
    let sum = 0;
    let wsum = 0;
    usable.forEach((p) => {
      const v = p.metrics[k];
      if (v === undefined) return;
      sum += v * p.words;
      wsum += p.words;
    });
    const value = wsum > 0 ? sum / wsum : 0;
    const sc = scoreInRange(value, lo, hi);
    const pass = value >= lo && value <= hi;
    let valueText: string;
    if (k === 'dialogue') valueText = (value * 100).toFixed(1) + '%';
    else if (k === 'leDensity') valueText = (value * 100).toFixed(2) + '%';
    else if (k === 'hookAt') valueText = value > 600 ? '开篇 600 字内无冲突' : `第 ${Math.round(value)} 字`;
    else if (k === 'endHook') valueText = value >= 1 ? '有' : '无';
    else if (k === 'machineParallel') valueText = value ? `${Math.round(value)} 处` : '无';
    else valueText = value.toFixed(2);
    metrics.push({
      key: k,
      name: r.label,
      value,
      valueText,
      healthy: k === 'hookAt' ? '≤300 字'
        : k === 'endHook' ? '必须有'
          : k === 'machineParallel' ? '0 处'
            : k === 'dialogue' ? `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`
              : k === 'leDensity' ? `≤${(hi * 100).toFixed(1)}%`
                : `${lo}-${hi}`,
      score: sc,
      weight: r.weight,
      pass,
      violation: pass ? undefined : violationOf(k),
      why: pass ? '' : whyOf(k, valueText),
      how: pass ? '' : howOf(k),
    });
  });

  const score = Math.round(metrics.reduce((s, mt) => s + mt.score * mt.weight, 0)
    / metrics.reduce((s, mt) => s + mt.weight, 0));

  const chaptersOut: ChapterPass[] = per.map((p) => {
    let s = 0;
    keys.forEach((k) => {
      const r: any = (SCORE_RULES as any)[k];
      const v = p.metrics[k];
      if (v === undefined) return;
      s += scoreInRange(v, r.healthy[0], r.healthy[1]) * r.weight;
    });
    return { order: p.order, title: p.title, words: p.words, score: Math.round(s), bad: p.bad };
  });

  const bads = metrics.filter((m) => !m.pass);
  const level = score >= 88 ? '可提交' : score >= 75 ? '接近合格' : score >= 60 ? '风险偏高' : '大概率被拒';
  const summary = bads.length
    ? `命中 ${bads.length} 项不合规：${bads.map((b) => `${b.name}（${b.valueText}，应 ${b.healthy}）`).join('；')}。`
      + `其中「${bads[0].name}」权重最高，先修它。`
    : `8 项判据全部落在健康区间，这一稿从平台机器审的角度看没有明显把柄。`;

  return {
    score,
    level,
    metrics,
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
