import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { signToken } from './token';
import { encryptSecret } from './secret';
import { GUEST_PLAN, limitsFor, publicPlans, resolvePlan } from './plan';
import { usageToday } from './quota';

/**
 * 微信登录与账号管理。
 *
 * 【隐私铁律】
 * - 只存 openid / unionid，不碰头像、昵称、手机号。
 * - openid 不写日志、不返回给前端（前端只需要一个 token）。
 * - 未配置小程序密钥时整套功能**自动关闭**，行为与加登录前完全一致，绝不影响已有作品。
 */

const APPID = () => process.env.WX_APPID || '';
const SECRET = () => process.env.WX_APP_SECRET || '';

/** 业主白名单：这些人恒为 VIP（作者自己的账号）。逗号分隔的 openid 列表 */
const ownerOpenids = (): string[] =>
  String(process.env.VIP_OPENIDS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * 新账号的默认等级。运营期可设成 vip 让试用的人拿到完整体验；
 * 正式对外前**必须改回 free**（或直接删掉这个变量），否则人人都是 VIP。
 */
const defaultLevel = (): string => {
  const v = String(process.env.DEFAULT_LEVEL || 'free').trim().toLowerCase();
  return v === 'vip' ? 'vip' : 'free';
};

/** VIP 白名单的到期时间：给一个足够远的日期，等价于"永久"。不能用 null —— null 会被判成已过期 */
const farFuture = (): Date => new Date('2099-12-31T23:59:59Z');

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  /** 小程序密钥没配就整体停用。前端拿到 enabled=false 会静默跳过登录 */
  get enabled(): boolean {
    return !!(APPID() && SECRET());
  }

  /**
   * wx.login 拿到的 code 换 openid，首次登录自动建号。
   * code 只能用一次、5 分钟失效，不做缓存。
   */
  async login(code: string, guestKey?: string | null) {
    if (!this.enabled) return { enabled: false as const };
    if (!code) throw new Error('缺少 code');

    const url = 'https://api.weixin.qq.com/sns/jscode2session';
    const r = await axios.get(url, {
      params: {
        appid: APPID(),
        secret: SECRET(),
        js_code: code,
        grant_type: 'authorization_code',
      },
      timeout: 15000,
    });
    const d = (r.data || {}) as {
      openid?: string; unionid?: string; session_key?: string; errcode?: number; errmsg?: string;
    };
    // 注意：errcode 不进日志原文（可能带敏感信息），只报给调用方一个可读原因
    if (!d.openid) throw new Error(d.errcode ? `微信登录失败(${d.errcode})` : '微信登录失败');

    const now = new Date();
    // session_key 是虚拟支付下单签名的必需品（wx.requestVirtualPayment 的 signature 用它算 HMAC），
    // 不存下来就只能让用户重新登录才能付款。加密落库，不进日志、不出任何接口。
    const sk = d.session_key ? encryptSecret(d.session_key) : undefined;
    // 等级：
    // - VIP_OPENIDS 里点名的账号（就是作者自己）永远 VIP，不受任何开关影响；
    // - 新账号按 DEFAULT_LEVEL 建（运营期设成 vip 让试用者拿到完整体验，正式对外前改回 free）。
    // 作者要求「我自己的账号默认 VIP」，但又不能把所有新用户都变成 VIP —— 所以走白名单 + 开关两条路。
    const isOwner = ownerOpenids().includes(d.openid);
    const initLevel = isOwner ? 'vip' : defaultLevel();
    const user = await this.prisma.user.upsert({
      where: { openid: d.openid },
      create: {
        openid: d.openid,
        unionid: d.unionid || null,
        lastLoginAt: now,
        sessionKey: sk,
        level: initLevel,
        ...(initLevel === 'vip' ? { vipExpireAt: farFuture() } : {}),
      },
      update: {
        lastLoginAt: now,
        unionid: d.unionid || undefined,
        ...(sk ? { sessionKey: sk } : {}),
        // 白名单里的账号每次登录都自愈回 VIP（配额被误改也兜得住）
        ...(isOwner ? { level: 'vip', vipExpireAt: farFuture() } : {}),
      },
    });

    // 已注销/封禁的账号不再发凭证
    if (user.status !== 'active') throw new Error('账号已被停用');

    // 认领：把这次登录前以游客身份建的作品挂到账号下。
    // 少了这一步，作者登录后会发现"我刚写的那本不见了" —— 作品还在，只是挂在游客名下。
    let claimed = 0;
    if (guestKey) {
      const r = await this.prisma.novel.updateMany({
        where: { guestKey, userId: null },
        data: { userId: user.id, guestKey: null },
      });
      claimed = r.count;
    }

    const usage = await this.usageToday(user.id, null);
    return {
      enabled: true as const,
      token: signToken(user.id),
      me: this.shape(user),
      plan: resolvePlan(user),
      limits: limitsFor(user),
      usage,
      novelCount: await this.prisma.novel.count({ where: { userId: user.id } }),
      claimed, // 前端拿到 >0 就提示"已把 N 本作品归到你的账号"
    };
  }

  /** 我的信息：等级、套餐、今日用量。uid 为空=游客（按 guestKey 统计他自己的量） */
  async me(uid: string | null, guestKey?: string | null) {
    if (!uid) {
      // 游客：配额用 GUEST_PLAN（比普通版低得多），用量只数这个 guestKey 名下的
      const usage = await this.usageToday(null, guestKey);
      const novelCount = guestKey
        ? await this.prisma.novel.count({ where: { guestKey } })
        : 0;
      return {
        loggedIn: false,
        guest: true,
        plan: GUEST_PLAN,
        limits: GUEST_PLAN.limits,
        usage,
        novelCount,
        active: await this.activeByPlatform(null, guestKey),
        // 游客没有账号可存，向导进度由前端落本地；这里固定返回"未走过"，前端据此决定是否弹向导
        onboard: { onboarded: false, steps: {}, penName: '' },
        // 游客看到这些提醒，才知道登录能解锁什么（界面上直接展示，不用作者猜）
        upsell: `登录后免费升到「普通版」：番茄·七猫各 1 部在写，每个平台每天 4 章 / 1 万字`,
      };
    }
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) return this.guestFallback(guestKey);

    const usage = await this.usageToday(uid, null);
    let steps: Record<string, boolean> = {};
    try { steps = (user as any).onboardJson ? JSON.parse((user as any).onboardJson) : {}; } catch (e) { steps = {}; }
    return {
      loggedIn: true,
      guest: false,
      me: this.shape(user),
      plan: resolvePlan(user),
      limits: limitsFor(user),
      usage,
      novelCount: await this.prisma.novel.count({ where: { userId: uid } }),
      active: await this.activeByPlatform(uid),
      // 首次进入要不要走向导，全看这个字段（前端不再靠本地缓存猜，换手机也能接着走）
      onboard: {
        onboarded: !!(user as any).onboarded,
        steps,
        penName: (user as any).penName || '',
      },
    };
  }

  /**
   * 【首次进入的开书向导】下载 App → 注册 → 实名 → 确认笔名 → 默认未签约 → 一键开书。
   *
   * 为什么后端也要存一份：只存本地，作者换手机 / 清缓存后又要重走一遍；
   * 存在账号上才能做到"换设备也只走一次"。游客（未登录）也能调，此时只回执，
   * 由前端落本地，登录后第一次调 me 再把进度并上来。
   */
  async onboard(uid: string | null, dto: {
    steps?: Record<string, boolean>;
    penName?: string;
    authorIntro?: string;
    done?: boolean;
  } = {}) {
    const steps = dto.steps || {};
    if (!uid) {
      return { ok: true, guest: true, steps, onboarded: !!dto.done, synced: false, penName: dto.penName || '' };
    }
    const user: any = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      return { ok: true, guest: true, steps, onboarded: !!dto.done, synced: false, penName: dto.penName || '' };
    }
    let prev: Record<string, boolean> = {};
    try { prev = user.onboardJson ? JSON.parse(user.onboardJson) : {}; } catch (e) { prev = {}; }
    const merged = { ...prev, ...steps };
    const data: any = { onboardJson: JSON.stringify(merged) };
    if (dto.penName) data.penName = String(dto.penName).trim();
    if (dto.authorIntro) data.authorIntro = String(dto.authorIntro).trim();
    if (dto.done) data.onboarded = true;
    await this.prisma.user.update({ where: { id: uid }, data });

    // 笔名只确认一次，之后名下所有作品（含之前建的老作品）都自动带上，封面才不会被平台驳回
    let patched = 0;
    if (dto.penName) {
      const r = await this.prisma.novel.updateMany({
        where: { userId: uid } as any,
        data: { penName: String(dto.penName).trim() } as any,
      });
      patched = r.count;
    }
    return {
      ok: true,
      guest: false,
      steps: merged,
      onboarded: !!user.onboarded || !!dto.done,
      penName: data.penName || user.penName || '',
      patched, // 顺手把笔名补到已有作品上，前端可提示"已同步到 N 本作品"
      synced: true,
    };
  }

  /** token 有效但用户已被删除（注销过）时，按游客返回，不能抛错把页面搞白 */
  private async guestFallback(guestKey?: string | null) {
    const usage = await this.usageToday(null, guestKey);
    return {
      loggedIn: false,
      guest: true,
      plan: GUEST_PLAN,
      limits: GUEST_PLAN.limits,
      usage,
      novelCount: guestKey ? await this.prisma.novel.count({ where: { guestKey } }) : 0,
    };
  }

  /**
   * 注销账号：删掉该用户下全部作品、章节、订单。
   * 《个人信息保护法》要求必须能删，这是硬要求不是可选项。
   */
  async destroy(uid: string | null) {
    if (!uid) throw new Error('未登录');
    const n = await this.prisma.novel.count({ where: { userId: uid } });
    // Novel.userId 设了 onDelete: Cascade，章节会跟着删；Order 同理
    await this.prisma.user.delete({ where: { id: uid } });
    return { ok: true, deletedNovels: n };
  }

  plans() {
    return { enabled: this.enabled, plans: publicPlans() };
  }

  /** 给前端的用户信息。openid 只脱敏显示后 4 位，方便作者自己核对是哪个号 */
  private shape(u: { id: string; openid: string; level: string; vipExpireAt: Date | null; createdAt: Date }) {
    return {
      id: u.id,
      openidMasked: `***${u.openid.slice(-4)}`,
      level: u.level,
      vipExpireAt: u.vipExpireAt,
      createdAt: u.createdAt,
    };
  }

  /**
   * 各平台「在写」数量：{fanqie:1, qimao:0}。
   * 每平台最多 1 部在写是新架构的硬约束，列表页要直接把这个数显示给作者看，
   * 否则他点「新建」被拒时只会觉得莫名其妙。
   */
  private async activeByPlatform(uid: string | null, guestKey?: string | null) {
    const where: any = uid
      ? { userId: uid, status: 'writing' }
      : { guestKey: guestKey || '__none__', userId: null, status: 'writing' };
    const rows = await this.prisma.novel.findMany({ where, select: { platform: true } });
    const m: Record<string, number> = {};
    rows.forEach((r: any) => { m[r.platform] = (m[r.platform] || 0) + 1; });
    return m;
  }

  /**
   * 今日已用额度：按今天新建的章节统计。不额外建表，避免为了计数多一次写库。
   *
   * 复用 quota.ts 的 usageToday（同一份口径）—— 额度是按平台各算一份的，
   * 这里必须一并返回 byPlatform，前端作品页才能把「番茄 1/4 章、七猫 0/4 章」分别显示出来。
   */
  private async usageToday(uid: string | null, guestKey?: string | null) {
    return usageToday(this.prisma as any, uid, guestKey);
  }
}
