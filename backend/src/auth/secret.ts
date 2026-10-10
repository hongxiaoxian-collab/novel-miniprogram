import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * 敏感凭证的落库加密（微信 session_key）。
 *
 * 为什么单独一层：session_key 是虚拟支付下单签名的密钥，明文落库等于把支付密钥
 * 放在数据库里 —— db 文件一旦被拷走就能伪造支付签名。用 AUTH_SECRET 派生密钥做
 * AES-256-GCM，密文自带 IV 与校验 tag，改一个字节就解不开（会抛错而不是解出乱码）。
 */

const KEY = () => {
  const s = process.env.AUTH_SECRET || process.env.WX_APP_SECRET || '';
  if (!s) return null;
  // 固定 32 字节：短了补、长了截。同一 secret 必须每次派生出同样的 key，否则解不开旧的
  return Buffer.from(s.padEnd(32, '0').slice(0, 32), 'utf8');
};

const ALGO = 'aes-256-gcm';

/** 加密。返回 `v1.<iv>.<tag>.<密文>` 全 base64url；没有密钥时返回 null（宁可不存也不明文存） */
export function encryptSecret(plain: string): string | null {
  const key = KEY();
  if (!key || !plain) return null;
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** 解密。密钥变了 / 数据被改过 / 格式不对，一律返回 null（调用方当"没有"处理，不抛错） */
export function decryptSecret(box: string | null | undefined): string | null {
  const key = KEY();
  if (!key || !box) return null;
  const p = String(box).split('.');
  if (p.length !== 4 || p[0] !== 'v1') return null;
  try {
    const d = createDecipheriv(ALGO, key, Buffer.from(p[1], 'base64url'));
    d.setAuthTag(Buffer.from(p[2], 'base64url'));
    return Buffer.concat([d.update(Buffer.from(p[3], 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null; // 密钥轮换过或数据损坏：当没存过，让调用方引导用户重新登录
  }
}
