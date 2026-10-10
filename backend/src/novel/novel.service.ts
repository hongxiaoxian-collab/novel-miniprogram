import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { currentQuota, checkNovelLimit, checkChapterLimit } from '../auth/quota';
import { AiService } from '../ai/ai.service';
import { tryParseJson, looseStringField } from '../common/json.util';
import {
  diceSimilar, titleStruct, locateQuote, allQuoteSpots, normQuote, midDiff, looksLikeName,
  dedupeAdjacentSegments, stripPromptLeak, replaceWithSeamDedup,
  countResidual, insideCorrectName,
} from '../common/text';
import { SearchService } from './search.service';
import { RANK_BOARD, renderRankBoard } from './rank-board';
import { analyzeBook, chapterFindings, rankFindings, PassReport } from './pass-review';
import { checkTitle, rankTitles } from './title-check';
import { buildDocx, safeFileName, DocxSection } from '../common/docx';
import { PLATFORMS, getPlatform, tagWhitelist } from '../platform/platform.config';
import {
  CreateNovelDto,
  GenerateOutlineDto,
  GenerateBibleDto,
  GenerateChapterDto,
  RewriteChapterDto,
  SaveChapterDto,
  UpdateNovelDto,
  AuthorAssistDto,
  CoverPlanDto,
} from './novel.dto';

/** 热榜研读强制要求：bot 每次写稿/推荐前研读番茄/七猫热榜小说，学钩子/语感/架构（与 coze-bot-design.md 对齐） */
const HOT_STUDY_RULE = `动笔前先用联网搜索定位该平台热榜 Top 作品，并用网页读取插件抓取试读章节，拆解其：1)钩子——开篇前300字如何3秒抓人、章末如何留悬念钩住下章；2)语感——句式长短、口语化、节奏密度、去AI味；3)架构——卷章切分、情绪曲线、爽点/伏笔/反转如何铺陈回收。只学方法论与节奏，禁止照搬抄袭原文。`;

/** 避撞车强制要求：平台大忌是与热榜作品书名/开局/主线雷同 */
const ANTI_CLASH_RULE = `【避撞车】平台大忌是与番茄/七猫在榜热书撞车：书名不得重名或近音近似、开局设定与核心情节线不得照搬热榜作品。必须联网比对后做出差异点。`;

/** 定版任务链（异步执行，前端轮询）：stage 与展示文案 */
const FINALIZE_STEPS = [
  { stage: 'dup', label: '查重 · 比对番茄/七猫热榜' },
  { stage: 'bible', label: '生成全书脉络 + 分卷时间线' },
  { stage: 'publish', label: '生成上架资料（简介 / 标签）' },
  { stage: 'golden', label: '写黄金 1-3 章' },
] as const;

/**
 * 【最高级写作铁律】目标不是"文笔好"、也不是"没矛盾"，而是 **过审 + 冲榜**。
 *
 * 这条规则要覆盖**所有**会产出正文的地方（黄金三章 / 续更 / 重写 / 大纲派生）。
 * 为什么单独抽成一个常量下发给模型：
 *   平台判据是可量化的（详见 pass-review.ts 的八项指标），如果只在事后"体检"里查，
 *   等于写完才发现不合格、返工重写；必须在**生成时**就把指标当约束写进去，一次到位。
 *
 * 判据来源：番茄签约标准 + 2026 年 5/8 月低质治理公告（AI粗制滥造 / 格式混乱 / 结构失常 / 空洞水文）
 *           + 番茄算法分发一线指标（吸量 / 完读率 / 追更比）。
 */
const PASS_GATE_RULE = `【过审即底线，冲榜是目标】本稿要投番茄/七猫，必须同时满足"机器审得过"和"算法愿意推"，逐条照做：

一、机器审的四条死线（违反立即被拒，平台每月拒签十几万本）
1. 禁"提纲式写文"：不许用"第一条/第二天/首先其次然后"这类编号式罗列推进剧情，
   一律改成按事件发生的自然顺序叙述。
2. 禁"句式重复堆砌"：同一句式不许连续出现三次以上；"了"字密度控制在 3% 以内。
3. 禁"模板化拼接"：段落长度要有变化（18-70 字），不许整章都是同一个长度的短段或长段。
4. 禁"空洞水文"：不许流水账、不许反复复述已知信息、不许用对白凑字数。
   纯对白对话占比控制在 28%-50%，其余用动作、心理、场景细节承载。

二、算法分发决定能不能起来（首秀期每天在跟同类书 PK）
5. 前 300 字内必须出现第一个冲突或强反差（吸量第一关：书名/简介/开篇抓不抓人）。
6. 每章章末 150 字内必须落一件具体发生的事（对白/动作/新信息）当钩子，
   不许用景物描写或心情感慨收束 —— 完读率和追更比全靠这个。
7. 章内要有情绪起伏：至少一处强情绪高点（打脸/反击/获得/揭示），
   不许整章平铺，也不许主角长时间憋屈不反击。
8. 爽点必须"有代价、有边界"：金手指出手就有成本（寿命/记忆/身体/关系），
   读者厌恶无脑无敌，无代价的爽反而掉留存。

三、文字质感（机器也查"句式呆板"）
9. 长短句交替：连续的中长句之间插 4-8 字的短句打断节奏。
10. 对话要单独成段；说话必须带动作或神态，不许光秃秃地"他说""她问"连排。
11. 不许出现解释性、总结性的旁白（"这让他明白了一个道理…""或许这就是命运"）。
12. 不许夹带英文单词、提示词残留、括号里的写作说明。`;

/** 黄金三章写作指令（定版后自动连写，第一章必须 3 秒抓人） */
const GOLDEN_CHAPTERS = [
  '黄金第一章：开篇 300 字内必须 3 秒抓人——直接进冲突/强反差/悬念，禁止环境描写与背景铺陈开场；本字内交代金手指或重生设定与主角处境；全章至少两处爽点或强情绪；章末留大钩子。',
  '黄金第二章：承接第一章章末钩子立刻兑现第一波爽点，稳住读者；主线推进一小步，埋下第一个长线伏笔，章末再留钩子。',
  '黄金第三章：第二波爽点升级（打脸/逆袭/获宝/翻身），把主角目标与全书主线对齐，章末抛出全书核心悬念，逼读者追更。',
];

export interface TaskStep {
  stage: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  note?: string;
  error?: string;
}

export interface DupReport {
  risk: 'high' | 'mid' | 'low';
  riskNote: string;
  matches: { title: string; platform: string; type: string; why: string; similarity: string }[];
  titleAdvice: string;
  titleSuggestions: string[];
  /** 候选名逐个"预检"过：只有真不撞车的才会给作者，避免"换个名还是撞"来回折腾 */
  titleChecks?: { title: string; risk: string; note: string; plot: string }[];
  plotAdvice: string;
  verdict: string;
  cached?: boolean; // true=沿用了 30 分钟内的上一次比对结果（内容指纹未变）
  /** 后端真联网抓到的在榜作品（证据链，作者可核对，不再是 AI 凭印象编的） */
  evidence?: { title: string; platform: string; snippet: string; url: string }[];
  searched?: boolean; // true=本次真的联网检索过（网络不通时为 false，结论会标明"未联网"）
}

/**
 * 严重撞车导致定版中断时，错误消息以此开头。
 * 前端据此把「定版失败」升级成「撞车处置面板」（换书名 / 调情节 / 换题材），而不是一句干巴巴的失败提示。
 */
/**
 * 【360 式打分】每一处矛盾按等级扣分，修一条就把这分加回来 —— 作者要的就是"修一个分数加一点"。
 * 用 AI 给的 score 不行：它是整份稿子的整体印象分，修掉一条不会变，作者看不到反馈。
 * 扣多少 = 高 8 / 中 4 / 低 2；撞车另外扣（high 12 / mid 5），因为撞车属于必须处理的发布风险。
 */
const PENALTY: Record<string, number> = { 高: 8, 中: 4, 低: 2 };
/** 定点修复成功后这一条能加回多少分（与 PENALTY 同源，前端按钮上的「+N分」也是它） */
const PATCH_GAIN = PENALTY;
const DUP_PENALTY: Record<string, number> = { high: 12, mid: 5, low: 0 };
/** 体检时每批喂给 AI 的章节数：一批太多会漏审后面的章，太少则调用次数翻倍 */
const AUDIT_BATCH = 4;

/**
 * 【续更提交前自检】作者要求：续更 = 发布，写完必须自检通过才能交出去
 * （"等全书写完再体检就晚了"）。所以写完一章立刻跑自检并当场改到 0 处。
 * 只查矛盾、**不查撞车**（撞车是书名级的事，续更不必每次联网查一遍）。
 */
const HEAL_MAX_ROUNDS = 3;   // 最多 3 轮「查 → 修 → 再查」；再多说明有条目在来回打转
const HEAL_MAX_PER_ROUND = 8; // 一轮最多修 8 条
/** 后台任务步骤的上下文：让长步骤（如"逐批审全书"）能实时把细粒度进度写进 jobLog */
export interface JobCtx {
  note: (s: string) => Promise<void>;
}

/** 体检参数。默认 full=true：把全书每一章都交给 AI 过一遍（作者要求"一次把问题找完"） */
export interface AuditOpts {
  full?: boolean;
  force?: boolean;
  /** 强制"全书重新审一遍"。默认 false = 收敛式复检（详见 auditConsistency 里的说明） */
  fullScan?: boolean;
  /**
   * 查什么：all=矛盾+撞车（默认）｜consistency=只查矛盾（快，不联网）｜dup=只查撞车（矛盾沿用上一份清单）。
   * 作者要求可分开点：撞车要联网检索，多数时候只想看看稿子有没有矛盾，不该每次都等联网。
   */
  scope?: 'all' | 'consistency' | 'dup';
  onProgress?: (done: number, total: number, label: string) => Promise<void> | void;
}
function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}
function scoreOfIssues(issues: any[], dupRisk = 'low'): number {
  const pen = (issues || []).reduce((s, x) => s + (PENALTY[x?.level] ?? 2), 0);
  return Math.max(0, Math.min(100, 100 - pen - (DUP_PENALTY[dupRisk] || 0)));
}

export const DUP_HIGH = 'DUP_HIGH｜';
/** 中风险撞车同样中断定版（作者要求：只要有相似就先给 3 个新名让他选，不能默默生成） */
export const DUP_MID = 'DUP_MID｜';

/**
 * 事实台账（canon）—— 治「前后矛盾」的核心。
 *
 * 为什么必须有：写稿时如果只带「上一章摘要」，AI 到第 20 章早忘了第 3 章定下的事，
 * 于是出现主角改名（资料写林越、正文写林辰）、女主同章两种写法（苏晚晴/苏婉晴）、
 * 时间线错乱（章内两小时的事被写成"昨天买的"）这类硬伤。
 * 台账把「人名唯一写法 + 当前剧情时间 + 已锁死事实 + 伏笔状态」显式化，每章强制注入并要求回传更新。
 */
export interface Canon {
  time?: string; // 当前剧情时间点
  people?: { name: string; role?: string; state?: string }[]; // 人物当前状态（name 为唯一写法）
  facts?: string[]; // 已锁死事实（不可违反）
  foreshadow?: { desc: string; status?: string }[]; // 伏笔及状态
}

/**
 * 人物锁定表：优先用脉络人物；脉络人物缺失时退回「上架资料」里的人物。
 * 为什么需要兜底：旧数据里存在 bibleStatus=done 但 characters 为空的作品，
 * 写稿时等于完全没有名字约束 → 资料写「林越」、正文写「林辰」，女主还出现 苏晚晴/苏婉晴 两种写法。
 */
function charListOf(bible: any, protagonistsJson?: string | null): any[] {
  const fromBible = (bible?.characters || []).filter((c: any) => c && c.name);
  if (fromBible.length) return fromBible;
  try {
    const p = protagonistsJson ? JSON.parse(protagonistsJson) : [];
    return Array.isArray(p) ? p.filter((c: any) => c && c.name) : [];
  } catch (e) {
    return [];
  }
}

/** 把台账渲染成写稿 prompt 里的硬约束段落 */
function renderCanon(canon: Canon | null, bibleChars: any[]): string {
  const lines: string[] = [];
  const names = (bibleChars || [])
    .filter((x) => x && x.name)
    .map((x) => `${x.name}（${x.role || ''}）`);
  if (names.length) {
    lines.push(`· 人物名只能用下列写法，一个字都不许改（禁止改姓、禁止同音替换）：${names.join('、')}`);
  }
  if (canon?.time) lines.push(`· 当前剧情时间：${canon.time}（不得倒退；同一章内的时间描述必须自洽）`);
  (canon?.people || []).forEach((p) => {
    if (p?.name) lines.push(`· ${p.name}｜${p.role || ''}｜现状：${p.state || '正常'}`);
  });
  (canon?.facts || []).slice(-40).forEach((f) => lines.push(`· 已锁死：${f}`));
  (canon?.foreshadow || []).slice(-30).forEach((f) => lines.push(`· 伏笔：${f.desc}（${f.status || '埋设中'}）`));
  return lines.length ? lines.join('\n') : '（首章，暂无台账：请你建立，并在 canon 里回传）';
}

/**
 * 封面道具词表（必须与 miniprogram/utils/cover.js 的 PROPS 一致）。
 * prompt 里只让 AI 用这些键，前端才有对应的绘制零件；多出来的键一律丢掉。
 */
const PROPS = {
  books: '旧书 / 连环画堆',
  sign: '手写招牌 / 价目牌',
  bike: '二八自行车',
  crate: '木箱 / 货箱',
  truck: '卡车 / 货车',
  pc: '电脑 / 显示器',
  coin: '钱币 / 钞票',
  sword: '刀剑 / 兵器',
  lantern: '灯笼',
  chart: '股市曲线 / 折线图',
  crane: '塔吊 / 工地',
  skyline: '城市楼群',
  mountain: '远山',
  ring: '星环 / 轨道',
  factory: '厂房 / 烟囱',
};
const COVER_ENUM = {
  sceneType: ['city', 'county', 'mountain', 'space', 'indoor', 'factory'],
  layout: ['center', 'band', 'side'],
  figType: ['modern', 'ancient', 'sci'],
  gender: ['male', 'female'],
  hair: ['short', 'long', 'bun'],
  outfit: ['worker', 'suit', 'coat', 'dress', 'armor', 'robe'],
  pose: ['hold', 'walk', 'look'],
};

/** 收紧 AI 给的封面方案：色值必须是 #rrggbb、枚举必须命中词表、比例必须在合理区间 */
function sanitizeCoverPlan(raw: any): any {
  const p = raw || {};
  const one = <T extends string>(v: any, list: T[], fb: T): T => (list.indexOf(v) >= 0 ? v : fb);
  const hex = (v: any, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fb);
  const pal = p.palette || {};
  const bg = Array.isArray(pal.bg) ? pal.bg : [];
  const fig = p.figure || {};
  const props = (Array.isArray(p.props) ? p.props : []).filter((k: any) => PROPS[k]).slice(0, 4);
  return {
    v: 2,
    scene: String(p.scene || '').slice(0, 120),
    mood: String(p.mood || '').slice(0, 30),
    sceneType: one(p.sceneType, COVER_ENUM.sceneType, 'city'),
    layout: one(p.layout, COVER_ENUM.layout, 'center'),
    props: props.length ? props : ['books', 'sign'],
    figure: {
      type: one(fig.type, COVER_ENUM.figType, 'modern'),
      gender: one(fig.gender, COVER_ENUM.gender, 'male'),
      hair: one(fig.hair, COVER_ENUM.hair, 'short'),
      outfit: one(fig.outfit, COVER_ENUM.outfit, 'worker'),
      pose: one(fig.pose, COVER_ENUM.pose, 'hold'),
    },
    palette: {
      bg: [hex(bg[0], '#1b2233'), hex(bg[1], '#41506b')],
      accent: hex(pal.accent, '#ffd77a'),
      cloth: hex(pal.cloth, '#1a2130'),
      inner: hex(pal.inner, '#e8edf5'),
      skin: hex(pal.skin, '#eccfae'),
      hair: hex(pal.hair, '#14161d'),
    },
    horizon: Math.min(0.78, Math.max(0.5, Number(p.horizon) || 0.68)),
    heroScale: Math.min(1.15, Math.max(0.7, Number(p.heroScale) || 0.95)),
  };
}

/**
 * 这类矛盾没有唯一正确改法，必须作者拍板，不能由程序自动修：
 * - 模式：重生回自己 / 魂穿别人身，改哪个方向取决于作者想写什么
 * - 作品名：撞车要换名，得作者选
 * 其余（人名统一、时间线对齐、事实统一、伏笔回收、字数补足）程序都能按 fix 字段直接改。
 */
function isHumanIssue(x: any): boolean {
  return String(x?.type || '') === '模式' || String(x?.type || '') === '作品名';
}

/**
 * 这条到底算不算矛盾。
 *
 * AI 逐句核对时偶尔会把"分析过程"也当成结论吐出来：why 里自己论证一圈、末尾写"不报"，
 * fix 写"无需修改"。这种条目没有任何可改的地方，却会占一个坑位、白扣一次分，
 * 作者体感就是"永远修不完"（2026-10-08 作者指出：既然无需改动，那就不是矛盾，不该列）。
 */
function isNonIssue(x: any): boolean {
  const fix = String((x && x.fix) || '').replace(/\s/g, '');
  const why = String((x && x.why) || '').replace(/\s/g, '');
  if (!fix && !why) return true; // 既没说问题也没给改法 = 空条目
  // ① fix 自己就说不用动
  if (/^(无需|无须|不需|不用|不必|暂不需要|保持原样|保持不变|维持原样)/.test(fix)) return true;
  if (/^(无|—|-|--|\/|／)$/.test(fix)) return true;
  // ② why 下了"不是矛盾"的结论，且 fix 里没有可执行动作
  const concluded = /(不报|无需报|不必报|不算矛盾|不构成矛盾|不是矛盾|未构成矛盾|无矛盾|并不矛盾|非矛盾|不算问题|不是问题|无硬伤|不成立|无需列出|不必列出)/;
  const actionable = /(改成|改为|换成|替换|删除|删掉|补写|统一成|统一为|去掉|加上|插入)/;
  return concluded.test(why) && !actionable.test(fix);
}

/** 「重复」类：这一句本身没写错，错在它在同一章里出现了不止一次 */
function isDupIssue(x: any): boolean {
  return /重复|重合|复用|同一句/.test(`${(x && x.type) || ''} ${(x && x.why) || ''} ${(x && x.fix) || ''}`);
}


/**
 * 去掉章名里多余的「第N章」前缀。
 * AI 常按 prompt 字面返回「第1章 刚重生就被老婆提离婚？」，而章号本来就有独立字段（Chapter.order），
 * 各处展示又都会拼「第N章」→ 会出现「第1章 第1章 刚重生…」。统一在落库时剥掉。
 */
function stripChapterNo(title: string): string {
  return String(title || '')
    .replace(/^\s*第\s*[0-9０-９一二三四五六七八九十百千两]+\s*章\s*[·:：、,，.\-—－\s]*/, '')
    .trim();
}

/**
 * 洗书名：AI 喜欢顺手带上书名号，落库后就变成《《重生1998：XXX》》这种双层书名号。
 * 书名本身不该带《》，展示时由界面统一加。
 */
function cleanTitle(t: any): string {
  return String(t || '')
    .replace(/[《》<>【】\[\]]/g, '')
    .replace(/^[\s"'']+|[\s"'']+$/g, '')
    .trim();
}

/**
 * 模式锁：重生 / 魂穿 / 穿书 三种模式只能选一种，且记忆边界必须写死。
 * 不锁就会出现这种硬伤：第1章写"重生到别人身上"（B 魂穿），第2章又写"上一世我在这儿蹲了15天"
 * （那是 A 重生回自己才成立的说法）——读者一眼看出是拼的。
 */
function modeLockOf(bible: any): string {
  const s = String(bible?.rebornMode || '').trim();
  if (s && s !== '无') {
    return `· 【模式锁·不得违反】${s}\n  写稿时必须前后一致：若锁的是「魂穿/穿到别人身上」，就绝不能写"上一世我在这里……"这类把这具身体的经历当成本人经历的句子；主人公只能"知道"原主的事，不能"经历过"。`;
  }
  return '';
}

/**
 * 中轴线定位：大纲 + 分卷时间线的价值，只有「写每一章前都按它对一次位」才体现得出来。
 * 只把整坨 bible JSON 塞进 prompt 等于没约束（模型会当背景忽略掉），
 * 所以按章号精确定位出：本章属于哪一卷、本卷锚定的真实时间/事件、本卷主线与爆发点、
 * 离下一个关键节点章还差几章 —— 让"不跑偏"变成可执行的硬约束。
 */
