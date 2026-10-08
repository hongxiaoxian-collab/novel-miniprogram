import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';

/** 云开发默认生文模型（需先在控制台 AI → 生文模型 里开启该模型） */
const DEFAULT_MODEL = 'hy3';

/**
 * 微信云开发(CloudBase) 大模型封装 —— 换掉扣子的那一层。
 * 走 OpenAI 兼容协议：
 *   POST https://<ENV_ID>.api.tcloudbasegateway.com/v1/ai/cloudbase/chat/completions
 * ENV_ID / API Key 仅存于服务端环境变量，绝不进小程序客户端。
 * 注意：本服务部署在自有服务器（非小程序端 / 非云函数），
 *       调用会从套餐资源点中扣除，不吃成长计划那份免费 Token 包。
 */
@Injectable()
export class CloudBaseService {
  private readonly logger = new Logger(CloudBaseService.name);
  private readonly envId = process.env.CLOUDBASE_ENV_ID || '';
  private readonly apiKey = process.env.CLOUDBASE_API_KEY || '';
  private readonly model = process.env.CLOUDBASE_MODEL || DEFAULT_MODEL;

  /** 是否已配置云开发凭证；未配置时上层自动回落到扣子 */
  get enabled(): boolean {
    return !!(this.envId && this.apiKey);
  }

  /**
   * 发送一条 prompt，返回生成文本。
   * 用流式：长文（一整个章节）非流式容易被网关超时截断，流式边收边拼更稳。
   */
  async chat(prompt: string, timeoutMs = 120000): Promise<string> {
    if (!this.enabled) {
      throw new Error('未配置 CLOUDBASE_ENV_ID / CLOUDBASE_API_KEY，请在 .env 中填写');
    }
    const payload = JSON.stringify({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });

    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        `https://${this.envId}.api.tcloudbasegateway.com/v1/ai/cloudbase/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'Accept-Encoding': 'identity',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', (d) => (errBody += d));
            res.on('end', () =>
              reject(new Error(`云开发 HTTP ${res.statusCode}: ${errBody.slice(0, 300)}`)),
            );
            return;
          }
          let tail = '';
          let text = '';
          res.on('data', (chunk) => {
            const r = this.consume(tail + chunk.toString());
            tail = r.tail;
            text += r.text;
          });
          res.on('end', () => {
            text += this.consume(tail + '\n').text; // 冲刷最后一眼没换行的数据
            const out = text.trim();
            if (!out) {
              reject(new Error(`云开发(${this.model}) 未返回内容，请确认该模型已在控制台开启`));
              return;
            }
            this.logger.log(`云开发(${this.model}) 返回 ${out.length} 字`);
            resolve(out);
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
      const t = setTimeout(() => req.destroy(new Error('云开发调用超时')), timeoutMs);
      if (t.unref) t.unref();
    });
  }

  /**
   * 消费缓冲区中「已完整」的 SSE 行，返回正文增量与未收全的尾部。
   * 必须保留尾部：http 分块会把一行 JSON 切成两半，逐块解析会得到残缺 JSON。
   */
  private consume(buf: string): { tail: string; text: string } {
    const lines = buf.split('\n');
    const tail = lines.pop() ?? '';
    let text = '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        text += JSON.parse(data).choices?.[0]?.delta?.content ?? '';
      } catch {
        // 极少数半包行兜底：跳过该行，不中断整段生成
      }
    }
    return { tail, text };
  }
}
