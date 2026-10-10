/**
 * 微信云函数：生文代理（ai-write）
 *
 * 为什么需要它：小程序成长计划赠送的 AI 免费额度，只允许「小程序端 SDK」和
 * 「云开发服务端（云函数/云托管）SDK」两种来源消耗；从自有服务器用 API Key
 * 直连 HTTP 会被拒（AI_CHANNEL_NOT_ALLOWED）。因此把模型调用放进云函数，
 * 由 ECS 上的 NestJS 通过 HTTP 触发它 —— 既合规又能吃到免费额度。
 *
 * 一份代码两种形态都能跑：
 *   · HTTP 云函数（Web 函数）：scf_bootstrap 执行 `node index.js` → 起 HTTP 服务监听 9000
 *   · 普通云函数（事件函数）：平台注入调用 → 走 exports.main(event)
 *
 * 若手动验证：POST {token, prompt} → 200 {text}；口令不对 → 401 {error:"bad token"}
 * 部署：函数配置里加环境变量 AI_WRITE_TOKEN；超时 300 秒、内存 512MB。
 */
const http = require('http');
const tcb = require('@cloudbase/node-sdk');

const PORT = process.env.PORT || 9000;
const MODEL = process.env.AI_MODEL || 'hy3';
const TOKEN = process.env.AI_WRITE_TOKEN || '';
const ENV_ID = process.env.TCB_ENV || process.env.CLOUDBASE_ENV_ID || 'zhicheng-novel-d9g7rdxjo798da6d0';
/** 模型渠道名，逐个试；不同版本控制台口径不一，留回退避免一次失败就卡死 */
const PROVIDERS = (process.env.AI_PROVIDER || 'cloudbase,hunyuan-exp')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let app;
const getApp = () =>
  (app ||= tcb.init({
    env: ENV_ID,
    // HTTP 云函数没有事件函数的免密上下文，需显式带平台注入的临时凭证（有则带上）
    ...(process.env.TENCENTCLOUD_SECRETID
      ? {
          secretId: process.env.TENCENTCLOUD_SECRETID,
          secretKey: process.env.TENCENTCLOUD_SECRETKEY,
          sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
        }
      : {}),
    timeout: 300000,
  }));

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

/* ---------------- 生图 ---------------- */
/**
 * 生图渠道。免费额度里含「10 万张生图」，同样只认小程序端 / 云函数来源，
 * 所以图片也必须从这里出去（自有服务器直连会被拒且按量计费）。
 * 默认走混元生图；AR 系列（v3.0）留作回退。
 */
// 只走 hunyuan-image：SDK 里只有它配了正确的子路径（images/generations）。
// 换别的 provider 名会落到默认的 images/ar/generations 端点，模型名对不上只会白报错。
const IMAGE_PROVIDERS = ['hunyuan-image'];
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL || 'hunyuan-image';
/** 3:4 竖版，正好是番茄/七猫封面比例 */
const IMAGE_SIZE = process.env.AI_IMAGE_SIZE || '768x1024';

const genImage = async (prompt, opts = {}) => {
  const ai = getApp().ai();
  let lastErr;
  for (const provider of IMAGE_PROVIDERS) {
    try {
      const input = {
        model: opts.imageModel || IMAGE_MODEL,
        prompt,
        size: opts.size || IMAGE_SIZE,
      };
      if (opts.seed != null && opts.seed !== '') input.seed = Number(opts.seed);
      if (opts.style) input.style = opts.style;
      const res = await ai.createImageModel(provider).generateImage(input);
      const url = res && res.data && res.data[0] && res.data[0].url;
      if (url) return url;
      lastErr = new Error(`渠道 ${provider} 未返回图片 URL：${JSON.stringify(res).slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
};

/** 统一处理：kind=image 出图（返回临时 URL），否则出文 */
const handle = async (payload) => {
  if (!payload) return { code: 400, data: { error: 'missing body' } };
  if (TOKEN && payload.token !== TOKEN) return { code: 401, data: { error: 'bad token' } };
  if (!payload.prompt) return { code: 400, data: { error: 'missing prompt' } };

  if (payload.kind === 'image') {
    try {
      const url = await genImage(payload.prompt, payload);
      return { code: 200, data: { url } };
    } catch (e) {
      return { code: 500, data: { error: e?.message || String(e) } };
    }
  }

  try {
    return { code: 200, data: { text: await writeText(payload.prompt, payload.model || MODEL) } };
  } catch (e) {
    return { code: 500, data: { error: e?.message || String(e) } };
  }
};

/* ---------------- 形态一：事件函数入口 ---------------- */
exports.main = async (event) => {
  const payload =
    !event ? null
    : typeof event === 'string' ? JSON.parse(event)
    : event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body)
    : event;
  const { code, data } = await handle(payload);
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
};

/* ---------------- 形态二：HTTP 云函数（Web）入口 ---------------- */
const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });

const send = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { ok: true, hint: 'POST {token, prompt} 出文；POST {token, kind:"image", prompt} 出图' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  let payload;
  try {
    payload = await readJson(req);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  const { code, data } = await handle(payload);
  send(res, code, data);
});

// 只有被直接 `node index.js` 启动时（scf_bootstrap）才监听端口；
// 作为事件函数被平台 require 时 require.main !== module，不会误启服务。
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`ai-write listening on 0.0.0.0:${PORT}`));
}
