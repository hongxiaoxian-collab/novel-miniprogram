import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 登录凭证。用内置 crypto 自签 HMAC，不引入 jwt 依赖 —— 少一个包，服务器少一次 npm install。
 * 格式：v1.<payload base64url>.<签名>
 */

const SECRET = process.env.AUTH_SECRET
  || process.env.WX_APP_SECRET
  || 'dev-only-secret-please-set-AUTH_SECRET';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function signToken(uid: string, days = 30): string {
  const body = b64(JSON.stringify({ uid, exp: Date.now() + days * 864e5 }));
  return `v1.${body}.${sign(body)}`;
}

export function verifyToken(token: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  const [, body, mac] = parts;
  const a = Buffer.from(sign(body));
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const p = JSON.parse(unb64(body)) as { uid?: string; exp?: number };
    if (!p.uid || !p.exp || p.exp < Date.now()) return null;
    return p.uid;
  } catch {
    return null;
  }
}

/** 从 Authorization: Bearer xxx 里取 userId。解析不出来返回 null（= 未登录，按游客处理） */
export function uidFromHeader(auth?: string): string | null {
  if (!auth) return null;
  const t = auth.replace(/^Bearer\s+/i, '').trim();
  return verifyToken(t);
}

/**
 * 游客匿名标识。未登录时用它统计"这个游客建了几本、今天写了几章"。
 *
 * 为什么不直接按"所有 userId 为空的作品"统算：那样所有游客共用一个池，
 * A 建了一本就会把 B 卡死 —— 限制必须能落到具体某个游客头上才算数。
 *
 * 只做格式校验（6-64 位可见字符），不解析任何内容：
 * 它来自客户端，永远当不可信输入处理。
 */
export function guestFromHeader(h?: string): string | null {
  if (!h) return null;
  const k = String(h).trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(k)) return null;
  return k;
}
