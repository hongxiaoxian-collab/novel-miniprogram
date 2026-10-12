import { GUEST_PLAN, Limits, limitsFor, resolvePlan } from './plan';

/**
 * 当前身份的「额度 + 已用」。登录用户按 userId 算，游客按匿名标识算。
 *
 * 抽出来是因为 auth（展示用）和 novel（拦截用）都要它：两处各写一份统计逻辑，
 * 迟早出现"页面显示还能写 3 章、点下去说超标"这种对不上的情况。
 */

/** 某个平台今天用掉的量 */
export interface PlatformUsage {
  chapters: number;
  words: number;
}

export interface Quota {
  isGuest: boolean;
  /** 当前套餐展示名（游客（未登录）/ 普通版 / VIP 版） */
  planName: string;
  limits: Limits;
  /** 名下作品总数（**含被拒/归档**；游客只数自己名下的，历史无主作品不算他的） */
  novels: number;
  /** 在写中的作品数（status=writing）。界面展示「在写 N/2」用这个 */
  activeTotal: number;
  /** 各平台在写数量：{fanqie:1, qimao:0}。每平台最多 1 部在写 */
  active: Record<string, number>;
  /**
   * 今日已生成章节数 / 字数。**含义由 perPlatform 决定**：
   * - perPlatform=true（VIP）：传了 platform 就是那个平台自己的量（番茄一份、七猫一份），
   *   判断前必须带平台，否则写七猫会去扣番茄的额度。
   * - perPlatform=false（免费/游客）：恒为两个平台的合计量，platform 参数不起作用。
   */
  chapters: number;
  words: number;
  /** 额度口径：true=按平台各算一份（VIP）；false=两平台共享一份（免费/游客）。取自 limits.quotaScope */
  perPlatform: boolean;
  /** 按平台拆开看：{fanqie:{chapters,words}, qimao:{chapters,words}}。共享档用它只做展示 */
  byPlatform: Record<string, PlatformUsage>;
  /** 游客登录后的话术，界面直接展示 */
  upsell?: string;
}

/** 平台中文名（提示语里必须说清是哪个平台的额度） */
export function platformName(platform?: string | null): string {
  return platform === 'qimao' ? '七猫' : platform === 'fanqie' ? '番茄' : '本平台';
}

/** PrismaClient 的最小接口：只用到这三张表，方便单测传假的 */
type Db = {
  user: { findUnique(p: any): Promise<any> };
  novel: { count(p: any): Promise<number>; findMany(p: any): Promise<any[]> };
  chapter: { findMany(p: any): Promise<any[]> };
};

/** 名下作品的归属条件：登录按 userId，游客按 guestKey。两处口径必须一致 */
function ownerWhere(uid: string | null, guestKey?: string | null) {
  return uid
    ? { userId: uid }
    : { guestKey: guestKey || '__none__', userId: null };
}

/**
 * 统计「在写」数量：全量 + 按平台。
 * 为什么单独抽：每平台 1 部是新架构的硬约束，列表页要显示、新建时要拦截、
 * 被拒重开时还要确认"腾出位置了没有" —— 三处各写一份迟早对不上。
 */
async function countActive(db: Db, uid: string | null, guestKey?: string | null) {
  const rows = await db.novel.findMany({
    where: { ...ownerWhere(uid, guestKey), status: 'writing' } as any,
    select: { platform: true },
  });
  const active: Record<string, number> = {};
  rows.forEach((r: any) => { active[r.platform] = (active[r.platform] || 0) + 1; });
  return { activeTotal: rows.length, active };
}

/**
 * 今日用量（总量 + 按平台拆开）。
 *
 * 抽成公开函数是因为 auth（展示用）和 novel（拦截用）都要它 —— 两处各写一份，
 * 迟早出现"页面显示还能写 3 章、点下去说超标"这种对不上的情况。
 * 额度按平台各算一份，所以统计必须带着 novel.platform 一起取回来。
 */
