/**
 * 用户等级 / 套餐配置。
 *
 * 设计原则：**功能差异只写在这一个文件里**。
 * 作者以后新增一个等级（比如"专业版""团队版"），只需往 PLANS 里加一条，
 * 业务代码不出现任何 `if (level === 'vip')` —— 那种写法每加一个等级就要全项目搜一遍改一遍。
 */

/** 单项权益。以后要加新的差异维度，在这里加一个 key 即可 */
export interface Limits {
  /** 最多保留几部作品（**含被拒/归档的历史作品**，不是"同时在写几本"） */
  maxNovels: number;
  /** 每个平台最多几部「在写」作品。番茄 1 部 + 七猫 1 部 = 同时在写最多 2 部。
   *  被拒/归档的作品不算在写，会自动腾出名额 —— 这样"被拒后重开一本"才不会被自己卡住。 */
  activePerPlatform: number;
  /** 每天最多「新开」几本书（不含"被拒后自动重开"的）。
   *  开一本书会一次性生成大纲/脉络/时间线/黄金三章，全是 AI 成本；不设上限就能
   *  反复删了重开、绕过日更额度白嫖正文。 */
  dailyNewNovels: number;
  /** 每天最多生成多少章（作者定的产品口径：每天 1 万字 ≈ 4 章） */
  dailyChapters: number;
  /** 每天最多生成多少字 */
  dailyWords: number;
  /** 单部作品最多多少章 */
  maxChaptersPerNovel: number;
  /** 单章目标字数上限（作者自己调的不超过这个值） */
  wordPerChapter: number;
  /** 能不能自己调每章字数。游客固定 2000 字不给调，避免白嫖大额度 */
  chapterWordsEditable: boolean;
  /** 联网撞车查重（要调搜索引擎，有成本） */
  dupCheck: boolean;
  /** 全书重新审一遍（AI 逐章过，最烧额度） */
  auditFullScan: boolean;
  /** 一键自动修复 */
  autoFix: boolean;
  /** 导出 */
  exportDoc: boolean;
  /** 可用平台 */
  platforms: string[];
  /** AI 档位：传给 Coze 选不同的 bot / 参数 */
  aiTier: string;
}

export interface Plan {
  code: string;
  name: string;
  /** 价格（分）。0 = 免费 */
  priceFen: number;
  /** 购买后有效天数。0 = 永久 */
  days: number;
  limits: Limits;
}

const ALL_PLATFORMS = ['fanqie', 'qimao'];

/**
 * 套餐表。加等级 = 加一条。
 * 注意：free 必须存在，它是过期/降级后的兜底。
 */
export const PLANS: Record<string, Plan> = {
  free: {
    code: 'free',
    name: '普通版',
    priceFen: 0,
    days: 0,
    limits: {
      // 历史作品（含被拒）上限给宽一点：被拒重开一本是新书的常态，不能让"攒了几本被拒稿"就把作者卡死
      maxNovels: 20,
      activePerPlatform: 1,
      dailyNewNovels: 1,   // 每天最多新开 1 本（被拒重开的书不占这个名额）
      dailyChapters: 4,      // 每天 4 章
      dailyWords: 10000,     // 每天 1 万字
      maxChaptersPerNovel: 60,
      wordPerChapter: 3000,
      chapterWordsEditable: true,
      dupCheck: true,
      auditFullScan: false, // 普通版只能做收敛式复检（增量），全书重审留给付费
      autoFix: true,
      exportDoc: true,
      platforms: ALL_PLATFORMS,
      aiTier: 'standard',
    },
  },
  vip: {
    code: 'vip',
    name: 'VIP 版',
    priceFen: 9900, // 99 元/月（占位，等作者定价）
    days: 30,
    limits: {
      maxNovels: 200,
      activePerPlatform: 1,
      dailyNewNovels: 1,   // 每天最多新开 1 本（被拒重开的书不占这个名额）
      dailyChapters: 4,      // 每天 4 章（产品口径，不因付费放开：日更上限是平台节奏，不是权益）
      dailyWords: 10000,     // 每天 1 万字
      maxChaptersPerNovel: 2000,
      wordPerChapter: 8000,
      chapterWordsEditable: true,
      dupCheck: true,
      auditFullScan: true,
      autoFix: true,
      exportDoc: true,
      platforms: ALL_PLATFORMS,
      aiTier: 'pro',
    },
  },
};

/**
 * 游客（未登录）配额。刻意压到"够试写一本"的量，用额度引导登录 —— 作者明确要求。
 * 不进 PLANS：它不是可购买套餐，且 free/vip 用户永远不该退化成游客。
 */
export const GUEST_PLAN: Plan = {
  code: 'guest',
  name: '游客（未登录）',
  priceFen: 0,
  days: 0,
  limits: {
    maxNovels: 2,          // 最多留 2 本（番茄 1 本 + 七猫 1 本，被拒的会腾位置）
    activePerPlatform: 1,
      dailyNewNovels: 1,   // 每天最多新开 1 本（被拒重开的书不占这个名额）
    dailyChapters: 1,      // 游客每天只能写 1 章（登录后才放开到 4 章）
    dailyWords: 3000,
    maxChaptersPerNovel: 10,
    wordPerChapter: 2000,
    chapterWordsEditable: false, // 每章字数锁死 2000，不给调
    dupCheck: false,       // 联网查重要调搜索引擎，有成本
    auditFullScan: false,
    autoFix: true,
    exportDoc: true,
    platforms: ALL_PLATFORMS,
    aiTier: 'standard',
  },
};

/** 缺省套餐：level 查不到、或已过期时一律退回普通版，绝不因为配置缺失把用户锁死 */
const FALLBACK = PLANS.free;

export type UserLike = {
  level?: string | null;
  vipExpireAt?: Date | string | null;
  quotaJson?: string | null;
};

/**
 * 算出用户当前真正生效的套餐。
 * 过期自动降级为 free —— 付费到期后不该还能用 VIP 权益。
 */
export function resolvePlan(user: UserLike | null | undefined): Plan {
  if (!user) return FALLBACK;
  const expired = user.vipExpireAt
    && new Date(user.vipExpireAt).getTime() < Date.now();
  const code = expired ? 'free' : user.level || 'free';
  return PLANS[code] || FALLBACK;
}

/** 单项开关是否有权限 */
export function hasFeature(user: UserLike | null, key: keyof Limits): boolean {
  const v = resolvePlan(user).limits[key];
  return typeof v === 'boolean' ? v : true;
}

/** 取数值型额度 */
export function limitOf(user: UserLike | null, key: keyof Limits): number {
  const v = resolvePlan(user).limits[key];
  return typeof v === 'number' ? v : 0;
}

/** 手工调额：quotaJson 里写了就以它为准（运营给某人单独放宽某几项） */
export function limitsFor(user: UserLike | null): Limits {
  const base = resolvePlan(user).limits;
  if (!user || !user.quotaJson) return base;
  try {
    return { ...base, ...(JSON.parse(user.quotaJson) as Partial<Limits>) };
  } catch {
    return base;
  }
}

/** 给前端展示的套餐列表（不含内部字段） */
export function publicPlans() {
  return Object.values(PLANS).map((p) => ({
    code: p.code,
    name: p.name,
    priceFen: p.priceFen,
    days: p.days,
    limits: p.limits,
  }));
}
