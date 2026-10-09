/**
 * 【书名判据】过审 + 冲榜，从"选书名"这一步就开始卡。
 *
 * 为什么单独建一层：书名的失败是**不可逆**的。正文写得再好，书名在书城里没人点，
 * 算法就不会给量 —— 番茄分发的第一关叫"吸量"，看的就是书名/简介/开篇抓不抓人。
 * 而且书名一旦定下来再改，等于换一本书重新开始（老读者认不出、算法重新打标签）。
 *
 * ── 判据来源 ──────────────────────────────────────────────
 * 过审侧（机器审，违反直接下架或不予收录）：
 *   ① 涉黄涉政涉暴、粗口、黑产词（各平台通用安全红线）
 *   ② 导流词：微信 / QQ / 加群 / 公众号 / 扫码 / 私信 / 站外平台名（番茄、七猫均严禁站外导流）
 *   ③ 竞品平台名：起点 / 晋江 / 阅文 / 纵横 / 书旗 等（书名带别家平台名 = 导流 + 侵权风险）
 *   ④ 极限词：广告法口径的"第一 / 最强 / 史上最 / 唯一 / 国家级"等
 *
 * 冲榜侧（吸量，决定点击率与算法打标签）：
 *   ① 信息量：书名要让读者一眼看出"这是什么题材、什么爽点" —— 番茄当下主流是
 *      「主标题：副标题」式（如"高考前三天：我靠邮票IC卡造出中国芯"），
 *      比文艺腔书名点击率高得多，且便于算法打题材标签。
 *   ② 题材关键词：系统/重生/穿越/空间/神医/年代/高考/直播…没有关键词 = 算法认不出你是谁。
 *   ③ 冲突/反差信号：开局/穿成/退婚/被赶/打脸/逆袭/偏要…
 *   ④ 数字：带数字的书名吸量普遍更好（"三天""八十年代""九零"）。
 *
 * 全部为确定性计算，不依赖 AI 判断 —— 同一书名跑多少次结果一致。
 */

export interface TitleReport {
  title: string;
  /** 吸量分 0-100（冲榜口径） */
  score: number;
  /** 能否过机器审 */
  pass: boolean;
  length: number;
  /** 硬伤：必须改，否则上架被卡 */
  issues: string[];
  /** 建议：不致命，但影响吸量 */
  tips: string[];
  /** 命中了哪些加分项（给作者看"这本书名凭什么能打"） */
  hits: string[];
  verdict: string;
}

/** 安全红线：涉黄涉政涉暴、粗口、黑产 */
const BAN_WORDS = /(色情|淫|嫖|嫖娼|吸毒|毒贩|赌博|赌场|洗钱|走私|代孕|卖淫|强奸|轮奸|乱伦|变态|虐杀|自杀指南|炸药制作|枪支买卖|办证|发票|私彩|裸贷|校园贷|高利贷)/;
/** 导流词：一律不许出现（站外导流是番茄/七猫的共同红线） */
const DRAIN_WORDS = /(微信|QQ|企鹅|加群|群号|公众号|扫码|二维码|私信|加V|加微|豆瓣|知乎|微博|B站|抖音|快手|淘宝|拼多多|闲鱼|京东)/;
/** 竞品平台名 */
const RIVAL_WORDS = /(起点|晋江|阅文|纵横|书旗|刺猬猫|塔读|飞卢|掌阅|磨铁|豆瓣阅读)/;
/** 极限词（广告法口径） */
const EXTREME_WORDS = /(第一|最强|史上最|唯一|国家级|世界级|最佳|顶级|绝无仅有|全球第一|全国第一|首选)/;

/** 题材关键词：让算法一眼认出你属于哪个赛道 */
const GENRE_WORDS = /(重生|穿越|穿书|穿成|系统|空间|随身|签到|神医|中医|兵王|特种兵|战神|嫡女|王妃|太子|王爷|相爷|总裁|奶爸|后妈|继母|修仙|修真|玄学|相师|风水|古董|鉴宝|法医|刑侦|刑警|律师|医生|教师|厂|车间|年代|八十年代|八零|九零|九零后|知青|高考|学区|拆迁|股市|炒股|创业|摆摊|直播|电商|外卖|跑腿|快递|网约|传承|手艺人|匠|军婚|随军|知青|供销社|粮票|工分)/;
/** 冲突/反差钩子词：决定"想不想点开" */
const HOOK_TITLE_WORDS = /(开局|穿成|重生|被赶|退婚|离婚|净身|流放|顶包|替嫁|冲喜|打脸|逆袭|翻身|觉醒|绑定|曝光|翻车|塌房|偏要|死活|不敢|硬刚|全城|全家|全世界|都跪|求我|别惹|我偏|谁说|凭什么|我靠|开局就|一睁眼|睁眼|醒来就|回到)/;
/** 文艺腔 / 抽象无信息：好看但没人点，是 AI 起名的典型毛病 */
const ARTY_WORDS = /(那年|浮生|岁月|时光|若梦|如初|盛夏|微凉|微光|倾城|倾世|蒹葭|流年|清欢|旧梦|烟雨|落花|听风|观海|归途|远方|人间|半生|余生|此间|何以|莫负|不负)/;

/** 书名里的数字（含中文数字） */
const NUM_WORDS = /[0-9０-９]|[一二三四五六七八九十百千万零]/;

/** 统计"有效字数"：去掉空白与分隔符号 */
function titleLength(t: string): number {
  return t.replace(/[\s:：｜|·、，,。.!！?？…~—\-_*《》「」『』()（）【】\[\]]/g, '').length;
}

