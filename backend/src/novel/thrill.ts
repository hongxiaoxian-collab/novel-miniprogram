/**
 * 【爽点定位会诊】M18 —— 解决「读者为什么追」。
 *
 * 和另外两层的分工，别串味：
 * - 本文件（M18）管「爽什么」：核心爽点、双引擎、疲劳陷阱、爽点存货。
 * - 大纲/中轴线管「剧情从哪儿来」。
 * - M32（PASS_GATE_RULE 里的节奏）管「多久爽一次」。
 * - M16·坑4 管「用什么兑现」（数字化入账、打赢后拿到什么）。
 *
 * **爽点必须建立在大纲之上、按卷章走**（作者 2026-10-12 明确要求）：
 * 会诊必须在《全书脉络》生成之后跑，每条爽点存货都要绑到具体某一卷，
 * 写稿时按「本章所在卷」取该卷的爽点锚点 —— 爽点是给大纲供血的，
 * 不是让作者另想一套爽点剧情去挤掉大纲（那样中轴线就废了）。
 *
 * 为什么必须单独一层：实测里最典型的翻车是「稿子没矛盾、字数也够，但就是没人追」——
 * 因为爽点从来没被定位过，作者凭感觉写，写到第十章开场就重复了。
 */

/** 爽点母题库：5 组 × 6 条。会诊时先给模型看母题，避免它凭空憋出「打脸/逆袭」这种空词 */
export const THRILL_MATRIX: Array<{ group: string; items: string[] }> = [
  {
    group: '安全感系（我比你安全）',
    items: ['绝境脱险', '物资碾压他人', '庇护弱者', '危机提前预知', '安全屋升级', '别人求我收留'],
  },
  {
    group: '信息差系（我知道你不知道）',
    items: ['预知走向', '马甲揭棺', '高手被当成废物', '提前三步布局', '情报碾压', '当众拆穿谎言'],
  },
  {
    group: '财富资源系（拿到手的东西）',
    items: ['捡漏暴富', '数字化入账', '囤货兑现', '稀缺品垄断', '投资翻盘', '旧物变天价'],
  },
  {
    group: '身份地位系（我在往上走）',
    items: ['身份反转', '当众打脸', '权威改口', '上门跪求', '阶层跨越', '被大人物敬重'],
  },
  {
    group: '关系情感系（有人站我这边）',
    items: ['被偏爱', '旧人回头后悔', '长辈护短', '强者追随结盟', '被众人需要', '误解解开'],
  },
];

/** B 顾问的已知疲劳陷阱：踩一条就废，逐条都要能答「爽到第几次开始疲劳」 */
export const FATIGUE_TRAPS: Array<{ name: string; why: string }> = [
  { name: '只靠灾难盲盒（随机天灾推着走）', why: '天灾和主角能力无关，读者爽不到主角身上，第三次就疲劳' },
  { name: '只囤不消耗', why: '物资没有代价就没有张力，囤货变成记账' },
  { name: '队伍无限扩编', why: '人一多就没有个体命运，读者记不住谁' },
  { name: '只靠马甲揭棺', why: '揭一次新鲜，揭五次读者开始数马甲' },
  { name: '打脸只靠嘴炮', why: '对方没有真实损失 = 没有爽感，只有噪音' },
  { name: '财富只报数字不落地', why: '数字不换成画面（谁的手在抖、谁的脸白了）就没有体感' },
  { name: '开局即无敌', why: '张力归零，后面无事可写' },
  { name: '压抑超 3 章不释放', why: '不是蓄力，是流失' },
  { name: '爽点只在大高潮出现', why: '中间断了粮，读者在平淡段流失' },
  { name: '只能爽一次的东西当核心', why: '到那个点之前没有持续供能，到之后直接空窗' },
];

