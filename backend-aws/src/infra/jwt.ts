import { createHmac, timingSafeEqual } from 'node:crypto';

export type Role = 'athlete' | 'display';

export interface TokenClaims {
  iss: 'lmclub';
  sub: string;
  role: Role;
  club: string;
  cls: string;
  iat: number;
  exp: number;
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const HEADER = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

const mac = (data: string, secret: string): Buffer => createHmac('sha256', secret).update(data).digest();

export function signToken(claims: TokenClaims, secret: string): string {
  const body = `${HEADER}.${b64u(JSON.stringify(claims))}`;
  return `${body}.${b64u(mac(body, secret))}`;
}

/** Returns claims only for a correctly signed, unexpired HS256 token minted by us; otherwise null. */
export function verifyToken(token: string, secret: string, nowSec: number): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null; // also rejects alg=none / alg swaps
  const [h, p, s] = parts as [string, string, string];
  const expected = mac(`${h}.${p}`, secret);
  const actual = Buffer.from(s, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Partial<TokenClaims>;
    const ok =
      c.iss === 'lmclub' &&
      (c.role === 'athlete' || c.role === 'display') &&
      typeof c.sub === 'string' &&
      typeof c.club === 'string' &&
      typeof c.cls === 'string' &&
      typeof c.exp === 'number' &&
      c.exp > nowSec;
    return ok ? (c as TokenClaims) : null;
  } catch {
    return null;
  }
}

/** Class-scoped pseudonym: stable for an account within one class, unlinkable across classes without the secret. */
export function pseudonymFor(secret: string, classId: string, accountId: string): string {
  const h = mac(`athlete:${classId}:${accountId}`, secret).subarray(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x40; // version 4 layout
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
