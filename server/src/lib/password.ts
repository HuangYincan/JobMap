// ============================================================
// 密码哈希 / 校验(node:crypto scrypt,无新增依赖)
//
// 存储格式:scrypt$N$r$p$salt$hash
//   - N / r / p:scrypt 参数(与 Node 默认一致:16384 / 8 / 1)
//   - salt:16 字节随机 hex
//   - hash:32 字节派生密钥 hex
// ============================================================

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** 用户名:2-32 位,字母(含中文)/数字/下划线。与前端校验一致。 */
export const USERNAME_RE = /^[\p{L}\p{N}_]{2,32}$/u;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const expected = Buffer.from(parts[5], 'hex');
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(password, parts[4], expected.length, { N: n, r, p });
  return timingSafeEqual(expected, actual);
}

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8;
}