/**
 * 【四大结构钩子】（作者 2026-10-12 定）—— 全书级，每本书开书时必须逐条给出本书的落地方式。
 *
 * 和 M18 爽点卡的分工：爽点卡管"这一章爽什么"，四大钩子管"这本书靠什么让人一直追"。
 * 前者是单章供能，后者是长线结构 —— 缺了后者，前 30 章好看，30 章后必崩（主角没处升、资源不缺、没有谜可剥）。
 */
export const BOOK_HOOKS: Array<{ key: string; name: string; what: string; rule: string }> = [
  {
    key: 'upgrade',
    name: '主角全方位升级',
    what: '从贫困户到全国大佬：身份、资源、人脉、话语权全线升格，读者每章都能看到"他又往上走了一格"',
    rule: '升级必须可量化、可围观（谁的脸变了、谁的态度变了）；只升战力不升身份 = 单维升级，第三章就腻',
  },
  {
    key: 'hunger',
    name: '制造资源饥渴感',
    what: '永远差一点：钱差一笔、名额差一个、时间差一天。主角永远在"凑"，凑的过程就是剧情',
    rule: '饥渴必须当章部分兑现（每次只给 1/3、剩下的吊着）；连扣不给超过三章，读者先跑',
  },
  {
    key: 'falseGoal',
    name: '设置假目标制造意外',
    what: '主角（和读者）冲着 A 去，路上撞出 B；真目标永远比假目标高一层，且回头看处处是伏笔',
    rule: '假目标必须是真目标的必要台阶，不是绕路骗字数；意外落地后要回头补一句"原来早有征兆"',
  },
  {
    key: 'onion',
    name: '剥洋葱式解密',
    what: '一层真相包着另一层：每剥一层都推翻前面一个"事实"，且每层都改变人物关系',
    rule: '每层只剥一半（给线索不给全貌）；连剥三层必须落一次实锤，纯吊着不兑现就是水文',
  },
];

/** 救场空词黑名单：写这些 = 没给方案 */
const HOOK_EMPTY = /^(注意|要|需要|合理|适当|适时|灵活|根据|结合|提升|加强|优化|做好|推进|围绕|贯穿)$/;

/**
 * key 归一化：模型给 key 时大小写/连字符不保证（falseGoal / falsegoal / false-goal 都见过）。
 * 两边都过这个函数再比对，否则一条钩子对不上，整卡就被误判不合格。
 */
function normKey(v: any): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface HypeTrap {
  name: string;
  why: string;
  dodge: string;
  /** 这条能爽到第几次开始疲劳（数字）。B 顾问的判据：答不上来就是不合格 */
  times: number | null;
}

/** 绑在某卷上的一条爽点存货：v=卷号，s=场景 */
export interface HypeStockItem {
  v: number;
  s: string;
}

/** 每卷的爽点锚点：这一卷靠什么爽，与卷锚点（关键事件）对齐 */
export interface HypeVolume {
  v: number;
  name: string;
  /** 本卷爽点锚点：与大纲这一卷的关键事件同一个画面 */
  anchor: string;
  /** 本卷的爽点供能：三轴各进一格 */
  object: string;
  method: string;
  cost: string;
}

export interface HypeCard {
  /** 核心爽点 = 读者心里那句话（不许是「打脸/逆袭」这种空词） */
  core: string;
  /** 引擎 A：每 3000 字就能给一点的日常供能，必须能重复兑现 100 次 */
  engineA: string;
  /** 引擎 B：每 30000-50000 字爆一次的大爆发。与 A 必须在同一条因果链上 */
  engineB: string;
  /** 开局前 3 章第一次兑现：谁、在哪、说了什么、拿到了什么 */
  opening: string;
  /** 中期可破局点：同一个爽点靠什么翻新 */
  midRefresh: string;
  /** 爆发期顶点画面 */
  climax: string;
  /** 绝对要避开的（≥3 条，每条带「为什么废」） */
  avoid: string[];
  /** 疲劳陷阱逐条批 */
  traps: HypeTrap[];
  /** 防腻三轴（全局默认，各卷可在 perVolume 里升级） */
  axes: { object: string; method: string; cost: string };
  /** 每卷爽点锚点：按大纲卷序排，写稿时按本章所在卷取 */
  perVolume: HypeVolume[];
  /** 30 条爽点存货，每条绑到具体卷。按卷序排，同卷内按对象轴由低到高 */
  stock: HypeStockItem[];
  /** 四大结构钩子在本书的落地（四条一条不能少，空话判不合格） */
  hooks: HypeHook[];
  /** 救场三招的预制方案（剧情平淡时按序取用，见 rescue.ts） */
  rescue: HypeRescue[];
  version: number;
}

