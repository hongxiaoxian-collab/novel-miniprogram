import { Injectable, BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS } from '../auth/plan';
import { decryptSecret } from '../auth/secret';

/**
 * 会员充值（微信「虚拟支付」）。
 *
 * 【为什么不能用普通微信支付】
 * 微信《小程序虚拟支付业务管理规范更新公告》（2026-02-27）：自 2026-04-01 起，
 * 售卖虚拟商品（会员、课程、道具、AI 生成内容额度）的小程序**必须**走官方虚拟支付
 * 接口（wx.requestVirtualPayment）；继续用普通商户号收虚拟商品的钱属违规，
 * 会被限制功能乃至终止服务。iOS 端更是由苹果 IAP 接管。
 *
 * 【发货依据的取舍】
 * 官方说"以发货推送为主"。但发货推送是任何人都能往这个 URL POST 一段 XML 的，
 * 直接照着发会员等于白送。所以本实现的顺序是：
 *   收到推送 → 只当"去查一下"的信号 → 调官方 query_order 确认真的收了钱 → 才开通。
 * 伪造推送拿不到任何东西；真订单漏推送时，query_order 兜底也能补发。
 *
 * 【未配置时的行为】
 * 没填 OfferID / AppKey / 道具 ID 时 enabled=false，下单接口返回明确提示，
 * 绝不假装有支付。作者想先给熟人开会员，走 /pay/manual（人工开通）。
 */

const OFFER_ID = () => process.env.VP_OFFER_ID || '';
const APP_KEY = () => process.env.VP_APP_KEY || '';
const ENV = 0; // 官方要求：正式环境固定填 0

/** 商品（道具）。productId 必须与 MP 后台「虚拟支付 → 道具管理」里建的一致，价格也必须对上 */
function goodsList() {
  const list = [
    {
      planCode: 'vip',
      months: 1,
      name: 'VIP 月卡',
      productId: process.env.VP_PRODUCT_VIP_MONTH || '',
      priceFen: Number(process.env.VP_PRICE_VIP_MONTH || PLANS.vip.priceFen) || 9900,
    },
  ];
  return list.filter((g) => g.productId);
}

function hmacSha256(key: string, msg: string): string {
  return createHmac('sha256', key).update(msg, 'utf8').digest('hex');
}

/** outTradeNo：8-32 位、不能以下划线开头（官方硬要求），每次下单重新生成 */
function newOutTradeNo(): string {
  return 'N' + Date.now().toString(36).toUpperCase() + randomBytes(3).toString('hex').toUpperCase();
}

/** 从微信推送的 XML 里取字段值。只取需要的键，够用且不引依赖 */
function xmlField(xml: string, key: string): string {
  const m = xml.match(new RegExp(`<${key}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${key}>`));
  return m ? m[1].trim() : '';
}

@Injectable()
export class PayService {
  constructor(private prisma: PrismaService) {}

  /** 虚拟支付是否配齐。缺任一项就整体停用，避免"能下单但付不了" */
  get enabled(): boolean {
    return !!(OFFER_ID() && APP_KEY() && goodsList().length);
  }

  /** 可购买的商品列表（前端购买页直接用） */
  goods() {
    return {
      enabled: this.enabled,
      goods: goodsList().map((g) => ({
        planCode: g.planCode, months: g.months, name: g.name,
        priceFen: g.priceFen,
        priceText: (g.priceFen / 100).toFixed(2),
      })),
      // 没配好时把原因说清楚，作者照着去补
      missing: this.enabled ? [] : [
        !OFFER_ID() ? 'VP_OFFER_ID（虚拟支付 → 基本配置）' : '',
        !APP_KEY() ? 'VP_APP_KEY（现网 AppKey）' : '',
        !goodsList().length ? 'VP_PRODUCT_VIP_MONTH（道具管理里建的道具 ID）' : '',
      ].filter(Boolean),
      note: '会员属虚拟商品，必须用微信小程序「虚拟支付」。普通微信支付收虚拟商品的钱属违规。',
    };
  }

  /**
   * 下单：建本地订单（pending）→ 生成前端拉起支付需要的 payData。
   * 未登录不能下单（不知道发给谁）。
   */
  async createOrder(uid: string | null, planCode: string) {
    if (!this.enabled) throw new BadRequestException('支付尚未开通，请稍后再试');
    if (!uid) throw new BadRequestException('请先登录再购买');

    const g = goodsList().find((x) => x.planCode === planCode);
    if (!g) throw new BadRequestException('没有这个商品');

    const user: any = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BadRequestException('账号不存在');

    // 用户态签名要用 session_key；没有就只能让用户重新登录（wx.login 会刷新）
    const sessionKey = decryptSecret(user.sessionKey);
    if (!sessionKey) throw new BadRequestException('登录状态已失效，请退出后重新进入小程序再购买');

    const outTradeNo = newOutTradeNo();
    const signData = JSON.stringify({
      offerId: OFFER_ID(),
      buyQuantity: 1,
      env: ENV,
      currencyType: 'CNY',
      productId: g.productId,
      goodsPrice: g.priceFen,
      outTradeNo,
      attach: JSON.stringify({ uid, planCode, months: g.months }),
    });

    await this.prisma.order.create({
      data: {
        userId: uid,
        planCode,
        amount: g.priceFen,
        outTradeNo,
        channel: 'wxpay',
        status: 'pending',
      } as any,
    });

    return {
      mode: 'short_series_goods',
      signData,
      paySig: hmacSha256(APP_KEY(), `requestVirtualPayment&${signData}`),
      signature: hmacSha256(sessionKey, signData),
      outTradeNo,
    };
  }

