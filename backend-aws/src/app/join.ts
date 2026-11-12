import { randomUUID } from 'node:crypto';
import { UUID_RE, type AthleteIdentity, type ClassSession, type JoinReceipt } from '@lmclub/contracts';
import { sanitizeDisplayName } from '../domain/displayName';
import { HttpError } from '../domain/errors';
import { toClassSession, toIdentity } from '../domain/mappers';
import type { ClassRepository, ClubRepository, ControlPublisher, PinRepository, RosterRepository } from '../domain/ports';
import type { RosterRecord } from '../domain/types';
import { pseudonymFor, signToken } from '../infra/jwt';

export interface JoinDeps {
  pins: PinRepository;
  classes: ClassRepository;
  clubs: ClubRepository;
  roster: RosterRepository;
  control: ControlPublisher;
  secret: string;
  realtime: ClassSession['realtime'];
  nowSec: () => number;
  newAthleteId?: () => string;
  athleteTokenTtlSeconds: number;
  rosterRetentionSeconds: number;
}

export interface JoinInput {
  pin: unknown;
  displayName: unknown;
  sourceIp: string;
  account?: { id: string; provider: AthleteIdentity['auth_provider'] };
}

/**
 * Check-in. Guest and authenticated athletes share one path; the only difference is whether the
 * pseudonym is random (guest) or derived from the account (so reconnects are idempotent).
 */
export async function joinClass(d: JoinDeps, input: JoinInput): Promise<JoinReceipt> {
  const now = d.nowSec();
  if (await d.pins.isBlocked(input.sourceIp, now)) throw new HttpError(429, 'too_many_attempts');

  const name = sanitizeDisplayName(input.displayName);
  const pin = typeof input.pin === 'string' && /^\d{4}$/.test(input.pin) ? input.pin : null;
  const pinRecord = pin ? await d.pins.resolve(pin, now) : null;
  if (!pinRecord) {
    await d.pins.recordFailure(input.sourceIp, now);
    throw new HttpError(404, 'invalid_or_expired_pin'); // same answer for wrong/expired: no oracle
  }

  const cls = await d.classes.get(pinRecord.class_id);
  const club = cls && (await d.clubs.get(cls.club_id));
  if (!cls || !club) throw new HttpError(404, 'invalid_or_expired_pin');
  if (cls.status === 'completed') throw new HttpError(410, 'class_ended');

  const athleteId = input.account ? pseudonymFor(d.secret, cls.class_id, input.account.id) : (d.newAthleteId ?? randomUUID)();
  if (!UUID_RE.test(athleteId)) throw new Error('bad athlete id');

  const joinedAt = new Date(now * 1000).toISOString();
  const row: RosterRecord = await d.roster.putIfAbsent({
    class_id: cls.class_id,
    athlete_id: athleteId,
    auth_state: input.account ? 'authenticated' : 'guest',
    auth_provider: input.account?.provider ?? null,
    account_id: input.account?.id ?? null,
    display_name: name,
    display_name_override: null,
    override_by: null,
    override_at: null,
    joined_at: joinedAt,
    ttl: now + d.rosterRetentionSeconds,
  });

  // PII-free signal only (UUID). Best effort: the TV also refetches the roster when it sees an unknown athlete_id.
  await d.control
    .publish(cls.club_id, cls.class_id, { v: 1, type: 'roster.changed', data: { athlete_id: row.athlete_id } })
    .catch(() => console.warn('roster.changed publish failed'));

  const exp = now + d.athleteTokenTtlSeconds;
  const token = signToken({ iss: 'lmclub', sub: athleteId, role: 'athlete', club: cls.club_id, cls: cls.class_id, iat: now, exp }, d.secret);

  return {
    v: 1,
    identity: toIdentity(row),
    session: toClassSession(cls, club, d.realtime, { includePin: false, nowSec: now }),
    token,
    token_expires_at: new Date(exp * 1000).toISOString(),
    topics: {
      publish: `${cls.club_id}/${cls.class_id}/${athleteId}`,
      control: `${cls.club_id}/${cls.class_id}/_control/events`,
    },
  };
}