export async function usageToday(
  db: Db,
  uid: string | null,
  guestKey?: string | null,
): Promise<{ date: string; chapters: number; words: number; byPlatform: Record<string, PlatformUsage> }> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const rows: any[] = await db.chapter.findMany({
    where: {
      novel: ownerWhere(uid, guestKey),
      createdAt: { gte: since },
      // 开书初始化自带的黄金三章不计入日更额度（开书有自己的"每天最多 1 本"闸门）
      quotaFree: false,
    } as any,
    select: { content: true, novel: { select: { platform: true } } },
  });
  const byPlatform: Record<string, PlatformUsage> = {};
  let chapters = 0;
  let words = 0;
  for (const r of rows) {
    const p = (r.novel && r.novel.platform) || '';
    const w = ((r.content || '') as string).length;
    const it = (byPlatform[p] = byPlatform[p] || { chapters: 0, words: 0 });
    it.chapters += 1;
    it.words += w;
    chapters += 1;
    words += w;
  }
  // 日期必须是**服务器本地**的年月日，不能用 toISOString()：
  // 本地 00:00 在 UTC+8 会变成前一天 16:00Z，slice 出来是昨天 —— 作者看到"今天的用量"标着昨天会觉得额度错乱。
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;
  return { date, chapters, words, byPlatform };
}

/**
 * @param platform 当前在操作哪个平台。只有 perPlatform（VIP）档才会用它把额度切成该平台那一份
 */
export async function currentQuota(
  db: Db,
  uid: string | null,
  guestKey?: string | null,
  platform?: string | null,
): Promise<Quota> {
  const usage = await usageToday(db, uid, guestKey);

  // 先把身份/套餐这一段算出来（配额口径藏在 limits.quotaScope 里，要先知道套餐才能定口径）
  let head: Omit<Quota, 'chapters' | 'words' | 'perPlatform' | 'byPlatform'> | null = null;
  if (uid) {
    const user = await db.user.findUnique({ where: { id: uid } });
    if (user) {
      const plan = resolvePlan(user);
      const act = await countActive(db, uid);
      head = {
        isGuest: false,
        planName: plan.name,
        limits: limitsFor(user),
        // 「AI 选题」的占位作品不算一部书（作者还没选定方案），不能占名额
        novels: await db.novel.count({ where: { userId: uid, planDraft: false } }),
        activeTotal: act.activeTotal,
        active: act.active,
      };
    }
    // token 有效但用户被删了：按游客处理，不抛错把页面搞白
  }
  if (!head) {
    const key = guestKey || '__none__';
    const a = await countActive(db, null, guestKey);
    head = {
      isGuest: true,
      planName: GUEST_PLAN.name,
      limits: GUEST_PLAN.limits,
      novels: await db.novel.count({ where: { guestKey: key, planDraft: false } }),
      activeTotal: a.activeTotal,
      active: a.active,
      upsell: '登录后免费升到「普通版」：番茄、七猫各一部在写，两平台合计每天 2 章 / 4000 字；'
        + 'VIP 则每平台各 4 章 / 1 万字。',
    };
  }

  // 额度口径：VIP 按平台各算一份；免费/游客两平台共享同一份（此时 platform 不参与切分）
  const perPlatform = head.limits.quotaScope === 'perPlatform';
  const scoped = (perPlatform && platform)
    ? (usage.byPlatform[platform] || { chapters: 0, words: 0 })
    : usage;

  return {
    ...head,
    chapters: scoped.chapters,
    words: scoped.words,
    perPlatform,
    byPlatform: usage.byPlatform,
  };
}

/**
 * 能不能再建一部作品。超限返回原因，调用方直接抛给前端。
 * 只拦"新建"，不动已有作品 —— 已有作品永远可编辑，绝不因为配额把作者锁死。
 */
export function checkNovelLimit(q: Quota): string | null {
  if (q.novels >= q.limits.maxNovels) {
    return q.isGuest
      ? `游客最多建 ${q.limits.maxNovels} 部作品（你现在 ${q.novels} 部）。${q.upsell || ''}`
      : `当前等级最多建 ${q.limits.maxNovels} 部作品（你现在 ${q.novels} 部）。`;
  }
  return null;
}

