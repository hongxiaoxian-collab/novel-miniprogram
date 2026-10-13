/**
 * 去 AI 味 · 统计指纹模块
 *
 * 依据（用户 2026-10-13 搜索确认）：
 *   朱雀类 AI 检测器核心看「困惑度 + 突发性(Burstiness)」两套统计特征，属于七维检测。
 *   AI 文本的典型破绽：句长标准差低（集中在 5–8）、句长均匀、段落长度方差小、
 *   每段都"完整"、句末标点单一、引号密度高。**同义词替换对这套指标完全无效**，
 *   必须改句式结构与节奏指纹。
 *
 * 本模块只做**量化与判据**：给出一段正文的统计指纹 → 是否达标 → 差在哪（deficits）。
 * 具体的改写由 LLM 完成（novel.service 的 deaiIfNeeded），本模块负责「测 → 判 → 给重写指令」，
 * 并保持纯函数（无副作用、可单测），便于回归验证指标是否真的能区分 AI/人写。
 */

export interface Fingerprint {
  /** 句子总数 */
  sentences: number;
  /** 正文字数（去空白） */
  chars: number;
  /** 平均句长 */
  avgLen: number;
  /** 句长标准差（核心指标：AI 常 5–8，目标 >10） */
  stdDev: number;
  minLen: number;
  maxLen: number;
  /** 超短句（<6 字）占比，目标 ≥0.10 */
  shortRatio: number;
  /** 长句（>30 字）占比，目标 ≥0.05 */
  longRatio: number;
  /** 段落数 */
  paras: number;
  /** 段落长度标准差，目标 ≥22（越大越"参差"） */
  paraStdDev: number;
  /** 句末标点种类数（。！？…～），目标 ≥3 */
  endPunctKinds: number;
  /** 每百字引号数，过高=AI 强调惯性，目标 ≤3 */
  quotePer100: number;
  /** 0–100 人类特征综合分 */
  score: number;
  /** 是否达标（可跳过重写） */
  pass: boolean;
  /** 短板描述（中文，直接喂给重写 prompt） */
  deficits: string[];
}