/** 一条结构钩子在本书的落地方式 */
export interface HypeHook {
  key: string;
  name: string;
  /** 本书具体怎么执行这条钩子（必须写到能直接变成剧情的程度） */
  how: string;
}

/** 一招救场在本书的预制方案 */
export interface HypeRescue {
  key: string;
  name: string;
  /** 这本书的救场打法：什么信号出现时用、具体怎么改 */
  how: string;
}

const HYPE_VERSION = 2;

function str(v: any, max = 200): string {
  return String(v ?? '')
    .trim()
    // 模型常把提示词里的字数限制原样抄进答案（"…（≤60字）"），作者会看到这种脏尾巴
    .replace(/[（(]?\s*≤\s*\d+\s*字\s*[）)]?/g, '')
    .trim()
    .slice(0, max);
}

/**
 * 会诊提示词。
 * **必须在大纲与《全书脉络》生成之后调用** —— 爽点要挂在大纲的卷上，不许另想一套。
 * 一次调用定完：A 顾问五问 → B 顾问挑刺 → 裁判双引擎 → 按卷分配 → 30 条存货。
 */
export function thrillPrompt(
  n: {
    title?: string; platform?: string; genre?: string; targetReader?: string;
    sellPoint?: string; outline?: string;
  },
  volumes: Array<{ volume?: number; name?: string; chapterRange?: string; keyEvent?: string }> = [],
): string {
  const matrix = THRILL_MATRIX
    .map((g) => `- ${g.group}：${g.items.join('、')}`)
    .join('\n');
  const traps = FATIGUE_TRAPS.map((t, i) => `${i + 1}) ${t.name} —— ${t.why}`).join('\n');
  const volList = volumes.length
    ? volumes.map((v) => `第${v.volume}卷《${v.name || ''}》（${v.chapterRange || '?'}章）：${v.keyEvent || ''}`).join('\n')
    : '（大纲还没分卷，你按 6 卷自行规划，并在 perVolume 里写出卷名）';

  return `你是网文资深责编，主持一场**爽点定位会诊**。
大纲解决"剧情从哪儿来"，这场会诊只解决一件事：**读者为什么追这本书**。

【铁律】爽点必须**按大纲走**：下面的分卷时间线是已经定稿的中轴线，
你只能给每一卷配爽点、给卷里的章配爽点场景，**不许改剧情、不许新增卷、不许把关键事件换掉**。
爽点是给大纲供血的，不是另写一套爽文剧情去挤掉大纲。

【作品底子】
平台=${n.platform || '番茄'}｜书名=${n.title || '（待定）'}｜题材=${n.genre || ''}｜目标读者=${n.targetReader || ''}
一句话卖点=${n.sellPoint || ''}
全书大纲=${(n.outline || '').slice(0, 400)}

【已定稿的分卷时间线（爽点必须挂在这些卷上）】
${volList}

【爽点母题库（参考，别照抄，要挑出适合本书的组合）】
${matrix}

=== A 顾问五问（一题不能跳，每题必须给具体答案）===
1) 核心爽点是什么？**必须写成「读者心里那句话」**（例："我就知道他藏了底牌，我就等着看他们后悔"）。
   不许答「打脸 / 逆袭 / 爽文」这类空词 —— 那等于没定位。
2) 开局用什么兑现第一次爽感（前 3 章内）？具体到场景：谁、在哪、说了什么、拿到了什么。
3) 可破局点在哪儿？同一个爽点，中期靠什么翻新，才不会重复。
4) 爆发期点什么？把爽感拉到顶的那一下，是什么画面。
5) 绝对要避开什么？至少三条，每条写清「为什么一碰就废」。

=== B 顾问挑刺（口头禅：「这条能爽几次？爽到第几次开始疲劳？」）===
下面每条已知陷阱，判断本书会不会踩；会踩的给规避写法，并填「爽到第几次开始疲劳」。
答不上"能爽几次"的爽点 = 不合格，必须换引擎重写。
${traps}

=== 裁判结论：必须是双引擎（只给一个 = 不合格）===
核心爽点 = 【引擎 A：每 3000 字就能给一点的】 + 【引擎 B：每 30000-50000 字爆一次的】
两个引擎必须在**同一条因果链**上（因为 A 所以 B，例：绝对安全感 + 信息差碾压：因为知道 → 所以安全）。
引擎 A 必须能重复兑现 100 次；答不出就换引擎。

=== 防腻三轴（给每个大爽点各进一格）===
对象轴：身边人 → 配角 → 势力 → 规则（相邻大爽点**必须升一级**）
方式轴：物资 → 情报 → 身份 → 规则（不许重复）
代价轴：越来越大

=== 按卷分配（必须逐卷给，不许只给全局）===
对上面每一卷写出 perVolume 一项：本卷爽点锚点（**与这一卷的关键事件同一个画面**）
+ 本卷三轴各进到哪一格（卷号越大，对象轴越高、代价越大）。

=== 爽点存货 ===
开书一次备 **30 条**，每条是一句能直接写成一场戏的具体场景（20-40 字，不许写"打脸"这种抽象词），
**并且必须标明它属于第几卷（v）**，同卷内按对象轴由低到高排。
30 条要摊到各卷上（卷多的多分几条），不许 30 条全堆在第 1 卷。
写到剩 10 条必须回大纲补货 —— 存货见底是"写着写着不知道写什么"的头号原因。

=== 四大结构钩子（每条都必须给出本书的具体执行，这是长线追读的骨架）===
爽点管"单章爽什么"，这四条管"这本书凭什么让人追到三百章"。每条都要写到**能直接变成剧情**的程度，
不许答"注意节奏""加强冲突"这种空话 —— 空话 = 没做定位。
${BOOK_HOOKS.map((h, i) => `${i + 1}) ${h.name} —— ${h.what}\n   铁律：${h.rule}`).join('\n')}

=== 救场三招预制（剧情平淡时按序取用）===
预先把三招在本书的打法写好，写到"什么信号出现 → 下一章具体怎么改"：
1) 强设新目标 —— 主角完成一个目标后立刻给出更高价的新目标（旧目标的终点就是新目标的起点），
   新目标必须带着**时限**和**围观者**，不许是"继续努力变强"。
2) 硬加冲突 —— 让正在推进的事**当场失败一次**：反派真实得分（抢走资源/揭穿马甲/切断后路），
   主角付出具体代价。软交锋（试探—拆穿）不算冲突。
3) 借鉴飞卢文快节奏 —— 三章内连给：新地图/新身份/新敌人各一个，单章只留一个看点，
   砍掉所有过渡段与心理铺垫，章章有爆点。

仅输出如下 JSON（不要代码块、不要任何说明文字）：
{"core":"读者心里那句话（≤40字）",
 "engineA":"引擎A：每3000字给一点的日常供能（≤60字）",
 "engineB":"引擎B：每3-5万字爆一次的大爆发（≤60字）",
 "opening":"开局前3章第一次兑现：谁/在哪/说了什么/拿到什么（≤120字）",
 "midRefresh":"中期靠什么翻新（≤80字）",
 "climax":"爆发期顶点画面（≤80字）",
 "avoid":["绝对避开1（含为什么废）","绝对避开2","绝对避开3"],
 "traps":[{"name":"陷阱名","why":"为什么撑不住","dodge":"本书怎么规避","times":3}],
 "axes":{"object":"对象轴起始级","method":"方式轴起始级","cost":"代价轴起始级"},
 "perVolume":[{"v":1,"name":"卷名","anchor":"本卷爽点锚点画面（≤60字）","object":"对象轴","method":"方式轴","cost":"代价轴"}],
 "stock":[{"v":1,"s":"爽点场景（20-40字）"},"...共30条"],
 "hooks":[{"key":"upgrade","name":"主角全方位升级","how":"本书怎么升：第一条线先升什么、第1章就让读者看到哪一格"},
          {"key":"hunger","name":"制造资源饥渴感","how":"本书永远缺什么、每次只兑现几分之一"},
          {"key":"falseGoal","name":"设置假目标制造意外","how":"开局假目标是什么、真目标高在哪一层、第一次意外在哪章撞出来"},
          {"key":"onion","name":"剥洋葱式解密","how":"第一层真相是什么、下面还包着几层、每层剥开后推翻哪个'事实'"}],
 "rescue":[{"key":"goal","name":"强设新目标","how":"本书用完一个目标后，下一档目标固定是什么"},
           {"key":"conflict","name":"硬加冲突","how":"本书第一场'反派真实得分'安排在哪、主角付什么代价"},
           {"key":"feilu","name":"借鉴飞卢快节奏","how":"本书哪一段最该切到飞卢节奏、砍什么留什么"}]}`;
}

