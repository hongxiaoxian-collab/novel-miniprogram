import { Injectable } from '@nestjs/common';
import { CozeService } from '../coze/coze.service';
import { CloudBaseService } from './cloudbase.service';

/**
 * 写稿引擎统一入口。
 * 按环境变量择一：配了 CLOUDBASE_ENV_ID + CLOUDBASE_API_KEY 走微信云开发，
 * 否则回落到扣子 Coze。业务代码只依赖本类，换供应商不动业务逻辑。
 */
@Injectable()
export class AiService {
  constructor(
    private readonly cloudbase: CloudBaseService,
    private readonly coze: CozeService,
  ) {}

  chat(prompt: string, timeoutMs = 120000): Promise<string> {
    return this.cloudbase.enabled
      ? this.cloudbase.chat(prompt, timeoutMs)
      : this.coze.chat(prompt, timeoutMs);
  }

  /** 生图是否可用（未配置云函数时封面只能退回 canvas 方案图） */
  get imageEnabled(): boolean {
    return this.cloudbase.imageEnabled;
  }

  /**
   * 文字转图片，返回临时 URL。
   * 只有云开发云函数通道能吃免费生图额度，所以这里不做 Coze 回落。
   */
  image(prompt: string, opts: { size?: string; seed?: number; imageModel?: string } = {}): Promise<string> {
    return this.cloudbase.image(prompt, opts);
  }
}