function axisOf(bible: any, order: number): string {
  const vols = (bible?.volumes || []).filter((v: any) => v && v.chapterRange);
  const hit = vols.find((v: any) => {
    const m = String(v.chapterRange).match(/(\d+)\s*[-~－—–]\s*(\d+)/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return order >= Math.min(a, b) && order <= Math.max(a, b);
  });
  if (!hit) return '（大纲里没有可用的分卷区间，请务必遵守上面的三幕大纲）';
  // 关键节点章：先按卷号匹配；模型偶尔漏填 volume，再按「order 落在本卷区间」兜底，
  // 否则整卷的节点章全丢 → 中轴线只剩卷名，等于没有逐章定位。
  const allKeys = (bible?.keyChapters || []).filter((k: any) => k && Number(k.order) > 0);
  const rangeOf = (v: any) => {
    const m = String(v.chapterRange).match(/(\d+)\s*[-~－—–]\s*(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const rg = rangeOf(hit);
  const keys = allKeys.filter(
    (k: any) =>
      Number(k.volume) === Number(hit.volume) ||
      (rg && Number(k.order) >= Math.min(rg[0], rg[1]) && Number(k.order) <= Math.max(rg[0], rg[1])),
  );
  const lines = [
    `· 本章属第 ${hit.volume} 卷《${hit.name || ''}》，全书章节区间为 ${hit.chapterRange}`,
    hit.keyEvent ? `· 本卷锚定的时间 / 事件（必须对齐，不得另起一条时间线）：${hit.keyEvent}` : '',
    hit.arc ? `· 本卷主线：${hit.arc}` : '',
    hit.climax ? `· 本卷爆发点：${hit.climax}` : '',
    hit.hook ? `· 卷末钩子：${hit.hook}` : '',
  ].filter(Boolean);
  if (keys.length) {
    lines.push(
      `· 本卷关键节点章：${keys.map((k: any) => `第${k.order}章《${k.title}》`).join('、')}`,
    );
    const next = keys.find((k: any) => Number(k.order) >= order);
    if (next && Number(next.order) === order) {
      lines.push(`· ⚠ 本章就是关键节点章，必须完成《${next.title}》：${next.summary || ''}`);
    } else if (next) {
      lines.push(`· 中轴推进目标：正朝第${next.order}章《${next.title}》推进（还差 ${Number(next.order) - order} 章）`);
    }
  } else if (rg) {
    // 本卷没列节点章：退而求其次，用卷内位置给一个不可跑偏的进度锚
    const a = Math.min(rg[0], rg[1]);
    const b = Math.max(rg[0], rg[1]);
    const pct = Math.round(((order - a + 1) / Math.max(1, b - a + 1)) * 100);
    lines.push(`· 本卷进度：第 ${order} 章 / 本卷 ${a}-${b} 章（约 ${pct}%），必须朝本卷主线与爆发点推进，不得提前写后面卷的内容`);
  }
  const locks = (bible?.stateLocks || []).filter(Boolean);
  if (locks.length) lines.push(`· 状态锁（不得违反）：${locks.join('；')}`);
  return lines.join('\n');
}

/** 合并台账：新一轮覆盖旧的同键项，事实列表去重保序 */
function mergeCanon(prev: Canon | null, next: Canon | null): Canon {
  const p = prev || {};
  const n = next || {};
  const uniqBy = <T>(arr: T[], key: (x: T) => string) => {
    const m = new Map<string, T>();
    arr.forEach((x) => {
      const k = key(x);
      if (k) m.set(k, x);
    });
    return [...m.values()];
  };
  return {
    time: n.time || p.time || '',
    people: uniqBy([...(p.people || []), ...(n.people || [])], (x) => (x && x.name) || ''),
    facts: [...new Set([...(p.facts || []), ...(n.facts || [])])].slice(-60),
    foreshadow: uniqBy([...(p.foreshadow || []), ...(n.foreshadow || [])], (x) => (x && x.desc) || '').slice(-40),
  };
}

@Injectable()
export class NovelService {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private readonly search: SearchService,
  ) {}

  /** 平台元数据（标签枚举） */
  getMeta() {
    return PLATFORMS;
  }

  async listNovels(platform?: string, uid?: string | null, guestKey?: string | null) {
    const base = platform ? { platform } : {};
    // 「AI 选题」的占位作品（还没选定方案）不进列表：它不是一部书，只是选题任务的载体
    //
    // 【踩坑·已修】"历史无主作品"必须同时满足 userId=null **且** guestKey=null。
    // 只判 userId=null 会把**别的游客**的作品也捞进来 —— 游客建的作品 userId 同样是 null，
    // 于是 A 的列表里出现了 B 刚写的书（实测复现）。老作品（登录功能上线前建的）才两个都为空。
    const legacy = { userId: null, guestKey: null };
    const where = uid
      ? { ...base, planDraft: false, OR: [{ userId: uid }, legacy] }
      : {
        ...base,
        planDraft: false,
        OR: [legacy, ...(guestKey ? [{ guestKey }] : [])],
      };
    const list = await this.prisma.novel.findMany({ where, orderBy: { updatedAt: 'desc' } });
    // 【作者反馈·已修】列表"已写 6 章"、点进去只有 3 章：以前直接 _count 全部章节，
    // 连作废章节(stale)也算进去。这里改成只数有效章节，和章节目录（listChapters）口径一致。
    const ids = list.map((n) => n.id);
    const counts = ids.length
      ? await this.prisma.chapter.groupBy({
          by: ['novelId'],
          where: { novelId: { in: ids }, stale: false } as any,
          _count: { _all: true },
        })
      : [];
    const cnt = new Map(counts.map((c: any) => [c.novelId, c._count._all]));
    return list.map((n) => ({ ...n, _count: { chapters: cnt.get(n.id) || 0 } }));
  }

  async getNovel(id: string) {
    const n = await this.prisma.novel.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('作品不存在');
    return n;
  }

  async createNovel(dto: CreateNovelDto, uid?: string | null, guestKey?: string | null) {
    // 配额闸门：只拦"新建"，已有作品永远可编辑 —— 绝不能因为配额把作者锁死在门外
    const q = await currentQuota(this.prisma as any, uid || null, guestKey);
    const deny = checkNovelLimit(q);
    if (deny) throw new BadRequestException(deny);

    return this.prisma.novel.create({
      data: {
        ...dto,
        userId: uid || null,
        guestKey: uid ? null : (guestKey || null),
        title: cleanTitle(dto.title),
        // 游客不给调每章字数：固定 2000。传了也强制改回，避免绕过
        chapterWords: q.limits.chapterWordsEditable
          ? (dto.chapterWords ?? 2000)
          : q.limits.wordPerChapter,
        tags: dto.tags ? JSON.stringify(dto.tags) : undefined,
      } as any,
    });
  }

  async updateNovel(id: string, dto: UpdateNovelDto) {
    const before: any = await this.getNovel(id);
    const data: any = { ...dto };

    // 每章字数：游客级别锁死不给调，付费级别也不能超过自己等级的上限。
    // 这一条是"字数不可以改"的落点 —— 只在这里卡，正文其余部分照常可编辑。
    if ((dto as any).chapterWords != null) {
      const want = Number((dto as any).chapterWords);
      const q = await currentQuota(this.prisma as any, before.userId || null, before.guestKey || null);
      if (!q.limits.chapterWordsEditable) {
        if (want !== q.limits.wordPerChapter) {
          throw new BadRequestException(
            `游客不支持调整每章字数，固定 ${q.limits.wordPerChapter} 字。${q.upsell || ''}`,
          );
        }
      } else if (want > q.limits.wordPerChapter) {
        throw new BadRequestException(`当前等级每章最多 ${q.limits.wordPerChapter} 字`);
      }
    }
    if (data.title) data.title = cleanTitle(data.title); // 书名不带《》：展示时界面统一加
    if (data.dupAccepted) data.dupAccepted = cleanTitle(data.dupAccepted);
    if (dto.tags) data.tags = JSON.stringify(dto.tags);
    // 换了书名 = 设定变了：简介 / 主角 / 标签 / 全书脉络都是按旧名写的，留着就是"名和简介对不上"。
    // 作者明确要求过：再次定稿，作品简介必须跟着改。这里清掉 → 定版时按新名重新生成，不会再"跳过"。
    // 注意比的是"洗过书名号之后的值"：只把《XXX》洗成 XXX 不算改名，不能因此把简介/脉络全清了。
    if (data.title && cleanTitle(data.title) !== cleanTitle(before.title)) {
      Object.assign(data, { intro: null, protagonists: null, tags: null, bible: null, bibleStatus: 'none', canon: null });
      await this.clearAudit(id); // 改名 = 重开一部，旧体检结果作废
    }
    return this.prisma.novel.update({ where: { id }, data });
  }

  /** 删除作品（级联删除其下所有章节，数据库外键 onDelete: Cascade 生效） */
  async deleteNovel(id: string) {
    await this.getNovel(id);
    await this.prisma.novel.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** AI 按平台爆款推荐题材 */
  async recommendTopic(platform: string) {
    const p = getPlatform(platform);
    const prompt = `你是网文爆款写作助手。平台=${p.name}。请联网搜索该平台当前热门榜/热词，
【热榜研读】${HOT_STUDY_RULE}
返回 3-5 个当前最热的题材（每个 2-4 字，如 都市/重生/赘婿）。只输出 JSON：{"topics":["...","..."]}`;
    const text = await this.ai.chat(prompt);
    const parsed = tryParseJson(text, ['topics']);
    if (!parsed?.topics) throw new Error(`AI 未返回题材列表，原始输出：${text.slice(0, 200)}`);
    return { topics: parsed.topics };
  }

  // ==================== AI 选题：扫榜 → 差异化金手指 → 3-5 个完整方案 ====================

  /**
   * 【真扫榜】后端亲自联网抓番茄 / 七猫男频女频榜单，抓不到才退回本地快照。
   *
   * 为什么不让 AI "联网扫榜"：模型没有联网工具，让它写榜单 = 编书名编热度，
   * 照着假榜单定题材比不扫更糟。这里由后端发真实请求抓证据，AI 只负责在真证据上做研读。
   * 抓回来的书名顺手存进本地在榜库（HotBook），后面查重会更准。
   */
  private async scanBoard(platform: string): Promise<{ fresh: boolean; evidence: string; at: string }> {
    const p = getPlatform(platform);
    const queries = [
      `${p.name} 男频 畅销榜 排行 前十`,
      `${p.name} 女频 畅销榜 排行 前十`,
      '番茄小说 男频 畅销榜 排行',
      '七猫小说 男频 大热榜 排行',
      '番茄小说 女频 畅销榜 排行',
      '七猫小说 女频 大热榜 排行',
      '网文 热门题材 趋势 开局',
    ];
    const groups = await Promise.all(queries.map((q) => this.search.search(q).catch(() => [])));
    /**
     * 【坑·已修】搜索"XX 畅销榜"回来的一大半是下载站 / 应用商店 / 短视频激励页这类 SEO 垃圾
     * （实测抓到"微软商店PC端免费小说""抖音金币激励""全本免费下载"），
     * 直接喂给 AI 会把选题带成《PC召史鬼写》这种根本不是网文的东西。
     * 所以逐条过滤：带下载/商店/App/激励等词的、不像作品名的，一律丢掉。
     */
    const JUNK = /下载|全本|txt|TXT|微软|商店|抖音|金币|激励|安卓|iOS|APP|官网|笔趣|顶点|八一|爱下|无弹窗|免费阅读|书城|追书|排行榜单/;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const hits of groups) {
      for (const h of hits) {
        const t = String(h.title || '').replace(/[《》]/g, '').trim();
        const s = String(h.snippet || '');
        if (!t || seen.has(t)) continue;
        if (JUNK.test(t) || JUNK.test(s.slice(0, 40))) continue;
        if (t.length > 30) continue; // 作品名不会这么长，多半是营销标题
        seen.add(t);
        lines.push(`- 《${t}》[${h.source}]${s ? '：' + s.slice(0, 90) : ''}`);
        if (lines.length >= 20) break;
      }
      if (lines.length >= 20) break;
    }
    if (lines.length) this.search.collect(groups.flat() as any, '扫榜').catch(() => undefined);

    const fresh = lines.length >= 4;
    /**
     * 本地快照**始终注入**：它是人工真扫、逐条核对过的（番茄男频四大分类榜 / 番茄女频 / 七猫男女频），
     * 质量远高于搜索引擎抓回来的东西。联网结果只作增量补充，抓不到也不影响选题质量。
     */
    const base = `【本地榜单快照 · ${RANK_BOARD.updatedAt} 人工真扫核对（这是主证据）】\n${renderRankBoard()}\n\n`
      + `【快照提炼的信号】\n`
      + `在爆·男频：${(RANK_BOARD.signals.inMale || []).join(' / ')}\n`
      + `在爆·女频：${(RANK_BOARD.signals.inFemale || []).join(' / ')}\n`
      + `在爆开局套路：${(RANK_BOARD.signals.openers || []).join(' / ')}\n`
      + `已降温：${(RANK_BOARD.signals.cooling || []).join(' / ')}\n`
      + `跨平台规律：${(RANK_BOARD.signals.common || []).join(' / ')}`;
    const evidence = fresh
      ? `${base}\n\n【本次联网补充抓到的结果（仅供参考，严禁凭印象编造上面没有的作品名）】\n${lines.join('\n')}`
      : `${base}\n\n【⚠ 本次联网没抓到可用结果（网络受限或全是下载站垃圾），请以本地快照为准】`;
    return { fresh, evidence, at: new Date().toISOString().slice(0, 10) };
  }

  /** 建一个「AI 选题」占位作品（列表里不出现），并立刻启动扫榜任务 */
  async createPlanDraft(dto: { platform: string; opinion?: string; chapterWords?: number }, uid?: string | null) {
    // 只保留一个占位：作者反复点「AI 帮我选」不会堆出一串废作品
    await this.prisma.novel.deleteMany({ where: { planDraft: true, jobStage: { not: 'running' } } as any });
    const n: any = await this.prisma.novel.create({
      data: {
        platform: dto.platform,
        title: 'AI 选题中',
        chapterWords: dto.chapterWords || 2000,
        planDraft: true,
        userId: uid || null,
      } as any,
    });
    // 【坑·已修】startJob 返回的是任务进度对象（本来就是给已有作品轮询用的），里面没有 id ——
    // 前端拿不到作品 id 就没法轮询、没法选定方案。这里必须把 id 一起给出去。
    const job: any = await this.startPlanJob(n.id, dto.opinion);
    return { ...job, id: n.id };
  }

  /**
   * 【AI 选题流水线】三步，全部由 AI 定，作者只负责最后挑一个：
   * ① 扫榜研读（真联网 + 本地快照兜底）→ 在爆题材 / 开局套路 / 红海 / 空位
   * ② 差异化金手指（找榜单没人写的空位，且必须带代价与边界）
   * ③ 3-5 个完整开书方案（书名 / 男女频 / 题材 / 金手指 / 卖点 / 开篇钩子 / 黄金三章骨架）
   */
  async startPlanJob(id: string, opinion?: string) {
    const n: any = await this.getNovel(id);
    const p = getPlatform(n.platform);
    const opinionLine = (opinion || '').trim() ? `\n【作者的一句话想法（必须落实，其余留白由你定）】${opinion}` : '';
    const box: any = { board: null, cheats: [], plans: [] };

    return this.startJob(id, 'plan', [
      {
        key: 'scan',
        label: `扫榜：${p.name} 男频 / 女频 畅销榜`,
        run: async () => {
          const s = await this.scanBoard(n.platform);
          const prompt = `你是网文平台资深责编，负责「扫榜研读」。目标平台=${p.name}。
${s.evidence}
${opinionLine}

请研读上面这批榜单，输出**当下的市场判断**（不要复述榜单、不要编造上面没有的书）：
1) hot：男频 / 女频各自"现在真在爆"的题材，各 4-6 条，每条写清"爆在哪一点"（如"求生叙事：航海/公路求生霸占番茄游戏榜前二"）
2) openers：**必填**，现在最好用的开局套路 4-6 条，每条必须具体到"开篇第一件事是什么 / 前 300 字给读者什么"（空数组不可接受，至少 4 条）
3) cooling：已经降温、别再写的红海 3-5 条
4) gaps：**榜单上没人写满**的交叉空位 3-5 条（这是后面找差异化金手指的原料；要具体到"X 题材 × Y 设定"）

只输出 JSON，不要解释：
{"hot":{"男频":["..."],"女频":["..."]},"openers":["..."],"cooling":["..."],"gaps":["..."],"summary":"一句话市场判断（未联网时注明"数据为本地快照"）"}`;
          const parsed = tryParseJson(await this.ai.chat(prompt, 150000), ['hot', 'gaps']) || {};
          // 模型偶尔漏给开局套路（实测返回过空数组）——它是后面"开篇钩子"唯一的原料，
          // 空了整条链就塌了，所以必须用快照里的真实结论兜底。
          const openers = Array.isArray(parsed.openers) && parsed.openers.length >= 2
            ? parsed.openers : RANK_BOARD.signals.openers;
          const cooling = Array.isArray(parsed.cooling) && parsed.cooling.length
            ? parsed.cooling : RANK_BOARD.signals.cooling;
          box.board = {
            fresh: s.fresh,
            at: s.at,
            hot: parsed.hot || {},
            openers,
            cooling,
            gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
            summary: parsed.summary || '',
          };
          await this.prisma.novel.update({
            where: { id },
            data: { planJson: JSON.stringify({ ...box, step: 'scan' }) } as any,
          });
          const g = (box.board.gaps || []).length;
          return `在爆题材 ${Object.values(box.board.hot).flat().length} 条 · 开局套路 ${box.board.openers.length} 条 · 空位 ${g} 条${s.fresh ? '' : '（本次未联网，用的本地快照）'}`;
        },
      },
      {
        key: 'cheat',
        label: '找差异化金手指（避开红海）',
        run: async () => {
          const b = box.board || {};
          const prompt = `你是网文开书策划，负责「差异化金手指」。平台=${p.name}。
【刚扫出来的市场判断】
在爆题材：${JSON.stringify(b.hot || {})}
开局套路：${(b.openers || []).join(' / ')}
红海（别碰）：${(b.cooling || []).join(' / ')}
空位：${(b.gaps || []).join(' / ')}
${opinionLine}

请给 **5 个差异化金手指**，每一个都要：
- 从上面的"空位"里长出来，避开"红海"里那几类；
- 有**明确的代价 / 边界**（无代价的无敌金手指读者三章就腻，必须写清限制或反噬）；
- 说清它为什么能给读者持续爽点（能反复触发、能升级、能制造冲突），不是一次性道具。

只输出 JSON：
{"cheats":[{"name":"金手指名(2-8字)","mech":"机制：怎么触发、得到什么","cost":"代价/边界","why":"差异化在哪：避开了榜单上哪类写法","channel":"男频|女频","genre":"题材(2-6字)","loop":"爽点循环：读者为什么会一直追"}]}`;
          const parsed = tryParseJson(await this.ai.chat(prompt, 150000), ['cheats']) || {};
          box.cheats = Array.isArray(parsed.cheats) ? parsed.cheats.slice(0, 6) : [];
          await this.prisma.novel.update({
            where: { id },
            data: { planJson: JSON.stringify({ ...box, step: 'cheat' }) } as any,
          });
          return box.cheats.length ? `${box.cheats.length} 个金手指` : 'AI 没给出金手指，方案将直接基于空位生成';
        },
      },
      {
        key: 'plans',
        label: '出 3-5 个完整开书方案（书名 / 频道 / 题材 全定）',
        run: async () => {
          const b = box.board || {};
          const cheats = (box.cheats || []).filter((c: any) => c && c.name);
          const prompt = `你是网文开书总策划。平台=${p.name}。现在要一次性定下一部新书的全部要件 —— **书名、男频/女频、题材、金手指全部由你定**，作者只从你给的 4 个方案里挑一个。
【市场判断】${b.summary || ''}
在爆题材：${JSON.stringify(b.hot || {})}
开局套路：${(b.openers || []).join(' / ')}
红海：${(b.cooling || []).join(' / ')}
【可选金手指（优先从这里挑，也可以组合/改良）】
${cheats.map((c: any, i: number) => `${i + 1}) ${c.name}｜${c.mech}｜代价：${c.cost}｜${c.channel}·${c.genre}`).join('\n') || '（无，请自行设计）'}
${opinionLine}

请给 **4 个完整开书方案**，硬性要求：
1) **男女频都要有**（至少各 1 个），题材不许重复，金手指不许重复；
2) 书名是**吸量第一关**，按下面的规格起，起完会被机器按判据硬扫，不合规的会被打回：
   - 长度 6-18 字（上限 22），书城一行放得下；
   - 必须带**题材关键词**（重生/系统/年代/高考/神医/直播…），否则算法认不出赛道、读者搜不到；
   - 必须带**冲突或反差信号**（开局/穿成/被赶/退婚/逆袭/偏要…），否则点击率上不去；
   - 鼓励「主标题：副标题」式（如「高考前三天：我靠邮票IC卡造出中国芯」），信息量足、便于打标签；
   - 禁文艺腔（那年/浮生/岁月/时光/烟雨…好听但没人点）、禁生僻字、禁英文单词、
     禁导流词（微信/QQ/加群/公众号）、禁别家平台名（起点/晋江/阅文）、禁极限词（第一/最强/史上最）；
   4 个之间不得近似，也不许与上面榜单出现过的作品重名/近名；
3) 开篇钩子必须是**具体发生的一件事**（不是"他将何去何从"这类空话），且前 300 字就发生；
4) 黄金三章骨架要写到"每章一件什么事、章末留什么钩"，第三章末必须抛出全书核心悬念；
5) 每个方案用一句话说明"为什么这个能打"（结合上面的空位/在爆题材）。

【⚠ 三条红线（踩了整个方案作废）】
- **不许写"写小说的小说"**：主角是网文作者 / 编辑 / 靠"签约""曝光权重""编辑隐批""读者打赏"推动剧情，一律不行 —— 读者要看的是故事里的世界，不是网文行业本身。
- **不许把现代互联网产品写进设定**：什么 PC 端、App、抖音金币、微软商店、听书音波、短剧天道，都不是网文设定，不许出现在书名、金手指与剧情里。
- **金手指必须服务于故事里的冲突**：能反复触发、能升级、能制造麻烦；代价要落在主角身上（寿命/记忆/身体/关系），不是"系统提示"这种没有痛感的限制。
- **所有字段一律中文**：书名、卖点、钩子、章纲里不许出现英文单词（模型偶尔会漏出 protector 这类词，读者一眼看出是机器写的）。

只输出 JSON：
{"plans":[{"title":"书名","channel":"男频|女频","genre":"题材(2-6字)","cheat":"金手指名","cheatMech":"机制+代价","sellPoint":"一句话卖点(≤30字)","hook":"开篇钩子：前300字发生的具体事件","chapters":[{"no":1,"name":"章名(2-8字)","synopsis":"本章发生什么(≤60字)","cliffhanger":"章末钩子"}],"why":"为什么这个能打(≤50字)"}]}`;
          let parsed = tryParseJson(await this.ai.chat(prompt, 180000), ['plans']) || {};
          let plans: any[] = Array.isArray(parsed.plans) ? parsed.plans : [];
          // 书名双检：① 撞车（联网比对本地在榜库 + 本次榜单快照）② 平台判据硬扫（过审 + 吸量）
          // 为什么两道都要：撞车是"跟别人太像"，判据是"平台收不收、读者点不点" —— 互不包含。
          plans = await Promise.all(plans.map(async (x: any) => {
            const t = cleanTitle(String(x.title || ''));
            if (!t) return null;
            const local = await this.search.localMatches(t, 0.7).catch(() => []);
            const boardHit = local.length ? local[0].title : '';
            const review = checkTitle(t, { existing: (b.titles || []).slice(0, 40) });
            return {
              ...x,
              title: t,
              dupRisk: boardHit ? 'high' : 'low',
              dupNote: boardHit ? `与在榜作品《${boardHit}》近似` : '',
              titleReview: review,
            };
          })) as any[];
          // 排序：能过审的 > 不撞车的 > 吸量分高的
          plans = plans.filter(Boolean).sort((a: any, b: any) => {
            const ap = a.titleReview && a.titleReview.pass ? 1 : 0;
            const bp = b.titleReview && b.titleReview.pass ? 1 : 0;
            if (ap !== bp) return bp - ap;
            const ad = a.dupRisk === 'high' ? 1 : 0;
            const bd = b.dupRisk === 'high' ? 1 : 0;
            if (ad !== bd) return ad - bd;
            return (b.titleReview?.score || 0) - (a.titleReview?.score || 0);
          });
          box.plans = plans.slice(0, 5);
          await this.prisma.novel.update({
            where: { id },
            data: { planJson: JSON.stringify({ ...box, step: 'plans' }) } as any,
          });
          return box.plans.length ? `${box.plans.length} 个方案${box.plans.some((x: any) => x.dupRisk === 'high') ? '（有书名可能撞车，已排后并标注）' : ''}` : 'AI 没产出方案，请再点一次';
        },
      },
    ]);
  }

  /**
   * 削掉夹在中文里的孤立英文单词（模型偶尔漏出 `扳倒 protector` 这种）。
   * 常见缩写（GPS / DNA / QQ …）要留下，只删"前后都不是英文、也没有语境"的裸词。
   */
  private stripStrayWords(s: string): string {
    const KEEP = /^(GPS|DNA|RNA|WiFi|WIFI|QQ|AI|IP|OK|MBA|CPU|USB|DNA|KTV|BBQ|CEO|CIA|FBI)$/;
    return String(s || '')
      .replace(/([一-龥，。、；：！？])\s*([A-Za-z]{2,})\s*(?=[，。、；：！？\s]|$)/g,
        (_m, a, w) => (KEEP.test(w) ? `${a} ${w} ` : a))
      .replace(/\s{2,}/g, ' ');
  }

  /** 作者选定一个方案：落到作品上（书名 / 频道 / 题材 / 金手指 / 卖点 / 三章骨架 → 大纲），占位转正 */
  async pickPlan(id: string, dto: { idx?: number; title?: string }) {
    const n: any = await this.getNovel(id);
    let box: any = {};
    try { box = n.planJson ? JSON.parse(n.planJson) : {}; } catch (e) { box = {}; }
    const plans = Array.isArray(box.plans) ? box.plans : [];
    // 优先按下标挑；下标丢了（页面被回收）就退回按书名挑 —— 两条路都要能走通
    const want = cleanTitle(String(dto.title || ''));
    const pick = plans[Number(dto.idx)]
      || plans.find((x: any) => cleanTitle(String(x.title || '')) === want);
    if (!pick) throw new Error('方案不存在，请重新让 AI 出一批');
    const channel = String(pick.channel || '');
    const targetReader = n.platform === 'qimao'
      ? (/女/.test(channel) ? '女生' : '男生')
      : (/女/.test(channel) ? '女频' : '男频');
    const outline = [
      `【金手指】${pick.cheat || ''}：${pick.cheatMech || ''}`,
      `【一句话卖点】${pick.sellPoint || ''}`,
      `【开篇钩子】${pick.hook || ''}`,
      '',
      '【黄金三章骨架】',
      ...(Array.isArray(pick.chapters) ? pick.chapters : []).map((c: any) =>
        `第${c.no}章 ${c.name || ''}：${c.synopsis || ''}（章末钩子：${c.cliffhanger || ''}）`),
      '',
      `【为什么能打】${pick.why || ''}`,
    ].join('\n');
    const cleanOutline = this.stripStrayWords(outline);

    const updated = await this.prisma.novel.update({
      where: { id },
      data: {
        title: cleanTitle(pick.title),
        genre: pick.genre || '',
        targetReader,
        sellPoint: this.stripStrayWords(pick.sellPoint || ''),
        outline: cleanOutline,
        planDraft: false,
        dupAccepted: cleanTitle(pick.title), // 锁死：后面重出大纲不许把作者选的名字改回去
      } as any,
    });
    return { ...updated, plan: pick };
  }

  /** 重读方案（作者点「换一批」/ 页面上方案丢了时用） */
  async getPlan(id: string) {
    const n: any = await this.getNovel(id);
    try { return n.planJson ? JSON.parse(n.planJson) : null; } catch (e) { return null; }
  }

  // ==================== 笔名推荐 / 作者简介（首次引导与作品资料页共用） ====================

  /** 一次调用只做一件事：kind=pen 给至少 3 个笔名候选；kind=intro 给一段可用的作者简介 */
  async authorAssist(dto: AuthorAssistDto) {
    const p = getPlatform(dto.platform);
    if (dto.kind === 'pen') {
      const parsed = tryParseJson(await this.ai.chat(this.penPrompt(p, dto), 90000), ['pens']) || {};
      const picked: string[] = [];
      (Array.isArray(parsed.pens) ? parsed.pens : []).forEach((s: any) => {
        const v = String(s || '').trim();
        if (v && v.length <= 12 && picked.indexOf(v) < 0 && (dto.exclude || []).indexOf(v) < 0) picked.push(v);
      });
      return { pens: this.ensurePens(picked, dto) }; // 保证「至少 3 个」，前端永远有得选
    }
    const text = await this.ai.chat(this.introPrompt(p, dto), 90000);
    const intro = String(text || '')
      .replace(/```[a-z]*|```/gi, '')
      .replace(/^["'“”]|["'“”]$/g, '')
      .trim()
      .slice(0, 300);
    if (!intro) throw new Error('AI 未返回作者简介，请重试');
    return { intro };
  }

  /** 笔名候选不足 3 个时用词池拼够（模型偶尔只给 1-2 个，不能让界面空着） */
  private ensurePens(list: string[], dto: AuthorAssistDto) {
    const A = ['北境', '青山', '临江', '拾光', '夜航', '南屿', '长夜', '秋池'];
    const B = ['孤狼', '不改', '听雨', '煮酒', '执笔', '观潮', '行者', '书客'];
    for (let i = 0; list.length < 3 && i < A.length * B.length; i++) {
      const name = `${A[i % A.length]}${B[Math.floor(i / A.length) % B.length]}`;
      if (list.indexOf(name) < 0 && (dto.exclude || []).indexOf(name) < 0) list.push(name);
    }
    return list.slice(0, 6);
  }

  private penPrompt(p: any, dto: AuthorAssistDto) {
    return `你是【${p.name}】的资深编辑，帮作者起笔名（作家名，会印在封面上）。
要求：① 2-4 个字，好记、有画面感或气势，贴合${p.name}${dto.genre ? `「${dto.genre}」题材` : '热门题材'}读者口味；② 不要像真实姓名，不要与知名作家重名；③ 严禁与下列已给出的重复：${(dto.exclude || []).join('、') || '（无）'}。
只输出 JSON，不要解释：{"pens":["笔名1","笔名2","笔名3","笔名4","笔名5","笔名6"]}`;
  }

  private introPrompt(p: any, dto: AuthorAssistDto) {
    return `你是【${p.name}】的资深编辑，帮作者写「作家简介」（用于作家页与上架资料）。
要求：${dto.genre ? `作者主攻题材=${dto.genre}；` : ''}80-120 字，第一人称，写清写作方向、文风特点、更新承诺（如稳定日更），语气亲和可信；不吹牛、不提平台名、不写联系方式。
${dto.opinion ? `作者的修改意见（必须落实）：${dto.opinion}` : ''}
只输出简介正文：不要标题、不要引号、不要解释。`;
  }

  /** AI 生成作品名 + 大纲（可带意见重来）；带意见时强制换新名，同名则自动重试一次 */
  async generateOutline(id: string, dto: GenerateOutlineDto) {
    const n: any = await this.getNovel(id); // any：本地 Prisma Client 可能还没生成新字段（服务器上正常）
    const p = getPlatform(n.platform);
    const opinion = (dto.opinion || '').trim();

    // 【坑·已修】以前只调一次 AI：只要它漏返回 title 或 outline（或干脆不吐 JSON），
    // tryParseJson 就返回 null，后面 data={} 空更新 —— 表现就是"作者改了名，大纲却一点没动"。
    // 现在最多跑 3 次；带意见时还要求"标题必须换、大纲必须与旧的不同"，否则继续重跑。
    // 作者刚按推荐选定了书名（dupAccepted）—— 这时书名是**锁死的**，
    // 不能让 AI 再"必须换个新名"把作者选的名字覆盖掉（之前正是这么被改回去的）。
    const lockTitle = n.dupAccepted && n.dupAccepted === n.title ? String(n.title) : '';
    let parsed: any = null;
    let lastText = '';
    for (let i = 0; i < 3; i++) {
      lastText = await this.ai.chat(this.outlinePrompt(n, p, opinion, i > 0, lockTitle), 180000);
      const one = tryParseJson(lastText, ['title', 'outline']);
      if (!one) continue;
      parsed = parsed && parsed.outline && !one.outline ? parsed : one;
      const gotTitle = !!String(one.title || '').trim();
      const gotNewOutline = !!String(one.outline || '').trim()
        && String(one.outline).trim() !== String(n.outline || '').trim();
      if (gotTitle && (!opinion || gotNewOutline)) { parsed = one; break; }
      if (!parsed) parsed = one;
    }
    if (!parsed || !String(parsed.outline || '').trim()) {
      throw new Error(`AI 没产出新的大纲（原始输出：${String(lastText || '').slice(0, 80)}…），请再点一次`);
    }

    const data: any = {};
    // 书名已锁（作者刚选的）：只用 AI 给的大纲和卖点，书名原样不动
    if (!lockTitle && parsed?.title) data.title = cleanTitle(parsed.title);
    if (parsed?.sellPoint) data.sellPoint = parsed.sellPoint;
    if (parsed?.outline) data.outline = parsed.outline;
    const updated = await this.prisma.novel.update({ where: { id }, data });

    // 书名或大纲实质变化 = 设定变了：旧章节与旧台账一并作废。
    // 否则会出现「两套设定的章节共存、序号还撞在一起」——旧数据就踩过这个坑
    // （同一部作品里既有"高考前倒卖邮票"版，又有"高考放榜日救五金厂"版，序号 1,1,2,2,3,3）。
    const titleChanged = !lockTitle && !!parsed?.title && parsed.title.trim() !== n.title;
    const outlineChanged = !!parsed?.outline && parsed.outline.trim() !== (n.outline || '').trim();
    if (!titleChanged && !outlineChanged) return { ...updated, staleCount: 0, publishCleared: false };

    // 【改成真删】以前只打 stale 标记，结果界面还数着"共 3 章"，点进去却是空的（读不到正文），
    // 作者以为章节还在、定版也因此误判"章节已有"而跳过重写。设定既然整体换了，旧章就该清掉。
    const invalidated = await this.prisma.chapter.deleteMany({ where: { novelId: id } as any });
    // 脉络 / 台账 / 上架资料都是按旧设定生成的，设定变了必须整体重做。
    // 上架资料（作品简介 / 主角名 / 标签）尤其不能留：旧简介是按旧书名旧大纲写的，
    // 挂着新书名只会"简介与正文对不上"。清掉 → 定版时重新生成一版跟新大纲的。
    await this.prisma.novel.update({
      where: { id },
      data: {
        canon: null,
        bible: null,
        bibleStatus: 'none',
        intro: null,
        protagonists: null,
        tags: null,
      } as any,
    });
    await this.clearAudit(id); // 稿子整体换过了，旧的体检结果（矛盾清单/角标）全部作废
    return { ...updated, staleCount: invalidated.count, publishCleared: true };
  }

  /** 起名 + 大纲 prompt（forceRename=true 用于「上一次没改名」的补刀重试） */
  private outlinePrompt(n: any, p: any, opinion?: string, forceRename = false, lockTitle = '') {
    const titleRule = lockTitle
      ? `【书名已锁定·严禁改动】作者已亲自选定书名《${lockTitle}》，本次必须原样沿用，任何情况下都不要新起书名，也不要在输出里返回别的书名（title 字段就填《${lockTitle}》）。你只需要按这本书名重写大纲。`
      : `【书名硬性要求】本次书名必须与旧名「${n.title}」明显不同，严禁沿用或仅微调旧名。${forceRename ? '注意：你上一次给出的书名与旧名完全相同，本次必须换一个全新的书名。' : ''}`;
    return `你是网文爆款写作助手，按【${p.name}】平台规则写稿。
【热榜研读】${HOT_STUDY_RULE}
${ANTI_CLASH_RULE}
【过审即底线】选题与大纲阶段就要避开平台雷区：核心设定不许照搬热榜、主线不许"模板化套路串"、
  题材必须能撑起 30 万字以上（七猫人工审要求看得到 30 万字后的剧情走向）。
当前作品：题材=${n.genre || '未定'}，目标读者=${n.targetReader || '未定'}，签约状态=${n.contractStatus}。
${opinion ? `作者意见（必须逐条落实）：${opinion}` : ''}
${titleRule}
请生成：
1) 作品名（1 个，符合${p.name}男/女频口味，吸睛；禁止与在榜热书重名或近似）${lockTitle ? '（书名已锁定，直接填《' + lockTitle + '》）' : ''}
2) 一句话卖点（≤40字）
3) 大纲（三幕结构：第一幕/第二幕/第三幕各 2-3 句，含主线与爽点节奏）
仅输出如下 JSON，不要多余解释：
{"title":"...","sellPoint":"...","outline":"..."}`;
  }

  // ==================== 定版任务链（异步 + 轮询） ====================
  // 单次 HTTP 等不到结果：全书脉络 / 黄金三章耗时 1-3 分钟，小程序请求默认 60s 超时，
  // 会把「其实已经生成成功」误报成失败。故改为「启动即返回 + 前端轮询进度」。

  /**
   * 正在跑定版的作品 id。同一部作品同时只允许一个定版任务：
   * 【实战事故】作者点「定版」时上一个还在写黄金三章，退出又进来（草稿恢复）后再点一次 →
   * 两个任务并发各写 3 章，库里变成 6 章（1,1,2,2,3,3 两套标题），列表还显示"已写 6 章"。
   * 现在第二个请求直接返回当前进度（前端照常轮询同一个任务），不再另起一个。
   */
  private readonly finalizing = new Set<string>();

  /** 启动定版：立即返回进度快照，重活在后台跑 */
  async startFinalize(id: string, dto: GenerateBibleDto = {}) {
    await this.getNovel(id);
    if (this.finalizing.has(id)) return this.getProgress(id); // 幂等：已在跑就复用，绝不并发写稿
    this.finalizing.add(id);
    const log: TaskStep[] = FINALIZE_STEPS.map((s): TaskStep => ({ ...s, status: 'pending' }));
    await this.prisma.novel.update({
      where: { id },
      data: {
        taskStage: 'running',
        taskLog: JSON.stringify(log),
        taskError: null,
        // 只补写正文时不动脉络状态：置成 generating 会让写稿前置检查失败
        ...(dto.onlyGolden ? {} : { bibleStatus: 'generating' }),
      } as any,
    });
    this.runFinalize(id, dto, log)
      .catch(() => undefined) // 后台执行，不等待
      .finally(() => this.finalizing.delete(id)); // 跑完（含失败）才解锁
    return this.getProgress(id);
  }

  /** 任务链定义：查重 → 全书脉络（含时间线）→ 上架资料 → 黄金 1-3 章 */
  private finalizePipeline(id: string, dto: GenerateBibleDto) {
    const skip = dto.onlyGolden; // 请求方希望只补写正文；但能不能真跳过，一律以实际内容为准
    let bibleRebuilt = false; // 脉络是否被重建：重建了资料就必须跟着重做，不能再吃旧的
    // 【作者反馈】"前三项显示跳过不合适"：以前 onlyGolden=true 就无条件跳过查重/脉络/资料，
    // 结果那些「状态标着 done、内容其实是空」的老作品永远补不上。现在只信内容，不信标记。
    const bibleOk = async () => {
      const n = await this.getNovel(id);
      try { return !!n.bible && this.hasVolumes(JSON.parse(n.bible)); } catch (e) { return false; }
    };
    const publishOk = async () => {
      const n = await this.getNovel(id);
      try { return !!n.intro && !!n.protagonists && JSON.parse(n.protagonists).length > 0; } catch (e) { return false; }
    };
    return [
      {
        stage: 'dup',
        run: async () => {
          // 【查重最重要，永不跳过】书名 / 大纲一变就可能撞上别人，哪怕只补写正文也要重查一遍：
          // 宁可多花一次调用，也不能带着撞车风险把几卷书都写完才发现。
          // 【重要】撞车不再"自动改名后闷头生成"，而是中断定版，把决策交回作者：
          // 换书名（给 3 个候选）/ 按建议调情节 / 换题材重做大纲。只有作者显式确认（acceptDup）才继续。
          // 中风险（存在相似）也照样中断——作者明确要求：出现相似就停下来让他选名，不能默默生成。
          const rep = await this.checkDuplicate(id);
          // 只要还判定撞车（high 直接撞在榜热书 / mid 存在相似），定版一律中断：
          // 选名 → 按新名重出大纲 → 再查重 → 还撞就再给一批新名，直到不撞车为止。
          // 出口：选到不撞车的名；或作者自己点「不换名了，仍要定版」（acceptDup）/ 换题材。
          if (rep.risk === 'high' && !dto.acceptDup) {
            throw new Error(
              `${DUP_HIGH}严重撞车（${rep.riskNote}）。请从下方 3 个已预检的书名里选一个（会同步按差异化剧情重出大纲）`,
            );
          }
          if (rep.risk === 'mid' && !dto.acceptDup) {
            throw new Error(
              `${DUP_MID}存在相似（${rep.riskNote}）。请从下方 3 个已预检的书名里选一个（会同步按差异化剧情重出大纲）`,
            );
          }
          return rep.riskNote;
        },
      },
      {
        stage: 'bible',
        run: async () => {
          // 【致命坑·已修】以前只要前端传 onlyGolden 就无条件把状态落回 done，
          // 结果脉络其实是空对象 {} 也被当成"已有大纲"→ 后面写稿没有任何中轴线，
          // 全靠模型自由发挥，于是出现人名前后不一、重生/魂穿混用、时间线打架。
          // 现在不管传什么，一律先查内容：脉络空 = 没有大纲，必须补生成。
          const has = await bibleOk();
          if (!has) {
            await this.buildBible(id, dto);
            // 之前没脉络 = 旧章节是在"没有中轴线"的状态下写的，人名 / 时间线 / 重生模式都可能
            // 与新脉络冲突（正是"魂穿"与"上一辈子"打架那类硬伤）。留着它们，新章只会接着错，
            // 所以一并作废 + 清空台账，让作品干净地按新中轴线从第 1 章重起。
            const inv = await this.prisma.chapter.deleteMany({ where: { novelId: id } as any });
            if (inv.count) {
              await this.prisma.novel.update({ where: { id }, data: { canon: null } as any });
            }
            bibleRebuilt = true;
            return inv.count
              ? `脉络为空（旧数据误判为已生成），已补生成；原有 ${inv.count} 章因缺中轴线已删除，从第 1 章重起`
              : '脉络为空（旧数据误判为已生成），已补生成全书脉络';
          }
          if (!skip) {
            await this.buildBible(id, dto);
            return '全书脉络已生成';
          }
          await this.prisma.novel.update({ where: { id }, data: { bibleStatus: 'done' } as any });
          return '已有脉络，跳过';
        },
      },
      {
        stage: 'publish',
        run: async () => {
          // 同理：资料空（没简介 / 主角表为空）不能算"已生成"，否则人物名没有权威来源、简介与正文脱节。
          // 另外脉络一旦重建（换名 / 改大纲 / 补生成），旧简介必然与新大纲对不上，必须跟着重做。
          if (skip && !bibleRebuilt && (await publishOk())) return '已有上架资料，跳过';
          await this.generatePublishInfo(id);
          return bibleRebuilt ? '上架资料已按新大纲重新生成' : '上架资料已生成';
        },
      },
      {
        stage: 'golden',
        run: async () => {
          // 查重通过后三项必须全部重出：脉络重建过（换名 / 改大纲）时旧稿与新设定必然对不上，
          // 这里强制重写黄金三章，绝不留"已有正文章节，跳过"这种半吊子结果。
          const n = await this.writeGoldenChapters(id, bibleRebuilt);
          return n ? `已重新生成黄金 ${n} 章` : '已有正文章节，跳过';
        },
      },
    ];
  }

  private async runFinalize(id: string, dto: GenerateBibleDto, log: TaskStep[]) {
    const save = (stage: string, patch: Partial<TaskStep>) => {
      const it = log.find((x) => x.stage === stage);
      if (it) Object.assign(it, patch);
      return this.prisma.novel.update({ where: { id }, data: { taskLog: JSON.stringify(log) } as any });
    };
    let cur = '';
    try {
      for (const { stage, run } of this.finalizePipeline(id, dto)) {
        cur = stage;
        await save(stage, { status: 'running' });
        await save(stage, { status: 'done', note: await run() });
      }
      await this.prisma.novel.update({ where: { id }, data: { taskStage: 'done', taskError: null } as any });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (cur) await save(cur, { status: 'failed', error: msg });
      await this.prisma.novel.update({
        where: { id },
        data: {
          taskStage: 'failed',
          taskError: msg,
          ...(dto.onlyGolden ? {} : { bibleStatus: 'failed' }),
        } as any,
      });
    }
  }

  /** 进度快照（前端每 3 秒轮询一次） */
  async getProgress(id: string) {
    const n = await this.getNovel(id);
    const read = <T>(s: string | null, fb: T): T => {
      try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; }
    };
    return {
      stage: n.taskStage || 'idle',
      steps: read<TaskStep[]>(n.taskLog, []),
      error: n.taskError || '',
      dupReport: read<DupReport | null>(n.dupReport, null),
      title: n.title,
      bibleStatus: n.bibleStatus,
      publishReady: !!(n.intro && n.tags),
      // 与列表 / 章节目录同一口径：只数有效章节，作废(stale)的不算
      chapterCount: await this.prisma.chapter.count({ where: { novelId: id, stale: false } as any }),
    };
  }

  // ==================== 撞车检测（番茄 / 七猫热榜比对） ====================

  /**
   * 撞车检测：联网比对番茄/七猫热榜，排查书名/开篇/主线雷同。
   * 注意：不再自动改名 —— 严重撞车由调用方（定版流程）中断，把书名/情节/题材的选择权交回作者。
   */
  /**
   * @param force true=强制重新联网比对。默认走"指纹缓存"：
   * 书名/大纲没变、且 30 分钟内查过 → 直接复用上次结果。
   * 为什么要缓存：作者先在页面点「查重」显示"未发现撞车"，接着点「定版」里又查一次却判"存在相似"
   * —— 两次都是全新 AI 调用、结论随机漂移，作者根本不知道该信哪个（也被卡在这里过）。
   */
  // ==================== 真·联网查重（后端亲自抓，不靠 AI 口中的"联网"） ====================

  /**
   * 硬撞车判定：相似度由代码算（Dice 二元组），不靠 AI 抽样 → 结论稳定可复现。
   * 阈值：0.85 = 几乎同名（高）；0.7 = 高度近似（中）；
   * 命名结构相同（都叫「重生1998：XXX」）且相似度 ≥0.5 也判中 —— 平台按结构查重，作者也被卡过。
   */
  private hardClash(title: string, real: { title: string; platform?: string; snippet?: string; url?: string }[]) {
    const st = titleStruct(title);
    const out: any[] = [];
    for (const r of real) {
      const s = diceSimilar(title, r.title);
      const sameStruct = !!st && st === titleStruct(r.title);
      const high = s >= 0.85;
      const mid = s >= 0.7 || (sameStruct && s >= 0.5);
      if (!high && !mid) continue;
      if (cleanTitle(r.title) === cleanTitle(title) && s < 0.85) continue; // 完全同名由 high 处理
      out.push({
        title: r.title,
        platform: r.platform || '全网',
        type: '书名',
        why: `真实检索命中（相似度 ${s.toFixed(2)}${sameStruct ? '·命名结构相同' : ''}）${r.snippet ? '：' + String(r.snippet).slice(0, 50) : ''}`,
        similarity: high ? '高' : '中',
        _s: s,
        _high: high,
        url: r.url || '',
      });
    }
    return out.sort((a, b) => b._s - a._s).slice(0, 6);
  }

  /**
   * 真联网抓一次：通用小说检索 + 番茄站内 + 七猫站内，命中的在榜作品存进本地库。
   * 之后本地库可直接比对，既快又不漂移。
   */
  private async realSearch(title: string, keywords = '') {
    const hits = await this.search.searchNovel(title, keywords).catch(() => []);
    if (hits.length) this.search.collect(hits, title).catch(() => undefined);
    const local = await this.search.localMatches(title).catch(() => []);
    const all: any[] = (hits as any[]).concat(
      local.map((x: any) => ({ title: x.title, platform: x.source, snippet: x.snippet, url: x.url, source: x.source })),
    );
    return { hits, clash: this.hardClash(title, all) };
  }

  async checkDuplicate(id: string, force = false): Promise<DupReport> {
    const n: any = await this.getNovel(id);
    const key = `${n.title}|${(n.outline || '').length}|${(n.bible || '').length}`;
    const age = n.dupCheckedAt ? Date.now() - +new Date(n.dupCheckedAt) : Infinity;
    if (!force && n.dupReport && n.dupCheckedKey === key && age < 30 * 60 * 1000) {
      try {
        const cached = JSON.parse(n.dupReport);
        if (cached && cached.risk) return { ...cached, cached: true };
      } catch (e) { /* 坏数据就重查 */ }
    }
    const bible = n.bible ? ((JSON.parse(n.bible) as any) || {}) : {};
    // ① 后端亲自联网抓真实在榜作品（作者怀疑"作品名是 AI 凭印象编的"，所以先拿真证据再让 AI 判）
    const real = await this.realSearch(n.title, String(n.genre || '').split('·')[0]);
    const evidenceText = real.hits.length
      ? real.hits
          .slice(0, 12)
          .map((h) => `- 《${h.title}》[${h.source}]${h.snippet ? '：' + h.snippet.slice(0, 80) : ''}`)
          .join('\n')
      : '（本次联网未抓到结果，可能是网络受限；此时只能基于你的知识判断，并在 riskNote 里注明"未联网"）';
    const prompt = `你是【${getPlatform(n.platform).name}】的资深网文责编，负责「撞车排查」。平台大忌：与在榜热书书名重名/近似、开篇设定雷同、主线情节照搬。
【热榜研读】${HOT_STUDY_RULE}
【⚠ 后端已联网检索到的真实在榜作品（必须基于下面这些真实结果判断，严禁凭印象编造不存在的作品名）】
${evidenceText}

待查作品：
书名=${n.title}
题材=${n.genre || ''}｜目标读者=${n.targetReader || ''}
一句话卖点=${n.sellPoint || ''}
大纲=${n.outline || ''}
核心设定=${bible.coreSetting || ''}

请基于**上面给出的真实检索结果**判断（不要声称你联网搜过，也不要编造上面没有的作品名）：
a) 上面这些在榜作品里，有没有与待查书名同名、近音、近形、同结构的
b) 开局设定（重生时间点、金手指、打脸对象、首个冲突）是否与上面这些作品高度相似
c) 主线（核心冲突、成长路径、结局走向）是否照搬上面这些作品
逐项比对：
1) 书名撞车：是否有重名、近音、同结构（如「重生1998：XXX」）的在榜作品
2) 开篇撞车：前 3 章开局（重生时间点、金手指、打脸对象、首个冲突）是否与在榜作品高度相似
3) 主线撞车：核心冲突、成长路径、结局走向是否雷同

只输出如下 JSON，不要解释：
{"risk":"high|mid|low","riskNote":"一句话风险结论（含比对到的在榜作品名）",
 "matches":[{"title":"在榜作品名","platform":"番茄|七猫","type":"书名|开篇|主线","why":"雷同点","similarity":"高|中|低"}],
 "titleAdvice":"书名调整建议","titleSuggestions":["全新候选书名1","候选2","候选3"],
 "plotAdvice":"情节差异化调整建议（具体到卷/章，说明如何做出与热榜作品的差异点）",
 "verdict":"一句话总结"}
判断标准：risk=high 表示书名与在榜热书重名或开篇主线高度雷同（必须改名+调情节）；mid 表示有相似但可差异化解开；low 表示无明显撞车。`;
    const text = await this.ai.chat(prompt, 150000);
    const parsed = tryParseJson(text, ['risk']) || {};
    const aiMatches = Array.isArray(parsed.matches) ? parsed.matches : [];
    // ② 代码算出来的硬撞车优先（AI 说没事、但真抓到同名书，必须算撞 —— 否则"上面说没撞、定版说撞了"）
    const realMatches = real.clash.map(({ _s, _high, url, ...m }) => m);
    const hardHigh = real.clash.some((c) => c._high);
    const report: DupReport = {
      risk: ['high', 'mid', 'low'].includes(parsed.risk) ? parsed.risk : 'low',
      riskNote: parsed.riskNote || parsed.verdict || '未发现明显撞车',
      matches: realMatches.concat(aiMatches).slice(0, 8),
      titleAdvice: parsed.titleAdvice || '',
      titleSuggestions: await this.ensureTitleSuggestions(n, parsed.titleSuggestions),
      plotAdvice: parsed.plotAdvice || '',
      verdict: parsed.verdict || '',
      evidence: real.hits.slice(0, 12).map((h) => ({ title: h.title, platform: h.source, snippet: h.snippet, url: h.url })),
      searched: real.hits.length > 0,
    };
    if (hardHigh) report.risk = 'high';
    else if (real.clash.length && report.risk === 'low') report.risk = 'mid';
    if (real.clash.length) {
      report.riskNote = `【真实联网检索】命中 ${real.clash.length} 部近似在榜作品（如《${real.clash[0].title}》）。${report.riskNote}`;
    } else if (!real.hits.length) {
      report.riskNote = `（本次联网未抓到检索结果，结论仅基于模型知识）${report.riskNote}`;
    }
    // 撞车才做改名预检：把候选名和差异化剧情一起送去联网比对，
    // 只把"预检通过（risk=low）"的递给作者 —— 推荐项必定是不撞车的那个。
    if (report.risk !== 'low') {
      const plans = await this.safeTitlePlans(n, bible, report.titleSuggestions, report.plotAdvice).catch(() => []);
      report.titleChecks = plans;
      report.titleSuggestions = plans.map((x) => x.title); // 只保留预检通过的
      report.titleAdvice = plans.length
        ? `已逐个联网预检：下面每个名字连同配套剧情都与在榜作品不撞车，可直接采用。${report.titleAdvice || ''}`
        : `⚠ 连换几批名字都没能通过防撞预检（该题材命名太拥挤）。建议点「换题材重做」换一条赛道，或点「换一批」再试。${report.titleAdvice || ''}`;
    }
    await this.prisma.novel.update({
      where: { id },
      data: {
        dupReport: JSON.stringify(report),
        dupCheckedAt: new Date(),
        dupCheckedKey: key,
      } as any,
    });
    return report;
  }

  /** 撞车时要给作者「至少 3 个」可选新名：模型给不够就补生成一次，再不够用题材模板兜底 */
  private async ensureTitleSuggestions(n: any, raw: any): Promise<string[]> {
    const uniq = (arr: any[]) => {
      const out: string[] = [];
      arr.forEach((t) => {
        const s = cleanTitle(t);
        if (s && s !== cleanTitle(n.title) && out.indexOf(s) < 0) out.push(s);
      });
      return out;
    };
    let out = uniq(Array.isArray(raw) ? raw : []);
    if (out.length >= 3) return out.slice(0, 6);
    try {
      const more = tryParseJson(await this.ai.chat(this.titleSuggestPrompt(n, out), 90000), [
        'titleSuggestions',
      ]);
      out = uniq(out.concat(Array.isArray(more?.titleSuggestions) ? more.titleSuggestions : []));
    } catch (e) { /* 补生成失败：走下面的兜底 */ }
    const g = String(n.genre || '都市').split('·')[0];
    ['：我重来一次就赢', '：从摆摊到顶流', '：开局我先手'].forEach((suf) => {
      if (out.length < 3) out.push(`${g}${suf}`);
    });
    return out.slice(0, 6);
  }

  /**
   * 【改名预检】一次性把整批候选书名 + 差异化剧情拿去联网比对。
   * 为什么必须有这一步：以前作者点了"用这个"才改名，改完再查一次又撞车，来回折腾没完。
   * 现在先把候选名和剧情逐个预检，只把真不撞车的递给作者；第一个（推荐项）必定是预检通过的。
   */
  private async batchVerifyTitles(n: any, bible: any, titles: string[], basePlot: string) {
    if (!titles.length) return [];
    const p = getPlatform(n.platform);
    // 真联网预检（并发）：作者要的是"推荐出来的名字一定不撞车"。
    // 光让 AI 说 low 不够 —— 必须后端真的去番茄/七猫站内搜一遍，抓到同名/近似的直接淘汰。
    const genreKey = String(n.genre || '').split('·')[0];
    const realRes = await Promise.all(
      titles.map((t) => this.realSearch(t, genreKey).catch(() => ({ hits: [], clash: [] as any[] }))),
    );
    const realText = titles
      .map((t, i) =>
        `· 《${t}》→ ${realRes[i].hits.length ? realRes[i].hits.slice(0, 6).map((h: any) => `《${h.title}》[${h.source}]`).join('、') : '（本次未抓到检索结果）'}`,
      )
      .join('\n');
    const prompt = `你是【${p.name}】的资深责编，负责"改名预检"。作者的书撞了车，准备改成下面这些名字，并按下述剧情方向重写。
【待预检的候选书名】
${titles.map((t, i) => `${i + 1}. 《${t}》`).join('\n')}
【⚠ 后端已联网检索到的真实在榜作品（逐个候选名分别搜的，必须基于这些真实结果判断，禁止编造）】
${realText}
【准备采用的差异化剧情方向】${basePlot || '（沿用原主线，仅做书名区隔）'}
【作品底子】题材=${n.genre || ''}｜目标读者=${n.targetReader || ''}｜一句话卖点=${n.sellPoint || ''}｜核心设定=${bible.coreSetting || ''}

请【联网检索】番茄小说与七猫小说的热榜/畅销榜/新书榜，对每个候选名逐条判断**书名本身**会不会撞：
① 站内有没有同名、近音、近形（例如别人已有「重生1998：XXX」，同结构也算撞）的在榜作品；
② 该书名是否直接套用在榜热书的招牌词（如"首富""至尊""制霸全球"这类被用烂的套路词）。
【判定口径·重要】risk 只看"书名撞不撞车"：
low = 站内没有同名/近音/同结构的在榜作品（情节雷同不算，剧情差异会在 plot 里解决）；
mid = 有近似结构但可用剧情拉开；high = 直接撞在榜热书。
不要因为"这个赛道同类书很多"就把所有候选都判成 mid —— 那样作者永远选不到名字。

只输出 JSON，不要解释：
{"checks":[{"title":"候选书名(必须原样回传)","risk":"high|mid|low","note":"结论(≤40字，撞的话写明撞了哪一本)","plot":"这个书名下更保险的差异化剧情(≤80字，具体到开局与主线差异点；已安全就回原剧情)"}]}`;
    const parsed = tryParseJson(await this.ai.chat(prompt, 150000), ['checks']) || {};
    const arr = Array.isArray(parsed.checks) ? parsed.checks : [];
    const rank: any = { low: 0, mid: 1, high: 2 };
    return titles.map((t, i) => {
      const hit = arr.find((c: any) => cleanTitle(c.title) === t);
      let risk = ['high', 'mid', 'low'].includes(hit?.risk) ? hit.risk : 'mid';
      let note = String(hit?.note || '未取到预检结论，谨慎采用').slice(0, 120);
      // 硬判定压过 AI：真抓到同名/近似在榜作品，不管 AI 怎么说都算撞（否则推荐出去又撞，循环没完）
      const hard = realRes[i]?.clash || [];
      const hardRisk = hard.some((c: any) => c._high) ? 'high' : hard.length ? 'mid' : 'low';
      if (rank[hardRisk] > rank[risk]) {
        risk = hardRisk;
        note = `真实检索撞到《${hard[0].title}》（相似度 ${hard[0]._s.toFixed(2)}）· ${note}`;
      }
      if (risk === 'low' && !(realRes[i]?.hits || []).length) {
        note = `联网未抓到检索结果，结论为模型判断 · ${note}`;
      }
      return {
        title: t,
        risk,
        note: note.slice(0, 160),
        plot: String(hit?.plot || basePlot || '').slice(0, 200),
      };
    });
  }

  /**
   * 取一批"真不撞车"的候选名：预检 → 没过的直接淘汰（不展示）→ 不够就换一批再检。
   * 作者明确要求：**推荐列表里出现的每一个名都必须是预检通过的**，
   * 宁可多跑几轮，也不能把"还有撞车可能"的名字递给他（那就是换个名继续撞）。
   */
  private async safeTitlePlans(n: any, bible: any, seed: string[], basePlot: string) {
    const used: string[] = [];
    const safe: { title: string; risk: string; note: string; plot: string }[] = [];
    let pool = seed.slice(0, 4);
    for (let round = 0; round < 4 && safe.length < 3; round++) {
      const todo = pool.filter((t) => used.indexOf(t) < 0).slice(0, 4);
      if (!todo.length) break;
      todo.forEach((t) => used.push(t));
      const checks = await this.batchVerifyTitles(n, bible, todo, basePlot).catch(() => []);
      checks.forEach((c: any) => { if (c.risk === 'low') safe.push(c); });
      if (safe.length >= 3) break;
      // 没过关的是"命名结构"本身就撞（如满屏的「重生1998：XXX」），
      // 第三轮起强制换一种结构再起名，而不是在同一套结构里打转
      pool = await this.genTitles(n, used.concat(seed), round >= 2);
    }
    // 还凑不够 3 个：用模板名补一批，同样要过预检（不过就丢掉，绝不凑数）
    if (safe.length < 3) {
      const g = String(n.genre || '都市').split('·')[0];
      const taken = safe.map((x) => x.title).concat(used, [n.title]);
      const tpl = [`${g}：我重来一次就赢`, `${g}：开局我先手`, `${g}：这一世换个活法`]
        .filter((t) => taken.indexOf(t) < 0);
      if (tpl.length) {
        const checks = await this.batchVerifyTitles(n, bible, tpl, basePlot).catch(() => []);
        checks.forEach((c: any) => { if (c.risk === 'low' && safe.length < 3) safe.push(c); });
      }
    }
    return safe.slice(0, 3);
  }

  /** 预检作者自己起的书名（返回能不能用 + 该书名下的差异化剧情） */
  async checkMyTitle(id: string, title: string) {
    const n: any = await this.getNovel(id);
    const bible = n.bible ? ((JSON.parse(n.bible) as any) || {}) : {};
    const t = cleanTitle(title);
    if (!t) throw new Error('请先填一个书名');
    if (t === n.title) throw new Error('和现在的书名一样，等于没改');
    const basePlot = String(bible.coreSetting || n.sellPoint || '').slice(0, 120);
    const [r] = await this.batchVerifyTitles(n, bible, [t], basePlot);
    const base: any = r || { title: t, risk: 'mid', note: '未取到预检结论', plot: basePlot };
    // 书名是吸量第一关 —— 除了查撞车（联网），还要按平台判据硬扫一遍：能不能过审、够不够吸量。
    // 这一步是纯代码算的，秒出，不依赖 AI，也不会因为联网失败就没有结论。
    const review = checkTitle(t, { existing: [String(n.title || '')].filter(Boolean) });
    return { ...base, titleReview: review };
  }

  /**
   * 「换一批推荐名」（轻接口）：作者对这批不满意就再取一批，同样逐个联网预检，
   * 只回预检通过的。真一个都过不了时返回空 —— 面板会提示换题材，而不是硬塞有风险的名。
   */
  async suggestTitles(id: string, exclude: string[] = []) {
    const n = await this.getNovel(id);
    const bible = n.bible ? ((JSON.parse(n.bible) as any) || {}) : {};
    const seed = await this.genTitles(n, exclude.concat([n.title]));
    const plans = await this.safeTitlePlans(n, bible, seed, (bible.coreSetting || n.sellPoint || '').slice(0, 120))
      .catch(() => []);
    // 书名先过判据这一关：能过审的排前面、同档按吸量分降序。
    // 撞车预检（联网）可能因为网络失败返回空，判据硬扫永远有结论，所以放在最后兜底。
    const reviewed = rankTitles(plans.map((x) => String(x.title || '')).filter(Boolean),
      { existing: [String(n.title || ''), ...exclude].filter(Boolean) });
    const byTitle = new Map(reviewed.map((r) => [r.title, r]));
    const ordered = [...plans].sort((a: any, b: any) => {
      const ra: any = byTitle.get(String(a.title || '')) || { pass: true, score: 0 };
      const rb: any = byTitle.get(String(b.title || '')) || { pass: true, score: 0 };
      if (ra.pass !== rb.pass) return ra.pass ? -1 : 1;
      return rb.score - ra.score;
    });
    return {
      titleSuggestions: ordered.map((x) => x.title),
      // 每个候选都带上判据结论，前端才能显示"这个名 82 分 / 那个名有硬伤"
      titleChecks: ordered.map((x: any) => ({ ...x, titleReview: byTitle.get(String(x.title || '')) })),
      noneSafe: ordered.length === 0,
    };
  }

  /** 生成一批新书名（供"预检不过，再换一批"用）；switchStructure=true 时强制换命名结构 */
  private async genTitles(n: any, exclude: string[], switchStructure = false): Promise<string[]> {
    try {
      const more = tryParseJson(await this.ai.chat(this.titleSuggestPrompt(n, exclude, switchStructure), 90000), ['titleSuggestions']);
      const arr = Array.isArray(more?.titleSuggestions) ? more.titleSuggestions : [];
      const out: string[] = [];
      arr.forEach((t: any) => {
        const s = cleanTitle(t);
        if (s && s !== cleanTitle(n.title) && exclude.indexOf(s) < 0 && out.indexOf(s) < 0) out.push(s);
      });
      if (out.length) return out.slice(0, 4);
    } catch (e) { /* 生成失败就用下面兜底 */ }
    const g = String(n.genre || '都市').split('·')[0];
    return [`${g}：我重来一次就赢`, `${g}：从摆摊到顶流`, `${g}：开局我先手`].slice(0, 3);
  }

  private titleSuggestPrompt(n: any, exclude: string[], switchStructure = false) {
    const struct = switchStructure
      ? '④【关键】前面几批都因为"命名结构撞车"没通过预检（例如满屏都是「重生+年份：XXX」）。这一批必须换一种完全不同的命名结构：不要再用「重生/重回/回到 + 年份」开头，改用「身份/物件/地点 + 冲突」这类结构（如《废品站里捡出个首富》《我的五金厂通着2024》），并避开在榜热书的常见套路名。'
      : '② 避开在榜热书的重名与近似结构（同结构也算撞，如别人已有「重生1998：XXX」，就不要再用这个结构）；';
    return `你是网文起名高手，为【${getPlatform(n.platform).name}】平台的${n.genre || '都市'}题材作品重起书名。
硬性要求：① 必须与这些已用过的名字明显不同：${exclude.concat([n.title]).filter(Boolean).join('、')}；${struct}③ 贴合平台男/女频口味，有记忆点、够勾人。
只输出 JSON，不要解释：{"titleSuggestions":["新名1","新名2","新名3"]}`;
  }

  // ==================== 全书脉络（分卷时间线 + 故事圣经） ====================

  /** 定版 / 重新调整：生成《全书脉络 · 故事圣经》（含分卷时间线） */
  private async buildBible(id: string, dto?: GenerateBibleDto) {
    const n = await this.getNovel(id);
    const p = getPlatform(n.platform);
    let adjustCtx = '';
    if (dto?.reason === 'review_failed') {
      adjustCtx = '\n【重要】该作品此前平台审核未过，需要你重新调整整部小说：保留核心卖点，重梳人设/情节/伏笔，规避审核红线，输出一版更稳的《全书脉络》。';
    } else if (dto?.reason === 'pre_review') {
      adjustCtx = '\n【提示】作者在做未审核前的调整，可按下方意见优化整部结构。';
    }
    if (dto?.opinion) adjustCtx += `\n【调整意见】${dto.opinion}`;

    // 撞车报告：若已判定撞车，把差异化要求作为硬约束带入，避免脉络又写成雷同情节
    const dup = n.dupReport ? (JSON.parse(n.dupReport) as DupReport) : null;
    if (dup && dup.risk !== 'low' && dup.plotAdvice) {
      adjustCtx += `\n【避撞车·硬性要求】经与番茄/七猫热榜比对判定为「${dup.risk === 'high' ? '严重撞车' : '存在相似'}」，必须按下列差异化方向调整卷章与情节，禁止照搬雷同桥段：${dup.plotAdvice}`;
    }

    const prompt = `你是网文爆款写作助手+故事架构师，按【${p.name}】平台规则，为下面作品生成《全书脉络·故事圣经》。
作品：名=${n.title}，一句话卖点=${n.sellPoint || ''}，大纲=${n.outline || ''}，题材=${n.genre || ''}，目标读者=${n.targetReader || ''}，每章目标字数=${n.chapterWords}。${adjustCtx}
${ANTI_CLASH_RULE}

=== 本次核心产出：分卷时间线 ===
把全书拆成 3-7 卷，每卷 40-60 章。每卷必须给出：
- name：卷名，格式「年份·主题」或「阶段·主题」（例：2008·重来一次 / 2011·风口来了）
- words：本卷预计字数（例：14万）
- chapterRange：章节区间（例：1-40）。必须从第 1 章开始、连续衔接、不重叠不断档
- keyEvent：本卷锚定的**真实时间点 + 真实事件**（例：10.28 上证 1664 点，满仓抄底）。现实向题材（重生/年代/商战/职场）必须锚定真实历史事件，不得编造时间；纯架空/玄幻题材改为设定内的关键时间节点
- arc：本卷主线一句话
- climax：本卷情绪爆发点（压-小扬-压-爆 里的「爆」）
- hook：卷末钩子（勾住下一卷）

=== 模式锁（重生/穿越类题材必填，其余题材写"无"）===
必须用一句话锁死下面三件事，后文每章都不得违反：
① 主角是怎么回到过去的：A 重生回自己的身体 / B 魂穿到别人的身体 / C 穿进书里成为角色
② 他能调用哪一段记忆：只有自己上一世的记忆 / 只有原主残留的记忆 / 两者都有
③ 这具身体的原主经历算谁的：若选 A，则"上一世我在这里坐过牢/吃过亏"成立；若选 B，则原主的经历（案底、仇家、亲人）不等于主角的经历，主角只能"知道"不能"经历过"
禁止含糊其辞（如"既像重生又像穿越"），一句话写清楚选 A / B / C，并写出记忆边界。

=== 输出 JSON（字段齐全、可机读）===
{
 "sellPoint":"一句话卖点",
 "coreSetting":"核心设定（世界观/金手指/力量体系）",
 "rebornMode":"一句话锁死穿越/重生模式（见下方『模式锁』）",
 "threeAct":["第一幕…","第二幕…","第三幕…"],
 "volumes":[{"volume":1,"name":"","words":"","chapterRange":"","keyEvent":"","arc":"","climax":"","hook":""}],
 "characters":[{"name":"","role":"主角/女主/反派/配角/导师","desc":"","relations":[{"to":"","type":"恋人/宿敌/父子/师徒/盟友"}]}],
 "factions":[{"name":"","side":"正派/反派/中立","desc":"","relatedTo":[""]}],
 "stateLocks":["死亡:…","毁灭:…","覆灭:…","结局:…","时间:…","遗失损毁:…"],
 "foreshadow":[{"item":"伏笔","status":"埋设/进行中/待回收/已回收","plan":"预计第几卷回收"}],
 "settingDB":{ "world":"","timeline":"","places":"","people":"","events":"","items":"","forces":"","foreshadow":"","ledger":"","bugfix":"" },
 "emotionCurve":"整体情绪曲线说明（压-小扬-压-爆 节奏）",
 "keyChapters":[{"volume":1,"order":1,"title":"","summary":""}]
}
注意：keyChapters 只列**每卷 5-8 个关键节点章**，不要逐章罗列全书；order 必须落在对应卷的 chapterRange 内。
只输出 JSON，不要解释。`;

    const text = await this.ai.chat(prompt, 240000);
    let parsed = tryParseJson(text, ['coreSetting', 'volumes']) || tryParseJson(text, ['coreSetting']);
    // 输出被 token 上限截断时，volumes 常常整段丢失：精简重试一次只补骨架，避免前端「全书脉络」空白
    if (!this.hasVolumes(parsed)) {
      parsed = await this.retryBibleSkeleton(id, parsed, n, p.name);
    }
    // 救不回来就如实标记失败，不能把空对象当成功（否则前端一片空白还查不出原因）
    if (!this.hasVolumes(parsed)) {
      await this.prisma.novel.update({
        where: { id },
        data: { bible: JSON.stringify(parsed || {}), bibleStatus: 'failed' } as any,
      });
      throw new Error('全书脉络生成失败：模型输出被截断且补救无效，请重试定版');
    }
    await this.prisma.novel.update({
      where: { id },
      data: { bible: JSON.stringify(parsed), bibleStatus: 'done' } as any,
    });
    return parsed;
  }

  private hasVolumes(b: any) {
    return !!(b && Array.isArray(b.volumes) && b.volumes.length);
  }

  /**
   * 精简重试：只要「核心设定 + 分卷 + 关键节点章」这三块最小骨架，字段少、体积小、不会被截断。
   * 成功后与首次结果合并（缺什么补什么，已有的不覆盖）。
   */
  private async retryBibleSkeleton(id: string, first: any, n: any, platName: string) {
    const prompt = `你是网文故事架构师。为下面作品输出《全书脉络》的最小骨架，字段务必少而全，避免被截断。
作品：名=${n.title}，题材=${n.genre || ''}，目标读者=${n.targetReader || ''}，每章=${n.chapterWords}字，卖点=${n.sellPoint || ''}，大纲=${n.outline || ''}
输出【只含】下面这些字段的 JSON（不要解释、不要 markdown 围栏）：
{"coreSetting":"核心设定一句话（金手指/世界观）",
 "volumes":[{"volume":1,"name":"卷名","chapterRange":"1-40","keyEvent":"本卷锚定事件","arc":"本卷主线","climax":"爆发点","hook":"卷末钩子"}],
 "keyChapters":[{"volume":1,"order":1,"title":"章名","summary":"一句话"}],
 "characters":[{"name":"","role":"主角/反派/配角","desc":"一句话"}]}
硬性限制：volumes 3-5 卷（chapterRange 从第1章起连续衔接）；keyChapters 每卷 3 个；characters 最多 5 人。不要输出 settingDB / factions / stateLocks / foreshadow / emotionCurve。
平台：${platName}。只输出 JSON。`;
    const text2 = await this.ai.chat(prompt, 180000);
    const core = tryParseJson(text2, ['volumes']) || tryParseJson(text2, ['coreSetting']);
    if (!core) return first;
    const merged: any = { ...(first || {}) };
    Object.keys(core).forEach((k) => {
      const v = core[k];
      const empty = v == null || (Array.isArray(v) && !v.length) || v === '';
      if (empty) return;
      if (Array.isArray(v)) merged[k] = v;
      else if (typeof v === 'object') merged[k] = { ...(merged[k] || {}), ...v };
      else if (!merged[k]) merged[k] = v;
    });
    return merged;
  }

  // ==================== 通用后台任务（体检 / 自动修复 / 续更 / 出大纲）====================
  // 为什么要有它：网络小说一章要跑 40 秒、定版要几分钟。挂在单次请求上，
  // 用户一退出小程序请求就断，进度全丢。改成"落库的任务 + 前端轮询"后，
  // 退出再进来还能看到跑到哪一步。

  /** 启动一个后台任务；同一作品同时只允许一个，避免两套改写互相覆盖 */
  // run 的返回值：字符串=步骤备注；对象=任务产出（会存进 jobResult 回传给前端）
  private async startJob(
    id: string,
    kind: string,
    steps: Array<{ key: string; label: string; run: (ctx: JobCtx) => Promise<any> }>,
  ) {
    const cur: any = await this.getNovel(id);
    // 【卡死根因·已修】部署 / 服务重启会打断正在跑的任务，而库里 jobStage 永远停在 running，
    // 于是之后每一次点按钮都被"已有一个任务在跑"挡住 —— 作者就永远卡在同一屏。
    // 现在靠心跳时间判定：超过 10 分钟没心跳的 running 视为孤儿任务，直接接管重开。
    const staleMs = cur.jobAt ? Date.now() - +new Date(cur.jobAt) : Infinity;
    if (cur.jobStage === 'running' && staleMs < 10 * 60 * 1000) {
      throw new Error('已有一个任务在跑（体检/修复/写稿），等它结束再试');
    }
    const log = steps.map((s) => ({ key: s.key, label: s.label, status: 'pending', note: '', error: '' }));
    const beat = { jobAt: new Date() } as any;
    await this.prisma.novel.update({
      where: { id },
      data: { jobKind: kind, jobStage: 'running', jobLog: JSON.stringify(log), jobError: null, ...beat } as any,
    });
    const setStep = async (i: number, status: string, note = '', error = '') => {
      Object.assign(log[i], { status, note, error });
      await this.prisma.novel.update({ where: { id }, data: { jobLog: JSON.stringify(log), jobAt: new Date() } as any });
    };
    // 步骤内部的细粒度进度（体检要逐批审全书，只报"正在体检"等于黑盒）
    const setNote = async (i: number, note: string) => {
      log[i].note = note;
      await this.prisma.novel.update({ where: { id }, data: { jobLog: JSON.stringify(log), jobAt: new Date() } as any });
    };
    let out: any = null; // 最后一步的产出（出大纲要回传新书名/大纲给前端）
    (async () => {
      for (let i = 0; i < steps.length; i++) {
        await setStep(i, 'running');
        try {
          const r = await steps[i].run({ note: (s: string) => setNote(i, s) });
          out = r === undefined || r === null ? out : r;
          await setStep(i, 'done', typeof r === 'string' ? r : '');
        } catch (e: any) {
          await setStep(i, 'failed', '', e?.message || String(e));
          await this.prisma.novel.update({ where: { id }, data: { jobStage: 'failed', jobError: e?.message || '任务失败' } as any });
          return;
        }
      }
      await this.prisma.novel.update({
        where: { id },
        data: { jobStage: 'done', jobResult: out === null ? null : JSON.stringify(out) } as any,
      });
    })().catch(() => undefined);
    return this.getJob(id);
  }

  /** 任务进度（stage=done/failed 时前端停止轮询） */
  async getJob(id: string) {
    const n: any = await this.getNovel(id);
    let steps: any[] = [];
    try { steps = n.jobLog ? JSON.parse(n.jobLog) : []; } catch (e) { steps = []; }
    let result: any = null;
    try { result = n.jobResult ? JSON.parse(n.jobResult) : null; } catch (e) { result = null; }
    // 孤儿任务（服务重启打断、心跳超过 10 分钟）：直接报失败，别让前端一直空转轮询
    const ageMs = n.jobAt ? Date.now() - +new Date(n.jobAt) : 0;
    const orphan = n.jobStage === 'running' && ageMs > 10 * 60 * 1000;
    return {
      kind: n.jobKind || '',
      stage: orphan ? 'failed' : (n.jobStage || 'idle'),
      orphan: !!orphan,
      steps,
      result,
      error: n.jobError || '',
      doneCount: steps.filter((s) => s.status === 'done').length,
      total: steps.length,
      // current 带上步骤自己的细粒度进度（体检逐批审全书时，只显示"正在体检"等于黑盒）
      current: (() => {
        const cur = steps.find((s) => s.status === 'running') || {};
        return cur.note ? `${cur.label || ''} · ${cur.note}` : cur.label || '';
      })(),
    };
  }

  /**
   * 一键体检（后台任务）：① 代码硬扫 ② AI 语义核对 ③ 撞车比对
   * force=false 时走指纹缓存：稿子没改就直接复用上次清单，
   * 否则 AI 每次抽样不同，作者会看到"第一次 2 条、第二次 7 条"。
   */
  /**
   * 一键体检（后台任务）。
   * @param fullScan true = 全书重新审一遍（慢、烧额度）；false = 收敛式复检（默认：代码核验旧清单 + 只审改动处）
   */
  async startAuditJob(id: string, fullScan = false, scope: 'all' | 'consistency' | 'dup' = 'all') {
    const n: any = await this.getNovel(id);
    if (!n.bible) throw new Error('请先定版生成《全书脉络》再体检');
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    if (!chapters.length) throw new Error('还没有章节可体检');
    // 【只查撞车】单独一步跑完：矛盾清单原样沿用，作者就是想看看书名撞没撞
    if (scope === 'dup') {
      return this.startJob(id, 'audit', [{
        key: 'dup',
        label: '联网撞车比对（书名 vs 番茄 / 七猫在榜作品）',
        run: async () => {
          const r: any = await this.auditConsistency(id, { full: true, force: true, scope });
          const risk = (r && r.dup && r.dup.risk) || 'low';
          return risk === 'low' ? '未发现撞车' : `撞车风险：${risk}`;
        },
      }]);
    }
    const onlyConsistency = scope === 'consistency';
    const batches = Math.max(1, Math.ceil(chapters.length / AUDIT_BATCH));
    const marks = fullScan ? [] : await this.editMarks(id);
    return this.startJob(id, 'audit', [
      {
        key: 'scan',
        label: `代码硬扫 ${chapters.length} 章（人名 / 章号 / 字数 / 旧写法残留）`,
        run: async () => {
          const hard = this.hardIssues(n, JSON.parse(n.bible as string), chapters);
          return `${hard.length} 条确定性问题`;
        },
      },
      {
        key: 'ai',
        label: fullScan
          ? `AI 逐句审校全书 ${chapters.length} 章（分 ${batches} 批）${onlyConsistency ? '' : ' + 联网撞车比对'}`
          : `复检旧清单 + AI 只审改动过的地方（${marks.length} 处）${onlyConsistency ? '' : ' + 联网撞车比对'}`,
        run: async (ctx) => {
          const r = await this.auditConsistency(id, {
            full: true,
            force: fullScan,
            fullScan,
            scope,
            onProgress: (done, total, label) =>
              ctx.note(`${label} · 整体 ${Math.round((done / total) * 100)}%`),
          });
          return `还剩 ${(r.issues || []).length} 处${r.cached ? '（稿子未改动，沿用上次结果）' : ''}${r.resolvedCount ? `，本轮清掉 ${r.resolvedCount} 条` : ''}`;
        },
      },
    ]);
  }

  /**
   * 【修到干净】作者要的"一次性到位"：一次点击，后台连跑最多 3 轮
   * 「定点修复 → 复检 → 再修」，直到没有可自动修的问题为止。
   *
   * 修复本身永远是**一条矛盾一次定点替换**（正文其余部分字节级不变），
   * 不做"整章重写"——旧版那样修 1 处会冒 3 处。
   * 为什么还要循环：一轮修完后改动处可能引出新的小问题（改动自身也有代价），
   * 复检能马上发现并就地修掉。合在一起跑，作者只需要点一次、看一条进度条。
   * 收敛式复检（详见 auditConsistency）保证这个循环会终止 —— 清单只会变短不会膨胀。
   */
  async startFixJob(id: string, opinion?: string) {
    // 零成本先修一批：章名里的「第N章」前缀直接改库，不用烧 AI
    const all = await this.prisma.chapter.findMany({ where: { novelId: id } as any });
    const dirty = all.filter((c) => /^\s*第\s*[0-9一二三四五六七八九十百千两]+\s*章/.test(String(c.title || '')));
    for (const c of dirty) {
      const clean = stripChapterNo(c.title);
      if (clean) await this.prisma.chapter.update({ where: { id: c.id }, data: { title: clean } as any });
    }

    const MAX_ROUNDS = 3;   // 最多三轮：再多说明有问题在循环，交回作者看
    const MAX_PER_ROUND = 40; // 一轮最多修 40 条，避免一步跑半小时
    const box: any = { ok: 0, skip: 0, gain: 0, msgs: [] as string[], rounds: 0, left: 0, done: false };
    const short = (s: string) => String(s || '').replace(/\s+/g, '').slice(0, 12);

    /** 取"当前还挂着、且程序能确定改法"的清单（收敛复检口径，不会越取越多） */
    const pick = async (): Promise<any[]> => {
      const aud = await this.auditConsistency(id, {});
      const RANK: Record<string, number> = { 高: 0, 中: 1, 低: 2 };
      const seen = new Set<string>();
      return (aud.issues || [])
        .filter((x: any) => Number(x.chapter) > 0 && !x.unlocatable && !String(x.quote || '').startsWith('章名：')
          && (opinion ? true : !isHumanIssue(x)))
        .filter((x: any) => { const k = normQuote(x.quote); if (!k || seen.has(k)) return false; seen.add(k); return true; })
        // 代码能直接改的（旧写法残留）排最前：0 AI 成本、秒改，先吃掉
        .sort((a: any, b: any) => (a.deprecated ? 0 : 1) - (b.deprecated ? 0 : 1)
          || (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3));
    };

    const steps: Array<{ key: string; label: string; run: (ctx?: JobCtx) => Promise<any> }> = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      steps.push({
        key: `fix${round}`,
        label: `第 ${round} 轮 · 定点修复`,
        run: async (ctx) => {
          const list = await pick();
          if (!list.length) { box.done = true; return round === 1 ? '没有可自动修复的问题' : '已经没有待修问题了'; }
          const todo = list.slice(0, MAX_PER_ROUND);
          box.left = Math.max(0, list.length - todo.length);
          const chapters = await this.prisma.chapter.findMany({
            where: { novelId: id, stale: false } as any,
            orderBy: { order: 'asc' },
          });
          let okThis = 0;
          let skipThis = 0;
          for (let i = 0; i < todo.length; i++) {
            const x = todo[i];
            if (ctx) await ctx.note(`第 ${round} 轮 ${i + 1}/${todo.length}：第 ${x.chapter} 章〔${x.level}·${x.type}〕`);
            const ch = chapters.find((c) => c.order === Number(x.chapter));
            if (!ch) continue;
            const r: any = await this.patchIssue(id, ch.id, x);
            if (r.ok) {
              box.ok += 1; okThis += 1; box.gain += Number(r.gain) || 0;
              await this.resolveAuditIssue(id, x.quote).catch(() => undefined);
            } else {
              box.skip += 1; skipThis += 1;
              box.msgs.push(`第${x.chapter}章「${short(x.quote)}…」没改成：${r.reason}`);
            }
          }
          box.rounds = round;
          return `第 ${round} 轮：处理 ${todo.length} 条，成功 ${okThis}、未改动 ${skipThis}`;
        },
      });
      steps.push({
        key: `chk${round}`,
        label: `第 ${round} 轮 · 复检（代码核验旧清单 + 只审改动处）`,
        run: async () => {
          const r2 = await this.auditConsistency(id, {});
          const leftAuto = (r2.issues || []).filter((x: any) => !x.needHuman && Number(x.chapter) > 0).length;
          if (!leftAuto) box.done = true;
          return leftAuto
            ? `还剩 ${leftAuto} 处可自动修${box.left ? `（另有 ${box.left} 条排到下轮）` : ''}`
            : '复检通过：已无可自动修的矛盾';
        },
      });
    }
    // 最后一步做汇总：作者要看到"改了几条、哪几条没改成"，不是一句"修复完成"
    steps.push({
      key: 'sum',
      label: '汇总结果',
      run: async () => ({
        ok: box.ok,
        skip: box.skip,
        gain: box.gain,
        rounds: box.rounds,
        done: box.done,
        msgs: box.msgs.slice(0, 8),
        note: `共跑 ${box.rounds} 轮，成功 ${box.ok} 条、未改动 ${box.skip} 条`
          + (box.done ? '；**已修到干净**，剩下的只有需要你拍板的' : `；还有没修完的，可以再点一次「一键修复」`)
          + (box.left ? `；另有 ${box.left} 条超出单轮上限，下轮继续` : ''),
      }),
    });
    await this.startJob(id, 'fix', steps);
    return { started: true, total: steps.length, left: box.left };
  }

  /** 续更（后台任务）：写下一章也走任务队列，退出小程序不丢、还能看进度 */
  /**
   * 续更：一次可以连写 N 章（作者不用一章一章点，点一次选「续更 5 章」就等着收）。
   * 走后台任务：一章要跑 40 秒以上，挂在单次请求上退出小程序就断了；
   * 现在退出也照写，回来还能看到"写到第几步"。每章写完顺带自检矛盾并当场改。
   */
  async startChapterJob(id: string, wordCount?: number, instruction?: string, count = 1) {
    const n = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));

    // 连写多章时在入口一次查清总数：不然后面写到第 4 章才发现超标，前三章的额度已经烧掉了。
    // 额度按"这部作品挂在谁名下"算 —— 内部流程（定版写黄金三章等）因此自动受限，不用层层传身份。
    const owner = await this.getNovel(id);
    const q0 = await currentQuota(this.prisma as any, (owner as any).userId || null, (owner as any).guestKey || null);
    const deny0 = checkChapterLimit(q0, n);
    if (deny0) throw new BadRequestException(deny0);

    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    const start = chapters.length + 1;
    const done: any[] = []; // 每章的结果攒起来，最后一步汇总给前端
    const steps: Array<{ key: string; label: string; run: (ctx?: JobCtx) => Promise<any> }> = [
      {
        key: 'ctx',
        label: n > 1
          ? `读取脉络与前文（准备连写第 ${start}~${start + n - 1} 章）`
          : `读取脉络与前文（准备写第 ${start} 章）`,
        run: async () => `已承接第 ${chapters.length} 章章末钩子`,
      },
    ];

    for (let k = 0; k < n; k++) {
      const order = start + k;
      const box: any = {}; // 跨步骤传递：写出来的章给自检用
      steps.push({
        key: `w${order}`,
        label: n > 1 ? `AI 写第 ${order} 章（${k + 1}/${n}）` : `AI 写第 ${order} 章`,
        run: async () => {
          const ch: any = await this.generateChapter(id, {
            instruction: instruction
              || `续写第${order}章：承接上一章章末的钩子立刻展开，推进本卷主线，保持人物性格与《全书脉络》一致；全章至少一个小爽点，章末再留新钩子。`,
            wordCount: wordCount || undefined,
            skipHeal: true, // 自检统一放到下一步做，别让同一章被审两遍（烧两份额度）
          } as any);
          box.ch = ch;
          // 新写的整章标记为"待复审"：下次体检（收敛口径）会专门把这一章过一遍 AI
          await this.pushEditMark(id, ch.order, '', true);
          return `第 ${ch.order} 章完成，${(ch.content || '').length} 字`;
        },
      });
      steps.push({
        key: `h${order}`,
        label: n > 1
          ? `第 ${order} 章 发布前自检（${k + 1}/${n}）`
          : '发布前自检（只查矛盾，不查撞车；有就当场改到 0 处）',
        run: async (ctx) => {
          const chId = box.ch && box.ch.id;
          if (!chId) return '没有可自检的章节';
          const h: any = await this.selfHealUntilClean(id, chId);
          if (ctx) await ctx.note(h.note);
          const fresh: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
          const words = (fresh && fresh.content ? fresh.content : '').length;
          done.push({
            order: box.ch.order,
            words,
            heal: h.note,
            healInfo: { clean: h.clean, rounds: h.rounds, fixed: h.fixed, left: h.left, found: h.found, msgs: h.msgs.slice(0, 5) },
          });
          return `第 ${box.ch.order} 章 ${words} 字 · ${h.note}`;
        },
      });
    }

    steps.push({
      key: 'sum',
      label: '汇总',
      run: async () => {
        const fixed = done.reduce((s, x) => s + (x.healInfo.fixed || 0), 0);
        const left = done.reduce((s, x) => s + (x.healInfo.left || 0), 0);
        // 单章沿用原来的文案（前端按「自检发现」开头判断走弹窗还是 toast）
        const heal = done.length === 1
          ? done[0].heal
          : left > 0
            ? `自检发现 ${fixed} 处矛盾并已当场改掉，还有 ${left} 处程序改不了`
            : '自检通过，没有发现矛盾';
        return {
          order: done.length ? done[done.length - 1].order : start,
          from: done.length ? done[0].order : start,
          to: done.length ? done[done.length - 1].order : start,
          count: done.length,
          words: done.reduce((s, x) => s + x.words, 0),
          chapters: done,
          heal,
          healInfo: { clean: left === 0, fixed, left, rounds: done.length ? done[0].healInfo.rounds : 0, msgs: [] },
        };
      },
    });

    await this.startJob(id, 'chapter', steps);
    return this.getJob(id);
  }

  /**
   * 【撞车一键修复·完整流水线】作者点「用这个」就一条龙走完，不再让他自己一步步点：
   * 改书名 → 按新名重出大纲 → 重建全书脉络 → 重出上架资料（作品简介）→ 重写黄金三章
   * → 重出封面 → 最后再查一次重。任何一步失败都会写进进度里，作者一眼看得出卡在哪。
   */
  async startDupFixJob(id: string, title: string, plot: string) {
    const t = cleanTitle(title);
    await this.prisma.novel.update({
      where: { id },
      data: { title: t, dupAccepted: t } as any, // dupAccepted：重出大纲时锁死书名，不让 AI 又给改回去
    });
    await this.clearAudit(id); // 整部重做，先把旧体检结果（矛盾清单 + 角标）清干净
    return this.startJob(id, 'dupfix', [
      {
        key: 'rename',
        label: `改名《${t}》`,
        run: async () => '已换名并锁定（重出大纲时不再改书名）',
      },
      {
        key: 'outline',
        label: '按新名重新生成大纲',
        run: async () => {
          const out: any = await this.generateOutline(id, {
            opinion: `【避撞车·必须执行】已换用新书名《${t}》。请据此整体重写大纲，确保书名、开局、主线都与热榜作品明显区隔。${plot || '核心冲突、开局金手指与成长路径都要做出差异。'}`,
          } as any);
          return out.publishCleared ? '大纲已重出，旧章节与旧简介已作废' : '大纲未变化，重试一次即可';
        },
      },
      {
        key: 'bible',
        label: '重建全书脉络 + 分卷时间线',
        run: async () => {
          await this.buildBible(id, {} as any);
          return '全书脉络已重建';
        },
      },
      {
        key: 'publish',
        label: '重新生成上架资料（作品简介 / 主角 / 标签）',
        run: async () => {
          await this.generatePublishInfo(id);
          return '作品简介已按新大纲重新生成';
        },
      },
      {
        key: 'golden',
        label: '重新生成黄金 1-3 章',
        run: async () => {
          const n = await this.writeGoldenChapters(id, true);
          return n ? `已重新写出黄金 ${n} 章` : '黄金三章已存在，保持原样';
        },
      },
      {
        key: 'cover',
        label: '按新情节重新生成封面',
        run: async () => {
          try {
            await this.coverPlan(id, {} as any);
            return '封面已按新情节重新设计';
          } catch (e: any) {
            return `封面重出失败（不影响正文）：${e?.message || '未知原因'}`;
          }
        },
      },
      {
        key: 'recheck',
        label: '最后再查一次撞车',
        run: async () => {
          const rep = await this.checkDuplicate(id);
          return rep.risk === 'low'
            ? '✓ 已不撞车，可以发布'
            : `仍判定为${rep.risk === 'high' ? '严重撞车' : '存在相似'}：${rep.riskNote}（可再换一批书名）`;
        },
      },
    ]);
  }

  /** 生成大纲（后台任务）：出大纲也要几分钟，同样避开"请求断开 = 前功尽弃" */
  async startOutlineJob(id: string, opinion?: string) {
    await this.startJob(id, 'outline', [
      { key: 'title', label: '书名定位 + 题材人群拆解', run: async () => '定位完成' },
      {
        key: 'outline',
        label: 'AI 生成全书脉络（分卷 + 章纲）',
        run: async () => {
          const out: any = await this.generateOutline(id, { opinion } as any);
          // 回传新书名/大纲/作废旧章数，前端直接铺到向导页（不用再拉一次）
          return {
            title: out.title,
            sellPoint: out.sellPoint,
            outline: out.outline,
            staleCount: out.staleCount || 0,
            publishCleared: !!out.publishCleared,
            // 让前端能分辨"真出了新大纲"还是"空跑一场"（以前空跑时作者只看到名改了、大纲没动）
            outlineChanged: !!out.publishCleared,
          };
        },
      },
    ]);
    return this.getJob(id);
  }

  /**
   * 给"需要作者拍板"的问题生成 2-3 个可选方向，第一个是推荐项并写明理由。
   * 作者点选后走「定向修复」：按他选的方向重写受影响的章。
   */
  private async decisionOptions(n: any, humans: any[], dup: any): Promise<any[]> {
    const lines = humans
      .slice(0, 5)
      .map((x: any) => `-【${x.type}】第${x.chapter || '?'}章：${x.why}（原文“${String(x.quote || '').slice(0, 30)}”）`)
      .join('\n');
    const dupLine = dup && dup.risk !== 'low'
      ? `\n另有撞车问题：判定为「${dup.risk === 'high' ? '严重撞车' : '存在相似'}」，${dup.riskNote}`
      : '';
    const prompt = `你是网文主编。作者这部书出了几个"没有唯一正确改法"的问题，请你给出 2-3 个可选方向，并明确推荐哪个、为什么。
作品：《${n.title}》，题材=${n.genre || ''}，目标读者=${n.targetReader || ''}
${lines}${dupLine}

要求：
① 每个方向必须给出**具体可执行的改法**（AI 照着就能改稿），不是"建议调整"这种空话；
② 第一个必须是推荐项，reason 里写清为什么更稳（读者接受度 / 平台审核 / 不打乱已有剧情）；
③ 方向之间要有实质区别（例如：统一按"魂穿"写 vs 统一按"重生"写），不要换汤不换药。
只输出 JSON：
{"options":[{"title":"方向名(≤10字)","detail":"具体怎么改，AI 照着执行(≤80字)","reason":"为什么推荐/不推荐(≤50字)","recommend":true}]}`;
    const parsed = tryParseJson(await this.ai.chat(prompt, 120000), ['options']) || {};
    const arr = Array.isArray(parsed.options) ? parsed.options : [];
    return arr.slice(0, 3).map((o: any, i: number) => ({
      title: String(o.title || `方案${i + 1}`).slice(0, 20),
      detail: String(o.detail || '').slice(0, 200),
      reason: String(o.reason || '').slice(0, 120),
      recommend: i === 0 ? true : !!o.recommend,
    }));
  }

  /** 读最近一次体检结果（含"上/下一次体检"的指纹，用于判断结果是否还作数） */
  async getAudit(id: string) {
    const n: any = await this.getNovel(id);
    let data: any = null;
    try { data = n.auditJson ? JSON.parse(n.auditJson) : null; } catch (e) { data = null; }
    // 读回时同样要过一遍分组收尾（可自动修 / 需你拍板），否则页面上的"可自动修 N"里会混进
    // "AI 只给描述、正文定位不到原句"的条目 —— 点了必然报"找不到这句话"，作者以为修不完
    if (data && Array.isArray(data.issues) && data.issues.length) {
      const chapters = await this.prisma.chapter.findMany({
        where: { novelId: id, stale: false } as any,
        orderBy: { order: 'asc' },
      });
      data = this.tidyAuditReport(data, chapters);
    }
    return { audit: data, stale: !!data && n.auditKey !== (await this.auditFingerprint(id)) };
  }

  /** 体检指纹：章节集合或大纲一变，指纹就变（结果需要重算） */
  private async auditFingerprint(id: string) {
    const n = await this.getNovel(id);
    const list = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
      select: { id: true, updatedAt: true, order: true } as any,
    });
    // 用"全书所有章的更新时间之和"而不是只看最后一章：
    // 修第 1 章不会改最后一章的 updatedAt，指纹不变 → 体检读回旧清单 → 作者看到"改了但清单没变"。
    const stamp = list.reduce((s, c: any) => s + +new Date(c.updatedAt), 0);
    const resolvedLen = String((n as any).resolvedQuotes || '').length;
    return `${list.length}|${stamp}|${(n.bible || '').length}|${n.title}|${resolvedLen}`;
  }

  /**
   * 确定性硬扫描：这部分完全由代码判定，同一份稿子跑多少次结果都一样
   * （AI 抽样每次给的问题条数会变，作者看到"第一次 2 条、第二次 7 条"就是被这个坑的）。
   */
  private hardIssues(n: any, bible: any, chapters: any[], opts?: { chapterScope?: boolean }): any[] {
    const out: any[] = [];
    const chapterScope = !!(opts && opts.chapterScope); // 单章自检：只用"在本章内成立"的判据
    const chars = charListOf(bible, n.protagonists);
    // 只盯"主角 / 女主"这类必定登场的人：配角还没出场是正常的，拿来当矛盾报就是误报
    const leads = chars.filter((c: any) => /主角|女主|男主/.test(String(c.role || '')));
    const names = (leads.length ? leads : chars.slice(0, 1))
      .map((c: any) => String(c.name || ''))
      .filter((x) => x.length >= 2);
    const bodyAll = chapters.map((c) => c.content || '').join('\n');

    // ① 人物表里的角色名，全文一次都没出现 → 正文一定用了别的写法（如"林越"写成"林辰"）
    //    这条是"全书级"判断，单章自检时不用（某一章没提到女主是正常的，不是矛盾）
    if (!chapterScope) names.forEach((name) => {
      if (bodyAll && bodyAll.indexOf(name) < 0) {
        out.push({
          level: '高', type: '人名', chapter: chapters[0] ? chapters[0].order : 1, hard: true,
          quote: `全书正文中未出现「${name}」`,
          why: `《全书脉络》与上架资料里的角色名是「${name}」，但正文里一次都没出现过，说明正文用了别的名字（角色改名是最常见的硬伤）`,
          fix: `把正文里对应角色的名字统一改成「${name}」`,
        });
      }
    });

    // ② 「同姓异写」不再用正则硬扫（2026-10-02 停用）。
    //    中文没有词边界，「姓 + N 个汉字」这种正则会把「林建国」切成「林建」、「林这一」切成「林这」，
    //    一部 6 章的书直接刷出 177 条假"人名矛盾"，真问题反而被淹掉。
    //    这种"同音错写"（苏婉晴 / 苏晚晴）交给 AI 判更准，代码只做能 100% 确定的那几条。

    // ③ 章号重复 / 断号（全书级判断）
    const orders = chapters.map((c) => c.order).sort((a, b) => a - b);
    const dupOrder = chapterScope ? null : orders.find((o, i) => i > 0 && o === orders[i - 1]);
    if (dupOrder) {
      out.push({
        level: '高', type: '事实', chapter: dupOrder, hard: true,
        quote: `第 ${dupOrder} 章出现了两次`,
        why: '章节序号重复，通常是两套设定混在了一起（旧稿没作废就重写）',
        fix: '保留与新大纲一致的那一版，把另一版作废',
      });
    }

    // ④ 章名仍带「第N章」前缀（历史数据遗留，会和界面的"第N章"显示成两遍）
    chapters.forEach((c) => {
      if (/^\s*第\s*[0-9一二三四五六七八九十百千两]+\s*章/.test(String(c.title || ''))) {
        out.push({
          level: '低', type: '事实', chapter: c.order, hard: true,
          quote: `章名：${c.title}`,
          why: '章名里自带「第N章」，和界面上自动显示的章号重复，看起来像「第1章 第1章 …」',
          fix: '章名只保留章名本身，去掉「第N章」前缀',
        });
      }
    });

    // ⑤ 字数不达平台要求（每章不足目标字数的 80%）
    const need = Number(n.chapterWords) || 2000;
    chapters.forEach((c) => {
      const len = (c.content || '').length;
      if (len > 0 && len < need * 0.8) {
        out.push({
          level: '中', type: '事实', chapter: c.order, hard: true,
          quote: `本章约 ${len} 字`,
          why: `平台要求每章不少于 ${need} 字，本章明显偏短，容易被判"内容单薄"`,
          fix: `把本章扩写到 ${need} 字以上（补细节与对话，不新增支线）`,
        });
      }
    });

    // ⑥ 已被统一过的"错写法"还有残留 → 一定是没改干净。
    //    纯代码判定（对比 renamedJson 映射表），0 AI 成本、一条都跑不掉，
    //    专门治"人名类问题每轮只清掉几处、下一轮又冒出来"的死循环。
    let renamed: Record<string, string> = {};
    try { renamed = n.renamedJson ? JSON.parse(n.renamedJson) : {}; } catch (e) { renamed = {}; }
    Object.keys(renamed).forEach((old) => {
      if (!old || old.length < 2) return;
      const to = renamed[old] || '';
      chapters.forEach((c) => {
        /**
         * 必须排除"落在正确写法内部"的误命中（详见 insideCorrectName）：
         * `陈建国眉头一皱` 里能数出 1 处「建国眉」，但它只是正确人名的后半截 + 后边一个字，
         * 报出来并照改会把「眉」删掉、正文变 `陈陈建国头一皱`。
         * 这类条目正是作者说的"改不动 / 改了更糟"，一条都不能报。
         */
        const cnt = countResidual(String(c.content || ''), old, to);
        if (cnt <= 0) return;
        out.push({
          level: '中', type: '人名', chapter: c.order, hard: true,
          deprecated: old, to,
          quote: `第 ${c.order} 章还有 ${cnt} 处「${old}」（旧写法残留）`,
          why: `这个写法已经统一成「${to || '删除'}」，本章还残留 ${cnt} 处，两种写法并存`,
          fix: `把本章的「${old}」全部改成「${to || '正确称呼'}」（代码直接改，不用 AI）`,
        });
      });
    });

    return out;
  }

  /** 定版后自动连写黄金 1-3 章（已有正文章节则跳过，避免重复堆稿） */
  /**
   * @param force true=整部重建（脉络刚重出 / 换过名）：旧章节与新设定必然对不上，先清干净再写黄金三章。
   *  false=只补缺失的开篇（普通续写场景，绝不删已有稿子）。
   */
  private async writeGoldenChapters(id: string, force = false) {
    const n = await this.getNovel(id);
    // 只要脉络内容真的在就能写稿（bibleStatus 仅用于展示）。
    // 注意：不能只判 `!n.bible` —— 空对象 "{}" 也是真值，旧数据就有这种"看着有、其实是空"的脉络。
    let ok = false;
    try { ok = !!n.bible && this.hasVolumes(JSON.parse(n.bible)); } catch (e) { ok = false; }
    if (!ok) throw new Error('全书脉络未就绪（或为空），无法写黄金三章，请先定版');
    // 历史遗留的作废章节（stale）先清掉：否则这里 count 到它们就误判"已有正文"而跳过，
    // 结果界面显示 0 章、定版却说"已有正文章节，跳过"——永远写不出黄金三章。
    await this.prisma.chapter.deleteMany({ where: { novelId: id, stale: true } as any });
    await this.dedupeChapters(id); // 先清掉同章号的重复稿：否则 count 到重复章也会误判"已有正文"而跳过
    if (force)     await this.prisma.chapter.deleteMany({ where: { novelId: id } as any });
    if (force) await this.clearAudit(id); // 整部重写了，旧矛盾清单不再作数
    if (!force && await this.prisma.chapter.count({ where: { novelId: id, stale: false } as any })) return 0;
    let done = 0;
    for (const instruction of GOLDEN_CHAPTERS) {
      await this.generateChapter(id, { instruction });
      done++;
    }
    await this.dedupeChapters(id); // 写完再兜一次：万一还有并发/重试留下的重复章，这里清掉
    return done;
  }

  /**
   * 【文字打磨】机器先挑毛病，AI 只改文字与节奏、情节一个字不许动。
   *
   * 和「体检」的分工：体检管**矛盾**（人名/时间线/事实/重复），打磨管**好不好看**
   * （字数、分段、去 AI 味、章末钩子）。以前只有体检，稿子"没矛盾"但读起来发飘、章末没钩，
   * 作者拿去上架还是没人追。所以定版后要单独打磨一遍。
   *
   * 只让 AI 改文字不改情节，是为了收敛：改情节会牵动人名、伏笔、台账，越改越乱。
   */
  /**
   * 打磨前的机器自查。
   * @param isGolden 是否黄金三章 —— 验证期曝光全压在前三章，爽点密度要求更高
   */
  private polishFindings(content: string, words: number, isGolden = false): string[] {
    const t = String(content || '');
    const out: string[] = [];
    const len = t.replace(/\s/g, '').length;
    if (!len) return ['本章没有正文'];
    if (len < words * 0.9) out.push(`字数不足：现在 ${len} 字，目标 ${words} 字`);
    const paras = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (paras.length < 45) out.push(`段落只有 ${paras.length} 段：网文要短段快节奏，2000 字至少要 45-50 段`);
    const longs = paras.filter((p) => p.length > 100).length;
    if (longs) out.push(`有 ${longs} 段超过 100 字，手机上是一整屏黑压压的字，要拆开`);
    const le = (t.match(/了/g) || []).length;
    if (len > 500 && le / len > 0.035) out.push(`"了"字密度 ${(le / len * 100).toFixed(1)}%（偏高），读起来发飘`);
    const dash = (t.match(/——/g) || []).length;
    if (dash > 3) out.push(`破折号用了 ${dash} 次（超过 3 次显得刻意）`);
    if (/(第[一二三])[条天名]/.test(t)) out.push('出现"第一条/第二天"这类机械排比，要融进自然叙述');
    const tail = t.slice(-150);
    if (/他不知道|她不知道|这将|从此|命运|或许|也许|也许这就是/.test(tail)) {
      out.push('章末在总结感慨，不是钩子：要换成一件"具体发生的事"（动作 / 对白 / 新信息）');
    }
    if (!/[？?！!]/.test(tail) && !/(说|喊|道|问|喝|笑)[：:"“”]/.test(tail)) {
      out.push('章末没有对话或强动作，钩子不够硬');
    }
    // 冲榜判据（章首钩子 / 章末钩子 / 水段 / 爽点密度）：
    // 过审只保证"能发"，这几条决定"有没有量"。打磨必须两条一起满足。
    out.push(...rankFindings(t, isGolden));
    return out;
  }

  /** 打磨一章：有问题就让 AI 改一版，改完复检。返回有没有真改动 */
  private async polishChapterOnce(id: string, chId: string, words: number, isGolden = false) {
    const ch: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (!ch || !ch.content) return { changed: false, note: '章节没有正文' };
    const findings = this.polishFindings(ch.content, words, isGolden);
    if (!findings.length) return { changed: false, note: '文字达标，无需打磨' };

    const prompt = `你是网文资深责编，负责**最后一遍文字打磨**。
【这一章现在的问题（机器逐条查出来的，必须全部解决）】
${findings.map((f, i) => `${i + 1}) ${f}`).join('\n')}

${PASS_GATE_RULE}

【硬性要求】
1) **只改文字、节奏、分段**：情节、人物、对白内容、时间线、专有名词一个字都不许变。改情节会越改越乱，一律不许。
2) 字数必须 ≥ ${words} 字，段落 ≥ 45 段，单段 ≤ 100 字；人物开口说话单独成段。
3) 直接输出**改后完整正文**，不要章节标题、不要任何说明、不要代码块。

【原正文】
${ch.content}`;
    const text = String(await this.ai.chat(prompt, 180000) || '')
      .replace(/```[a-z]*\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    // AI 偷懒只给片段（比原文短太多）→ 宁可不改，也不能把正文写残
    if (text.length < ch.content.length * 0.8) return { changed: false, note: 'AI 返回的正文过短，已放弃本次打磨' };
    await this.prisma.chapter.update({ where: { id: chId }, data: { content: text } as any });
    const left = this.polishFindings(text, words, isGolden);
    return { changed: true, note: `改了 ${findings.length} 处问题${left.length ? `，还剩 ${left.length} 处` : '，已达标'}` };
  }

  /**
   * 【过审体检】按平台签审判据给稿子打分 —— 和「一致性体检」是两码事。
   *
   * 一致性体检回答"故事对不对"（有无矛盾）；过审体检回答"能不能签约"（机器判据过不过）。
   * 【实战教训 2026-10-08】某稿安全审核 11:58 秒过，签约评估同一分钟被拒，
   * 理由"作品质量暂未达到签约标准"。全程 95 分钟 → 判定主体是机器，抓文本结构指纹。
   * 也就是说：**没有矛盾 ≠ 能过审**。所以必须单独一层判据、单独一个分数。
   *
   * 纯代码计算（八项指标全部确定性），同一份稿子跑多少次结果完全一样。
   */
  async passReview(id: string): Promise<PassReport> {
    await this.getNovel(id); // 先校验作品存在：否则不存在的 id 会抛出 500，前端拿不到"作品不存在"这句人话
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    if (!chapters.length) throw new Error('还没有章节可做平台过审体检');
    return analyzeBook(chapters.map((c: any) => ({
      order: Number(c.order),
      title: stripChapterNo(c.title),
      content: c.content || '',
    })));
  }

  /**
   * 【过审清洗】按平台判据逐章改写，改完复检，直到过线。
   *
   * 与「打磨」的分工：打磨是通用文字优化（无明确验收线），清洗**对着评分线打**——
   * 只改不达标的那几项，达标项一个字节不碰。这样"改了几轮、还差多少分"是可视的。
   *
   * 硬约束（防 AI 越改越坏）：
   *   ① 只改文字，情节/人名/时间线一个字不许动（改情节会牵动人名台账，越改越乱）
   *   ② AI 返回比原文短 20% 以上 → 判定偷懒，放弃本次改动、不落库
   *   ③ 改完必须**分数不变低**才落库（防止"修 A 指标把 B 指标改坏"）
   */
  private async cleanChapterOnce(id: string, chId: string, words: number): Promise<{ changed: boolean; note: string; before: number; after: number }> {
    const ch: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (!ch || !ch.content) return { changed: false, note: '章节没有正文', before: 0, after: 0 };
    const before = analyzeBook([{ order: Number(ch.order), title: ch.title, content: ch.content }]).score;
    // 过审项 + 冲榜项一起查：只改过审项会出现"能发但没人看"，两条都是标准
    const findings = [...chapterFindings(ch.content, words), ...rankFindings(ch.content, Number(ch.order) <= 3)];
    if (!findings.length) return { changed: false, note: '各项判据已达标，无需清洗', before, after: before };

    const prompt = `你是网文平台的**签约审核视角**修稿人。下面这章正文被平台机器审判定命中若干"低质"特征，
你的任务是在**不动情节**的前提下把文本结构改到合规。

【本章被判定不达标的地方（机器算出来的，逐条解决）】
${findings.map((f, i) => `${i + 1}) ${f}`).join('\n')}

【平台点名的四类严禁（你改完必须一条都不沾）】
① AI粗制滥造：内容空洞、结构失常、空洞水文
② 格式混乱：分章异常、标点错乱、排版紊乱
③ 结构失常：提纲式写文、复述剧情、句式重复堆砌、模板化拼接
④ 空洞水文：流水账叙事、无意义堆砌、剧情拖沓

【硬性要求】
1) **情节、人物、对白内容、时间线、专有名词一个字都不许变**。你只做文字层面的重组：
   拆段、并段、把对白改成带动作的叙述、换掉重复句式、调整长短句配比。
2) 段落长度控制在 18-70 字，长短要有变化，不要整章一个长度。
3) 少用"了"字；不要"第一条/其次/然后"式机械排比；不要格言式收尾。
4) 字数不得少于原文的 95%。
5) 章末 150 字内必须落一件**具体发生的事**（对白/动作/新信息）当钩子。
6) 直接输出**改后完整正文**，不要章节标题、不要任何说明、不要代码块。