/**
 * 校验并归一化会诊结果。
 * 不合格直接返回 null —— 宁可没有爽点卡（写稿退回原来的写法），
 * 也不能把「打脸」这种空词写进库里当核心爽点，那比没有更糟。
 */
export function normalizeHype(raw: any): HypeCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const core = str(raw.core, 60);
  // 空词黑名单：模型偷懒只给套路词 = 没做定位
  if (!core || /^(打脸|逆袭|爽文|爽点|升级|变强|复仇|装逼)$/.test(core)) return null;
  const engineA = str(raw.engineA, 120);
  const engineB = str(raw.engineB, 120);
  if (!engineA || !engineB) return null;

  const avoid = Array.isArray(raw.avoid)
    ? raw.avoid.map((x: any) => str(x, 120)).filter(Boolean).slice(0, 8)
    : [];
  const traps: HypeTrap[] = Array.isArray(raw.traps)
    ? raw.traps
        .map((t: any) => ({
          name: str(t?.name, 60),
          why: str(t?.why, 120),
          dodge: str(t?.dodge, 160),
          times: Number.isFinite(Number(t?.times)) ? Number(t.times) : null,
        }))
        .filter((t: HypeTrap) => t.name)
        .slice(0, 12)
    : [];
  // 存货兼容两种写法：模型有时给纯字符串数组（那就按卷均摊），规范写法是 {v,s}
  const stock: HypeStockItem[] = Array.isArray(raw.stock)
    ? raw.stock
        .map((x: any, i: number) =>
          typeof x === 'string'
            ? { v: Math.floor(i / 5) + 1, s: str(x, 80) }
            : { v: Number(x?.v) || 1, s: str(x?.s, 80) })
        .filter((x: HypeStockItem) => x.s)
        .slice(0, 30)
        // 按卷号排（稳定排序）：模型补货时常把剩下的又写回第 1 卷，
        // 不排序的话展示会出现两段「第 1 卷」，作者看了会以为重复。
        .sort((a: HypeStockItem, b: HypeStockItem) => Number(a.v) - Number(b.v))
    : [];
  // 存货少于 10 条：这卡没法支撑全书，直接判不合格
  if (stock.length < 10) return null;

  const perVolume: HypeVolume[] = Array.isArray(raw.perVolume)
    ? raw.perVolume
        .map((v: any) => ({
          v: Number(v?.v) || 0,
          name: str(v?.name, 40),
          anchor: str(v?.anchor, 120),
          object: str(v?.object, 40),
          method: str(v?.method, 40),
          cost: str(v?.cost, 40),
        }))
        .filter((v: HypeVolume) => v.v > 0)
        .slice(0, 24)
    : [];

  const axes = raw.axes && typeof raw.axes === 'object' ? raw.axes : {};
  // 四大结构钩子：四条一条不能少，每条都要有本书的具体执行。
  // 校验从严 —— 少一条或写空话，整卡判不合格（宁可没有卡，也不能给写稿注入假钩子）。
  const hooks = normalizeHooks(raw.hooks);
  if (!hooks) return null;
  const rescue = normalizeRescue(raw.rescue);
  if (!rescue) return null;
  return {
    core,
    engineA,
    engineB,
    opening: str(raw.opening, 240),
    midRefresh: str(raw.midRefresh, 200),
    climax: str(raw.climax, 200),
    avoid,
    traps,
    axes: {
      object: str(axes.object, 40),
      method: str(axes.method, 40),
      cost: str(axes.cost, 40),
    },
    perVolume,
    stock,
    hooks,
    rescue,
    version: HYPE_VERSION,
  };
}

