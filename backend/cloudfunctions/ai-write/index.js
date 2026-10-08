/**
 * 微信云函数：生文代理（ai-write）
 *
 * 为什么需要它：小程序成长计划赠送的 AI 免费额度，只允许「小程序端 SDK」和
 * 「云开发服务端（云函数/云托管）SDK」两种来源消耗；从自有服务器用 API Key
 * 直连 HTTP 会被拒（AI_CHANNEL_NOT_ALLOWED）。因此把模型调用放进云函数，
 * 由 ECS 上的 NestJS 通过 HTTP 触发它 —— 既合规又能吃到免费额度。
 *
 * 部署：云开发控制台 → 云函数 → 新建 → 通过代码包创建 → 上传本目录 zip
 *      → 函数配置：超时 300 秒、内存 512MB、环境变量 AI_WRITE_TOKEN
 *      → HTTP 访问服务：路径 /ai-write 绑定本函数
 *
 * 入参：POST JSON {token, model?, prompt}
 * 出参：{ text }（失败时 { error }）
 */
const tcb = require('@cloudbase/node-sdk');

const MODEL = process.env.AI_MODEL || 'hy3';
const TOKEN = process.env.AI_WRITE_TOKEN || '';
/** 模型渠道名，按顺序试；不同版本控制台口径不一，留回退避免一次失败就卡死 */
const PROVIDERS = (process.env.AI_PROVIDER || 'cloudbase,hunyuan-exp')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let app;
const getApp = () => (app ||= tcb.init({ timeout: 300000 }));

const tryJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** 兼容云函数 HTTP 访问服务 / 函数 URL 化的几种 event 形态 */
const parseBody = (event) => {
  if (!event) return null;
  if (typeof event === 'string') return tryJson(event);
  if (event.body) return typeof event.body === 'string' ? tryJson(event.body) : event.body;
  return event;
};

const resp = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

/** 逐渠道尝试，第一个出内容就返回 */
const writeText = async (prompt, modelName) => {
  const ai = getApp().ai();
  let lastErr;
  for (const provider of PROVIDERS) {
    try {
      const res = await ai.createModel(provider).streamText({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
      });
      let text = '';
      for await (const chunk of res.textStream) {
        text += typeof chunk === 'string' ? chunk : chunk?.text ?? '';
      }
      if (text.trim()) return text.trim();
      lastErr = new Error(`渠道 ${provider} 返回空内容`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
};

exports.main = async (event) => {
  const body = parseBody(event);
  if (!body) return resp(400, { error: 'missing body' });
  if (TOKEN && body.token !== TOKEN) return resp(401, { error: 'bad token' });
  if (!body.prompt) return resp(400, { error: 'missing prompt' });

  try {
    return resp(200, { text: await writeText(body.prompt, body.model || MODEL) });
  } catch (e) {
    return resp(500, { error: e?.message || String(e) });
  }
};
