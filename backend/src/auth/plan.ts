/**
 * 用户等级 / 套餐配置。
 *
 * 设计原则：**功能差异只写在这一个文件里**。
 * 作者以后新增一个等级（比如"专业版""团队版"），只需往 PLANS 里加一条，
 * 业务代码不出现任何 `if (level === 'vip')` —— 那种写法每加一个等级就要全项目搜一遍改一遍。
 */

/** 单项权益。以后要加新的差异维度，在这里加一个 key 即可 */
export interface Limits {
  /** 最多建几部作品 */
  maxNovels: number;
  /** 每天最多生成多少章 */
  dailyChapters: number;
  /** 每天最多生成多少字 */
  dailyWords: number;
  /** 单部作品最多多少章 */
  maxChaptersPerNovel: number;
  /** 单章目标字数上限（作者自己调的不超过这个值） */
  wordPerChapter: number;
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
      maxNovels: 3,
      dailyChapters: 5,
      dailyWords: 15000,
      maxChaptersPerNovel: 60,
      wordPerChapter: 3000,
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
      maxNovels: 50,
      dailyChapters: 50,
      dailyWords: 200000,
      maxChaptersPerNovel: 2000,
      wordPerChapter: 8000,
      dupCheck: true,
      auditFullScan: true,
      autoFix: true,
      exportDoc: true,
      platforms: ALL_PLATFORMS,
      aiTier: 'pro',
    },
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