  /**
   * 发货推送（MP 后台配置的那个 URL）。
   * 只做三件事：解析 → 交给 syncOrder 去官方查单确认 → 回 XML 成功。
   * 伪造的推送在第 2 步会查不到订单，拿不到任何权益。
   */
  async notify(xml: string) {
    const event = xmlField(xml, 'Event');
    if (event && event !== 'xpay_goods_deliver_notify') {
      return '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[ignore]]></ErrMsg></xml>';
    }
    const outTradeNo = xmlField(xml, 'OutTradeNo');
    const wxOrderNo = xmlField(xml, 'MchOrderNo');
    if (!outTradeNo) {
      return '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[no out_trade_no]]></ErrMsg></xml>';
    }
    const r = await this.syncOrder(outTradeNo, wxOrderNo || undefined);
    // 返回 0 = 平台不再重试。查单没查到（例如假推送）也回 0，否则平台会重试 15 次
    return `<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[${r.granted ? 'ok' : 'pending'}]]></ErrMsg></xml>`;
  }

  /** access_token（查单接口要用）。内存缓存，过期前 5 分钟提前换 */
  private tokenCache: { v: string; exp: number } | null = null;
  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.exp > Date.now()) return this.tokenCache.v;
    const r = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid: process.env.WX_APPID || '',
        secret: process.env.WX_APP_SECRET || '',
      },
      timeout: 15000,
    });
    const d = r.data || {};
    if (!d.access_token) throw new Error(`取 access_token 失败(${d.errcode || 'unknown'})`);
    this.tokenCache = { v: d.access_token, exp: Date.now() + (d.expires_in - 300) * 1000 };
    return d.access_token;
  }

  /**
   * 用官方 query_order 确认订单真的支付了，然后开通会员。
   * 幂等：订单已是 paid 就直接返回，重复推送不会重复加时长。
   */
  async syncOrder(outTradeNo: string, wxOrderNo?: string) {
    const order: any = await this.prisma.order.findUnique({ where: { outTradeNo } });
    if (!order) return { granted: false, reason: '本地没有这笔订单' };
    if (order.status === 'paid') return { granted: false, reason: '已发过货', already: true };
    if (!this.enabled) return { granted: false, reason: '支付未配置' };

    const user: any = await this.prisma.user.findUnique({ where: { id: order.userId } });
    if (!user) return { granted: false, reason: '账号不存在' };

    const body = JSON.stringify({
      openid: user.openid,
      env: ENV,
      ...(wxOrderNo ? { wx_order_id: wxOrderNo } : { order_id: outTradeNo }),
    });
    const paySig = hmacSha256(APP_KEY(), `/xpay/query_order&${body}`);
    const url = `https://api.weixin.qq.com/xpay/query_order?access_token=${await this.accessToken()}&pay_sig=${paySig}`;

    const r = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }).catch((e) => ({ data: { errcode: -1, errmsg: String(e && e.message) } }));

    const d = (r.data || {}) as any;
    // 已支付的判据：官方字段在不同版本叫法不一致（paid / pay_time / transaction_id），
    // 只认其中一个会漏发货，三个都没有就坚决不发 —— 宁可让作者手工补，也不能白送会员。
    const o = (d && d.order) || {};
    const paid = !!(d && d.errcode === 0 && (Number(o.paid) === 1 || o.pay_time || o.transaction_id));
    if (!paid) {
      return { granted: false, reason: d.errmsg || '平台查不到已支付记录' };
    }

    const months = goodsList().find((g) => g.planCode === order.planCode)?.months || 1;
    await this.grant(user.id, 'vip', months);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'paid', paidAt: new Date(), wxOrderNo: wxOrderNo || d.order.order_id || null } as any,
    });
    return { granted: true, months };
  }

  /** 开通 / 续期。已有有效期就从到期日往后接，没到期就从今天算 —— 不会把老用户的时间吃掉 */
  async grant(userId: string, level: string, months: number) {
    const u: any = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new BadRequestException('账号不存在');
    const base = u.vipExpireAt && new Date(u.vipExpireAt).getTime() > Date.now()
      ? new Date(u.vipExpireAt) : new Date();
    base.setMonth(base.getMonth() + months);
    await this.prisma.user.update({
      where: { id: userId },
      data: { level, vipExpireAt: base } as any,
    });
    return { level, vipExpireAt: base };
  }

  /**
   * 人工开通：作者给某人开会员（支付没配好时的过渡手段，或给熟人免单）。
   * 必须带 ADMIN_KEY，否则任何人都能给自己开 VIP。
   */
  async manual(openid: string, months: number, adminKey: string) {
    const key = process.env.ADMIN_KEY || '';
    if (!key || adminKey !== key) throw new BadRequestException('管理密钥不对');
    const u: any = await this.prisma.user.findUnique({ where: { openid } });
    if (!u) throw new BadRequestException('没有这个用户（他得先在小程序里打开过一次）');
    const r = await this.grant(u.id, 'vip', months || 1);
    await this.prisma.order.create({
      data: {
        userId: u.id, planCode: 'vip', amount: 0,
        outTradeNo: newOutTradeNo(), channel: 'manual', status: 'paid', paidAt: new Date(),
      } as any,
    });
    return { ok: true, ...r };
  }

  /** 前端下单后轮询这个看有没有到账（网络差时推送可能晚几秒） */
  async orderStatus(outTradeNo: string, uid: string | null) {
    const o: any = await this.prisma.order.findUnique({ where: { outTradeNo } });
    if (!o || (uid && o.userId !== uid)) throw new BadRequestException('没有这笔订单');
    if (o.status !== 'paid') {
      // 推丢了的兜底：前端轮询时顺手查一次单
      const r = await this.syncOrder(outTradeNo).catch(() => ({ granted: false }));
      if (r.granted) return { status: 'paid' };
    }
    return { status: o.status, amount: o.amount };
  }
}
