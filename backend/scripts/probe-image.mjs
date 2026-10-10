/**
 * 探活云函数：文本通道 / 生图通道 / 口令校验 / HTTP 方法。
 * 只读 .env，不打印 token 全文。
 */
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = env.CLOUDBASE_FN_URL;
const token = env.CLOUDBASE_FN_TOKEN;
if (!url) { console.log('NO_FN_URL'); process.exit(0); }

const call = async (body, method = 'POST') => {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 500) };
  } catch (e) {
    return { status: 'ERR', text: e?.message || String(e) };
  }
};

const show = (label, r) => console.log(`${label}\n  ${JSON.stringify(r)}`);

show('1) GET ', await call(null, 'GET'));
show('2) 文本（正确口令）', await call({ token, prompt: '回一个字：好' }));
show('3) 口令校验（错误口令，期望 401）', await call({ token: 'wrong-token-xxx', prompt: 'hi' }));
show('4) 生图（正确口令）', await call({ token, kind: 'image', prompt: '古代言情小说封面底图：一位红衣女子立在烛光下的深色内室，电影级写实，画面下方三分之一留深色空白', size: '768x1024' }));