const END_PUNCT_RE = /[。！？!?…～]/g;
const QUOTE_RE = /["“”「」『』]/g;

/** 句末标点集合（用于标点多样性统计） */
const END_KINDS = ['。', '！', '？', '…', '～'];

function clean(s: string): string {
  return String(s || '').replace(/\s/g, '');
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
}

function mapRange(x: number, lo: number, hi: number, outLo: number, outHi: number): number {
  if (hi === lo) return outHi;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return outLo + (outHi - outLo) * t;
}

/** 把正文切成"句子"：先行分，再按句末标点分，保留标点 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    // 用 lookbehind 在句末标点后断句（Node 18+ 支持）
    const parts = line.split(/(?<=[。！？!?…～]+)/);
    for (const p of parts) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** 切段落：每个非空行算一段（网文常见排版） */
export function splitParagraphs(text: string): string[] {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 计算统计指纹。
 * @param minChars 正文短于此值不做判断（太短统计无意义），返回 pass=true
 */
export function aiFingerprint(text: string, minChars = 400): Fingerprint {
  const plain = String(text || '').trim();
  const paras = splitParagraphs(plain);
  const sents = splitSentences(plain);
  const lens = sents.map((s) => clean(s).length).filter((n) => n > 0);
  const charCount = clean(plain).length;

  const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const stdDev = +std(lens).toFixed(2);
  const minLen = lens.length ? Math.min(...lens) : 0;
  const maxLen = lens.length ? Math.max(...lens) : 0;
  const shortRatio = lens.length ? lens.filter((n) => n < 6).length / lens.length : 0;
  const longRatio = lens.length ? lens.filter((n) => n > 30).length / lens.length : 0;

  const paraLens = paras.map((p) => clean(p).length).filter((n) => n > 0);
  const paraStdDev = +std(paraLens).toFixed(2);

  const ends = plain.match(END_PUNCT_RE) || [];
  const endKinds = new Set(ends);
  const endPunctKinds = END_KINDS.filter((k) => endKinds.has(k)).length;

  const quotes = (plain.match(QUOTE_RE) || []).length;
  const quotePer100 = charCount ? +((quotes / charCount) * 100).toFixed(2) : 0;

  // ── 综合分（0–100）：以「突发性（句长方差）」为最大权重 ──
  // 句长标准差 3→15 映射 0→40 分（AI 落在 5–8，即 7–17 分；人写 11+ 拿 27+ 分）
  const sStd = mapRange(stdDev, 3, 15, 0, 40);
  // 碎句占比 0→0.16 映射 0→22 分
  const sShort = mapRange(shortRatio, 0, 0.16, 0, 22);
  // 长句占比 0→0.10 映射 0→16 分
  const sLong = mapRange(longRatio, 0, 0.1, 0, 16);
  // 段落方差 8→45 映射 0→14 分
  const sPara = mapRange(paraStdDev, 8, 45, 0, 14);
  // 句末标点种类 1→4 映射 0→8 分
  const sPunct = mapRange(endPunctKinds, 1, 4, 0, 8);
  const score = Math.round(sStd + sShort + sLong + sPara + sPunct);

  const deficits: string[] = [];
  if (stdDev < 10) {
    deficits.push(`句长太均匀（标准差 ${stdDev}，需 ≥10）：增加 35 字以上的长句与 2–5 字的碎句，把落差拉大`);
  }
  if (shortRatio < 0.1) {
    deficits.push(`碎句太少（占比 ${(shortRatio * 100).toFixed(0)}%，需 ≥10%）：把若干句砍成 2–5 字的短句，单独成句`);
  }
  if (longRatio < 0.05) {
    deficits.push(`长句偏少（占比 ${(longRatio * 100).toFixed(0)}%，需 ≥5%）：补入几个绵长的长句（人物心绪/环境铺陈）`);
  }
  if (paraStdDev < 22) {
    deficits.push(`段落长度太齐（方差 ${paraStdDev}，需 ≥22）：让段落长短参差，允许一句成段、碎句独立成段`);
  }
  if (endPunctKinds < 3) {
    deficits.push(`句末标点单一（仅 ${endPunctKinds} 种）：用 ！？…～ 制造断句故障感，别每句都用句号收尾`);
  }
  if (quotePer100 > 3) {
    deficits.push(`引号偏多（每百字 ${quotePer100} 个）：普通词去掉引号，只在引用原话/反讽/术语时用`);
  }

  const pass =
    charCount >= minChars &&
    score >= 60 &&
    stdDev >= 9.5; // 句长标准差是一票项，不能只靠段落参差蒙混过关

  return {
    sentences: lens.length,
    chars: charCount,
    avgLen: +avgLen.toFixed(1),
    stdDev,
    minLen,
    maxLen,
    shortRatio: +shortRatio.toFixed(3),
    longRatio: +longRatio.toFixed(3),
    paras: paraLens.length,
    paraStdDev,
    endPunctKinds,
    quotePer100,
    score,
    pass: charCount < minChars ? true : pass,
    deficits,
  };
}

/** 生成重写提示词：只动句式与节奏，情节/人名/事实一字不改 */
export function deaiRewritePrompt(text: string, fp: Fingerprint): string {
  const targets =
    fp.deficits.length > 0
      ? fp.deficits.map((d) => `   - ${d}`).join('\n')
      : '   - （无硬指标短板，仍请再制造一些句长与段落的参差）';
  return `你是一位写惯了碎碎念网文的作者，把下面这段正文**改写得更像真人手写**。

【铁律·不可违反】
1. 只改句式与节奏：情节、人物名、时间、事实、对话原意**一个字都不能变**（这是润色不是重写创作）。
2. 逐字保留所有人名、地名、专有名词、数字、时间表述。
3. 字数与原文相当（允许 ±15%），不要增删情节。

【主攻方向·统计指纹（AI 检测器就看这个，同义词替换无效）】
- 句长方差拉爆：既要有 35 字以上的长句，也要有 2–5 字的碎句单独成句；
- 段落参差：允许一句成段、半截话、语气词独立成段，别每段都起承转合俱全；
- 段间过渡断崖：允许硬切、留白、突然跳场，别每段都用"话说/接着/就在这时"顺滑接上。

【这段正文的实测短板·必须改掉】
${targets}

【当前统计】句长标准差 ${fp.stdDev}（目标 ≥10）、碎句占比 ${(fp.shortRatio * 100).toFixed(0)}%（目标 ≥10%）、段落方差 ${fp.paraStdDev}（目标 ≥22）。

只输出改写后的**正文纯文本**：不要 JSON、不要解释、不要 markdown 代码块、不要"改写说明"。

【原文】
${text}`;
}
