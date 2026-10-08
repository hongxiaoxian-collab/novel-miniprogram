/**
 * 微信云函数：生文代理（ai-write）
 *
 * 为什么需要它：小程序成长计划赠送的 AI 免费额度，只允许「小程序端 SDK」和
 * 「云开发服务端（云函数/云托管）SDK」两种来源消耗；从自有服务器用 API Key
 * 直连 HTTP 会被拒（AI_CHANNEL_NOT_ALLOWED）。因此把模型调用放进云函数，
 * 由 ECS 上的 NestJS 通过 HTTP 触发它 —— 既合规又能吃到免费额度。
 *
 * 部署：云开发控制台 → 云函数 → 新建 → 运行时 Node.js → 上传本目录 zip
 *      → 函数配置：超时 300 秒、内存 512MB
 *      → HTTP 触发：开启「函数 URL」，路径 /ai-write
 *      → 环境变量：AI_WRITE_TOKEN（自定义口令，防被白嫖）
 */
const tcb = require('@cloudbase/node-sdk');

const MODEL = process.env.AI_MODEL || 'hy3';
const TOKEN = process.env.AI_WRITE_TOKEN || '';

let app;
const getApp = () => (app ||= tcb.init({ timeout: 300000 }));

/** 兼容云函数 URL 化后的几种 event 形态 */
const parseBody = (event) => {
  if (!event) return null;
  if (typeof event === 'string') return tryJson(event);
  if (event.body) return typeof event.body === 'string' ? tryJson(event.body) : event.body;
  return event;
};

const tryJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const resp = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

exports.main = async (event) => {
  const body = parseBody(event);
  if (!body) return resp(400, { error: 'missing body' });
  if (TOKEN && body.token !== TOKEN) return resp(401, { error: 'bad token' });
  if (!body.prompt) return resp(400, { error: 'missing prompt' });

  try {
    const model = getApp().ai().createModel('cloudbase');
    const res = await model.streamText({
      model: body.model || MODEL,
      messages: [{ role: 'user', content: body.prompt }],
    });
    let text = '';
    for await (const chunk of res.textStream) text += chunk;
    return resp(200, { text: text.trim() });
  } catch (e) {
    return resp(500, { error: e?.message || String(e) });
  }
};