/** 提示语里的额度主体：VIP 说平台名（各算一份），免费/游客说「两个平台合计」 */
function scopeWord(q: Quota, platform?: string | null): string {
  return q.perPlatform ? platformName(platform) : '番茄 + 七猫合计';
}

/**
 * 今天还能不能再写章。
 * q 必须是带正确 platform 算出来的（见 currentQuota 第 4 个参数）——
 * 共享档 platform 不参与切分，只影响提示文案。
 */
export function checkChapterLimit(q: Quota, count = 1, platform?: string | null): string | null {
  const who = scopeWord(q, platform);
  if (q.chapters + count > q.limits.dailyChapters) {
    const tail = q.perPlatform
      ? '明天 0 点自动恢复；另一个平台的额度不受影响。'
      : '免费版两个平台共享这一份额度，明天 0 点自动恢复；升级 VIP 后每个平台各有 4 章 / 1 万字。';
    return q.isGuest
      ? `游客每天只能写 ${q.limits.dailyChapters} 章（${who}今天已写 ${q.chapters} 章）。${q.upsell || ''}`
      : `${who}今天已生成 ${q.chapters} 章，达到上限 ${q.limits.dailyChapters} 章。${tail}`;
  }
  return null;
}

/** 今天还能不能再写这么多字 */
export function checkWordLimit(q: Quota, words = 0, platform?: string | null): string | null {
  const who = scopeWord(q, platform);
  const left = q.limits.dailyWords - q.words;
  if (words > left) {
    return `${who}今天还能写 ${Math.max(0, left)} 字`
      + `（上限 ${q.limits.dailyWords} 字，已写 ${q.words} 字）。`
      + (q.isGuest ? ` ${q.upsell || ''}` : '');
  }
  return null;
}

/**
 * 该平台还能不能再开一本「在写」的作品。
 * 每个平台同时只准 1 部在写 —— 番茄 1 部 + 七猫 1 部，被拒/归档的不占位。
 */
export function checkPlatformSlot(q: Quota, platform: string): string | null {
  const name = platform === 'qimao' ? '七猫' : '番茄';
  const used = q.active[platform] || 0;
  if (used >= q.limits.activePerPlatform) {
    return `${name}已有一部在写的作品（同平台最多 ${q.limits.activePerPlatform} 部在写）。`
      + '如果那本被平台拒了，去作品页点「被拒」登记原因，名额立刻腾出来并自动重开一本。';
  }
  return null;
}

/**
 * 今天还能不能再「新开」一本书。
 *
 * 开一本会一次性生成书名/大纲/全书脉络/时间线/黄金三章 + 封面，成本远高于续更一章；
 * 不设上限的话，反复「删掉→重开」就能绕过每天 4 章的额度白嫖正文。
 *
 * 只数**作者亲手开**的（autoCreated=false）：「被拒后自动重开一本」是产品的正常闭环，
 * 不能因为今天已经开过一本书就把拒稿重开也堵死。
 */
export async function checkNewNovelPerDay(
  db: Db,
  uid: string | null,
  guestKey: string | null,
  limit: number,
  perPlatform: boolean,
  platform?: string | null,
): Promise<string | null> {
  if (!limit || limit <= 0) return null;
  const who = perPlatform ? platformName(platform) : '两个平台合计';
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const rows = await db.novel.findMany({
    where: {
      ...ownerWhere(uid, guestKey),
      createdAt: { gte: since },
      autoCreated: false,
      // VIP 按平台各算一份（番茄 1 本 + 七猫 1 本）；免费/游客两平台共享 1 本
      ...(perPlatform && platform ? { platform } : {}),
    } as any,
    select: { id: true },
  });
  if (rows.length >= limit) {
    return `${who}今天已经新开过 ${rows.length} 本书（每天最多新开 ${limit} 本）。`
      + '新开一本会生成大纲、全书脉络、时间线和黄金三章，额度有限：'
      + '今天先把手上这本写下去，明天再开新书。'
      + (rows.length && !uid ? ' 登录后可保留更多作品。' : '');
  }
  return null;
}
