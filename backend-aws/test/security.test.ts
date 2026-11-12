import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { pseudonymFor, signToken, verifyToken, type TokenClaims } from '../src/infra/jwt';
import { extractToken, policyFor } from '../src/handlers/authorizer';
import { sanitizeDisplayName } from '../src/domain/displayName';
import { toIso } from '../src/infra/timestream';
import { UUID_RE } from '@lmclub/contracts';

process.env.AWS_REGION = 'us-east-1';
process.env.ACCOUNT_ID = '123456789012';

const SECRET = 'test-secret';
const claims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
  iss: 'lmclub', sub: '0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10', role: 'athlete', club: 'iron-house',
  cls: '5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77', iat: 1000, exp: 2000, ...over,
});

describe('jwt', () => {
  it('round-trips and enforces expiry', () => {
    const t = signToken(claims(), SECRET);
    expect(verifyToken(t, SECRET, 1500)?.sub).toBe(claims().sub);
    expect(verifyToken(t, SECRET, 2000)).toBeNull();
  });
  it('rejects wrong secret, tampering and alg=none', () => {
    const t = signToken(claims(), SECRET);
    expect(verifyToken(t, 'other', 1500)).toBeNull();
    const [h, , s] = t.split('.');
    const forged = Buffer.from(JSON.stringify(claims({ role: 'display' }))).toString('base64url');
    expect(verifyToken(`${h}.${forged}.${s}`, SECRET, 1500)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${forged}.`;
    expect(verifyToken(none, SECRET, 1500)).toBeNull();
    const hs512 = Buffer.from('{"alg":"HS512","typ":"JWT"}').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${hs512}.${forged}`).digest('base64url');
    expect(verifyToken(`${hs512}.${forged}.${sig}`, SECRET, 1500)).toBeNull();
  });
  it('derives a stable, class-scoped, UUID-shaped pseudonym', () => {
    const a = pseudonymFor(SECRET, 'c1', 'acct');
    expect(a).toBe(pseudonymFor(SECRET, 'c1', 'acct'));
    expect(a).not.toBe(pseudonymFor(SECRET, 'c2', 'acct'));
    expect(a).toMatch(UUID_RE);
  });
});

describe('iot authorizer', () => {
  it('extracts the token from WebSocket query, MQTT password or token field', () => {
    expect(extractToken({ token: 't1' })).toBe('t1');
    expect(extractToken({ protocolData: { http: { queryString: '?x-amz-customauthorizer-name=a&token=t2' } } })).toBe('t2');
    expect(extractToken({ protocolData: { mqtt: { password: Buffer.from('t3').toString('base64') } } })).toBe('t3');
    expect(extractToken({})).toBeNull();
  });
  it('athlete may publish only to their own topic and only read the control topic', () => {
    const p = policyFor(claims()) as { Statement: { Action: string; Resource: string }[] };
    const c = claims();
    const publish = p.Statement.filter((s) => s.Action === 'iot:Publish');
    expect(publish).toEqual([{ Effect: 'Allow', Action: 'iot:Publish', Resource: `arn:aws:iot:us-east-1:123456789012:topic/${c.club}/${c.cls}/${c.sub}` }]);
    expect(p.Statement.find((s) => s.Action === 'iot:Subscribe')?.Resource).toMatch(/_control\/events$/);
    expect(JSON.stringify(p)).not.toContain('#');
  });
  it('display token is read-only for its class', () => {
    const c = claims({ role: 'display', sub: 'tv-x' });
    const p = policyFor(c) as { Statement: { Action: string; Resource: string }[] };
    expect(p.Statement.some((s) => s.Action === 'iot:Publish')).toBe(false);
    expect(p.Statement.find((s) => s.Action === 'iot:Subscribe')?.Resource).toBe(`arn:aws:iot:us-east-1:123456789012:topicfilter/${c.club}/${c.cls}/#`);
  });
});

describe('sanitizeDisplayName', () => {
  it('strips bidi/zero-width controls and collapses whitespace', () => {
    expect(sanitizeDisplayName('  Mi\u202Eke\u200B   R. ')).toBe('Mi ke R.');
  });
  it('rejects empty, oversized and non-string input', () => {
    expect(() => sanitizeDisplayName('\u200B\u202E')).toThrow();
    expect(() => sanitizeDisplayName('x'.repeat(25))).toThrow();
    expect(() => sanitizeDisplayName(42)).toThrow();
  });
  it('counts code points, not UTF-16 units', () => {
    expect(sanitizeDisplayName('💪'.repeat(24))).toHaveLength(48);
  });
});

describe('timestream helpers', () => {
  it('converts timestamps', () => {
    expect(toIso('2026-11-14 12:01:00.000000000')).toBe('2026-11-14T12:01:00.000Z');
  });
});
