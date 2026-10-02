import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { signToken } from './token';
import { limitsFor, publicPlans, resolvePlan } from './plan';

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
  async login(code: string) {
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
    const d = (r.data || {}) as { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
    // 注意：errcode 不进日志原文（可能带敏感信息），只报给调用方一个可读原因
    if (!d.openid) throw new Error(d.errcode ? `微信登录失败(${d.errcode})` : '微信登录失败');

    const now = new Date();
    const user = await this.prisma.user.upsert({
      where: { openid: d.openid },
      create: { openid: d.openid, unionid: d.unionid || null, lastLoginAt: now },
      update: { lastLoginAt: now, unionid: d.unionid || undefined },
    });

    // 已注销/封禁的账号不再发凭证
    if (user.status !== 'active') throw new Error('账号已被停用');

    return {
      enabled: true as const,
      token: signToken(user.id),
      me: this.shape(user),
    };
  }

  /** 我的信息：等级、套餐、今日用量。uid 为空=游客 */
  async me(uid: string | null) {
    if (!uid) return { loggedIn: false, plan: resolvePlan(null), limits: limitsFor(null) };
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) return { loggedIn: false, plan: resolvePlan(null), limits: limitsFor(null) };

    const usage = await this.usageToday(uid);
    return {
      loggedIn: true,
      me: this.shape(user),
      plan: resolvePlan(user),
      limits: limitsFor(user),
      usage,
      novelCount: await this.prisma.novel.count({ where: { userId: uid } }),
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
  private async usageToday(uid: string) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const rows = await this.prisma.chapter.findMany({
      where: { novel: { userId: uid }, createdAt: { gte: since } },
      select: { content: true },
    });
    return {
      date: since.toISOString().slice(0, 10),
      chapters: rows.length,
      words: rows.reduce((s, r) => s + (r.content || '').length, 0),
    };
  }
}
