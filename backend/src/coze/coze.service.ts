import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import { tryParseJson } from '../common/json.util';

/** 流式响应累积结果 */
interface SseAcc {
  event: string; // 当前 SSE 事件名（可能跨 chunk，需保留）
  answer: string; // message.completed 的全量答案
  deltas: string; // message.delta 的增量拼接
  reasoning: string; // 思考过程（仅思考模型有）
  failure: string; // chat.failed 的错误原因
}

/**
 * 扣子(Coze) 写稿引擎封装。
 * 调用 Coze Chat API：发送带《全书脉络》上下文的 prompt -> 流式取回文本。
 * API Key / Bot ID 仅存于服务端环境变量，绝不进小程序客户端。
 */
@Injectable()
export class CozeService {
  private readonly logger = new Logger(CozeService.name);
  private readonly base = process.env.COZE_API_BASE || 'https://api.coze.cn';
  private readonly token = process.env.COZE_API_KEY || '';
  private readonly botId = process.env.COZE_BOT_ID || '';
  private readonly userId = process.env.COZE_USER_ID || 'novel-app-user';

  /**
   * 发送一条 prompt 给扣子 bot，返回生成文本。
   * 采用流式（stream:true）：答案直接在 SSE 流中返回，
   * 既绕开「auto_save_history=false 必须流式」的限制，
   * 也避开了 retrieve/message 接口偶发的鉴权 4100 问题。
   */
  async chat(prompt: string, timeoutMs = 120000): Promise<string> {
    if (!this.token || !this.botId) {
      throw new Error('未配置 COZE_API_KEY / COZE_BOT_ID，请在 .env 中填写');
    }
    const payload = JSON.stringify({
      bot_id: this.botId,
      user_id: this.userId,
      stream: true,
      auto_save_history: false,
      additional_messages: [{ role: 'user', content: prompt, content_type: 'text' }],
    });

    const acc: SseAcc = { event: '', answer: '', deltas: '', reasoning: '', failure: '' };

    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        `${this.base}/v3/chat`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Accept-Encoding': 'identity',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', (d) => (errBody += d));
            res.on('end', () =>
              reject(new Error(`Coze HTTP ${res.statusCode}: ${errBody.slice(0, 300)}`)),
            );
            return;
          }
          let tail = '';
          res.on('data', (chunk) => {
            tail = this.consume(tail + chunk.toString(), acc);
          });
          res.on('end', () => {
            this.consume(tail + '\n', acc); // 冲刷最后一行
            if (acc.failure) {
              this.logger.error(`Coze 运行失败: ${acc.failure}`);
              reject(new Error(`Coze 运行失败: ${acc.failure}`));
              return;
            }
            const out = this.pickAnswer(acc);
            if (!out) {
              reject(
                new Error('Coze 未返回内容（bot 可能未输出正文，请检查 bot 模型是否开启了「深度思考」）'),
              );
              return;
            }
            this.logger.log(
              `Coze 返回：answer=${acc.answer.length}字 delta=${acc.deltas.length}字 reasoning=${acc.reasoning.length}字`,
            );
            resolve(out);
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
      const t = setTimeout(() => req.destroy(new Error('Coze 调用超时')), timeoutMs);
      if (t.unref) t.unref();
    });
  }

  /**
   * 消费缓冲区中「已完整」的 SSE 行，返回尚未收全的尾部。
   * 必须保留尾部：http 分块会把一行 JSON 切成两半，逐块解析会得到残缺 JSON。
   */
  private consume(buf: string, acc: SseAcc): string {
    const lines = buf.split('\n');
    const tail = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        acc.event = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      this.applyEvent(line.slice(5).trim(), acc);
    }
    return tail;
  }

  /** 解析单个 SSE data 事件：区分增量/全量/工具消息，并把思考内容单独收集 */
  private applyEvent(data: string, acc: SseAcc): void {
    if (!data || data === '[DONE]') return;
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (acc.event === 'conversation.chat.failed' || msg.status === 'failed') {
      acc.failure = msg.last_error?.msg || msg.msg || JSON.stringify(msg).slice(0, 200);
      return;
    }
    if (typeof msg.reasoning_content === 'string') acc.reasoning += msg.reasoning_content;
    if (msg.type && msg.type !== 'answer') return; // 过滤工作流/插件等工具消息，防止污染正文
    if (typeof msg.content !== 'string' || !msg.content) return;
    if (acc.event.endsWith('message.completed')) acc.answer = msg.content;
    else acc.deltas += msg.content;
  }

  /**
   * 优选返回文本：
   * 1) message.completed 全量答案（最完整）
   * 2) delta 增量拼接
   * 3) 思考过程（推理模型 content 为空时，正文常混在这里 —— 由上层再抠 JSON）
   * 优先选「含可解析 JSON」的那一段，避免把思考前言当正文交出去。
   */
  private pickAnswer(acc: SseAcc): string {
    const texts = [acc.answer, acc.deltas, acc.reasoning].map((s) => s.trim()).filter(Boolean);
    return texts.find((t) => tryParseJson(t)) ?? texts[0] ?? '';
  }
}
