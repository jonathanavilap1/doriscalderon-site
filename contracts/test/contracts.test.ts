import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  classWildcard, controlTopic, isAthleteIdentity, isClassResults, isClassSession, isControlMessage,
  isHeartRatePayload, isJoinReceipt, isRosterEntry, parseTopic, telemetryTopic, zoneFor, ZONE_NAMES, type Zone,
} from '../src';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const load = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

describe('example fixtures satisfy the schemas', () => {
  it.each([
    ['heart-rate-payload.json', isHeartRatePayload],
    ['class-session.json', isClassSession],
    ['athlete-identity.json', isAthleteIdentity],
    ['roster-entry.json', isRosterEntry],
    ['class-results.json', isClassResults],
    ['control-message.json', isControlMessage],
    ['join-receipt.json', isJoinReceipt],
  ] as const)('%s', (file, guard) => {
    expect(guard(load(file))).toBe(true);
  });
});

describe('schemas reject bad input', () => {
  const hr = load('heart-rate-payload.json');
  it('rejects PII / unknown fields in telemetry', () => {
    expect(isHeartRatePayload({ ...hr, display_name: 'Mike' })).toBe(false);
    expect(isHeartRatePayload({ ...hr, age: 33 })).toBe(false);
  });
  it('rejects out-of-range bpm', () => {
    expect(isHeartRatePayload({ ...hr, bpm: 400 })).toBe(false);
  });
  it('rejects display names on the real-time control channel (zero PII over IoT)', () => {
    const msg = load('control-message.json');
    expect(isControlMessage(msg)).toBe(true);
    expect(isControlMessage({ ...msg, data: { ...msg.data, display_name: 'Mike' } })).toBe(false);
  });
  it('rejects non-https logo and non-hex color', () => {
    const s = load('class-session.json');
    expect(isClassSession({ ...s, branding: { ...s.branding, logo_url: 'http://x/y.png' } })).toBe(false);
    expect(isClassSession({ ...s, branding: { ...s.branding, accent_color: 'red; background:url(x)' } })).toBe(false);
  });
});

describe('zones', () => {
  it('matches cross-language vectors', () => {
    for (const v of load('zone-vectors.json') as { effort_pct: number; zone: Zone }[]) {
      expect(zoneFor(v.effort_pct)).toBe(v.zone);
    }
  });
  it('exposes the five documented zones', () => {
    expect(ZONE_NAMES).toEqual(['gray', 'blue', 'green', 'orange', 'red']);
  });
});

describe('topics', () => {
  const club = 'iron-house';
  const cls = '5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77';
  const ath = '0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10';
  it('round-trips', () => {
    expect(parseTopic(telemetryTopic(club, cls, ath))).toEqual({ kind: 'telemetry', clubId: club, classId: cls, athleteId: ath });
    expect(parseTopic(controlTopic(club, cls))).toEqual({ kind: 'control', clubId: club, classId: cls });
    expect(classWildcard(club, cls)).toBe(`${club}/${cls}/#`);
  });
  it('rejects malformed topics and ids (also guards SQL interpolation)', () => {
    expect(parseTopic(`${club}/${cls}/not-a-uuid`)).toBeNull();
    expect(() => telemetryTopic("x'; DROP", cls, ath)).toThrow();
  });
});
