import { GUEST_PLAN, Limits, limitsFor, resolvePlan } from './plan';

/**
 * 当前身份的「额度 + 已用」。登录用户按 userId 算，游客按匿名标识算。
 *
 * 抽出来是因为 auth（展示用）和 novel（拦截用）都要它：两处各写一份统计逻辑，
 * 迟早出现"页面显示还能写 3 章、点下去说超标"这种对不上的情况。
 */

export interface Quota {
  isGuest: boolean;
  /** 当前套餐展示名（游客（未登录）/ 普通版 / VIP 版） */
  planName: string;
  limits: Limits;
  /** 已建作品数（游客只数自己名下的，历史无主作品不算他的） */
  novels: number;
  /** 今日已生成章节数 / 字数 */
  chapters: number;
  words: number;
  /** 游客登录后的话术，界面直接展示 */
  upsell?: string;
}

/** PrismaClient 的最小接口：只用到这三张表，方便单测传假的 */
type Db = {
  user: { findUnique(p: any): Promise<any> };
  novel: { count(p: any): Promise<number> };
  chapter: { findMany(p: any): Promise<any[]> };
};

export async function currentQuota(db: Db, uid: string | null, guestKey?: string | null): Promise<Quota> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  if (uid) {
    const user = await db.user.findUnique({ where: { id: uid } });
    if (user) {
      const rows = await db.chapter.findMany({
        where: { novel: { userId: uid }, createdAt: { gte: since } },
        select: { content: true },
      });
      const plan = resolvePlan(user);
      return {
        isGuest: false,
        planName: plan.name,
        limits: limitsFor(user),
        // 「AI 选题」的占位作品不算一部书（作者还没选定方案），不能占名额
        novels: await db.novel.count({ where: { userId: uid, planDraft: false } }),
        chapters: rows.length,
        words: rows.reduce((s, r) => s + ((r as any).content || '').length, 0),
      };
    }
    // token 有效但用户被删了：按游客处理，不抛错把页面搞白
  }

  const key = guestKey || '__none__';
  const rows = await db.chapter.findMany({
    where: { novel: { guestKey: key }, createdAt: { gte: since } },
    select: { content: true },
  });
  return {
    isGuest: true,
    planName: GUEST_PLAN.name,
    limits: GUEST_PLAN.limits,
    novels: await db.novel.count({ where: { guestKey: key, planDraft: false } }),
    chapters: rows.length,
    words: rows.reduce((s, r) => s + ((r as any).content || '').length, 0),
    upsell: '登录后免费升到「普通版」：3 部作品 / 每天 5 章 / 每章可调到 3000 字',
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

/** 今天还能不能再写章 */
export function checkChapterLimit(q: Quota, count = 1): string | null {
  if (q.chapters + count > q.limits.dailyChapters) {
    return q.isGuest
      ? `游客每天只能写 ${q.limits.dailyChapters} 章（今天已写 ${q.chapters} 章）。${q.upsell || ''}`
      : `今天已生成 ${q.chapters} 章，达到当前等级上限 ${q.limits.dailyChapters} 章。`;
  }
  return null;
}