/** 撞名判断：去掉标点后完全相同，或一方包含另一方且长度差 ≤2 */
function isSimilar(a: string, b: string): boolean {
  const na = a.replace(/[\s\p{P}]/gu, '');
  const nb = b.replace(/[\s\p{P}]/gu, '');
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
  return l.includes(s) && l.length - s.length <= 2;
}

/**
 * 硬扫一个书名。
 * @param title 待检书名
 * @param opts.existing 已有的书名（本作品历史书名 / 热榜 TOP 榜名），用于查撞名
 */
export function checkTitle(title: string, opts: { existing?: string[] } = {}): TitleReport {
  const t = String(title || '').trim();
  const len = titleLength(t);
  const issues: string[] = [];
  const tips: string[] = [];
  const hits: string[] = [];

  if (!t) {
    return { title: t, score: 0, pass: false, length: 0, issues: ['书名为空'], tips: [], hits: [], verdict: '书名为空，无法评估。' };
  }

  // ── 一、过审硬伤（命中即 pass=false）──────────────────
  const ban = t.match(BAN_WORDS);
  if (ban) issues.push(`含安全红线词「${ban[0]}」，平台安全审核会直接拦截`);
  const drain = t.match(DRAIN_WORDS);
  if (drain) issues.push(`含导流词「${drain[0]}」，站外导流是平台红线，必须删`);
  const rival = t.match(RIVAL_WORDS);
  if (rival) issues.push(`含竞品平台名「${rival[0]}」，有导流与侵权风险，必须删`);
  const ext = t.match(EXTREME_WORDS);
  if (ext) issues.push(`含极限词「${ext[0]}」（广告法口径），建议换成具体描述`);

  if (len < 2) issues.push('书名过短（<2 字），读者与算法都认不出题材');
  if (len > 22) issues.push(`书名过长（${len} 字，应 ≤22），书城列表会被截断`);

  // 英文占比过高：纯英文名在番茄书城几乎没人点
  const enWords = t.match(/[A-Za-z]{2,}/g) || [];
  if (enWords.length >= 3) issues.push(`英文单词过多（${enWords.join('/')}），中文书城点击率极差`);

  // 符号堆砌
  if (/[!！?？]{2,}|。{2,}|\*{2,}/.test(t)) issues.push('连续强烈标点，书城展示会被判标题党');

  // 撞名
  const clash = (opts.existing || []).find((e) => isSimilar(t, e));
  if (clash) issues.push(`与已有书名「${clash}」高度相似，读者会认错、算法判定同质化`);

  // ── 二、冲榜吸量分（从 100 起扣）─────────────────────
  let score = 100;

  // ① 长度：6-18 字最佳
  if (len >= 6 && len <= 18) hits.push(`长度 ${len} 字，在书城一行放得下`);
  else if (len >= 4 && len <= 22) { score -= 8; tips.push(`长度 ${len} 字，略偏离最佳区间 6-18 字`); }
  else { score -= 22; }

  // ② 题材关键词（最影响算法打标签）
  const g = t.match(GENRE_WORDS);
  if (g) hits.push(`含题材词「${g[0]}」，算法能认出赛道`);
  else { score -= 22; tips.push('没有题材关键词（重生/系统/年代/神医/高考…），算法认不出你属于哪个赛道，也搜不到'); }

  // ③ 冲突/反差钩子（最影响点击率）
  const h = t.match(HOOK_TITLE_WORDS);
  if (h) hits.push(`含钩子词「${h[0]}」，有点击欲`);
  else { score -= 18; tips.push('没有冲突或反差信号（开局/穿成/退婚/被赶/逆袭…），书名平，点击率上不去'); }

  // ④ 数字（吸量加分）
  if (NUM_WORDS.test(t)) { hits.push('含数字，吸量更好'); score += 5; }

  // ⑤ 主副标题式（当下番茄主流，信息量高）
  if (/[：:｜|]/.test(t)) { hits.push('主副标题式，信息量足、便于算法打标签'); score += 5; }

  // ⑥ 文艺腔（AI 起名的典型毛病：好听但没信息量）
  const arty = t.match(ARTY_WORDS);
  if (arty && !g && !h) { score -= 20; tips.push(`「${arty[0]}」是文艺腔写法，好听但没信息量，书城点击率明显偏低`); }

  // ⑦ 撞名（已在 issues，这里再扣分）
  if (clash) score -= 30;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const pass = issues.length === 0;

  let verdict: string;
  if (!pass) verdict = `有 ${issues.length} 处硬伤必须先改：${issues[0]}`;
  else if (score >= 85) verdict = `${score} 分，书名能打：题材清楚、有钩子，书城点击率有保障`;
  else if (score >= 70) verdict = `${score} 分，能上架但吸量一般，按建议改一版会更好`;
  else verdict = `${score} 分，书名偏弱：${tips[0] || '信息量不足，读者在书城不会点开'}`;

  return { title: t, score, pass, length: len, issues, tips, hits, verdict };
}

/** 批量评书名并排序（方案挑选时用：好的排前面） */
export function rankTitles(titles: string[], opts: { existing?: string[] } = {}): TitleReport[] {
  return titles
    .map((t) => checkTitle(t, opts))
    .sort((a, b) => {
      if (a.pass !== b.pass) return a.pass ? -1 : 1; // 能过审的永远排前面
      return b.score - a.score;
    });
}

/** 把评分结果压成给 AI 看的指令文本（用于让它改书名） */
export function titleFixBrief(r: TitleReport): string {
  const lines: string[] = [`书名「${r.title}」：${r.verdict}`];
  if (r.issues.length) lines.push(`必须改掉的硬伤：${r.issues.join('；')}`);
  if (r.tips.length) lines.push(`提升吸量的建议：${r.tips.join('；')}`);
  if (r.hits.length) lines.push(`已有的优点（改的时候别丢掉）：${r.hits.join('；')}`);
  return lines.join('\n');
}
