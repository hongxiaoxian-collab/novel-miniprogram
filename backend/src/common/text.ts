/** 去标签：把 HTML 压成纯文本（够用即可，不追求完整解析） */
export function stripTags(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 二元组 Dice 系数：0-1，越大越像。中文没有空格，用字级二元组比"按词"稳 */
export function diceSimilar(a: string, b: string): number {
  const norm = (s: string) => String(s || '').replace(/[\s《》〈〉「」【】\[\]()（）:：,，.。!！?？~·—\-_"']/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      set.set(g, (set.get(g) || 0) + 1);
    }
    return set;
  };
  const A = bigrams(x);
  const B = bigrams(y);
  let hit = 0;
  A.forEach((n, g) => { if (B.has(g)) hit += Math.min(n, B.get(g) as number); });
  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * hit) / total : 0;
}

/** 归一化一句话：去空白与标点。用于「这条矛盾是不是已经修过了」的指纹比对 */
export function normQuote(s: string): string {
  return String(s || '').replace(/[\s《》〈〉「」『』【】\[\]()（）:：;；,，.。!！?？~·—\-_"'“”‘’]/g, '');
}

/**
 * 在正文里定位 AI 摘录的那句话。
 *
 * AI 摘录时经常顺手改标点、省空格、补省略号，直接 indexOf 会「找不到」→
 * 于是修复只能整章重写（就是"越修越多"的根因）。这里三级定位：
 *   1) 原样精确匹配
 *   2) 去噪后逐字匹配（容忍标点差异，且能映射回原文下标）
 *   3) 滑动窗口按相似度取最佳区间（≥0.72 才认，防止误伤别处）
 */
export function locateQuote(content: string, quote: string): { start: number; end: number; score: number } | null {
  const c = String(content || '');
  const q = String(quote || '').trim();
  if (!c || !q) return null;
  const hit = c.indexOf(q);
  if (hit >= 0) return { start: hit, end: hit + q.length, score: 1 };

  const qn = normQuote(q);
  if (qn.length < 4) return null;

  // 去噪正文 + 下标映射：既容忍标点差异，又能把结果映射回原文位置
  let flat = '';
  const idx: number[] = [];
  for (let k = 0; k < c.length; k++) {
    const ch = c[k];
    if (ch.trim() && normQuote(ch) === ch) { flat += ch; idx.push(k); }
  }
  const p = flat.indexOf(qn);
  if (p >= 0) return { start: idx[p], end: idx[p + qn.length - 1] + 1, score: 0.98 };

  // 滑动窗口兜底（窗口宽度上下浮动，避免句读被算进长度）
  const min = Math.max(6, qn.length - 6);
  let best = { start: -1, end: -1, score: 0 };
  for (let s = 0; s < flat.length; s++) {
    for (const w of [qn.length - 4, qn.length - 2, qn.length, qn.length + 2]) {
      if (w < min || s + w > flat.length) continue;
      const sc = diceSimilar(flat.slice(s, s + w), qn);
      if (sc > best.score) best = { start: s, end: s + w, score: sc };
    }
  }
  return best.score >= 0.72
    ? { start: idx[best.start], end: idx[best.end - 1] + 1, score: best.score }
    : null;
}

/**
 * 找两个字符串「中间那段不一样的部分」（最长公共前后缀之外）。
 * 用途：定点修复后拿 改前/改后 比一比，就能知道"到底把哪个词换成了哪个词"——
 * 由此识别人名替换（任李建 → 班主任），进而把同一个错写法在全书里一次改干净。
 */
export function midDiff(a: string, b: string): { a: string; b: string } {
  const x = String(a || '');
  const y = String(b || '');
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  return { a: x.slice(p, x.length - s), b: y.slice(p, y.length - s) };
}

/** 人名的"虚词黑名单"：出现这些字的一定不是人名（是半句话） */
export const NAME_STOP = /[的了着过是在和与就都也还又把被让给从到对向为以而但却已将会能要说看想去来]/;

/** 像不像一个人名/称谓：纯汉字、长度 2-5、不含虚词 */
export function looksLikeName(w: string): boolean {
  const s = String(w || '');
  return s.length >= 2 && s.length <= 5 && /^[\u4e00-\u9fa5]+$/.test(s) && !NAME_STOP.test(s);
}

/** 书名结构前缀：如「重生1998：」「重回2000，」——同结构也算撞车 */
export function titleStruct(title: string): string {
  const t = String(title || '').replace(/[《》]/g, '').trim();
  const m = t.match(/^(重生|重回|回到|穿回|魂穿|穿越)[^：:，,、]{0,8}[：:，,、]/);
  if (m) return m[0];
  const m2 = t.match(/^([^：:]{2,10})[：:]/);
  return m2 ? m2[0] : '';
}
