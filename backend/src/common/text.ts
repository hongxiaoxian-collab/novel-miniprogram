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
 * 这句话在正文里**所有**出现的位置（不是只找第一处）。
 *
 * 用途：「重复」类矛盾的症状就是同一句出现两三次，而修复必须改**后出现的那一处** ——
 * 改第一处等于没改（后面那处还在），作者看到的就是"这条怎么都修不掉"。
 */
export function allQuoteSpots(content: string, quote: string): Array<{ start: number; end: number }> {
  const c = String(content || '');
  const q = String(quote || '').trim();
  if (!c || q.length < 2) return [];
  const exact: Array<{ start: number; end: number }> = [];
  for (let at = c.indexOf(q); at >= 0; at = c.indexOf(q, at + q.length)) {
    exact.push({ start: at, end: at + q.length });
  }
  if (exact.length >= 2) return exact; // 逐字就能找到两处以上，够了

  // 逐字对不上（AI 摘录改了标点/补了省略号）→ 去噪后匹配，再映射回原文下标
  const qn = normQuote(q);
  if (qn.length < 4) return exact;
  let flat = '';
  const idx: number[] = [];
  for (let k = 0; k < c.length; k++) {
    const ch = c[k];
    if (ch.trim() && normQuote(ch) === ch) { flat += ch; idx.push(k); }
  }
  const out: Array<{ start: number; end: number }> = [];
  for (let p = flat.indexOf(qn); p >= 0; p = flat.indexOf(qn, p + qn.length)) {
    out.push({ start: idx[p], end: idx[p + qn.length - 1] + 1 });
  }
  return out.length > exact.length ? out : exact;
}

/**
 * 去掉「紧挨着的逐字重复段」：
 *   `他得稳住节奏。，他得稳住节奏。，他得稳住节奏。` → `他得稳住节奏。`
 *   `距第十五章还差十章，距第十五章还差十章，他得稳住节奏。` → `距第十五章还差十章，他得稳住节奏。`
 *
 * 为什么需要：这类"重复"是机械性硬伤，但交给 AI"改写这一句"它多半原样退回（这句本身没写错），
 * 通用流程"改后不能与原文相同"的门槛就把整条判死 —— 作者看到的就是"这条怎么都修不掉"。
 * 规则故意做得很窄：只丢**与前一段完全一样**且长度 ≥4 字的段，不做任何语义判断，
 * 所以正常正文（各段内容不同）一定原样返回，不会被改坏。
 */
export function dedupeAdjacentSegments(text: string): string {
  const t = String(text || '');
  const re = /([^，,。.！!？?；;：:\n]+)([，,。.！!？?；;：:]*)(\n*)/g;
  const segs: Array<{ body: string; punct: string; nl: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m[1].trim()) segs.push({ body: m[1].trim(), punct: m[2] || '', nl: m[3] || '' });
  }
  if (segs.length < 2) return t;
  const keep: Array<{ body: string; punct: string; nl: string }> = [];
  segs.forEach((s) => {
    const prev = keep[keep.length - 1];
    if (prev && prev.body === s.body && s.body.length >= 4) {
      prev.punct = prev.punct.slice(0, 1); // 重复段被丢掉，标点只留句末那一个
      prev.nl += s.nl; // 段间换行不能丢，否则前后两段会粘在一起
      return;
    }
    keep.push({ body: s.body, punct: s.punct, nl: s.nl });
  });
  return keep.length === segs.length ? t : keep.map((s) => s.body + s.punct + s.nl).join('');
}

/**
 * 去掉 AI 把「提示词 / 写作说明」当正文交出来的痕迹。
 *
 * 实测泄漏：字数补足插入的段落开头写成 `（以下补字数，说这制程全球独一份。现在倒好…` ——
 * 括号里那句是提示词的意思复述，不是正文。留着有两个害处：读者会看到莫名其妙的说明，
 * 体检也会把它判成"复述前文"。削完如果太短（说明整段都是说明），宁可原样保留。
 */
