import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';

/** 云开发默认生文模型（需先在控制台 AI → 生文模型 里开启该模型） */
const DEFAULT_MODEL = 'hy3';

const safeJson = (s: string): Record<string, any> | null => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * 微信云开发(CloudBase) 大模型封装 —— 换掉扣子的那一层。
 *
 * 三种通道，按优先级择一：
 *   ① 云函数代理 CLOUDBASE_FN_URL  —— 推荐。成长计划的免费 Token 只允许
 *      「小程序端 SDK / 云开发服务端 SDK」消耗，自有服务器用 API Key 直连 HTTP
 *      会被拒（AI_CHANNEL_NOT_ALLOWED）。把模型调用放进云函数即可合规且免费用。
 *   ② Node SDK 直连 CLOUDBASE_SECRET_ID/KEY —— 自有服务器用官方 SDK，走套餐资源点。
 *   ③ HTTP 直连 CLOUDBASE_API_KEY —— OpenAI 兼容协议，成长计划环境会被拒。
 * 凭证仅存于服务端环境变量，绝不进小程序客户端。
 */
@Injectable()
export class CloudBaseService {
  private readonly logger = new Logger(CloudBaseService.name);
  private readonly envId = process.env.CLOUDBASE_ENV_ID || '';
  private readonly apiKey = process.env.CLOUDBASE_API_KEY || '';
  private readonly secretId = process.env.CLOUDBASE_SECRET_ID || '';
  private readonly secretKey = process.env.CLOUDBASE_SECRET_KEY || '';
  private readonly fnUrl = process.env.CLOUDBASE_FN_URL || '';
  private readonly fnToken = process.env.CLOUDBASE_FN_TOKEN || '';
  private readonly model = process.env.CLOUDBASE_MODEL || DEFAULT_MODEL;

  /** 是否已配置任一通道；未配置时上层自动回落到扣子 */
  get enabled(): boolean {
    return !!(this.fnUrl || (this.envId && (this.apiKey || (this.secretId && this.secretKey))));
  }

  async chat(prompt: string, timeoutMs = 120000): Promise<string> {
    if (this.fnUrl) return this.chatViaFunction(prompt, timeoutMs);
    if (!this.envId) throw new Error('未配置云开发通道，请在 .env 中填写 CLOUDBASE_FN_URL 或 CLOUDBASE_ENV_ID');
    return this.secretId && this.secretKey
      ? this.chatViaSdk(prompt, timeoutMs)
      : this.chatViaHttp(prompt, timeoutMs);
  }

  /** 通道 ①：调云函数 ai-write（模型调用发生在云函数内，合规且吃免费额度） */
  private async chatViaFunction(prompt: string, timeoutMs: number): Promise<string> {
    const res = await fetch(this.fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.fnToken, model: this.model, prompt }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = (await res.json()) as Record<string, any>;
    // 兼容「集成响应」（{statusCode,body}）与裸 JSON 两种返回
    const data = typeof raw?.body === 'string' ? safeJson(raw.body) : raw;
    const out = (data?.text ?? '').trim();
    if (!out) throw new Error(`云函数返回异常 ${res.status}: ${data?.error ?? JSON.stringify(raw).slice(0, 200)}`);
    this.logger.log(`云函数(${this.model}) 返回 ${out.length} 字`);
    return out;
  }

  /** 通道 ②：自有服务器用官方 Node SDK（需腾讯云 CAM 密钥） */
  private async chatViaSdk(prompt: string, timeoutMs: number): Promise<string> {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({
      env: this.envId,
      secretId: this.secretId,
      secretKey: this.secretKey,
      timeout: timeoutMs,
    });
    const model = app.ai().createModel('cloudbase');
    const res = await model.streamText({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = '';
    for await (const chunk of res.textStream) text += chunk;
    const out = text.trim();
    if (!out) throw new Error(`云开发 SDK(${this.model}) 未返回内容`);
    this.logger.log(`云开发 SDK(${this.model}) 返回 ${out.length} 字`);
    return out;
  }

  /** 通道 ③：OpenAI 兼容 HTTP 直连（成长计划环境会返回 AI_CHANNEL_NOT_ALLOWED） */
  private async chatViaHttp(prompt: string, timeoutMs: number): Promise<string> {
    if (!this.apiKey) {
      throw new Error('云开发未配置可用凭证（CLOUDBASE_API_KEY 或 CLOUDBASE_SECRET_ID/KEY）');
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