【原正文】
${ch.content}`;
    const text = String(await this.ai.chat(prompt, 180000) || '')
      .replace(/```[a-z]*\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    if (text.length < ch.content.length * 0.8) {
      return { changed: false, note: 'AI 返回的正文过短，已放弃本次清洗', before, after: before };
    }
    const after = analyzeBook([{ order: Number(ch.order), title: ch.title, content: text }]).score;
    // 改完分数反而更低 → 退回去。宁可这一章不动，也不能"越洗越差"。
    if (after < before) {
      return { changed: false, note: `改写后分数反而从 ${before} 降到 ${after}，已放弃本次改动`, before, after: before };
    }
    await this.prisma.chapter.update({ where: { id: chId }, data: { content: text } as any });
    const left = chapterFindings(text, words);
    return {
      changed: true,
      before,
      after,
      note: `判据 ${before} → ${after} 分${left.length ? `，还剩 ${left.length} 项不达标` : '，已全部达标'}`,
    };
  }

  /**
   * 【一键清洗】把全书按平台判据刷到过线。退出小程序也照跑（后台任务）。
   * @param target 目标分（默认 85，对应"接近合格"以上；作者可指定 90 冲"可提交"）
   */
  async startPassCleanJob(id: string, target = 85) {
    const n: any = await this.getNovel(id);
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    if (!chapters.length) throw new Error('还没有正文，请先定版生成黄金三章');
    const goal = Math.max(60, Math.min(95, Math.floor(Number(target) || 85)));
    const box: any = { before: 0, after: 0, fixed: 0, rounds: 0, left: 0, done: false };

    const steps: Array<{ key: string; label: string; run: (ctx?: JobCtx) => Promise<any> }> = [
      {
        key: 'base',
        label: '基线体检（八项平台判据打分）',
        run: async () => {
          const r = await this.passReview(id);
          box.before = r.score;
          box.after = r.score;
          return `当前 ${r.score} 分（${r.level}）：${r.summary}`;
        },
      },
    ];

    const MAX_ROUNDS = 3;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      steps.push({
        key: `clean${round}`,
        label: `第 ${round} 轮 · 按判据清洗`,
        run: async (ctx) => {
          const rep = await this.passReview(id);
          if (rep.score >= goal) {
            box.done = true;
            return `已达 ${rep.score} 分（目标 ${goal}），提前收工`;
          }
          // 只挑"拖后腿"的章：按分数升序，低的先改
          const list = [...rep.chapters].filter((c) => c.words >= 50).sort((a, b) => a.score - b.score);
          let okThis = 0;
          for (let i = 0; i < list.length; i++) {
            if (ctx) await ctx.note(`第 ${round} 轮 ${i + 1}/${list.length}：第 ${list[i].order} 章《${list[i].title}》（${list[i].score} 分）`);
            const ch: any = chapters.find((c: any) => Number(c.order) === list[i].order);
            if (!ch) continue;
            const res = await this.cleanChapterOnce(id, ch.id, n.chapterWords || 2000);
            if (res.changed) { okThis += 1; box.fixed += 1; }
            // 改完及时看总分，够线就走人（省 AI 额度）
            const now = await this.passReview(id);
            box.after = now.score;
            if (now.score >= goal) break;
          }
          box.rounds = round;
          return `第 ${round} 轮：改写 ${okThis} 章，当前 ${box.after} 分（目标 ${goal}）`;
        },
      });
      steps.push({
        key: `recheck${round}`,
        label: `第 ${round} 轮 · 复检`,
        run: async () => {
          const r = await this.passReview(id);
          box.after = r.score;
          if (r.score >= goal) { box.done = true; return `复检通过：${r.score} 分，已过线`; }
          return `复检：${r.score} 分，距目标还差 ${goal - r.score} 分`;
        },
      });
    }

    steps.push({
      key: 'sum',
      label: '汇总结果',
      run: async () => {
        const r = await this.passReview(id);
        box.after = r.score;
        box.left = r.metrics.filter((m) => !m.pass).length;
        return {
          before: box.before,
          after: box.after,
          fixed: box.fixed,
          rounds: box.rounds,
          done: box.done,
          metrics: r.metrics,
          note: `${box.before} → ${box.after} 分（${r.level}）`
            + (box.done ? '，**已达目标线**' : `，还有 ${box.left} 项不达标`)
            + `；本轮共改写 ${box.fixed} 章。`
            + (box.done ? '' : '可以再点一次「一键过审清洗」继续。'),
        };
      },
    });

    await this.startJob(id, 'passclean', steps);
    return { started: true, total: steps.length, before: box.before };
  }

  /** 打磨黄金前三章（每章最多 2 轮）：定版后单独点，把开篇磨到能直接上架 */
  async startPolishJob(id: string) {
    const n: any = await this.getNovel(id);
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    const golden = chapters.filter((c: any) => Number(c.order) <= 3);
    if (!golden.length) throw new Error('还没有正文，请先定版生成黄金三章');
    return this.startJob(id, 'polish', golden.map((c: any) => ({
      key: `ch${c.order}`,
      label: `打磨第 ${c.order} 章《${stripChapterNo(c.title)}》`,
      run: async () => {
        let note = '';
        for (let r = 1; r <= 2; r++) {
          // 前三章按"黄金三章"标准磨：验证期的曝光全压在这三章上，爽点密度要求更高
          const res = await this.polishChapterOnce(id, c.id, n.chapterWords || 2000, Number(c.order) <= 3);
          note = res.note || '';
          if (!res.changed) break;
          if (/已达标/.test(note)) break;
        }
        return note || '已打磨';
      },
    })));
  }

  /**
   * 按章号去重：同一 order 只保留**最后写入**的那一条，其余删掉。
   * 【实战事故】并发定版 / 中途重出大纲后重复写稿，库里出现 1,1,2,2,3,3 两套章节，
   * 作者看到「实际 3 章、列表显示 6 章」，写稿上下文里同一章号还出现两遍（越写越乱）。
   * @returns 删除的重复章节数
   */
  async dedupeChapters(id: string) {
    const chs = await this.prisma.chapter.findMany({
      where: { novelId: id } as any,
      orderBy: { createdAt: 'asc' },
      select: { id: true, order: true } as any,
    });
    const keep = new Map<number, string>();
    const drop: string[] = [];
    for (const c of chs) {
      const prev = keep.get(c.order);
      if (prev) drop.push(prev); // 同章号：把先写的那条丢掉，留最新稿
      keep.set(c.order, c.id);
    }
    if (drop.length) await this.prisma.chapter.deleteMany({ where: { id: { in: drop } } as any });
    return drop.length;
  }


  async getBible(id: string) {
    const n = await this.getNovel(id);
    return { bibleStatus: n.bibleStatus, bible: n.bible ? JSON.parse(n.bible) : null };
  }

  /**
   * AI 审校：按批把**全书每一章的正文**都过一遍（每批 AUDIT_BATCH 章）。
   *
   * 旧版只把最近 5 章正文喂给 AI，前面章节永远没被看过 ——
   * 于是同一份稿子每次体检都冒出"一批新矛盾"，作者体感就是"永远找不完、越修越多"。
   * 现在全书扫完再汇总，一次把问题找齐。
   */
  private async auditBatchesAI(
    n: any,
    bible: any,
    canon: Canon | null,
    chapters: any[],
    digest: string,
    batches: any[][],
    onProgress?: (done: number, total: number, label: string) => Promise<void> | void,
  ): Promise<{ issues: any[]; summary: string; score: number }> {
    const out: any[] = [];
    const seen = new Set<string>();
    const summaries: string[] = [];
    const scores: number[] = [];
    let idx = 0;
    for (const list of batches) {
      idx += 1;
      if (!list.length) continue;
      const from = list[0].order;
      const to = list[list.length - 1].order;
      if (onProgress) await onProgress(idx, batches.length, `正在核对第 ${from}~${to} 章（${idx}/${batches.length} 批）`);
      const bodies = list
        .map((c) => `第${c.order}章《${stripChapterNo(c.title)}》正文：\n${(c.content || '').slice(0, 2600)}`)
        .join('\n\n');
      const prompt = `你是网文责编，负责「连贯性审校」。下面是作品《${n.title}》的第 ${from}~${to} 章正文（全书共 ${chapters.length} 章），请逐句挑硬伤。
【全书脉络·人物与设定】
${JSON.stringify({ characters: bible.characters || [], coreSetting: bible.coreSetting || '' })}
【事实台账】
${renderCanon(canon, charListOf(bible, n.protagonists))}
【模式锁（重生 / 魂穿 / 穿书）】
${modeLockOf(bible) || '（该题材未设模式锁，若属重生/穿越类请顺带检查模式是否前后一致）'}
【全部章节摘要（用来判断本批正文与前文有没有冲突）】
${digest}
【本批正文·第 ${from} 章 ~ 第 ${to} 章（逐句核对时间与称呼）】
${bodies}

重点排查（有就给，没有别硬凑）：
1) 人名不一致：同一角色写法不同（如 苏晚晴/苏婉晴），或与台账、人物表不符
2) 时间线矛盾：前后时间点冲突（如"两小时内办完"与"昨天买的"并存）、日期倒退
3) 事实冲突：与"已锁死"事实矛盾、死人复活、物品归属错乱、钱物数目前后不一致
4) 伏笔断线：埋了不收、或重复埋设
5) 设定漂移：金手指 / 身份 / 目标与前文不符
6) 章节内容重复：本章大段复述了前面章已经讲过的剧情
7) 重生/穿越模式自相矛盾（重点）：同一部书里不能既"魂穿到别人身上"又写"上一世我在这里……"。
   锁的是 A（重生回自己）时，"上一世我在这坐过牢/吃过亏"成立；
   锁的是 B（魂穿别人身）时，原主的案底、仇家、亲人只能被"知道"，不能被"经历过"——
   写成"上一世我被关了15天"之类即判为高等级硬伤。

要求：quote 必须是**本批正文里逐字摘录**的句子（≤40字），这样后面才能定位回原文；不要报本批之外章节的问题。
**如果你只能概括、在正文里找不出对应的原句，就不要报这一条** —— 程序靠这句原文定位并做定点修复，
给描述（例如"某某为后续剧情埋伏笔"）会导致这条根本改不了，只会反复出现在清单里。
**核对后认为"其实不矛盾 / 无需修改"的，同样不要报** —— issues 里只放"确认是问题 + 给出具体改法"的条目；
fix 必须是可执行的动作（把 A 改成 B / 删除某句 / 补写某句），**不能写"无需修改""保持原样"**。
只输出 JSON：
{"score":0-100,"summary":"这批的一句话总评","issues":[{"level":"高|中|低","type":"人名|时间线|事实|伏笔|设定|模式|重复","chapter":章号数字,"quote":"原文逐字摘录","why":"为什么算矛盾","fix":"怎么改"}]}
确实没问题时 issues 返回空数组。`;
      let parsed: any = {};
      try {
        parsed = tryParseJson(await this.ai.chat(prompt, 180000), ['issues']) || {};
      } catch (e) { parsed = {}; }
      if (parsed.summary) summaries.push(String(parsed.summary));
      if (Number(parsed.score)) scores.push(Number(parsed.score));
      for (const x of (Array.isArray(parsed.issues) ? parsed.issues : [])) {
        if (!x || !x.quote) continue;
        const k = normQuote(x.quote);
        if (k && seen.has(k)) continue; // 同一句话被两批都报，只留一条
        if (k) seen.add(k);
        out.push(x);
      }
      if (out.length >= 80) break; // 上限保护：真出现天文数字就先停下来，别无限烧额度
    }
    return {
      issues: out,
      summary: summaries.slice(0, 3).join(' '),
      score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    };
  }

  /**
   * 【改动处复审】收敛式复检的 AI 部分：**只审"上一轮定点修复改过的那几句话"**。
   *
   * 为什么不重扫整章：整章重扫会连"没动过的地方"一起重新找茬，AI 每次说法都不同，
   * 于是修 A 冒出 B、修 B 冒出 C —— 作者体感就是"永远修不完"。而定点替换保证
   * 改动只发生在被替换的那一句，所以只需要看这几句有没有跟上下文打架即可。
   */
  private async auditSpots(
    n: any,
    bible: any,
    canon: Canon | null,
    chapters: any[],
    marks: Array<{ ch: number; text: string; whole?: boolean }>,
  ): Promise<{ issues: any[]; summary: string }> {
    const byOrder = new Map<number, any>();
    chapters.forEach((c) => byOrder.set(Number(c.order), c));
    const spots = marks
      .filter((m) => m && byOrder.has(Number(m.ch)))
      .slice(-12) // 上限：一轮改动不会太多，超了说明异常
      .map((m) => {
        const c: any = byOrder.get(Number(m.ch));
        const body = String(c.content || '');
        if (m.whole) return `第 ${m.ch} 章（新写的整章）：\n${body.slice(0, 2500)}`;
        const at = body.indexOf(m.text);
        const ctx = at >= 0
          ? body.slice(Math.max(0, at - 220), Math.min(body.length, at + m.text.length + 220))
          : '';
        return ctx ? `第 ${m.ch} 章（刚改动的那一段）：\n${ctx}` : '';
      })
      .filter(Boolean);
    if (!spots.length) return { issues: [], summary: '' };

    const prompt = `你是网文责编，只做一件事：**复核刚改动过的几处文字有没有引出新的矛盾**。
作品《${n.title}》。
【事实台账·不可违反】
${renderCanon(canon, charListOf(bible, n.protagonists))}
【模式锁】${modeLockOf(bible) || '（无）'}
【刚改动过的地方】
${spots.join('\n\n')}

只查这四类 **客观硬伤**（有才报，没有就返回空数组）：
1) 与事实台账 / 人物表冲突（人名、身份、物品归属、已锁死事实）
2) 时间线矛盾（同一处改动与前文时间点打架）
3) 重生/穿越模式自相矛盾
4) 改动处与本段上下文**逐字重复**（同一句话在一小段里出现两遍）

**不要**报"建议""可以更精彩""节奏略慢""伏笔偏多""表述可优化"这类主观意见 —— 这次只找硬伤。
quote 必须能在正文里逐字找到；只能概括、找不出原句的就别报（报了也定位不到、改不了）。
认为"其实不矛盾 / 无需修改"的也别报 —— fix 必须是可执行动作（把 A 改成 B / 删除某句 / 改写某句），不能写"无需修改"。
只输出 JSON：{"summary":"一句话","issues":[{"level":"高|中|低","type":"人名|时间线|事实|伏笔|设定|模式|重复","chapter":章号数字,"quote":"有问题的那一句（≤40字，逐字摘录）","why":"为什么算矛盾","fix":"怎么改"}]}`;

    const parsed = tryParseJson(await this.ai.chat(prompt, 60000), ['issues']) || {};
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
      .filter((x: any) => x && x.quote && Number(x.chapter) > 0);
    return { issues, summary: String(parsed.summary || '') };
  }

  /**
   * 一致性体检：把「人物表 + 事实台账 + 全部章节摘要 + **每一章正文**」交给 AI 逐条挑硬伤
   * （主角改名、女主两种写法、时间线自相矛盾、死人复活、伏笔断线…）。只诊断不自动改。
   */
  /**
   * 只查撞车时用的"撞车结论块"。抽出来是为了让「只查撞车」和「两个都查」共用同一份判据
   * （硬判定压过 AI、命中在榜作品存本地库），避免两条路径结论不一致。
   */
  private async dupBlock(id: string): Promise<any> {
    try {
      const rep = await this.checkDuplicate(id);
      return {
        risk: rep.risk,
        riskNote: rep.riskNote,
        matches: rep.matches || [],
        titleSuggestions: rep.titleSuggestions || [],
        titleChecks: rep.titleChecks || [],
        plotAdvice: rep.plotAdvice || '',
      };
    } catch (e) {
      return null; // 查重失败（网络/额度）不影响体检结果本身
    }
  }

  /** 上一份体检报告（拿旧清单 / 旧撞车结论时用） */
  private prevAudit(n: any): any {
    try { return n && n.auditJson ? JSON.parse(n.auditJson) : null; } catch (e) { return null; }
  }

  async auditConsistency(
    id: string,
    arg: number | AuditOpts = {},
    forceArg = false,
  ) {
    const opt = typeof arg === 'object' && arg !== null ? arg : {};
    const force = opt.force !== undefined ? !!opt.force : forceArg;
    /** 查什么：all（默认，矛盾+撞车）｜consistency（只查矛盾）｜dup（只查撞车） */
    const scope = opt.scope === 'consistency' || opt.scope === 'dup' ? opt.scope : 'all';
    const wantConsistency = scope !== 'dup';
    const wantDup = scope !== 'consistency';
    // 默认全书逐章审（作者要求"一次把问题找完"）；传 full:false 才退回"只看最近几章"的老行为
    const full = opt.full !== false;
    const n = await this.getNovel(id);
    if (!n.bible) throw new Error('请先定版生成《全书脉络》再体检');
    const bible = JSON.parse(n.bible) as any;
    const nn: any = n;
    // 指纹没变就直接复用上次结果：AI 每次抽样不同，同一份稿子连点两次会得到 2 条 / 7 条，
    // 作者会以为"体检乱报"。稿子没改就给他一份稳定的清单。
    const fp = await this.auditFingerprint(id);
    const prevForCache = this.prevAudit(nn);
    // 缓存还要求"查的东西一样"：上次只查了矛盾，这次点「两个都查」必须重算
    const useCache = !force && nn.auditKey === fp && !!nn.auditJson
      && (prevForCache?.scope || 'all') === scope;
    const canon = n.canon ? (JSON.parse(n.canon) as Canon) : null;
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    if (!chapters.length) throw new Error('还没有章节可体检');

    /**
     * 【只查撞车】作者选了它就不重算矛盾：
     * AI 找茬是无界的（"重复""伏笔冗余"这类主观项永远能再找出几条），重算一次就等于
     * 让刚修干净的清单又冒一批。所以矛盾清单**沿用上一份**，这里只刷新撞车结论。
     */
    if (!wantConsistency) {
      const dup = await this.dupBlock(id);
      const prev = prevForCache || {};
      const issues = Array.isArray(prev.issues) ? prev.issues : [];
      const merged: any = {
        ...prev,
        issues,
        dup,
        scope,
        checkedChapters: chapters.length,
        score: scoreOfIssues(issues, dup?.risk || 'low'),
        options: dup && dup.risk !== 'low'
          ? await this.decisionOptions(n, [], dup).catch(() => [])
          : (prev.options || []),
        at: Date.now(),
        cached: false,
      };
      // 刻意不清 editMarksJson：这一轮没审过正文，改动标记要留给下次真正审的时候
      const report = this.tidyAuditReport(merged, chapters);
      await this.prisma.novel.update({
        where: { id },
        data: { auditJson: JSON.stringify(report), auditKey: fp } as any,
      });
      return { ...report, cached: false };
    }

    if (useCache) {
      try {
        // 缓存命中也要过一遍分组收尾，否则分组口径和实时算的不一致
        // （会出现"显示 4 处可自动修、点下去 2 处找不到原句"）
        return { ...this.tidyAuditReport(JSON.parse(nn.auditJson), chapters), cached: true };
      } catch (e) { /* 旧数据坏了就重算 */ }
    }

    const digest = chapters.map((c) => `第${c.order}章《${stripChapterNo(c.title)}》摘要：${c.summary || '（无）'}`).join('\n');
    // 已经修掉的不再重复报：不然作者修完一条，"重新体检"又把它捞回来（越修越多的元凶之一）
    const resolved = await this.loadResolved(id);
    const fresh = (x: any) => {
      const k = normQuote(x && x.quote);
      return !(k.length >= 4 && resolved.has(k));
    };
    /**
     * 【两种体检口径】
     *   ① 全量（首次体检 / 作者点「全书重新审一遍」）：AI 逐章审全书，把问题一次找齐。
     *   ② 收敛（默认，已有清单时走这条）：**代码复检旧清单 + AI 只审改动过的那几句话**。
     *
     * 为什么必须有②：作者实测 5→7→5→3→7→4 永远修不完。根因是"每修一次 → 该章正文变了 →
     * 按章冻结失效 → 下一轮对它做全新的全书 AI 审校 → 换一批新说法"。而 AI 找茬本身是无界的
     * （"重复""伏笔冗余"这类主观项，它永远能再找出几条）。改成收敛口径后，
     * 清单只会因为"真的修掉了"而变短，新增只可能来自刚改过的地方 —— 这才收敛得下来。
     */
    const incremental = !!nn.auditJson && !force && !opt.fullScan;
    const aiIssues: any[] = [];
    let mergedSummary = '';
    let mergedScore = 0;
    let clearedThisRound = 0;
    let spotCount = 0;
    if (incremental) {
      const marks = await this.editMarks(id);
      spotCount = marks.length;
      if (marks.length) {
        const spot = await this.auditSpots(n, bible, canon, chapters, marks)
          .catch(() => ({ issues: [] as any[], summary: '' }));
        spot.issues.forEach((x: any) => aiIssues.push({ ...x, hard: false, needHuman: isHumanIssue(x) }));
        mergedSummary = spot.summary || '';
      }
    } else {
      const batches = full
        ? chunkArr(chapters, AUDIT_BATCH)
        : [chapters.slice(-Math.max(1, typeof arg === 'number' ? arg : 5))];
      const r = await this.auditBatchesAI(n, bible, canon, chapters, digest, batches, opt.onProgress);
      r.issues.forEach((x: any) => aiIssues.push({ ...x, hard: false, needHuman: isHumanIssue(x) }));
      mergedSummary = r.summary || '';
      mergedScore = r.score || 0;
    }
    // 硬伤放前面：这部分是代码判定的，稳定可复现；AI 语义问题排后面
    const hard = this.hardIssues(n, bible, chapters).filter(fresh).map((x) => ({ ...x, needHuman: isHumanIssue(x) }));
    // 按「等级 → 章号」排序，作者一眼能看到最该先处理的；
    // 并分成两组：程序能直接改的（autoFix）与必须作者拍板的（human）
    const RANK: Record<string, number> = { 高: 0, 中: 1, 低: 2 };
    /** 章正文指纹：用来判断"这一章后来有没有改过"（没改过的章沿用上一轮判定，清单才稳定） */
    const hashOf = (s: string) => {
      let h = 0;
      const t = String(s || '');
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
      return `${t.length}.${h.toString(36)}`;
    };
    let prevIssues: any[] = [];
    let prevHashes: Record<string, string> = {};
    try {
      const prev = nn.auditJson ? JSON.parse(nn.auditJson) : null;
      prevIssues = prev && Array.isArray(prev.issues) ? prev.issues : [];
      prevHashes = (prev && prev.chHashes) || {};
    } catch (e) { prevIssues = []; prevHashes = {}; }

    /**
     * 去重 + 过滤已修。用宽松相似度：AI 两次摘录同一句话时长度常不一致，
     * 只比字符串会出现"同一句话在清单里挂两条"。
     */
    const dedupe = (list: any[]) => {
      const out: any[] = [];
      for (const x of list) {
        const k = normQuote(x && x.quote);
        if (!k || k.length < 4) continue;
        if (resolved.has(k)) continue;
        if (out.some((y) => normQuote(y.quote) === k || diceSimilar(y.quote, x.quote) >= 0.82)) continue;
        out.push(x);
      }
      return out;
    };

    const thisRound = dedupe([...hard, ...aiIssues]);
    const roundByCh = new Map<number, any[]>();
    const globalIssues: any[] = [];
    thisRound.forEach((x: any) => {
      const k = Number(x.chapter);
      if (k > 0) roundByCh.set(k, (roundByCh.get(k) || []).concat([x]));
      else globalIssues.push(x); // 全书级问题（如"人物表里的人全文没出现"）没有章号
    });

    const frozenUsed: any[] = [];
    const chHashes: Record<string, string> = {};
    const byOrder = new Map<number, any>();
    chapters.forEach((c) => byOrder.set(Number(c.order), c));
    /**
     * 【代码复检】旧清单逐条判"还在不在"，不烧 AI：
     *   · 已修账本里有 → 划掉
     *   · 原文在正文里已经找不到了（我们用的是定点替换，改过的那句一定不一样）→ 视为已修，划掉
     *   · 原文还在 → 继续挂着（legacy）
     * 阈值取 0.9：相似度低于它说明这句已经被改写过了，不再是同一句。
     */
    const recheck = (c: any) => prevIssues
      .filter((p: any) => Number(p.chapter) === Number(c.order))
      .filter((p: any) => !resolved.has(normQuote(p.quote)))
      .filter((p: any) => {
        const l = locateQuote(String(c.content || ''), p.quote);
        return !!l && l.score >= 0.9;
      })
      .map((p: any) => ({ ...p, legacy: true }));

    chapters.forEach((c) => {
      const order = Number(c.order);
      const h = hashOf(c.content);
      chHashes[order] = h;
      const roundList = roundByCh.get(order) || [];
      if (incremental) {
        const prevForCh = prevIssues.filter((p: any) => Number(p.chapter) === order);
        const kept = recheck(c);
        clearedThisRound += Math.max(0, prevForCh.length - kept.length);
        frozenUsed.push(...dedupe([...kept, ...roundList]));
        return;
      }
      // 全量口径（按章冻结）：这一章正文没改动过就沿用上一轮判定，只有真改过的章才采纳 AI 的新说法。
      // 老数据没有 chHashes（undefined）→ 不会冻结，正好借这次重算把基准建起来
      const frozen = prevHashes[order] === h;
      if (!frozen) {
        frozenUsed.push(...roundList);
        return;
      }
      frozenUsed.push(...dedupe(
        prevIssues.filter((p: any) => Number(p.chapter) === order).map((p: any) => ({ ...p, legacy: true })),
      ));
    });
    // 全书级问题同样要沿用没解决的
    if (incremental) {
      globalIssues.push(...dedupe(prevIssues
        .filter((p: any) => !(Number(p.chapter) > 0))
        .filter((p: any) => !resolved.has(normQuote(p.quote)))
        .map((p: any) => ({ ...p, legacy: true }))));
    }

    let issues = [...frozenUsed, ...globalIssues];
    issues = issues.sort((a: any, b: any) => {
      const r = (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3);
      return r !== 0 ? r : Number(a.chapter || 0) - Number(b.chapter || 0);
    });
    // 给每条盖上"所在章正文指纹"，下一轮靠它判断这一章有没有被改过
    issues.forEach((x: any) => { x.chHash = chHashes[Number(x.chapter)] || ''; });
    // 脉络为空的老作品：体检只能做"章节之间互相比对"，没有大纲参照物，必须提醒作者先补大纲
    const noAxis = !this.hasVolumes(bible);
    // 一键体检顺带做撞车比对：查重和一致性一样属于"发布前必查"，分开点两次没道理。
    // 顺带结果已落库到 novel.dupReport，向导页下次打开也能直接用。
    // 作者选了「只查矛盾」就不联网 —— 撞车是书名级的事，不必每次都等检索。
    const dup: any = wantDup ? await this.dupBlock(id) : (this.prevAudit(nn)?.dup ?? null);
    // 「重生模式选哪种」「要不要换名」这类没有唯一答案 —— 不能瞎改，但也不能只丢给作者一句"你自己定"。
    // 让 AI 给 2-3 个方向、标明推荐哪个以及为什么，作者点一下就能执行。
    const humanIssues = issues.filter((x: any) => x.needHuman);
    const options = humanIssues.length || (dup && dup.risk !== 'low')
      ? await this.decisionOptions(n, humanIssues, dup).catch(() => [])
      : [];

    const result = {
      // 分数由"还剩多少矛盾"直接推出：修一条就 +N 分（详见 scoreOfIssues）
      score: scoreOfIssues(issues, dup?.risk || 'low'),
      aiScore: Number(mergedScore) || 0, // AI 的整体印象分，仅供参考（不参与加减）
      summary: noAxis
        ? `⚠ 这部作品的《全书脉络》是空的（老数据），本次只做了章节之间的互相比对，没有大纲作参照。建议先重新定版生成大纲与分卷时间线，再按新中轴线重起章节。${mergedSummary || ''}`
        : (mergedSummary || (incremental
          ? `复检完成：核验旧清单，清掉 ${clearedThisRound} 条${spotCount ? `；另外复审了刚改动过的 ${spotCount} 处` : ''}。`
          : '')),
      checkedChapters: chapters.length,
      noAxis,
      issues,
      dup,
      hardCount: hard.length,
      aiCount: aiIssues.length,
      options, // 「重生模式选哪种」这类需要作者拍板的方向选项
      resolvedCount: clearedThisRound, // 本轮清掉了多少条（旧清单里"原文已不复存在"的 + 已修账本命中的）
      incremental, // true = 收敛式复检（没全书重扫）；前端据此提示"想全书重审点这里"
      scope, // 本次查了什么：all / consistency / dup（只查矛盾时 dup 用的是上一份结论）
      chHashes, // 各章正文指纹：下次体检据此判断哪些章没动过（没动过的沿用本轮判定）
      at: Date.now(),
      cached: false,
    };
    // 收尾：分组（可自动修 / 需你拍板）由 tidyAuditReport 统一算，缓存命中时也走同一套
    const finalReport = this.tidyAuditReport(result, chapters);
    // 落库 + 记指纹：退出小程序再进来还能看到"上次体检 N 处未解决"，也是角标提醒的数据来源
    // 同时清掉"改动标记"：这些改动处刚审过，不必下一轮再审一遍（否则又变成反复找茬）
    await this.prisma.novel.update({
      where: { id },
      data: { auditJson: JSON.stringify(finalReport), auditKey: fp, editMarksJson: null } as any,
    });
    return finalReport;
  }

  /**
   * 体检报告收尾：算出 autoFix / human / fixableCount 三块，并识别"AI 只给了描述、正文里定位不到原句"
   * 的条目（改不了，归到「需你拍板」）。
   *
   * 为什么单独抽出来：缓存命中的那份报告是上一轮存的，如果不经过这里，分组口径就和实时算的不一致
   * （出现"显示 4 处可自动修、点下去 2 处找不到原句"）。
   */
  private tidyAuditReport(r: any, chapters: any[]): any {
    /**
     * 先剔掉"结论是不用动"的伪矛盾。
     *
     * AI 逐句核对时偶尔会把分析过程也当结论输出（why 里论证一圈、结尾写"不报"，
     * fix 写"无需修改"）。留着它的后果：白扣一次分 + 清单里多一条永远点不动的"修这条"，
     * 作者体感就是"永远修不完"（2026-10-08 作者指出：无需改动就不是矛盾，不该列出来）。
     * 放在收尾里做，是因为这条路径同时覆盖实时体检、缓存命中和读回旧报告 ——
     * 已经存在的老清单也会立刻变干净，不必重跑 AI。
     */
    const byOrder = new Map<number, any>();
    chapters.forEach((c) => byOrder.set(Number(c.order), c));

    /**
     * 再剔掉「旧写法残留」里的**误命中**条目。
     *
     * 实测：`陈建国眉头一皱` 里能数出 1 处「建国眉」（正确人名的后半截 + 后边一个字），
     * 于是清单挂着"第 4 章还有 1 处「建国眉」"，点修就把「眉」删掉、正文变 `陈陈建国头一皱`。
     * 这类条目改法写得斩钉截铁（"代码直接改，不用 AI"），实际一改就坏，是清单里最毒的一类。
     * 判据与扫描端一致（countResidual）：真残留数为 0 就是误命中，直接剔掉。
     * 放在这里同样是"一处修改、已经存下来的老清单立刻生效"。
     */
    const isFalseResidual = (x: any): boolean => {
      const dep = String((x && x.deprecated) || '');
      if (!dep || dep.length < 2 || !(Number(x.chapter) > 0)) return false;
      const c = byOrder.get(Number(x.chapter));
      if (!c) return false;
      return countResidual(String(c.content || ''), dep, String(x.to || '')) === 0;
    };

    const raw = Array.isArray(r.issues) ? r.issues : [];
    const kept = raw.filter((x: any) => !isNonIssue(x) && !isFalseResidual(x));
    if (kept.length !== raw.length) {
      const risk = (r.dup || {}).risk || 'low';
      // 分数按"扣分制差值"平移：老报告存的是 AI 印象分，直接换算法会"修好反而降分"
      const detBefore = scoreOfIssues(raw, risk);
      const offset = (Number(r.score) || detBefore) - detBefore;
      r.issues = kept;
      r.score = Math.max(0, Math.min(100, scoreOfIssues(kept, risk) + offset));
      r.droppedNotIssue = (Number(r.droppedNotIssue) || 0) + (raw.length - kept.length);
    }

    (r.issues || []).forEach((x: any) => {
      /**
       * 「旧写法残留」类**不靠定位原句**：它走的是重命名映射表（`deprecated → to`，全书一次换干净）。
       * 以前一律按"能不能在正文里找到 quote"判，这类条目的 quote 是「第 4 章还有 1 处「陈陈建」」
       * 这种统计说明、正文里当然找不到 → 被判 unlocatable、踢出"可自动修"，
       * 作者看到的就是"改法明明写着『代码直接改』，却点不动"。
       *
       * 这里**必须主动清掉旧标记**：误判结果会随报告一起存进 auditJson，
       * 只加"跳过"的话读回来仍是老样子（历史报告永远修不掉）。
       */
      if (x.deprecated) {
        x.unlocatable = false;
        x.needHuman = false;
        x.why = String(x.why || '').replace(/^\[这条没给正文原句[^\]]*\]\s*/, '');
        return;
      }
      if (!(Number(x.chapter) > 0) || x.unlocatable) return;
      const c = byOrder.get(Number(x.chapter));
      if (c && !locateQuote(String(c.content || ''), x.quote)) {
        x.unlocatable = true;
        x.needHuman = true;
        x.why = `[这条没给正文原句，程序定位不到、改不了] ${x.why || ''}`;
      }
    });
    const issues = r.issues || [];
    const auto = (x: any) => !x.needHuman && !x.unlocatable && Number(x.chapter) > 0;
    r.autoFix = issues.filter(auto);
    r.human = issues.filter((x: any) => !auto(x));
    r.fixableCount = r.autoFix.length;
    r.unlocatableCount = issues.filter((x: any) => x.unlocatable).length;
    return r;
  }

  /**
   * 把清单里"含这段文字"的条目一次全划掉。
   * 人名统一改了整章的写法，同一章可能挂着好几条同源问题 —— 一条条划不现实。
   */
  private async resolveIssuesLike(id: string, text: string) {
    const n: any = await this.getNovel(id);
    if (!n.auditJson || !text || text.length < 2) return;
    let data: any;
    try { data = JSON.parse(n.auditJson); } catch (e) { return; }
    const same = (x: any) => String((x && x.quote) || '').includes(text);
    const removed = (data.issues || []).filter(same);
    if (!removed.length) return;
    const before = (data.issues || []).length;
    data.issues = (data.issues || []).filter((x: any) => !same(x));
    data.autoFix = (data.autoFix || []).filter((x: any) => !same(x));
    data.human = (data.human || []).filter((x: any) => !same(x));
    data.options = (data.options || []).filter((x: any) => !same(x));
    data.resolvedCount = (Number(data.resolvedCount) || 0) + (before - data.issues.length);
    // 分数同样保留旧基准偏移量（老报告是 AI 印象分，直接换扣分制会"修好反而降分"）
    const risk = (data.dup || {}).risk || 'low';
    const detBefore = scoreOfIssues((data.issues || []).concat(removed), risk);
    const offset = (Number(data.score) || detBefore) - detBefore;
    data.score = Math.max(0, Math.min(100, scoreOfIssues(data.issues, risk) + offset));
    data.fixableCount = (data.autoFix || []).length;
    await this.prisma.novel.update({
      where: { id },
      data: { auditJson: JSON.stringify(data) } as any,
    }).catch(() => undefined);
  }

  /** 已修矛盾账本：修过的不再重复报（否则"修完又冒出同一批"） */
  private async loadResolved(id: string): Promise<Set<string>> {
    const n: any = await this.prisma.novel.findUnique({
      where: { id },
      select: { resolvedQuotes: true } as any,
    });
    try {
      const arr = JSON.parse((n && n.resolvedQuotes) || '[]');
      return new Set(Array.isArray(arr) ? arr.map((x: any) => String(x)) : []);
    } catch (e) {
      return new Set();
    }
  }

  private async markResolved(id: string, quote: string) {
    const key = normQuote(quote);
    if (key.length < 4) return;
    const set = await this.loadResolved(id);
    set.add(key);
    await this.prisma.novel.update({
      where: { id },
      data: { resolvedQuotes: JSON.stringify([...set].slice(-600)) } as any, // 留最近 600 条，别无限涨
    }).catch(() => undefined);
  }

  /**
   * 【人名统一】人名类问题不能"只改摘录那一句"。
   *
   * 实测踩坑：清单报"第1章 王建国"，只改那一处 → 同一章里"王建国"和"李建国"并存，
   * 下一轮体检立刻多出 3 条人名问题 —— 这正是"越修越多"的另一种形态。
   * 这类问题的正确做法是**批量替换**：按人物表的标准写法把全章的异写一次统一掉。
   * 全是本地字符串运算，0 AI 成本、结果确定。
   */
  private async unifyName(id: string, chId: string, issue: any) {
    const n: any = await this.getNovel(id);
    const bible = n.bible ? JSON.parse(n.bible) : {};
    const ch: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (!ch || !ch.content) return { ok: false, reason: '章节不存在或还没有正文' };
    const quote = String(issue.quote || '');
    const names = charListOf(bible, n.protagonists)
      .map((c: any) => String(c.name || '').trim())
      .filter((x: string) => x.length >= 2 && x.length <= 4);
    if (!names.length) return { ok: false, reason: '' }; // 没有人物表，交回默认的单句流程

    // 人名候选的净化规则（提取异写、挑选正字都用它）
    const STOP = /[的了着过是在和与就都也还又把被让给从到对向为以而但却已将会能要说看想去来]/;
    const looksLikeName = (w: string) => /^[\u4e00-\u9fa5]+$/.test(w) && !STOP.test(w);

    // 在摘录里找一个"与人物表某个名字高度相似、但不是它"的词：它就是异写
    // 【坑·已修】滑窗会切出 `陈建国眉头一皱` 里的「建国眉」—— 它只是正确人名的后半截 + 后边一个字，
    // 相似度同样 0.5，于是被当成异写、`建国眉 → 陈建国` 全书替换，正文变成 `陈陈建国头一皱`
    // （"眉"被吃掉）。凡落在正确写法内部的窗口一律不算异写。
    let bad = '';
    for (const nm of names) {
      const L = nm.length;
      for (let i = 0; i + L <= quote.length; i++) {
        const win = quote.slice(i, i + L);
        if (win === nm || insideCorrectName(quote, i, nm)) continue;
        if (looksLikeName(win) && diceSimilar(win, nm) >= 0.5) { bad = win; break; }
      }
      if (bad) break;
    }
    if (!bad) return { ok: false, reason: '' };

    /**
     * 统一成哪个写法？**只认正文里已经出现过的相似写法**（作者自己用过的那个才是"正字"）。
     *
     * 【坑·已修】早先版本从人物表里挑最相似的，结果把班主任"王建国"统一成了"陈建国" ——
     * 而人物表里"陈建国"是**导师**，班主任和导师同名，比原来的问题更糟。
     * 正文里一个别的写法都没有时，说明这需要另起新名，不是"统一"能解决的，
     * 交回单句流程（或由作者拍板）。
     */
    const L = bad.length;
    /**
     * 候选必须是「像人名」的词：与异写等长、纯汉字、不含虚词。
     * 【坑·已修】不加这层过滤时，滑动窗口会切出"建国的"（来自"王建国的吼声"），
     * 它与"王建国"的相似度同样是 0.5，结果把整章的"王建国"替换成了"建国的"——
     * 正文被毁得比原问题更厉害。所以人名候选里出现"的/了/着"这类虚词一律排除。
     */
    const counts = new Map<string, number>();
    for (let i = 0; i + L <= ch.content.length; i++) {
      const win = ch.content.slice(i, i + L);
      if (win === bad || !looksLikeName(win)) continue;
      if (names.some((nm: string) => insideCorrectName(ch.content, i, nm))) continue; // 同上：正确人名的一部分不能当"正字"
      if (diceSimilar(win, bad) < 0.5) continue;
      counts.set(win, (counts.get(win) || 0) + 1);
    }
    let good = '';
    let best = 0;
    counts.forEach((c, k) => { if (c > best) { best = c; good = k; } });
    if (!good) return { ok: false, reason: '' };

    /**
     * 【全书统一替换】不只摘录那一处、也不只这一章。
     * 错写法在其他章里同样存在时，只改一章 = 给下一轮留新问题（实测就是这么循环起来的）。
     */
    const cnt = ch.content.split(bad).length - 1;
    if (cnt < 1) return { ok: false, reason: '' };
    // 保险：替换点太多说明判据可能选错了词（正文字被大面积改写），宁可不动
    if (cnt > 30) return { ok: false, reason: '' };
    const total = await this.renameEverywhere(id, bad, good);
    if (total < 1) return { ok: false, reason: '' };
    // 把该章所有涉及这个异写的清单条目一次划掉（不然改完清单里还挂着几条）
    await this.markResolved(id, quote);
    await this.resolveIssuesLike(id, bad).catch(() => undefined);
    return {
      ok: true,
      quote,
      chapter: ch.order,
      oldText: bad,
      newText: `${good}（全书统一 ${total} 处）`,
      gain: PATCH_GAIN[issue.level] || 2,
    };
  }

  /**
   * 【定点修复】只改这一句话，正文其余部分一个字节都不动。
   *
   * 为什么废弃"整章重写"：以前一条矛盾也丢给 AI 重写整章，AI 会顺手改动几十句，
   * 于是「修一处、冒出三处」，作者被迫无限循环（实测 60 处 → 修完 99 处）。
   * 改成手术式替换后，AI 只输出「改后的那一句」，服务端在原句位置精确替换 ——
   * 结构上就不可能引入新矛盾。
   */
  async patchIssue(id: string, chId: string, issue: any) {
    const n: any = await this.getNovel(id);
    const ch: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (!ch || !ch.content) throw new Error('章节不存在或还没有正文');
    const quote = String((issue && issue.quote) || '').trim();
    if (!quote || quote.startsWith('章名：')) throw new Error('这条不是正文里的问题，无法定点修复');

    // ⓪ 这条涉及"已经统一过的旧写法"？直接按映射表全书替换，0 AI 成本。
    //    批量修复时同一来源的几条会接连命中这里 —— 第一遍就把全书换干净，后面几条自然无残留，
    //    不会再出现"改完一条、下一轮又冒一条"的循环。
    const ren = await this.renamedMap(id);
    const dep = String(issue.deprecated || '').trim();
    const hitDep = dep || Object.keys(ren).find((k) => k.length >= 2 && quote.includes(k)) || '';
    if (hitDep) {
      const to = ren[hitDep] !== undefined ? ren[hitDep] : String(issue.to || '');
      const cnt = await this.renameEverywhere(id, hitDep, to);
      await this.markResolved(id, quote);
      await this.resolveIssuesLike(id, hitDep).catch(() => undefined);
      return {
        ok: true,
        quote,
        chapter: ch.order,
        oldText: hitDep,
        newText: cnt > 0 ? `全书统一 ${hitDep} → ${to || '删除'}（共 ${cnt} 处）` : `「${hitDep}」全书已无残留（前一步已统一）`,
        gain: cnt > 0 ? (PATCH_GAIN[issue.level] || 2) : 0,
      };
    }

    // 人名类先走"全章统一替换"：只改一处会让同一章里两种写法并存，下一轮反而多出几条
    if (String(issue.type || '') === '人名') {
      const u: any = await this.unifyName(id, chId, issue).catch(() => null);
      if (u && u.ok) return u;
    }

    /**
     * 「重复」类要改的是**后出现的那一处**。
     *
     * 通用定位给的是第一处，而重复类的症状是"同一句在本章出现了两三次"——
     * 改第一处等于没改：后面那处还在，复检照样报（作者看到的就是"这条怎么都修不掉"）。
     * 所以这里先把所有出现位置找出来，命中两处以上就锁定最后一处。
     */
    const isDup = isDupIssue(issue);
    let hit: { start: number; end: number; score?: number } | null = locateQuote(ch.content, quote);
    const spots = isDup ? allQuoteSpots(ch.content, quote) : [];
    if (spots.length >= 2) hit = spots[spots.length - 1];
    if (!hit) return { ok: false, reason: '正文里找不到这句话（可能已经被改掉了）', quote };

    const oldText = ch.content.slice(hit.start, hit.end);

    /**
     * 「重复」类先走代码去重，不用问 AI。
     *
     * 这类条目交给 AI"改写这一句"它多半原样退回（这句本身没写错），通用流程的
     * "改后不能与原文相同"门槛就把整条判死 —— 作者看到的就是"这条怎么都修不掉"。
     * 代码能做对的事不交给模型（也不烧额度）。
     *
     * 范围取**命中处所在整段**，而不是只收敛命中那一句：实测同一段里常挨着两处同源重复，
     * 只改一处的话作者会看到"修过了但还重复"，复检又冒出新的那条。
     */
    if (isDup) {
      const pStart = ch.content.lastIndexOf('\n', Math.max(0, hit.start - 1)) + 1;
      const win = ch.content.slice(pStart, hit.end);
      const deduped = dedupeAdjacentSegments(win);
      if (deduped !== win) {
        const c2 = ch.content.slice(0, pStart) + deduped + ch.content.slice(hit.end);
        await this.prisma.chapter.update({ where: { id: chId }, data: { content: c2 } as any });
        const back: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
        if (String(back.content || '') !== c2) {
          await this.prisma.chapter.update({ where: { id: chId }, data: { content: ch.content } as any }).catch(() => undefined);
          return { ok: false, reason: '写入后校验不通过，已还原', quote };
        }
        await this.markResolved(id, quote);
        await this.resolveIssuesLike(id, quote).catch(() => undefined);
        return { ok: true, quote, chapter: ch.order, oldText: win, newText: deduped, gain: PATCH_GAIN[issue.level] || 2 };
      }
    }

    const bible = n.bible ? JSON.parse(n.bible) : {};
    const canon = n.canon ? (JSON.parse(n.canon) as Canon) : null;
    const prompt = `你是网文责编，做一次「最小改动」的文字手术。
作品《${n.title}》第 ${ch.order} 章《${stripChapterNo(ch.title)}》。
=== 事实台账·不可违反 ===
${renderCanon(canon, charListOf(bible, n.protagonists))}
=== 待修的这句话（原文逐字） ===
${oldText}
=== 为什么算矛盾 ===
${issue.why || '（未说明）'}
=== 改法 ===
${isDup && spots.length >= 2 ? `${issue.fix || ''}（重要：这句话在本章出现了 ${spots.length} 次，你现在改的是**最后出现的那一处**。请换一种说法表达同样的信息 —— 调换语序、换同义词、换个叙述角度都行，但不要删掉信息、不要新增剧情。改后必须与原文明显不同，否则读者仍会觉得重复。）` : (issue.fix || '（未说明）')}
=== 这句话的上下文（仅供理解，不要复述） ===
${ch.content.slice(Math.max(0, hit.start - 150), Math.min(ch.content.length, hit.end + 260))}

硬性要求：
1) 只改上面那一句（可拆成两小句），叙述视角、人称、人名写法一律沿用原文；
2) 改后长度与原文相当（原句的 80%-150%），只把矛盾的地方改对，不要增删信息；
3) **改后必须与上下文自然衔接**：不能和后文已有的表达重复（例如后文已写"放学回家翻出集邮册"，
   就不要把这一句也改成"放学回家确认"），也不要提前说掉后文要讲的事；
4) 不要复述上下文，不要输出解释，不要用引号/书名号包裹，不要 markdown；
5) 与原文一字不差视为不合格 —— 必须真的把矛盾改掉；
6) **如果"改法"就是删掉这一句，new 直接返回空字符串 ""**（服务端会把这一句连同多余的标点一起删掉）。
只输出 JSON：{"new":"改后的那一句"}`;

    let out = '';
    try {
      const parsed = tryParseJson(await this.ai.chat(prompt, 90000), ['new']) || {};
      out = String(parsed.new || '').trim();
    } catch (e) { out = ''; }
    out = out.replace(/^[《【「"'“”]+/, '').replace(/[》】」"'“”]+$/, '').trim();

    /**
     * 去掉"与上下文重叠的一截"。
     *
     * AI 有时会把 quote **之外**的前半句也一起返回：实测只让它改「塞进裤兜，塞进裤兜。」，
     * 它返回了整句「林墨把上章收到的校门口威胁短信截图塞进裤兜。」→ 直接拼上去就变成
     * 「…威胁短信截图林墨把…威胁短信截图塞进裤兜。」，凭空多出一整截（作者看到的就是"越修越乱"）。
     * 解法：返回内容的头若与左侧已有文字重合，就去掉重合部分；尾部同理。
     */
    const leftCtx = ch.content.slice(0, hit.start);
    const rightCtx = ch.content.slice(hit.end);
    for (let k = Math.min(out.length, 80); k >= 4; k--) {
      if (leftCtx.endsWith(out.slice(0, k))) { out = out.slice(k).trim(); break; }
    }
    for (let k = Math.min(out.length, 80); k >= 4; k--) {
      if (out.length > k && rightCtx.startsWith(out.slice(out.length - k))) {
        out = out.slice(0, out.length - k).trim();
        break;
      }
    }

    /**
     * 验收门槛：宁可不改，也不能把正文改坏。
     *
     * 【坑·已修】"删除型"改法（如"保留 1 次该伏笔即可，删除其余重复内容"）以前必然失败 ——
     * 空结果被当成"AI 没给内容"，那条永远修不掉，作者看到的就是"这条没改成"反复出现。
     * 现在按改法判定：改法里写了删除，就允许 new 为空（= 删掉这一句）。
     */
    // 改法里出现"删/精简/去重"这类字样就允许 new 为空（= 删掉这一句）。
    // 「删减」「仅保留…」以前不在词表里 → AI 返回空被判"没给改后的句子"，重复类条目因此永远修不掉。
    const canDelete = /删除|删掉|删去|去掉|移除|删减|精简|去重|压缩|合并|收敛|仅保留|只保留/.test(`${issue.fix || ''}${issue.why || ''}`);
    if (!out && !canDelete) return { ok: false, reason: 'AI 没给出改后的句子，这条没动', quote };
    if (out) {
      // 重复类要求"真的换了说法"：门槛比通用类严（0.9 而不是 0.97），
      // 因为只改一两个字时读者仍会觉得是重复，问题没解决
      const sameLimit = isDup ? 0.9 : 0.97;
      if (diceSimilar(out, oldText) > sameLimit) {
        return { ok: false, reason: isDup ? 'AI 只是改了个别字，重复感还在，已放弃' : 'AI 返回的内容与原文一样，等于没改', quote };
      }
      if (out.length > Math.max(60, oldText.length * 3)) return { ok: false, reason: 'AI 返回的远超这一句（会破坏正文），已丢弃', quote };
      if (out.length < Math.max(4, oldText.length * 0.35)) return { ok: false, reason: 'AI 返回的句子过短，已丢弃', quote };
    }

    let content = ch.content.slice(0, hit.start) + out + ch.content.slice(hit.end);
    // 删除型：接缝处左右都是标点的话，去掉左边那个，避免出现"，。"这种断句
    if (!out && /[，、。！？；：]/.test(content.slice(hit.start - 1, hit.start))
      && /[，、。！？；：]/.test(content.slice(hit.start, hit.start + 1))) {
      content = content.slice(0, hit.start - 1) + content.slice(hit.start);
    }
    await this.prisma.chapter.update({ where: { id: chId }, data: { content } as any });
    /**
     * 写后回读验收 —— 直接治"说改了其实没改"。
     * 【坑·已修】以前判"旧句不在"用的是 `!after.includes(oldText)`，
     * 而"重复"类问题按定义就是同一句话出现两次 → 改掉一处后另一处还在 → 校验判失败 → 整条回滚。
     * 作者看到的一直是"写入后校验不通过，已还原"，那条永远修不掉。
     * 现在改成比对**整段正文是否等于我们要写入的内容**，精确且不受重复句影响。
     */
    const after: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (String(after.content || '') !== content) {
      await this.prisma.chapter.update({ where: { id: chId }, data: { content: ch.content } as any }).catch(() => undefined);
      return { ok: false, reason: '写入后校验不通过，已还原', quote };
    }
    await this.markResolved(id, quote);
    // 注意：这里**不清 auditKey**。清掉会让前端下次读体检直接全量重算 AI 一遍，
    // 而 AI 换一批说法就变成"刚修完又冒出一批"，作者体感就是"修不完"。
    // 清单的增减交给 resolveAuditIssue 逐条划账（原清单 − 已修 = 剩余）；
    // 真正要复核时作者点「重新体检」，那时走的是收敛式复检。
    //
    // 【改名传播】比一比"改前 / 改后"的中间差异段：如果换掉的是一个像人名/称谓的词，
    // 就记进映射表并在全书统一 —— 否则同一个错写法会在别的句子里继续冒出来（实测的 5→3→5 死循环）。
    let extra = '';
    const d = midDiff(oldText, out);
    const nameish = String(issue.type || '') === '人名'
      || /人名|名字|姓名|称呼|统一|同一角色/.test(`${issue.why || ''}${issue.fix || ''}`);
    if (nameish && looksLikeName(d.a)) {
      const target = looksLikeName(d.b) ? d.b : '';
      // 删除型（改后这一小段为空）风险大："任李建说"→"说" 会毁句。
      // 只在全书出现次数很少时才敢删；否则只记录不动手，交给下一轮的具体句子处理。
      const capable = target || (await this.countEverywhere(id, d.a)) <= 4;
      const tot = capable ? await this.renameEverywhere(id, d.a, target) : 0;
      if (tot > 0) extra = `；全书另外 ${tot} 处「${d.a}」已一并改为「${target || '删除'}」`;
    }
    await this.pushEditMark(id, ch.order, out);
    return { ok: true, quote, chapter: ch.order, oldText, newText: (out || '（已删除该句）') + extra, gain: PATCH_GAIN[issue.level] || 2 };
  }

  /** 全书范围内某段文字出现多少次（改名传播前用来判断"删除型替换"敢不敢做） */
  private async countEverywhere(id: string, text: string): Promise<number> {
    const t = String(text || '');
    if (t.length < 2) return 0;
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id } as any,
      select: { content: true } as any,
    });
    return chapters.reduce((s, c: any) => s + String(c.content || '').split(t).length - 1, 0);
  }

  /**
   * 【清旧账】作品被整体重做（换名 / 重出大纲 / 重建脉络 / 重写章节）之后，
   * 上一版稿子的体检结果就全是陈年旧账了（出现过"整部都重写了，资料页还挂着 125 处未修"）。
   * 一律清掉：角标消失，下次体检重新打分。
   */
  private async clearAudit(id: string) {
    await this.prisma.novel.update({
      where: { id },
      // resolvedQuotes / renamedJson / editMarks 也要一并清：整部重做之后，上一版的账本早就不成立了
      data: { auditJson: null, auditKey: null, resolvedQuotes: null, renamedJson: null, editMarksJson: null } as any,
    }).catch(() => undefined);
  }

  /** 已统一过的写法映射：{"任李建":"班主任"} —— 全书残留只要还有，就一定能被硬扫出来 */
  private async renamedMap(id: string): Promise<Record<string, string>> {
    const n: any = await this.prisma.novel.findUnique({
      where: { id },
      select: { renamedJson: true } as any,
    });
    try {
      const o = JSON.parse((n && n.renamedJson) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  }

  /**
   * 【全书统一替换】把一个"错写法"在**所有章节**里一次换干净。
   *
   * 为什么必须全书而不是改一句：作者实测清单里反复出现「任李建」——
   * 第 1 章有 6 处，每轮定点修复只改掉 AI 摘录的那一两句，下一轮又报剩下的，
   * 于是 5→3→5 来回转，永远修不完。人名/称谓类必须"一次改干净 + 记进映射表"，
   * 残留再被硬扫兜住。纯字符串运算，0 AI 成本、结果确定。
   */
  private async renameEverywhere(id: string, from: string, to: string): Promise<number> {
    const bad = String(from || '');
    if (!bad || bad.length < 2) return 0;
    const chapters = await this.prisma.chapter.findMany({ where: { novelId: id } as any });
    let total = 0;
    for (const c of chapters) {
      const body = String(c.content || '');
      if (!body.includes(bad)) continue;
      // 接缝去叠字（详见 replaceWithSeamDedup 注释）：不做这一步，
      // "陈陈建国" 与 "陈建国国" 会来回震荡，残留扫描永远报"还有一个旧写法"
      // 第 4 个参数 = 正确写法：落在它内部的命中（「建国眉」之于「陈建国眉头一皱」）原样放过，不许改
      const r = replaceWithSeamDedup(body, bad, String(to || ''), String(to || ''));
      total += r.count;
      if (r.text !== body) {
        await this.prisma.chapter.update({ where: { id: c.id }, data: { content: r.text } as any });
      }
    }
    if (total > 0) {
      const map = await this.renamedMap(id);
      map[bad] = String(to || '');
      await this.prisma.novel.update({
        where: { id },
        // 只留最近 40 条映射，别无限涨
        data: { renamedJson: JSON.stringify(Object.fromEntries(Object.entries(map).slice(-40))) } as any,
      }).catch(() => undefined);
    }
    return total;
  }

  /** 最近一轮定点修复改过的句子（收敛式复检只审这些地方，不再全书重新找茬） */
  private async editMarks(id: string): Promise<Array<{ ch: number; text: string }>> {
    const n: any = await this.prisma.novel.findUnique({
      where: { id },
      select: { editMarksJson: true } as any,
    });
    try {
      const arr = JSON.parse((n && n.editMarksJson) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 记一笔"这一章刚被改过"。
   * 收敛式复检只审这些改动处 —— 换名/称谓统一是确定性替换，不需要再审，所以不记。
   * @param whole true = 整章都是新内容（新写的章节），按整章审
   */
  private async pushEditMark(id: string, ch: number, text: string, whole = false) {
    const list = await this.editMarks(id);
    list.push({ ch: Number(ch) || 0, text: String(text || '').trim(), whole } as any);
    await this.prisma.novel.update({
      where: { id },
      data: { editMarksJson: JSON.stringify(list.slice(-40)) } as any,
    }).catch(() => undefined);
  }

  /** 清空改动标记（本次体检审完这些地方后一并清掉，避免下一轮反复审同一处） */
  private async clearEditMarks(id: string) {
    await this.prisma.novel.update({
      where: { id },
      data: { editMarksJson: null } as any,
    }).catch(() => undefined);
  }

  /**
   * 【修一条 · 计一次分】作者在体检清单里点了「修这条」，改完就把这一条划掉、分数当场回涨。
   * 像 360 体检那样即时反馈：矛盾数 -1、分数 +N，而不是等下次全量体检才变。
   * 同时落库 —— 退出小程序再进来，入口角标也是减过的。
   * @param quote 矛盾原文（清单里每条都有，作为这一条的身份证）
   */
  async resolveAuditIssue(id: string, quote: string) {
    const n: any = await this.getNovel(id);
    if (!n.auditJson || !quote) return { ok: false, score: 0, left: 0, gain: 0 };
    let data: any;
    try { data = JSON.parse(n.auditJson); } catch (e) { return { ok: false, score: 0, left: 0, gain: 0 }; }
    const hit = (data.issues || []).find((x: any) => String(x?.quote || '') === String(quote));
    if (!hit) return { ok: false, score: data.score || 0, left: (data.issues || []).length, gain: 0 };
    const gain = PENALTY[hit.level] ?? 2;
    const same = (x: any) => String(x?.quote || '') === String(quote);
    const before = (data.issues || []).length;
    data.issues = (data.issues || []).filter((x: any) => !same(x));
    data.autoFix = (data.autoFix || []).filter((x: any) => !same(x));
    data.human = (data.human || []).filter((x: any) => !same(x));
    data.options = (data.options || []).filter((x: any) => !same(x));
    data.resolvedCount = (Number(data.resolvedCount) || 0) + Math.max(1, before - data.issues.length);
    /**
     * 【坑·已修】老体检结果的 score 是 AI 给的"整体印象分"（如 72），和扣分制（9 条 = 56）不是一个基准。
     * 直接换成扣分制会出现"明明修好一条，分数反而从 72 掉到 64"的诡异观感 —— 正是作者最反感的。
     * 所以保留旧基准的偏移量：新分 = 扣分制新分 +（旧分 - 扣分制旧分）。
     * 新数据两者相等，偏移为 0，等价于纯扣分制；老数据则平滑地"修一条 +N"。
     */
    const detBefore = scoreOfIssues(
      (data.issues || []).concat([hit]),
      (data.dup || {}).risk || 'low',
    );
    const offset = (Number(data.score) || detBefore) - detBefore;
    data.score = Math.max(0, Math.min(100, scoreOfIssues(data.issues, (data.dup || {}).risk || 'low') + offset));
    data.fixableCount = (data.autoFix || []).length;
    await this.prisma.novel.update({
      where: { id },
      data: { auditJson: JSON.stringify(data) } as any,
    }).catch(() => undefined);
    // 同样记进"已修账本"：下次体检不再把这条捞回来（作者最烦"修完又冒出来"）
    await this.markResolved(id, quote);
    return { ok: true, score: data.score, left: data.issues.length, gain, resolvedCount: data.resolvedCount };
  }

  /**
   * 【单条修复】给前端的「修这条」按钮用：定位原文那一句 → AI 只给改后的句子 → 精确替换。
   * 修完立刻扣掉这一条（不再整章重写，所以不会顺手引入新矛盾）。
   */
  async fixOneIssue(id: string, chId: string, issue: any) {
    const r: any = await this.patchIssue(id, chId, issue);
    if (!r.ok) return r;
    await this.resolveAuditIssue(id, issue.quote).catch(() => undefined);
    return r;
  }

  /** 生成「上架资料包」：作品简介 + 人物名 + 阅读标签 + 内容标签 + 签约/连载模式 */
  async generatePublishInfo(id: string) {
    const n = await this.getNovel(id);
    const p = getPlatform(n.platform);
    const bible = n.bible ? (JSON.parse(n.bible) as any) : {};
    // 没有大纲就没有作品简介：简介是"剧透式钩子"，必须按大纲写；否则就是凭空编一段与正文对不上的话
    if (!this.hasVolumes(bible)) {
      throw new Error('还没有《全书脉络》就没有作品简介，请先定版生成大纲与分卷时间线');
    }
    const chars: any[] = (bible.characters || []).filter((c: any) => c && c.name);
    const roleLine = chars.map((c) => `${c.name}（${c.role}）`).join('、') || '（人物表为空）';

    const prompt = `你是【${p.name}】平台的网文运营编辑，为下面这部作品准备「上架资料包」，供作者直接复制到平台后台发布。
作品：名=${n.title}，题材=${n.genre || ''}，目标读者=${n.targetReader || ''}，每章目标字数=${n.chapterWords}。
一句话卖点=${n.sellPoint || ''}
大纲=${n.outline || ''}
全书脉络·核心设定=${bible.coreSetting || ''}
全书脉络·三幕=${(bible.threeAct || []).join(' ｜ ')}
人物表=${roleLine}

输出如下 JSON（只输出 JSON，不要解释、不要 markdown 代码块）：
{
 "intro":"作品简介：180-220字，3-4 句，第 1 句就抛钩子抓人，突出核心爽点与人设反差，结尾留悬念、不剧透结局",
 "protagonists":[{"name":"真实姓名","role":"主角/女主/反派/配角","desc":"12字内一句话人设"}],
 "readingTags":{"主分类":"","主题":"","角色":"","情节":""},
 "contentTags":{"情节":"","情感":"","人设":"","世界观":""},
 "contractMode":"签约模式建议（如：独家签约 / 免费签约 / 暂未签约）",
 "serialMode":"连载模式建议（如：日更连载 / 周更连载 / 已完结）"
}

【标签硬性规则 —— 只能从下面清单里原样挑选，禁止自创、禁止改写、禁止合并】
${tagWhitelist(p, n.targetReader)}
每项各选 1 个，且必须与作品内容真实匹配（标签与内容不符会被平台限流）。
protagonists 提取 3-5 个最重要人物，name 必须来自上面人物表；人物表为空时才可按大纲自拟。`;

    const text = await this.ai.chat(prompt, 120000);
    const parsed = tryParseJson(text, ['intro', 'readingTags', 'contentTags']);
    if (!parsed || !parsed.intro) throw new Error('上架资料生成失败，请重试');

    const saved = await this.prisma.novel.update({
      where: { id },
      data: {
        intro: String(parsed.intro),
        protagonists: JSON.stringify(parsed.protagonists || []),
        tags: JSON.stringify({ reading: parsed.readingTags || {}, content: parsed.contentTags || {} }),
        contractMode: parsed.contractMode || (n.contractStatus === 'signed' ? '已签约' : '签约（未签约）'),
        serialMode: parsed.serialMode || '日更连载',
      } as any,
    });
    return this.shapePublishInfo(saved);
  }

  async getPublishInfo(id: string) {
    return this.shapePublishInfo(await this.getNovel(id));
  }

  // ==================== 封面：按情节生成「封面方案」 ====================

  /**
   * 封面方案：AI 读这部作品自己的情节（大纲 + 核心设定 + 首卷锚定事件 + 人物表），
   * 给出场景 / 配色 / 构图 / 人物 / 道具，前端 canvas 再按方案实时绘制。
   *
   * 为什么不直接 AI 生图：① 生图模型写中文书名十有八九是乱码，而封面必须含书名+笔名；
   * ② 后端没有配生图接口，小程序端也不该直连第三方；③ 方案化绘制同样能"按情节"，且输出恒为 600×800。
   */
  async coverPlan(id: string, dto: CoverPlanDto) {
    const n = await this.getNovel(id);
    if (!n.bible) throw new Error('还没有《全书脉络》（大纲），封面要先有情节才能画，请先定版');
    let bible: any = {};
    try { bible = JSON.parse(n.bible); } catch (e) { bible = {}; }
    if (!this.hasVolumes(bible)) {
      throw new Error('还没有《全书脉络》（大纲），封面要先有情节才能画，请先定版');
    }
    const p = getPlatform(n.platform);
    const v1 = (bible.volumes || [])[0] || {};
    const chars = charListOf(bible, n.protagonists)
      .slice(0, 4)
      .map((c: any) => `${c.name}（${c.role || ''}）`)
      .join('、');
    const prev = this.readCoverPlan(n);

    const prompt = `你是【${p.name}】平台的封面设计总监，为下面这部小说设计封面。
作品：名=《${n.title}》，题材=${n.genre || ''}，目标读者=${n.targetReader || ''}
一句话卖点=${n.sellPoint || ''}
大纲=${n.outline || ''}
核心设定=${bible.coreSetting || ''}
重生/穿越模式=${bible.rebornMode || '无'}
第一幕/首卷=${v1.name || ''}｜锚定事件=${v1.keyEvent || ''}｜主线=${v1.arc || ''}
主要人物=${chars || '（未定）'}
${dto.opinion ? `作者的额外要求（必须落实）：${dto.opinion}\n` : ''}${prev ? `上一版用过（请换一套，别重复）：配色 ${JSON.stringify(prev.palette)}，道具 ${JSON.stringify(prev.props)}\n` : ''}
【硬性要求】
1) 画面必须来自**这部作品的具体情节**：人物在什么场景、手里拿着什么、身后是什么，
   让读者一眼看出"这是讲什么的书"。禁止泛泛的"一个帅哥站在城市前"。
2) 色彩要有戏剧性、够抓眼（手机上要能从列表里跳出来），但要保证叠在上面的白色书名清晰可读。
3) 人物是**半身/大半身**、有明确动作或道具（1980-2000 年代、都市、玄幻、科幻按题材给对应造型）。
4) props 只能从下面词表里选 2-4 个，且必须是剧情里真实出现的东西。

可选值（必须严格用这些英文键）：
sceneType: city(城市街景) | county(县城老街) | mountain(山野) | space(星空) | indoor(室内) | factory(工业区)
layout: center(居中大标题) | band(中部横带压书名) | side(左对齐)
props: ${Object.keys(PROPS).join(' | ')}
figure.type: modern | ancient | sci
figure.gender: male | female
figure.hair: short | long | bun
figure.outfit: worker(工装/中山装) | suit(西装) | coat(风衣) | dress(连衣裙) | armor(甲胄) | robe(长袍)
figure.pose: hold(手拿道具) | walk(侧身走动) | look(回望)

只输出 JSON，不要解释：
{"scene":"一句话描述画面（≤60字，要具体到人+场景+道具）","mood":"氛围词2-3个",
"sceneType":"county","layout":"center","props":["books","sign"],
"figure":{"type":"modern","gender":"male","hair":"short","outfit":"worker","pose":"hold"},
"palette":{"bg":["#1b2233","#41506b"],"accent":"#ffd77a","cloth":"#1a2130","inner":"#e8edf5","skin":"#eccfae","hair":"#14161d"},
"horizon":0.68,"heroScale":0.95}
其中 palette 全部为 #rrggbb 十六进制色值；horizon 是地平线位置（0.5-0.78）；heroScale 是人物大小（0.7-1.15）。`;

    const parsed = tryParseJson(await this.ai.chat(prompt, 120000), ['scene', 'props', 'palette']) || {};
    const plan = sanitizeCoverPlan(parsed);
    await this.prisma.novel.update({
      where: { id },
      data: { coverImage: JSON.stringify({ v: 2, plan, layout: plan.layout }) } as any,
    });
    return plan;
  }

  /** 读出已存的封面方案（老数据只有 {v:1,seed}，返回 null 让前端走模板兜底） */
  private readCoverPlan(n: any): any {
    try {
      const v = JSON.parse(n.coverImage || '');
      if (v && v.v === 2 && v.plan) return v.plan;
    } catch (e) { /* 没存过或不合法 */ }
    return null;
  }

  async getCoverPlan(id: string) {
    const n = await this.getNovel(id);
    let layout = '';
    try {
      const v = JSON.parse(n.coverImage || '');
      if (v && v.v === 2) layout = v.layout || '';
    } catch (e) { /* 忽略 */ }
    return { plan: this.readCoverPlan(n), layout };
  }

  /**
   * 导出整部小说为 Word（.docx）：作品资料 → 全书脉络 → 分卷章节正文。
   * 零依赖手写 OOXML，服务器不需要额外安装任何包。
   */
  async exportDocx(id: string) {
    const n = await this.getNovel(id);
    const info = this.shapePublishInfo(n);
    const bible = (() => {
      try { return n.bible ? JSON.parse(n.bible) : null; } catch { return null; }
    })();
    const sections: DocxSection[] = [];

    // ⓪ AI 生成声明（合规）：导出件同样属于 AI 生成内容，必须有显式标识，
    //    与小程序内各页的「AI 生成」标识一致，避免导出后标识丢失。
    sections.push({
      heading: 'AI 生成声明',
      text:
        '本作品的书名、卖点、大纲、全书脉络、作品简介、人物设定、标签、封面文案与章节正文均由人工智能（AI）生成，仅供参考与创作辅助，发布前请作者自行核校、修改并承担相应责任。\n' +
        '依据《人工智能生成合成内容标识办法》，本文件含有 AI 生成合成内容。',
    });

    // ① 作品资料
    sections.push({
      heading: '一、作品资料',
      text: [
        `作品名称：${n.title}`,
        `笔名：${n.penName || '（未填写）'}`,
        `平台：${n.platform === 'qimao' ? '七猫小说' : '番茄小说'}`,
        `题材：${n.genre || ''}`,
        `目标读者：${info.targetReader || ''}`,
        `签约模式：${info.contractMode || ''}`,
        `连载模式：${info.serialMode || ''}`,
        `每章目标字数：${n.chapterWords} 字`,
      ].join('\n'),
    });
    if (info.sellPoint) sections.push({ heading: '一句话卖点', text: info.sellPoint });
    if (info.intro) sections.push({ heading: '作品简介', text: info.intro });
    if (info.protagonists.length) {
      sections.push({
        heading: '主要人物',
        text: info.protagonists
          .map((p: any) => `${p.name}（${p.role}）：${p.desc || ''}`)
          .join('\n'),
      });
    }
    const tagLine = (obj: any) =>
      obj ? Object.keys(obj).filter((k) => obj[k]).map((k) => `${k}：${obj[k]}`).join('；') : '';
    if (info.readingTags) sections.push({ heading: '阅读标签', text: tagLine(info.readingTags) });
    if (info.contentTags) sections.push({ heading: '内容标签', text: tagLine(info.contentTags) });

    // ② 全书脉络
    if (bible) {
      const vols = Array.isArray(bible.volumes) ? bible.volumes : [];
      const keys = Array.isArray(bible.keyChapters) ? bible.keyChapters : [];
      const lines: string[] = [];
      if (bible.coreSetting) lines.push(`核心设定：${bible.coreSetting}`, '');
      if (bible.oneLine) lines.push(`一句话故事：${bible.oneLine}`, '');
      vols.forEach((v: any) => {
        lines.push(
          `第 ${v.volume || ''} 卷 ${v.name || ''}（${v.chapterRange || ''}，约 ${v.words || ''}）`,
          `　关键事件：${v.keyEvent || ''}`,
          `　人物弧线：${v.arc || ''}`,
          `　高潮：${v.climax || ''}`,
          `　卷末钩子：${v.hook || ''}`,
          '',
        );
      });
      const byVol: Record<string, string[]> = {};
      keys.forEach((k: any) => {
        (byVol[String(k.volume || 1)] ||= []).push(`　第 ${k.order} 章 ${k.title || ''}：${k.summary || ''}`);
      });
      Object.keys(byVol).sort((a, b) => Number(a) - Number(b)).forEach((v) => {
        lines.push(`【第 ${v} 卷 关键节点章】`, ...byVol[v], '');
      });
      sections.push({ heading: '二、全书脉络（大纲 + 分卷时间线）', text: lines.join('\n'), breakBefore: true });
    }

    // ③ 章节正文（按卷）
    const chs = await this.prisma.chapter.findMany({ where: { novelId: id }, orderBy: { order: 'asc' } });
    if (chs.length) {
      const body: { heading?: string; text?: string; indent?: boolean; breakBefore?: boolean }[] = [
        { heading: '三、正文', text: `共 ${chs.length} 章，合计约 ${chs.reduce((s, c) => s + (c.content || '').length, 0)} 字`, breakBefore: true },
      ];
      let lastVol = 0;
      chs.forEach((c, i) => {
        if (c.volume !== lastVol) {
          lastVol = c.volume;
          body.push({ heading: `第 ${c.volume} 卷`, text: '', breakBefore: i > 0 });
        }
        body.push({ heading: `第 ${c.order} 章 ${stripChapterNo(c.title)}`, text: '' });
        if (c.content) body.push({ text: c.content, indent: true });
        else body.push({ text: '（本章尚未创作）' });
      });
      sections.push(...body);
    } else {
      sections.push({ heading: '三、正文', text: '（还没有章节，去写作页生成后再导出）', breakBefore: true });
    }

    return { buffer: buildDocx(n.title, sections), fileName: `${safeFileName(n.title)}.docx` };
  }

  /** 组装前端展示用的作品资料（对老数据/脏 JSON 容错） */
  private shapePublishInfo(n: any) {
    const read = (s: string | null, fb: any) => {
      try { return s ? JSON.parse(s) : fb; } catch { return fb; }
    };
    const tags = read(n.tags, {});
    // 【作者要求】没有大纲就不该有作品简介。简介 / 主角名 / 标签全都是按大纲写的，
    // 大纲不存在（或已被清掉等重做）时，这些资料必然与正文脱节 —— 宁可显示"待生成"，
    // 也不能拿一份对不上的简介去发布。
    let hasBible = false;
    try { hasBible = !!n.bible && this.hasVolumes(JSON.parse(n.bible)); } catch (e) { hasBible = false; }
    const ready = hasBible && !!(n.intro && tags.reading && tags.content);
    return {
      id: n.id,
      title: n.title,
      platform: n.platform,
      genre: n.genre,
      targetReader: n.targetReader || '',
      intro: ready ? n.intro : '',
      sellPoint: n.sellPoint || '',
      protagonists: ready ? read(n.protagonists, []) : [],
      readingTags: ready ? tags.reading || null : null,
      contentTags: ready ? tags.content || null : null,
      contractMode: n.contractMode || (n.contractStatus === 'signed' ? '已签约' : '签约（未签约）'),
      serialMode: n.serialMode || '',
      hasBible,
      ready,
    };
  }

  /** 章节目录（按卷分组） */
  async listChapters(id: string) {
    await this.getNovel(id);
    const chs = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any, // 作废章节不展示，避免新旧两套设定混在一起
      orderBy: { order: 'asc' },
    });
    const byVolume: Record<number, any[]> = {};
    chs.forEach((c) => {
      (byVolume[c.volume] ||= []).push(c);
    });
    return Object.keys(byVolume)
      .sort((a, b) => +a - +b)
      .map((v) => ({ volume: +v, chapters: byVolume[v] }));
  }

  /** AI 生成下一章（强制带入：全书脉络 + 事实台账 + 目录 + 最近三章摘要） */
  async generateChapter(id: string, dto: GenerateChapterDto) {
    const n = await this.getNovel(id);

    // 今日章节额度：连写时每章进来都会查一次，累计自然收敛，不会超发。
    // 按作品归属算，不按请求头 —— 定版写黄金三章这类内部流程也就自动受限了。
    const q = await currentQuota(this.prisma as any, (n as any).userId || null, (n as any).guestKey || null);
    const deny = checkChapterLimit(q, 1);
    if (deny) throw new BadRequestException(deny);

    const bible = n.bible ? JSON.parse(n.bible) : null;
    // 空对象 "{}" 也算"没有脉络"：那样写出来的章节没有任何中轴线，只会在正文里留下新的矛盾
    if (!bible || !this.hasVolumes(bible)) {
      throw new Error('还没有《全书脉络》（大纲为空），无法写稿，请先定版生成大纲与分卷时间线');
    }
    const canon = n.canon ? (JSON.parse(n.canon) as Canon) : null;
    // 已作废(stale)的旧章节不参与上下文，避免"两套设定混装"继续污染新章
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    const last = chapters[chapters.length - 1];
    const volume = dto.volume ?? (last ? last.volume : 1);
    const order = dto.order ?? (last ? last.order + 1 : 1);

    const dir = chapters.map((c) => `第${c.order}章 ${stripChapterNo(c.title)}`).join(' / ') || '（暂无）';
    // 只带「上一章」会让跨章伏笔断线，带最近三章摘要衔接更稳
    const recent =
      chapters
        .slice(-3)
        .map((c) => `第${c.order}章：${c.summary || (c.content || '').slice(0, 120)}`)
        .join('\n') || '（开篇，无前文）';
    const words = dto.wordCount ?? n.chapterWords ?? 2000;

    const prompt = `你正在为作品《${n.title}》写第 ${order} 章（卷${volume}）。
【全书脉络·故事圣经】：
${JSON.stringify(bible)}

=== 事实台账·不可违反（优先级最高，与上文冲突时以本段为准）===
${renderCanon(canon, charListOf(bible, n.protagonists))}

=== 中轴线定位（大纲 + 分卷时间线；本章必须顺着它写，禁止另起炉灶）===
${axisOf(bible, order)}
${modeLockOf(bible)}

【已有章节目录】${dir}
【最近三章摘要】
${recent}

【本次写稿指令】${dto.instruction}

=== 后台强制写作标准（用户不可见，你必须执行）===
${PASS_GATE_RULE}
0) 【中轴线优先】先读「中轴线定位」：本章是本卷主线的一个环节，必须顺着主线与关键节点推进，
   不得跳出大纲另开支线、不得另起一条时间线；写偏了就是废稿。
1) 人名一律用台账里的写法，不得换字、改姓、起同音名（这是本书最常见的硬伤）。
2) 时间线必须自洽：凡"刚刚 / 今天 / 昨天 / 两小时前 / 昨天买的"等时间表述，都要与台账时间及本章前文对齐，禁止自相矛盾。
3) 六大状态锁：已死亡/毁灭/覆灭/结局/时间/遗失损毁 的事实锁死，禁止复活、禁止地图复刻、禁止时间错乱。
4) 伏笔台账：推进或回收伏笔时更新 status；禁止重复埋设已存在的伏笔；禁止烂尾不回收。
5) 情绪曲线：本章遵循 压-小扬-压-爆 节奏，避免平淡。
6) 一次成稿：正文必须达到 ${words} 字（硬性指标，未达标不许收尾；节奏快、口语化、有钩子）。
7) 热榜研读：${HOT_STUDY_RULE}

=== 交稿前自检（必须做完再输出）===
逐条核对：① 人名写法与台账完全一致；② 本章所有时间表述互不矛盾；③ 没有与"已锁死事实"冲突的情节；
④ 上文【过审即底线】12 条逐条对照（尤其：无编号式罗列、段落长度有变化、前 300 字有冲突、章末有具体钩子）。发现不合格，改好再输出。

仅输出如下 JSON（canon 要精简，别写长）：
{"title":"第${order}章 章名","content":"正文（必须≥${words}字）","summary":"本章滚动摘要（≤200字）",
 "canon":{"time":"本章结束时的剧情时间点（≤20字）","people":[{"name":"本章出场且状态有变的人物","role":"主角/女主/反派","state":"现状（≤15字）"}],"facts":["本章新增的已锁死事实，最多 3 条、每条 ≤30 字"],"foreshadow":[{"desc":"伏笔","status":"埋设/已回收"}]}}`;

    const out = await this.askChapter(prompt, `第${order}章`);
    const { content, summary, canon: newCanon } = out;
    // 章名只存"章名"本身：AI 经常返回「第1章 刚重生就被老婆提离婚？」，
    // 前端/导出又会拼一次「第1章」，结果显示成「第1章 第1章 刚重生…」
    const title = stripChapterNo(out.title) || `第${order}章`;

    const saved = await this.prisma.chapter.create({
      data: {
        novelId: id, volume, order, title, content, summary,
        canon: newCanon ? JSON.stringify(newCanon) : null,
        status: 'done',
      } as any,
    });
    // 台账累积到作品上：下一章写稿会自动带入，主角名/时间线就不会再漂
    await this.prisma.novel.update({
      where: { id },
      data: { canon: JSON.stringify(mergeCanon(canon, newCanon || null)) } as any,
    });

    // 【写完立刻自检 + 修到干净】续更就是发布，"等全书都写完再体检就晚了"。
    // 只查矛盾、不查撞车；查到问题当场定点修，修完再查，0 处才交出去。
    let healNote = '';
    let healInfo: any = null;
    if (!dto.skipHeal) {
      try {
        healInfo = await this.selfHealUntilClean(id, saved.id);
        healNote = healInfo.note;
      } catch (e) {
        healNote = ''; // 自检失败不影响本章已经写好的正文
      }
    }
    const fresh = await this.prisma.chapter.findUnique({ where: { id: saved.id } });
    return { ...(fresh || saved), healNote, healInfo };
  }

  /**
   * 单章自检 + 当场修正：写完一章马上比对「本章内部 / 紧邻前文 / 事实台账 / 人物锁 / 模式锁」，
   * 发现矛盾就让 AI 只改这几处（其余情节节奏原样保留）。只跑 1 轮，防止改不出来反复烧额度。
   */
  /**
   * 单章自检：**只查不改，且不查撞车**。
   * ① 代码硬扫（本章口径：旧写法残留 / 章名前缀 / 字数）② AI 只审本章四类硬伤
   * （人名异写、时间线自相矛盾、与已锁死事实冲突、伏笔重复埋设）。
   * 撞车是"书名 vs 在榜作品"的事，续更一章不必每次联网查一遍 —— 作者明确要求续更阶段不跑。
   */
  private async chapterIssues(id: string, chId: string) {
    const n = await this.getNovel(id);
    const bible = n.bible ? JSON.parse(n.bible) : {};
    const canon = n.canon ? (JSON.parse(n.canon) as Canon) : null;
    const ch = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (!ch || !ch.content) return { ch: null, issues: [] as any[] };
    const list = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    const i = list.findIndex((c) => c.id === chId);
    const prev = i > 0 ? list[i - 1] : null;

    // ① 确定性检查：人名同姓异写 / 章名前缀 / 字数，这部分结果稳定，不靠抽样
    const hard = this.hardIssues(n, bible, [ch], { chapterScope: true });

    // ② 语义检查：只看本章，交给 AI 一次
    const prompt = `你是网文责编，只审**第${ch.order}章**有没有硬伤（不要评价文笔、不要提建议、没问题就返回空）。
【人物锁与台账】
${renderCanon(canon, charListOf(bible, n.protagonists))}
${modeLockOf(bible)}
【本卷中轴线】
${axisOf(bible, ch.order)}
【上一章摘要】${prev ? `第${prev.order}章：${prev.summary || ''}` : '（本章是开篇）'}
【本章章名】${stripChapterNo(ch.title)}
【本章正文】
${(ch.content || '').slice(0, 4000)}

只找这四类**确定矛盾**（有就给，没有别硬凑）：
1) 人名：与人物锁不一致（同音不同字、改姓），或本章内同一人两种写法
2) 时间线：本章内时间自相矛盾（"两小时"与"昨天"并存），或与上一章时间倒退
3) 事实：与「已锁死」事实冲突；物品/身份/金钱数目前后不一致
4) 伏笔：本章重复埋设已存在的伏笔
认为"其实不矛盾 / 无需修改"的别报 —— issues 只放确认有问题且给出具体改法的条目，
fix 必须是可执行动作（把 A 改成 B / 删除某句 / 改写某句），不能写"无需修改"。
只输出 JSON：
{"issues":[{"type":"人名|时间线|事实|伏笔|重复","level":"高|中","quote":"原文逐字摘录(≤40字)","why":"为什么是矛盾","fix":"怎么改"}]}`;

    let ai: any[] = [];
    try {
      const parsed = tryParseJson(await this.ai.chat(prompt, 150000), ['issues']) || {};
      ai = Array.isArray(parsed.issues) ? parsed.issues : [];
    } catch (e) { ai = []; }

    const issues = [...hard, ...ai].filter((x: any) => x && x.quote && !isHumanIssue(x));
    return { ch, issues };
  }

  /** 这条是不是"正文里的一句话"：章名前缀、字数不足是章节级问题，定点修复无从下手 */
  private isSentenceIssue(x: any): boolean {
    const q = String((x && x.quote) || '');
    if (!q) return false;
    if (q.startsWith('章名：') || q.startsWith('本章约') || q.startsWith('全书正文中未出现')) return false;
    return !/^第\s*\d+\s*章出现了两次/.test(q);
  }

  /** 程序有没有把握改这一条：旧写法残留走映射表（不必定位），其余必须能在正文里定位到原句 */
  private canAutoFix(x: any, content: string): boolean {
    if (!x) return false;
    if (x.deprecated) return true;
    return !!locateQuote(content, String(x.quote || ''));
  }

  /** 章节级问题：零成本改库（章名前缀）或扩写补足（字数不足），不占定点修复的名额 */
  private async fixChapterLevel(id: string, ch: any, items: any[], msgs: string[]) {
    for (const x of items || []) {
      const q = String((x && x.quote) || '');
      if (q.startsWith('章名：')) {
        const clean = stripChapterNo(ch.title);
        if (clean && clean !== ch.title) {
          await this.prisma.chapter.update({ where: { id: ch.id }, data: { title: clean } as any });
          msgs.push('章名已去掉多余的「第N章」前缀');
        }
        continue;
      }
      if (q.startsWith('本章约')) {
        const added = await this.padChapter(id, ch.id).catch(() => 0);
        msgs.push(added ? `本章偏短，已补写 ${added} 字` : '本章偏短，建议手动扩写后再发布');
        continue;
      }
      msgs.push(`${q.slice(0, 20)}（这条要你手动处理）`);
    }
  }

  /** 字数补足：补写的一段插在最后一个自然段之前，章末钩子原样留在最后 */
  private async padChapter(id: string, chId: string) {
    const n: any = await this.getNovel(id);
    const ch: any = await this.prisma.chapter.findUnique({ where: { id: chId } });
    const body = String((ch && ch.content) || '');
    const need = Number(n.chapterWords) || 2000;
    const lack = need - body.length;
    if (!body || lack < 100) return 0;
    const cut = body.lastIndexOf('\n');
    const split = cut > 300 ? cut + 1 : body.length;
    const prompt = `你是网文作者，下面这一章字数没达到平台要求，需要**补写一段**。
作品《${n.title}》第 ${ch.order} 章《${stripChapterNo(ch.title)}》。
【本章已有正文的最后部分（供衔接，不要复述）】
${body.slice(-400)}
【任务】接着上面继续写 ${lack + 200} 字左右，推进本章情节（补细节、动作、对话、心理均可）。
硬性要求：
1) 不要另起支线、不要时间线倒退、不要新增人物、不要改人名写法；
2) **不要写新的章末钩子** —— 钩子留在章节最后一段，由原文承担；
3) 不要复述已有内容，直接接着写；
4) **直接写正文，禁止任何说明性文字** —— 不要写"（以下补字数…）""（说明：…）"这类
   把写作要求复述出来的括号备注，也不要复述已有情节（那是重复，不是补写）。
只输出 JSON：{"add":"补写的正文"}`;
    let add = '';
    try {
      const parsed = tryParseJson(await this.ai.chat(prompt, 150000), ['add']) || {};
      add = String(parsed.add || '').trim();
    } catch (e) { add = ''; }
    add = stripPromptLeak(add);
    if (add.length < 80) return 0;
    const next = `${body.slice(0, split)}${add}\n${body.slice(split)}`.trim();
    await this.prisma.chapter.update({ where: { id: chId }, data: { content: next } as any });
    return add.length;
  }

  /**
   * 【续更提交前自检闭环】作者要求：续更就等于发布，交出去的这一章不能有自检问题
   * （"等全书都写完再体检就晚了，那时已经发了好几章"）。
   * 所以写完一章立刻跑自检 → 能自动修的当场定点修 → 修完再查，最多 3 轮，**查到 0 处才算提交**。
   * 修复永远是"一条矛盾一次定点替换"，不做整章重写（那是"修一处冒三处"的根因）。
   */
  private async selfHealUntilClean(id: string, chId: string) {
    const box = { clean: false, rounds: 0, found: 0, fixed: 0, left: 0, msgs: [] as string[], note: '' };
    for (let r = 1; r <= HEAL_MAX_ROUNDS; r++) {
      box.rounds = r;
      const { ch, issues } = await this.chapterIssues(id, chId);
      if (!ch) break;
      box.found = Math.max(box.found, issues.length);
      await this.fixChapterLevel(id, ch, issues.filter((x: any) => !this.isSentenceIssue(x)), box.msgs);
      const todo = issues
        .filter((x: any) => this.isSentenceIssue(x) && this.canAutoFix(x, ch.content))
        .slice(0, HEAL_MAX_PER_ROUND);
      if (!todo.length) { box.clean = true; box.left = 0; break; }
      let okThis = 0;
      for (const x of todo) {
        const res: any = await this.patchIssue(id, chId, x).catch(() => null);
        if (res && res.ok) {
          okThis += 1;
          box.fixed += 1;
          await this.resolveAuditIssue(id, x.quote).catch(() => undefined);
        } else {
          box.msgs.push(`「${String((x && x.quote) || '').slice(0, 12)}…」没改成：${(res && res.reason) || '未知原因'}`);
        }
      }
      box.left = todo.length - okThis;
      if (!okThis) break; // 一条都修不动，再跑也是白烧额度
    }
    // 收尾验收：跑满轮次或中途停下之后，必须再确认一次"真的没有可修的问题了"
    if (!box.clean) {
      const { ch, issues } = await this.chapterIssues(id, chId);
      box.left = ch ? issues.filter((x: any) => this.isSentenceIssue(x) && this.canAutoFix(x, ch.content)).length : 0;
      box.clean = box.left === 0;
    }
    box.note = !box.found
      ? '自检通过：本章未发现矛盾'
      : box.clean
        ? `自检发现 ${box.found} 处，已全部修正（${box.rounds} 轮）`
        : `自检发现 ${box.found} 处，已修正 ${box.fixed} 处，还剩 ${box.left} 处要你拍板`;
    return box;
  }

  /** 重写某一章：把「用户重写原因/意图」作为硬指令注入，AI 据此改写该章（保留全书脉络一致） */
  async rewriteChapter(id: string, chId: string, dto: RewriteChapterDto) {
    const n = await this.getNovel(id);
    const bible = n.bible ? JSON.parse(n.bible) : null;
    if (!bible || !this.hasVolumes(bible)) {
      throw new Error('还没有《全书脉络》（大纲为空），无法重写，请先定版生成大纲与分卷时间线');
    }
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chId } });
    if (!chapter) throw new Error('章节不存在');
    const canon = n.canon ? (JSON.parse(n.canon) as Canon) : null;
    const chapters = await this.prisma.chapter.findMany({
      where: { novelId: id, stale: false } as any,
      orderBy: { order: 'asc' },
    });
    const idx = chapters.findIndex((c) => c.id === chId);
    const prev = idx > 0 ? chapters[idx - 1] : null;
    const lastSummary = prev?.summary || prev?.content?.slice(0, 200) || '（开篇，无前文）';
    const words = n.chapterWords || 2000;
    const dir = chapters.map((c) => `第${c.order}章 ${stripChapterNo(c.title)}`).join(' / ') || '（暂无）';

    const prompt = `你正在「重写」作品《${n.title}》的第 ${chapter.order} 章（卷${chapter.volume}）《${chapter.title}》。
【全书脉络·故事圣经】：
${JSON.stringify(bible)}

=== 事实台账·不可违反（优先级最高）===
${renderCanon(canon, charListOf(bible, n.protagonists))}

=== 中轴线定位（重写也要对齐大纲与分卷时间线，不得越写越偏）===
${axisOf(bible, chapter.order)}
${modeLockOf(bible)}

【已有章节目录】${dir}
【上一章摘要】${lastSummary}
【本章原摘要】${chapter.summary || '（无）'}

【用户重写原因 / 意图】${dto.reason}
【附加改写指令】${dto.instruction || '（无）'}

=== 后台强制标准（同写稿）===
${PASS_GATE_RULE}
0) 【中轴线优先】重写也只能在「中轴线定位」的框架内调整表达与节奏，不得改动本卷主线方向。
1) 人名一律用台账里的写法，不得换字、改姓、起同音名。
2) 时间线必须自洽：与台账时间、本章前文对齐，禁止"刚刚/昨天"这类表述自相矛盾。
3) 六大状态锁：已锁死事实不许改；重写只调整表达与节奏，不推翻既定事实。
4) 伏笔台账：按用户意图增删伏笔时更新 status，禁止重复埋设、禁止烂尾。
5) 保留 压-小扬-压-爆 节奏；正文必须达到 ${words} 字（硬性指标）。
6) 热榜研读：${HOT_STUDY_RULE}

仅输出如下 JSON：
{"title":"第${chapter.order}章 章名","content":"正文（必须≥${words}字）","summary":"本章滚动摘要（≤200字）",
 "canon":{"time":"本章结束时的剧情时间点","people":[{"name":"","role":"","state":""}],"facts":["本章新增已锁死事实，最多 3 条、每条 ≤30 字"],"foreshadow":[{"desc":"","status":""}]}}`;

    const out = await this.askChapter(prompt, chapter.title);
    const { content, summary, canon: newCanon } = out;
    const title = stripChapterNo(out.title) || chapter.title; // 同上：不存「第N章」前缀
    await this.prisma.novel.update({
      where: { id },
      data: { canon: JSON.stringify(mergeCanon(canon, newCanon || null)) } as any,
    });
    return this.prisma.chapter.update({
      where: { id: chId },
      data: { title, content, summary, status: 'done' } as any,
    });
  }

  async saveChapter(id: string, chId: string, dto: SaveChapterDto) {
    await this.getNovel(id);
    return this.prisma.chapter.update({ where: { id: chId }, data: dto as any });
  }

  /**
   * 解析章节输出，三级兜底（模型常把小说正文写成含裸换行/未转义引号的非法 JSON）：
   * 1) 标准 JSON 解析（含裸换行修复）
   * 2) 定向抽取 content/title/summary 字段
   * 3) 模型完全脱离 JSON 直接写正文 —— 整段当正文
   * truncated=true 表示输出被 token 上限截断（JSON 未闭合），正文可能不完整，调用方应重试。
   */
  private parseChapterOutput(
    text: string,
    fallbackTitle: string,
  ): { title: string; content: string; summary: string; canon: Canon | null; truncated: boolean } | null {
    const parsed = tryParseJson(text, ['content']);
    if (parsed?.content) {
      return {
        title: parsed.title || fallbackTitle,
        content: parsed.content,
        summary: parsed.summary || '',
        canon: parsed.canon && typeof parsed.canon === 'object' ? (parsed.canon as Canon) : null,
        truncated: false,
      };
    }
    const content = looseStringField(text, 'content', ['summary', 'title'], true);
    if (content) {
      // 找不到 summary 收尾 = JSON 没闭合 = 大概率被截断
      const truncated = !looseStringField(text, 'summary');
      return {
        title: looseStringField(text, 'title') || fallbackTitle,
        content,
        summary: truncated ? '' : looseStringField(text, 'summary') || '',
        canon: null,
        truncated,
      };
    }
    const plain = text.trim();
    if (plain.length > 200 && !plain.includes('"content"')) {
      return { title: fallbackTitle, content: plain, summary: '', canon: null, truncated: false };
    }
    return null;
  }

  /**
   * 请求一次章节正文：输出被截断/解析失败时自动补一次纠偏重试。
   * 截断是长正文的常见问题（bible 上下文 + 2000 字正文容易顶到 token 上限）。
   */
  private async askChapter(prompt: string, fallbackTitle: string) {
    let text = await this.ai.chat(prompt, 240000);
    let out = this.parseChapterOutput(text, fallbackTitle);
    if (out && !out.truncated) return out;

    const retry = `${prompt}

【上一次输出不合格，请重发】原因：JSON 被截断或无法解析。硬性要求：
1) 不要用 markdown 代码块包裹，不要输出 \`\`\`；
2) 正文长度控制在目标字数的 90%-110%，写到目标字数立刻收尾并闭合 JSON；
3) 必须输出 title / content / summary / canon 四个字段且 JSON 完整闭合（canon 可精简，facts 最多 3 条）。`;
    text = await this.ai.chat(retry, 240000);
    out = this.parseChapterOutput(text, fallbackTitle) || out;
    if (!out) throw new Error(`AI 未返回章节正文，原始输出：${text.slice(0, 200)}`);
    return out;
  }
}