export function stripPromptLeak(text: string): string {
  const t = String(text || '').trim();
  const head = t.match(/^[（(【\[『「]?\s*(以下|下面|说明|注|备注|补字数|续写|接上|继续)/);
  if (!head) return t;
  const hasOpen = /^[（(【\[『「]/.test(t);
  const from = head[0].length;
  const limit = Math.min(t.length, from + 60);
  let cut = -1;
  if (hasOpen) {
    const close = t.slice(from, limit).search(/[）)】\]』」]/); // ① 有闭合括号就用它
    if (close >= 0) cut = from + close + 1;
  }
  if (cut < 0) {
    const stop = t.slice(from, limit).search(/[。！？；\n]/); // ② 没闭合就退到第一个句末标点
    if (stop >= 0) cut = from + stop + 1;
  }
  if (cut < 0) return t;
  const out = t.slice(cut).replace(/^[，,。:：;；、\s]+/, '').trim();
  return out.length >= 8 ? out : t; // 削完太短说明整段都是说明，宁可原样留
}

/**
 * 这次命中是不是「其实落在正确写法内部」。
 *
 * 中文没有词边界：用子串/滑窗扫「建国眉」时，它可能只是 `陈建国眉头一皱` 里**正确人名的后半截
 * 再带上后边一个字**，压根不是什么错写法。按「建国眉 → 陈建国」去改，正文会变成 `陈陈建国头一皱`
 * ——「眉」被吃掉，越改越坏（2026-10-08 实测：清单里挂着这么一条"旧写法残留"，点一次坏一次）。
 *
 * 判据（必须"正确写法先于它开始、且与它重叠"）：
 *  - `陈建国眉头一皱` 命中 `建国眉`（at=1）：`陈建国` 起于 0，0 < 1 且 0+3 > 1 → 算误命中，跳过。
 *  - `陈陈建国` 命中 `陈陈建`（at=0）：`陈建国` 起于 1，**晚于**命中点 → 是真错写，照改。
 * 之所以要"先于"这个方向：叠字错写本来就是正确名字前面/后面多长出来的，反过来判会把真问题一起放过。
 */
export function insideCorrectName(text: string, at: number, correct: string): boolean {
  const t = String(text || '');
  const L = String(correct || '').length;
  if (!L || at <= 0) return false;
  for (let j = Math.max(0, at - L + 1); j < at; j++) {
    if (t.startsWith(correct, j)) return true; // j + L > at 在这个区间内恒成立
  }
  return false;
}

/** 数一个"错写法"在正文里**真正算数**的残留处数（排除落在正确写法内部的误命中） */
export function countResidual(text: string, from: string, to: string): number {
  const t = String(text || '');
  const bad = String(from || '');
  if (!bad) return 0;
  let n = 0;
  for (let i = t.indexOf(bad); i >= 0; i = t.indexOf(bad, i + 1)) {
    if (!insideCorrectName(t, i, to)) n += 1;
  }
  return n;
}

/**
 * 全书统一改名：替换 from → to，并在**接缝两侧去掉叠字**。
 *
 * 为什么必须去叠字：稿子里存在 `陈陈建国头一皱` 这种叠字错写（陈 + 陈建国）。
 * 直接把 `陈陈建` 换成 `陈建国` 会得到 `陈建国国头一皱`；下一轮「残留扫描」又命中 `建国国`，
 * 换回去又变 `陈陈建国头一皱` —— **两个写法来回震荡，永远收敛不了**。
 * 去叠字后一次到位：`陈陈建国头一皱` → `陈建国头一皱`。
 */
export function replaceWithSeamDedup(text: string, from: string, to: string, correct?: string): { text: string; count: number } {
  const t = String(text || '');
  const bad = String(from || '');
  const good = String(to || '');
  if (!bad) return { text: t, count: 0 };
  let out = '';
  let i = 0;
  let count = 0;
  while (i <= t.length) {
    const at = t.indexOf(bad, i);
    if (at < 0) { out += t.slice(i); break; }
    // 命中落在正确写法内部（详见 insideCorrectName）：不是错写法，原样放过，只前进一个字继续找
    if (correct && insideCorrectName(t, at, correct)) { out += t.slice(i, at + 1); i = at + 1; continue; }
    count++;
    out += t.slice(i, at);
    let piece = good;
    if (out && piece && out[out.length - 1] === piece[0]) piece = piece.slice(1); // 左接缝叠字
    let skip = 0;
    const after = t.slice(at + bad.length);
    if (piece && after && piece[piece.length - 1] === after[0]) skip = 1; // 右接缝叠字
    out += piece;
    i = at + bad.length + skip;
  }
  return { text: out, count };
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
