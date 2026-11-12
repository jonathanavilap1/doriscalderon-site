/**
 * MQTT topic taxonomy. Hierarchy: `{clubId}/{classId}/{athleteId}`.
 * Server events live one level deeper (`_control/events`) so that the Timestream
 * rule filter `+/+/+` can never match them and athlete policies can be scoped tightly.
 */
export const CLUB_ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CONTROL_SEGMENT = '_control';

export function assertIds(clubId: string, classId: string, athleteId?: string): void {
  if (!CLUB_ID_RE.test(clubId)) throw new Error('invalid club id');
  if (!UUID_RE.test(classId)) throw new Error('invalid class id');
  if (athleteId !== undefined && !UUID_RE.test(athleteId)) throw new Error('invalid athlete id');
}

export const telemetryTopic = (clubId: string, classId: string, athleteId: string): string => {
  assertIds(clubId, classId, athleteId);
  return `${clubId}/${classId}/${athleteId}`;
};

export const controlTopic = (clubId: string, classId: string): string => {
  assertIds(clubId, classId);
  return `${clubId}/${classId}/${CONTROL_SEGMENT}/events`;
};

/** TV subscription: everything in the class. */
export const classWildcard = (clubId: string, classId: string): string => {
  assertIds(clubId, classId);
  return `${clubId}/${classId}/#`;
};

export type ParsedTopic =
  | { kind: 'telemetry'; clubId: string; classId: string; athleteId: string }
  | { kind: 'control'; clubId: string; classId: string };

export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  const [clubId, classId, third, fourth] = parts;
  if (!clubId || !classId || !third) return null;
  if (!CLUB_ID_RE.test(clubId) || !UUID_RE.test(classId)) return null;
  if (parts.length === 3 && UUID_RE.test(third)) return { kind: 'telemetry', clubId, classId, athleteId: third };
  if (parts.length === 4 && third === CONTROL_SEGMENT && fourth === 'events') return { kind: 'control', clubId, classId };
  return null;
}