/** 校验四大钩子：四条 key 必须齐全、how 必须具体（≥12 字且不是空话） */
function normalizeHooks(raw: any): HypeHook[] | null {
  if (!Array.isArray(raw)) return null;
  const got = new Map<string, string>();
  for (const x of raw) {
    const key = normKey(x?.key);
    const how = str(x?.how, 200);
    if (key && how) got.set(key, how);
  }
  const out: HypeHook[] = [];
  for (const h of BOOK_HOOKS) {
    const how = got.get(normKey(h.key));
    // 空话/过短 = 没做定位：整卡不合格
    if (!how || how.length < 12 || HOOK_EMPTY.test(how)) return null;
    out.push({ key: h.key, name: h.name, how });
  }
  return out;
}

/** 校验救场三招：三招齐全 + 每招有本书的具体打法 */
function normalizeRescue(raw: any): HypeRescue[] | null {
  if (!Array.isArray(raw)) return null;
  const got = new Map<string, string>();
  for (const x of raw) {
    const key = normKey(x?.key);
    const how = str(x?.how, 200);
    if (key && how) got.set(key, how);
  }
  const KEYS = ['goal', 'conflict', 'feilu'];
  const NAMES: Record<string, string> = {
    goal: '强设新目标',
    conflict: '硬加冲突',
    feilu: '借鉴飞卢快节奏',
  };
  const out: HypeRescue[] = [];
  for (const k of KEYS) {
    const how = got.get(normKey(k));
    if (!how || how.length < 12 || HOOK_EMPTY.test(how)) return null;
    out.push({ key: k, name: NAMES[k], how });
  }
  return out;
}

