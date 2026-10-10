import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { signToken } from './token';
import { encryptSecret } from './secret';
import { GUEST_PLAN, limitsFor, publicPlans, resolvePlan } from './plan';

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
    const user = await this.prisma.user.upsert({
      where: { openid: d.openid },
      create: { openid: d.openid, unionid: d.unionid || null, lastLoginAt: now, sessionKey: sk },
      update: { lastLoginAt: now, unionid: d.unionid || undefined, ...(sk ? { sessionKey: sk } : {}) },
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
        // 游客看到这些提醒，才知道登录能解锁什么（界面上直接展示，不用作者猜）
        upsell: `登录后免费升到「普通版」：3 部作品 / 每天 5 章 / 每章可调到 3000 字。`,
      };
    }
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) return this.guestFallback(guestKey);

    const usage = await this.usageToday(uid, null);
    return {
      loggedIn: true,
      guest: false,
      me: this.shape(user),
      plan: resolvePlan(user),
      limits: limitsFor(user),
      usage,
      novelCount: await this.prisma.novel.count({ where: { userId: uid } }),
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

  /** 今日已用额度：按今天新建的章节统计。不额外建表，避免为了计数多一次写库 */
  private async usageToday(uid: string | null, guestKey?: string | null) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    // 已登录按账号算；游客按匿名标识算 —— 两者互斥，不会双计
    const owner = uid ? { novel: { userId: uid } } : { novel: { guestKey: guestKey || '__none__' } };
    const rows = await this.prisma.chapter.findMany({
      where: { ...owner, createdAt: { gte: since } } as any,
      select: { content: true },
    });
    return {
      date: since.toISOString().slice(0, 10),
      chapters: rows.length,
      words: rows.reduce((s, r) => s + (r.content || '').length, 0),
    };
  }
}
