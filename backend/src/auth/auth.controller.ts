import { Body, Controller, Delete, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { uidFromHeader } from './token';

/**
 * 账号接口。全部可选鉴权 —— 没带 token 就是游客，不会 401，
 * 保证老版本小程序 / 未登录状态下功能照常可用。
 */
@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  /** 前端 wx.login 拿到 code 后调这里换 token */
  @Post('login')
  login(@Body() body: { code?: string }) {
    return this.svc.login(body?.code || '');
  }

  /** 我的信息 + 当前生效套餐 + 今日用量 */
  @Get('me')
  me(@Headers('authorization') auth?: string) {
    return this.svc.me(uidFromHeader(auth));
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
