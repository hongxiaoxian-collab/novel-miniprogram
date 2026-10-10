import { Body, Controller, Get, Param, Post, Req, Headers } from '@nestjs/common';
import { PayService } from './pay.service';
import { uidFromHeader } from '../auth/token';

/**
 * 会员充值。走微信小程序「虚拟支付」——会员属虚拟商品，普通微信支付收这个钱是违规的。
 *
 * /pay/notify 是给微信服务器推的，不是给小程序调的。
 */
@Controller('pay')
export class PayController {
  constructor(private svc: PayService) {}

  /** 可购买的商品 + 当前有没有配好（没配好会列出缺哪几项，作者照着补） */
  @Get('goods')
  goods() {
    return this.svc.goods();
  }

  /** 下单，返回前端拉起 wx.requestVirtualPayment 需要的 payData */
  @Post('order')
  createOrder(@Body() body: { planCode?: string }, @Headers('authorization') auth?: string) {
    return this.svc.createOrder(uidFromHeader(auth), body?.planCode || 'vip');
  }

  /** 前端支付后轮询这个看有没有到账（推送晚到时这里会顺手查一次单） */
  @Get('order/:outTradeNo')
  status(@Param('outTradeNo') outTradeNo: string, @Headers('authorization') auth?: string) {
    return this.svc.orderStatus(outTradeNo, uidFromHeader(auth));
  }

  /**
   * 微信发货推送。收到后不直接发货 —— 先调官方 query_order 确认真的收了钱。
   * 任何人都能往这个 URL 发一段 XML，照着就发会员等于白送。
   */
  @Post('notify')
  notify(@Req() req: any) {
    const raw = typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    return this.svc.notify(raw);
  }

  /** 人工开通（支付没配好时的过渡手段）。必须带 ADMIN_KEY */
  @Post('manual')
  manual(@Body() body: { openid?: string; months?: number; adminKey?: string }) {
    return this.svc.manual(body?.openid || '', Number(body?.months) || 1, body?.adminKey || '');
  }
}
