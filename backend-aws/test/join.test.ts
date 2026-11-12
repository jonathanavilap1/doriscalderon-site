import { describe, expect, it } from 'vitest';
import { isJoinReceipt } from '@lmclub/contracts';
import { joinClass, type JoinDeps } from '../src/app/join';
import { verifyToken } from '../src/infra/jwt';
import type { ClassRecord, ClubRecord, PinRecord, RosterRecord } from '../src/domain/types';
import type { ControlPublisher } from '../src/domain/ports';

const CLASS_ID = '5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77';
const NOW = 1_800_000_000;

const club: ClubRecord = { club_id: 'iron-house', club_name: 'Iron House', logo_url: 'https://cdn.example.com/l.png', accent_color: '#FF6B00', subscription_status: 'active' };
const cls: ClassRecord = { class_id: CLASS_ID, club_id: 'iron-house', coach_id: 'c', workout_type: 'hyrox', title: 'T', status: 'live', starts_at: '2026-11-14T12:00:00Z', ended_at: null, pin: '4821', pin_expires_at: NOW + 600 };

function setup(over: { classRec?: ClassRecord; failPublish?: boolean } = {}) {
  const roster = new Map<string, RosterRecord>();
  const failures: string[] = [];
  const published: unknown[] = [];
  const pinRec: PinRecord = { pin: '4821', class_id: CLASS_ID, club_id: 'iron-house', expires_at: NOW + 600 };
  const control: ControlPublisher = {
    async publish(_c, _k, m) {
      if (over.failPublish) throw new Error('iot down');
      published.push(m);
    },
  };
  const deps: JoinDeps = {
    pins: {
      allocate: async () => pinRec,
      resolve: async (p, now) => (p === pinRec.pin && pinRec.expires_at > now ? pinRec : null),
      revoke: async () => undefined,
      isBlocked: async (ip) => failures.filter((f) => f === ip).length >= 3,
      recordFailure: async (ip) => void failures.push(ip),
    },
    classes: { get: async () => over.classRec ?? cls, put: async () => undefined, setPin: async () => undefined, markCompleted: async () => null },
    clubs: { get: async () => club, put: async () => undefined },
    roster: {
      get: async (c, a) => roster.get(`${c}/${a}`) ?? null,
      list: async () => [...roster.values()],
      putIfAbsent: async (r) => roster.get(`${r.class_id}/${r.athlete_id}`) ?? (roster.set(`${r.class_id}/${r.athlete_id}`, r), r),
      setOverride: async () => null,
    },
    control,
    secret: 's3cret',
    realtime: { iot_endpoint: 'x-ats.iot.us-east-1.amazonaws.com', authorizer: 'lmclub-authorizer' },
    nowSec: () => NOW,
    athleteTokenTtlSeconds: 3600,
    rosterRetentionSeconds: 86_400,
  };
  return { deps, roster, published, failures };
}

const input = { pin: '4821', displayName: 'xX_mike_Xx', sourceIp: '1.2.3.4' };

describe('joinClass', () => {
  it('guest join yields a contract-valid receipt and a topic-scoped token', async () => {
    const { deps, published } = setup();
    const r = await joinClass(deps, input);
    expect(isJoinReceipt(r)).toBe(true);
    expect(r.identity.auth_state).toBe('guest');
    expect(r.session.join).toBeNull(); // the PIN is not echoed back to athletes
    const claims = verifyToken(r.token, 's3cret', NOW)!;
    expect(claims).toMatchObject({ role: 'athlete', sub: r.identity.athlete_id, cls: CLASS_ID });
    expect(r.topics.publish).toBe(`iron-house/${CLASS_ID}/${r.identity.athlete_id}`);
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ v: 1, type: 'roster.changed', data: { athlete_id: r.identity.athlete_id } });
    expect(JSON.stringify(published)).not.toContain('xX_mike_Xx'); // zero PII on the IoT layer
  });

  it('never leaks the account id into any outward-facing structure', async () => {
    const { deps, roster } = setup();
    const r = await joinClass(deps, { ...input, account: { id: 'cognito-sub-SECRET', provider: 'apple' } });
    expect(JSON.stringify(r)).not.toContain('cognito-sub-SECRET');
    expect(r.identity.auth_state).toBe('authenticated');
    expect([...roster.values()][0]!.account_id).toBe('cognito-sub-SECRET'); // stored server-side only
  });

  it('authenticated re-join is idempotent (same pseudonym, no duplicate row)', async () => {
    const { deps, roster } = setup();
    const a = await joinClass(deps, { ...input, account: { id: 'acct', provider: 'email' } });
    const b = await joinClass(deps, { ...input, account: { id: 'acct', provider: 'email' } });
    expect(b.identity.athlete_id).toBe(a.identity.athlete_id);
    expect(roster.size).toBe(1);
  });

  it('answers wrong and expired PINs identically and counts failures', async () => {
    const { deps, failures } = setup();
    await expect(joinClass(deps, { ...input, pin: '0000' })).rejects.toMatchObject({ status: 404, message: 'invalid_or_expired_pin' });
    await expect(joinClass({ ...deps, nowSec: () => NOW + 601 }, input)).rejects.toMatchObject({ status: 404, message: 'invalid_or_expired_pin' });
    expect(failures).toHaveLength(2);
  });

  it('blocks a source IP after repeated failures even with a valid PIN', async () => {
    const { deps } = setup();
    for (let i = 0; i < 3; i++) await joinClass(deps, { ...input, pin: '9999' }).catch(() => undefined);
    await expect(joinClass(deps, input)).rejects.toMatchObject({ status: 429 });
  });

  it('refuses joins to a completed class', async () => {
    const { deps } = setup({ classRec: { ...cls, status: 'completed' } });
    await expect(joinClass(deps, input)).rejects.toMatchObject({ status: 410 });
  });

  it('still succeeds when the MQTT roster push fails', async () => {
    const { deps } = setup({ failPublish: true });
    await expect(joinClass(deps, input)).resolves.toBeDefined();
  });
});
