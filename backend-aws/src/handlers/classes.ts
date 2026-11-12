import { randomUUID } from 'node:crypto';
import { WORKOUT_TYPES, type ClassSession } from '@lmclub/contracts';
import { HttpError } from '../domain/errors';
import { toClassSession, toRosterEntry } from '../domain/mappers';
import type { ClassRecord } from '../domain/types';
import { config } from '../infra/config';
import { container, nowSec } from '../infra/container';
import { json, parseBody, requireRoleToken, staffFrom, wrap } from '../infra/http';
import { signToken } from '../infra/jwt';
import { jwtSecret } from '../infra/secret';

const COACHES = ['coach', 'club_admin'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const classIdParam = (id: string | undefined): string => {
  if (!id || !UUID.test(id)) throw new HttpError(400, 'invalid_class_id');
  return id;
};

async function ownedClass(classId: string, clubId: string): Promise<ClassRecord> {
  const cls = await container().classes.get(classId);
  if (!cls || cls.club_id !== clubId) throw new HttpError(404, 'class_not_found'); // no cross-tenant existence oracle
  return cls;
}

/** POST /classes (coach iPad). Creates the class, its first PIN, and a TV pairing token. */
export const createClass = wrap(async (event) => {
  const staff = staffFrom(event, COACHES);
  const body = parseBody<{ title?: unknown; workout_type?: unknown }>(event);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 80) throw new HttpError(400, 'invalid_title');
  const workoutType = WORKOUT_TYPES.find((w) => w === body.workout_type);
  if (!workoutType) throw new HttpError(400, 'invalid_workout_type');

  const c = container();
  const club = await c.clubs.get(staff.clubId);
  if (!club) throw new HttpError(404, 'club_not_found');
  if (club.subscription_status !== 'active' && club.subscription_status !== 'trialing') throw new HttpError(402, 'subscription_inactive');

  const now = nowSec();
  const classId = randomUUID();
  const pin = await c.pins.allocate(classId, staff.clubId, config.pinTtlSeconds, now);
  const record: ClassRecord = {
    class_id: classId,
    club_id: staff.clubId,
    coach_id: staff.sub,
    workout_type: workoutType,
    title,
    status: 'live',
    starts_at: new Date(now * 1000).toISOString(),
    ended_at: null,
    pin: pin.pin,
    pin_expires_at: pin.expires_at,
  };
  await c.classes.put(record);

  const tvToken = signToken(
    { iss: 'lmclub', sub: `tv-${classId}`, role: 'display', club: staff.clubId, cls: classId, iat: now, exp: now + config.tvTokenTtlSeconds },
    await jwtSecret(),
  );
  const session: ClassSession = toClassSession(record, club, c.realtime, { includePin: true, nowSec: now });
  return json(201, { session, tv_token: tvToken });
});

/** POST /classes/{classId}/pin: issue a fresh PIN (old one is revoked immediately). */
export const rotatePin = wrap(async (event) => {
  const staff = staffFrom(event, COACHES);
  const cls = await ownedClass(classIdParam(event.pathParameters?.classId), staff.clubId);
  if (cls.status === 'completed') throw new HttpError(409, 'class_ended');
  const c = container();
  const now = nowSec();
  const pin = await c.pins.allocate(cls.class_id, cls.club_id, config.pinTtlSeconds, now);
  await c.classes.setPin(cls.class_id, pin.pin, pin.expires_at);
  if (cls.pin) await c.pins.revoke(cls.pin);
  return json(200, { pin: pin.pin, pin_expires_at: new Date(pin.expires_at * 1000).toISOString() });
});

/** POST /classes/{classId}/end: marks completed and emits ClassCompleted (idempotent; safe to retry). */
export const endClass = wrap(async (event) => {
  const staff = staffFrom(event, COACHES);
  const cls = await ownedClass(classIdParam(event.pathParameters?.classId), staff.clubId);
  const c = container();
  const done = await c.classes.markCompleted(cls.class_id, new Date().toISOString());
  if (!done) throw new HttpError(404, 'class_not_found');
  if (cls.pin) await c.pins.revoke(cls.pin);
  await c.control.publish(cls.club_id, cls.class_id, { v: 1, type: 'class.state', data: { status: 'completed' } }).catch(() => undefined);
  await c.events.classCompleted({ club_id: cls.club_id, class_id: cls.class_id, workout_type: cls.workout_type, ended_at: done.ended_at! });
  return json(202, { status: 'completed' });
});

/** GET /classes/{classId} (TV bearer token). Returns the ClassSession incl. branding + PIN. */
export const getClass = wrap(async (event) => {
  const classId = classIdParam(event.pathParameters?.classId);
  await requireRoleToken(event, 'display', classId);
  const c = container();
  const cls = await c.classes.get(classId);
  const club = cls && (await c.clubs.get(cls.club_id));
  if (!cls || !club) throw new HttpError(404, 'class_not_found');
  return json(200, toClassSession(cls, club, c.realtime, { includePin: true, nowSec: nowSec() }));
});

/** GET /classes/{classId}/roster (TV bearer token). UUID -> effective display name. */
export const getRoster = wrap(async (event) => {
  const classId = classIdParam(event.pathParameters?.classId);
  await requireRoleToken(event, 'display', classId);
  const rows = await container().roster.list(classId);
  return json(200, { roster: rows.map(toRosterEntry) });
});
