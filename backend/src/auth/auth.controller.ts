import { Body, Controller, Delete, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { uidFromHeader, guestFromHeader } from './token';

/**
 * 账号接口。全部可选鉴权 —— 没带 token 就是游客，不会 401，
 * 保证老版本小程序 / 未登录状态下功能照常可用。
 */
@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  /** 前端 wx.login 拿到 code 后调这里换 token。带上 guestKey 以便把游客作品认领到账号下 */
  @Post('login')
  login(@Body() body: { code?: string }, @Headers('x-guest-key') guest?: string) {
    return this.svc.login(body?.code || '', guestFromHeader(guest));
  }

  /** 我的信息 + 当前生效套餐 + 今日用量 + 首次向导进度。未登录时按游客配额返回 */
  @Get('me')
  me(@Headers('authorization') auth?: string, @Headers('x-guest-key') guest?: string) {
    return this.svc.me(uidFromHeader(auth), guestFromHeader(guest));
  }

  /**
   * 首次进入的「开书向导」进度：下载 App / 注册 / 实名 / 笔名 / 默认未签约。
   * 已登录的存进账号（换设备也只走一次）；游客只回执，由前端落本地。
   */
  @Post('onboard')
  onboard(
    @Body() body: { steps?: Record<string, boolean>; penName?: string; authorIntro?: string; done?: boolean },
    @Headers('authorization') auth?: string,
  ) {
    return this.svc.onboard(uidFromHeader(auth), body || {});
  }

  /** 注销：删掉账号及名下全部作品、章节、订单 */
  @Delete('me')
  destroy(@Headers('authorization') auth?: string) {
    return this.svc.destroy(uidFromHeader(auth));
  }

  /** 套餐列表，给以后的 VIP 购买页用 */
  @Get('plans')
  plans() {
    return this.svc.plans();
  }
}
