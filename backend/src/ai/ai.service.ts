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
}