/**
 * 救场会诊提示词：剧情平淡时按「强设新目标 → 硬加冲突 → 飞卢快节奏」出三条可直接执行的方案。
 *
 * 输入必须带：最近几章的标题+摘要（判断平淡在哪）、大纲剩余部分（不许救到场外）、
 * 爽点卡里的 hooks/rescue 预制（本书的钩子打法）。三条方案都要写到
 * **能直接当下一章写作指令**的程度，不许给"加快节奏"这种空话。
 */
export function rescuePrompt(n: {
  title?: string; genre?: string; targetReader?: string;
  outline?: string; situation?: string;
  recent?: Array<{ order: number; title?: string; summary?: string }>;
  card?: HypeCard | null;
}): string {
  const recent = (n.recent || []).length
    ? n.recent.map((c) => `第${c.order}章《${c.title || ''}》：${(c.summary || '').slice(0, 120) || '（无摘要）'}`).join('\n')
    : '（还没有正文，这是开书阶段的救场：为黄金三章铺钩子）';
  const card = n.card;
  const cardBlock = card
    ? `核心爽点：${card.core}
引擎A：${card.engineA}
引擎B：${card.engineB}
四大钩子（本书既定打法）：${(card.hooks || []).map((h) => `${h.name}→${h.how}`).join('；')}
救场预制：${(card.rescue || []).map((r) => `${r.name}→${r.how}`).join('；')}
爽点存货（还剩这些可用）：${(card.stock || []).slice(0, 8).map((s) => `[卷${s.v}]${s.s}`).join('；')}`
    : '（本书还没有爽点卡，按大纲与四大钩子通用打法给）';

  return `你是网文资深责编，作者现在觉得**剧情平了、追读要掉**，你主持一场救场会诊。
只解决一件事：**下一章怎么改，能把读者按在椅子上**。

【作品底子】
书名=${n.title || '（待定）'}｜题材=${n.genre || ''}｜目标读者=${n.targetReader || ''}
作者自述哪里平=${n.situation || '（没说，你自己从最近几章判断）'}

【最近几章（判断平淡在哪）】
${recent}

【大纲剩余（救场不许跳出大纲，只能借力打力）】
${(n.outline || '').slice(0, 600) || '（无）'}

【本书爽点卡】
${cardBlock}

=== 三招救场（按这个顺序出方案，每招都要落到"下一章第一段写什么"）===
1) **强设新目标**：主角手里的事告一段落了？当场抬一个更高价的新目标，带时限、带围观者。
   判据：主角完成了目标却没事干 = 平淡的头号原因。
2) **硬加冲突**：让正在推进的事**当场失败一次**。反派必须真实得分（抢走资源/揭穿马甲/切断后路），
   主角付出具体代价。判据：连赢三章 = 张力归零。
3) **借鉴飞卢文快节奏**：这一章只干一件事——把过渡段和心理铺垫全砍了，三章内连给
   新地图/新身份/新敌人各一个，单章一个看点，章章有爆点。

每招输出：signal（本书出现什么信号就用这招，≤40字）、plan（下一章具体怎么写，≤160字，
必须写到"谁、在哪、做什么、读者看到什么"，能直接当写作指令粘进去）。

仅输出如下 JSON（不要代码块、不要任何说明文字）：
{"plans":[{"key":"goal","name":"强设新目标","signal":"...","plan":"..."},
          {"key":"conflict","name":"硬加冲突","signal":"...","plan":"..."},
          {"key":"feilu","name":"借鉴飞卢快节奏","signal":"...","plan":"..."}]}`;
}

