import { isBranding, UUID_RE, type Branding } from '@lmclub/contracts';
import { sanitizeDisplayName } from '../domain/displayName';
import { HttpError } from '../domain/errors';
import { toRosterEntry } from '../domain/mappers';
import { container, nowSec } from '../infra/container';
import { json, parseBody, staffFrom, wrap } from '../infra/http';

/** PUT /club/branding (Club Admin). The club comes from the token, never from the URL. */
export const putBranding = wrap(async (event) => {
  const staff = staffFrom(event, ['club_admin']);
  const body = parseBody<Record<string, unknown>>(event);
  if (!isBranding(body)) throw new HttpError(400, 'invalid_branding');
  const branding: Branding = body;
  const c = container();
  const club = await c.clubs.get(staff.clubId);
  if (!club) throw new HttpError(404, 'club_not_found');
  await c.clubs.put({
    ...club,
    club_name: branding.club_name,
    logo_url: branding.logo_url,
    accent_color: branding.accent_color,
    secondary_color: branding.secondary_color,
  });
  return json(200, { ok: true });
});

/**
 * PUT /classes/{classId}/roster/{athleteId}/name (Club Admin override).
 * Body `{ "display_name": null }` clears the override. Pushes the change to the TV over MQTT.
 */
export const overrideName = wrap(async (event) => {
  const staff = staffFrom(event, ['club_admin']);
  const { classId, athleteId } = event.pathParameters ?? {};
  if (!classId || !athleteId || !UUID_RE.test(classId) || !UUID_RE.test(athleteId)) throw new HttpError(400, 'invalid_id');

  const c = container();
  const cls = await c.classes.get(classId);
  if (!cls || cls.club_id !== staff.clubId) throw new HttpError(404, 'class_not_found');

  const body = parseBody<{ display_name?: unknown }>(event);
  const name = body.display_name === null ? null : sanitizeDisplayName(body.display_name);
  const row = await c.roster.setOverride(classId, athleteId, name, staff.sub, new Date(nowSec() * 1000).toISOString());
  if (!row) throw new HttpError(404, 'athlete_not_found');

  await c.control.publish(cls.club_id, cls.class_id, { v: 1, type: 'roster.changed', data: { athlete_id: row.athlete_id } }).catch(() => undefined);
  return json(200, toRosterEntry(row));
});
