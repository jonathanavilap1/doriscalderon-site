import type { AthleteIdentity, ClassSession, RosterEntry } from '@lmclub/contracts';
import type { ClassRecord, ClubRecord, RosterRecord } from './types';

export const effectiveName = (r: RosterRecord): string => r.display_name_override ?? r.display_name;

export function toIdentity(r: RosterRecord): AthleteIdentity {
  return {
    v: 1,
    athlete_id: r.athlete_id,
    class_id: r.class_id,
    auth_state: r.auth_state,
    auth_provider: r.auth_provider,
    display_name: r.display_name,
    display_name_override: r.display_name_override,
    override_by: r.override_by,
    override_at: r.override_at,
    joined_at: r.joined_at,
  };
}

/** Presentation-layer projection: the only place UUID -> name is resolved for the TV. */
export function toRosterEntry(r: RosterRecord): RosterEntry {
  return { athlete_id: r.athlete_id, display_name: effectiveName(r), auth_state: r.auth_state, overridden: r.display_name_override !== null };
}

export function toClassSession(
  cls: ClassRecord,
  club: ClubRecord,
  realtime: ClassSession['realtime'],
  opts: { includePin: boolean; nowSec: number },
): ClassSession {
  const pinLive = opts.includePin && cls.pin !== null && cls.pin_expires_at !== null && cls.pin_expires_at > opts.nowSec;
  return {
    v: 1,
    class_id: cls.class_id,
    club_id: cls.club_id,
    workout_type: cls.workout_type,
    status: cls.status,
    title: cls.title,
    starts_at: cls.starts_at,
    ended_at: cls.ended_at,
    branding: {
      club_name: club.club_name,
      logo_url: club.logo_url,
      accent_color: club.accent_color,
      ...(club.secondary_color ? { secondary_color: club.secondary_color } : {}),
    },
    join: pinLive ? { pin: cls.pin!, pin_expires_at: new Date(cls.pin_expires_at! * 1000).toISOString() } : null,
    realtime,
  };
}
