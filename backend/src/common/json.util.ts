/**
 * JSON 容错解析工具。
 * 大模型（尤其带深度思考的推理模型）返回的文本常夹带思考过程、Markdown 围栏、多次试写，
 * 这里用「大括号配平扫描 + 多候选回退」把目标 JSON 抠出来，避免整条链路因一个多余字符而空返回。
 */

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;
const MAX_CANDIDATES = 30;

/** 从 start 处首个 '{' 开始，扫到配平的 '}'，返回这段完整 JSON 文本；扫描时正确跳过字符串内的括号与转义 */
function sliceJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** 生成按优先级排列的候选片段：整段 → 依次各配平段（跳过已覆盖区域，避免 O(n²)） */
function candidates(text: string): string[] {
  const out = [text.trim()];
  let i = text.indexOf('{');
  for (let n = 0; i >= 0 && n < MAX_CANDIDATES; n++) {
    const hit = sliceJson(text.slice(i));
    if (hit) {
      out.push(hit);
      i = text.indexOf('{', i + hit.length);
    } else {
      i = text.indexOf('{', i + 1);
    }
  }
  return out;
}

/** 把字符串内的裸换行/制表符转义 —— 模型常把小说换行直接写进 JSON 字符串，属非法 JSON，必须修 */
function repairBareNewlines(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && (ch === '\n' || ch === '\r' || ch === '\t')) {
      out += ch === '\t' ? '\\t' : '\\n';
      continue;
    }
    out += ch;
  }
  return out;
}

function toObject(cand: string): any {
  try {
    const v = JSON.parse(cand);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** 先按原样 parse，失败再修裸换行后重试 */
function parseAt(cand: string): any {
  return toObject(cand) ?? toObject(repairBareNewlines(cand));
}

function match(v: any, keys: string[], strict: boolean): boolean {
  if (!keys.length) return true;
  return strict ? keys.every((k) => k in v) : keys.some((k) => k in v);
}

/**
 * 输出被 token 上限截断时的抢救：截到最后一段完整内容，再补齐缺失的收尾括号。
 * 场景：全书脉络 JSON 很大（设定库+分卷+人物+伏笔…），模型常在写一半时被截断，
 * 括号不闭合 → 整段解析失败 → 存成 {} 还标 done，前端「全书脉络」一片空白。
 * 这里把已经写出来的字段尽量救回来。
 */
export function salvageJson(raw: string): any {
  if (!raw) return null;
  const text = raw.match(FENCE)?.[1] ?? raw;
  const start = text.indexOf('{');
  if (start < 0) return null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1;
  let safeStack: string[] = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) return null; // 本身就是完整 JSON，无需抢救
      lastSafe = i;
      safeStack = stack.slice();
      continue;
    }
    if (ch === ',' && stack.length) {
      lastSafe = i;
      safeStack = stack.slice();
    }
  }
  if (lastSafe < 0) return null;
  const head = text.slice(start, lastSafe).replace(/[,\s]+$/, '');
  return parseAt(head + safeStack.reverse().join(''));
}

/**
 * 容错解析 JSON。
 * @param raw 模型原始输出
 * @param requiredKeys 期望字段；先要求全部命中（严格），再退化为命中任一（宽松），
 *                     最后用截断抢救的结果兜底（同样要求命中任一期望字段）
 */
export function tryParseJson(raw: string, requiredKeys: string[] = []): any {
  if (!raw) return null;
  const text = (raw.match(FENCE)?.[1] ?? raw).trim();
  const cands = candidates(text);
  const pick = (strict: boolean) => {
    for (const cand of cands) {
      const v = parseAt(cand);
      if (v && match(v, requiredKeys, strict)) return v;
    }
    return null;
  };
  const hit = pick(true) ?? pick(false);
  if (hit) return hit;
  const salv = salvageJson(text);
  return salv && match(salv, requiredKeys, false) ? salv : null;
}

function unescape(s: string): string {
  return s
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * 定向抽取某个字符串字段的值（最后一道兜底）。
 * 当正文里同时出现「未转义双引号 + 裸换行」导致整体 JSON 无法解析时，
 * 用后继字段名（如 content 后面跟的 "summary"）当右边界，从原文里把内容抠出来。
 * @param openEnded 输出被 token 上限截断时（JSON 未闭合、找不到收尾引号）也强行取到结尾
 */
export function looseStringField(
  raw: string,
  field: string,
  nextKeys: string[] = ['summary', 'title'],
  openEnded = false,
): string | null {
  if (!raw) return null;
  const after = nextKeys.map((k) => `"${k}"`).join('|');
  const closed =
    new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"(?:${after})`).exec(raw) ??
    new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*)"`).exec(raw);
  if (closed) {
    const val = unescape(closed[1]).trim();
    if (val) return val;
  }
  if (!openEnded) return null;
  // 截断场景：从字段起点一直取到结尾，再清掉尾部的 JSON 残渣（引号/反引号/花括号）
  const open = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*)`).exec(raw);
  if (!open) return null;
  const val = unescape(open[1]).replace(/[\s"`}\]]+$/, '').trim();
  return val || null;
}