/** 救场方案校验：三招齐全 + 每招都有具体 plan（空话判不合格，该招作废） */
export function normalizeRescuePlans(raw: any): Array<{ key: string; name: string; signal: string; plan: string }> {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.plans)) return [];
  const NAMES: Record<string, string> = {
    goal: '强设新目标',
    conflict: '硬加冲突',
    feilu: '借鉴飞卢快节奏',
  };
  return raw.plans
    .map((p: any) => {
      const key = normKey(p?.key);
      return {
        key,
        name: NAMES[key] || str(p?.name, 20),
        signal: str(p?.signal, 80),
        plan: str(p?.plan, 300),
      };
    })
    .filter((p: any) => NAMES[p.key] && p.plan.length >= 15)
    .sort((a: any, b: any) => ['goal', 'conflict', 'feilu'].indexOf(a.key) - ['goal', 'conflict', 'feilu'].indexOf(b.key));
}

/** 取某卷的爽点锚点；没有该卷就退回全局三轴 */
export function hypeVolumeOf(h: HypeCard, volume: number): HypeVolume | null {
  if (!h) return null;
  const hit = (h.perVolume || []).find((v) => v.v === Number(volume));
  if (hit) return hit;
  // 卷号超出规划范围（写到后面加卷了）：用最后一卷的三轴继续，别让爽点断供
  const last = (h.perVolume || []).slice(-1)[0];
  return last || null;
}

/** 存库/读库的包装：解析失败或版本不符一律当没有 */
export function parseHype(json: string | null | undefined): HypeCard | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (!o || o.version !== HYPE_VERSION) return null;
    return normalizeHype(o);
  } catch {
    return null;
  }
}

/**
 * 写稿时注入的爽点约束块。**按本章所在卷取**，保证爽点跟着大纲走。
 *
 * 只挑「本卷该用的那几条存货」，不把 30 条全塞进提示词 —— 全塞会让模型在长上下文里
 * 抓不住重点，实测表现是"每条都沾一点，一条都没写透"。
 * @param order 本章章号：同卷内轮转取，保证相邻两章不重复
 * @param volume 本章所在卷：决定用哪一段爽点锚点
 */
export function hypeBriefForChapter(h: HypeCard | null, order: number, volume: number): string {
  if (!h) return '';
  const v = Number(volume) || 1;
  const hv = hypeVolumeOf(h, v);
  const object = hv?.object || h.axes.object || '身边人';
  const method = hv?.method || h.axes.method || '物资';
  const cost = hv?.cost || h.axes.cost || '小';

  // 本卷的存货优先；该卷没分到（模型漏了）就退回全库轮转，保证不断供
  const inVol = h.stock.filter((x) => Number(x.v) === v);
  const pool = inVol.length ? inVol : h.stock;
  const i = Math.max(0, Number(order) - 1);
  const pick = [0, 1, 2].map((k) => pool[(i + k * 3) % pool.length]).filter(Boolean);
  const avoid = h.avoid.slice(0, 3).map((a, k) => `${k + 1}) ${a}`).join('\n') || '（无）';

  // 四大结构钩子：每条都给一句"本章怎么推"—— 长线追读骨架，每章至少推动一条
  const hooks = (h.hooks || []).map((x, k) => {
    const push = [
      '本章必须让主角在某条线（身份/资源/人脉/话语权）上升一格，并写出围观者的反应',
      '本章结尾必须留一个"还差一点"的缺口（差多少写具体），并在章内先兑现三分之一',
      '主角本章要冲着假目标行动，并撞出一次意外（再小也算），意外要回头看有征兆',
      '本章至少剥半层真相：给线索不给全貌；连剥三层必须落一次实锤',
    ][k] || '';
    return `${k + 1}) ${x.name}：${x.how}\n   → ${push}`;
  }).join('\n');

  return `=== 爽点卡（M18：本章必须兑现的"爽"，优先级仅次于事实台账）===
核心爽点（读者心里那句话）：${h.core}
引擎 A（日常供能，每 3000 字给一点）：${h.engineA} —— **本章必须至少兑现一次**
引擎 B（大爆发，每 3-5 万字一次）：${h.engineB} —— 未到爆发期只铺垫、不许提前透支
本卷（第${v}卷${hv?.name ? `《${hv.name}》` : ''}）爽点锚点：${hv?.anchor || '（按中轴线推进）'}
  → 本章的爽点必须服务于这个锚点，**不许跳出大纲另造爽点剧情**。
防腻三轴（本卷）：对象轴=${object}｜方式轴=${method}｜代价轴=${cost}
  → 相邻两章的大爽点**不许同格**：对象轴至少升一级或换方式轴，重复就是读者犯困的开始。
本章可挑的爽点场景（挑 1 条写成一场戏，写透，别三条都沾一点）：
${pick.map((x, k) => `${k + 1}) ${x.s}`).join('\n')}
绝对避开：
${avoid}

=== 四大结构钩子（本书长线骨架，本章至少推动其中一条，能推两条更好）===
${hooks || '（未配置）'}`;
}
