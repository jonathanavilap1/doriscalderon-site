import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isHeartRatePayload, type HeartRatePayload } from '@lmclub/contracts';
import { brandingToCssVars, safeLogoUrl } from '../src/domain/branding';
import { parseControl, parseTelemetry, STALE_AFTER_MS, TelemetryStore } from '../src/domain/telemetryStore';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const hr = (over: Partial<HeartRatePayload> = {}): HeartRatePayload => ({ v: 1, bpm: 170, effort_pct: 93, ts: 1000, seq: 1, source: 'apple_watch', ...over });
const roster = (id: string, name: string) => ({ athlete_id: id, display_name: name, auth_state: 'guest' as const, overridden: false });

describe('parseTelemetry', () => {
  it('agrees with the JSON Schema on the shared fixture and on bad input (the schema is stricter only about unknown fields)', () => {
    const fixture = readFileSync(new URL('../../contracts/examples/heart-rate-payload.json', import.meta.url), 'utf8');
    expect(parseTelemetry(fixture)).not.toBeNull();
    const cases = [{ ...hr(), bpm: 400 }, { ...hr(), source: 'x' }, { ...hr(), v: 2 }, { ...hr(), seq: -1 }, hr()];
    for (const c of cases) expect(parseTelemetry(JSON.stringify(c)) !== null).toBe(isHeartRatePayload(c));
    expect(parseTelemetry('not json')).toBeNull();
  });
  it('parses control messages and ignores junk', () => {
    expect(parseControl(JSON.stringify({ v: 1, type: 'class.state', data: { status: 'completed' } }))?.type).toBe('class.state');
    expect(parseControl('{"v":1,"type":"evil","data":{}}')).toBeNull();
    expect(parseControl(JSON.stringify({ v: 1, type: 'roster.changed', data: { athlete_id: A } }))?.type).toBe('roster.changed');
  });
});

describe('TelemetryStore', () => {
  it('colours by effort zone and ranks by accumulated points', () => {
    const s = new TelemetryStore();
    s.setRoster([roster(A, 'Ana'), roster(B, 'Ben')]);
    s.ingest(A, hr({ seq: 1, ts: 1000 }), 0);
    s.ingest(A, hr({ seq: 2, ts: 2000 }), 1000); // 1s in red = 4/60 pts
    s.ingest(B, hr({ seq: 1, ts: 1000, effort_pct: 72 }), 0);
    s.ingest(B, hr({ seq: 2, ts: 2000, effort_pct: 72 }), 1000);
    const st = s.snapshot(1000);
    expect(st.athletes.map((a) => [a.name, a.zone, a.rank])).toEqual([['Ana', 'red', 1], ['Ben', 'green', 2]]);
    expect(st.podium).toHaveLength(2);
  });

  it('marks silent athletes stale/gray and stops crediting a reconnect gap beyond the cap', () => {
    const s = new TelemetryStore();
    s.ingest(A, hr({ seq: 1, ts: 1 }), 0);
    s.ingest(A, hr({ seq: 2, ts: 2 }), 60_000); // 60s gap: credit capped at 3s of red
    expect(s.snapshot(60_000).athletes[0]!.points).toBeCloseTo((4 * 3) / 60, 1);
    expect(s.snapshot(60_000 + STALE_AFTER_MS + 1).athletes[0]).toMatchObject({ stale: false }); // cached until touched
    s.touch();
    expect(s.snapshot(60_000 + STALE_AFTER_MS + 1).athletes[0]).toMatchObject({ stale: true, zone: 'gray' });
  });

  it('drops reordered frames but accepts a restarted publisher', () => {
    const s = new TelemetryStore();
    s.ingest(A, hr({ seq: 5, ts: 5000, bpm: 150 }), 0);
    s.ingest(A, hr({ seq: 4, ts: 4000, bpm: 100 }), 10);
    expect(s.snapshot(10).athletes[0]!.bpm).toBe(150);
    s.ingest(A, hr({ seq: 0, ts: 9000, bpm: 120 }), 20); // seq reset, newer clock
    expect(s.snapshot(20).athletes[0]!.bpm).toBe(120);
  });

  it('reports unresolved ids until the roster (fetched over REST) resolves them', () => {
    const s = new TelemetryStore();
    s.ingest(A, hr(), 0);
    expect(s.snapshot(0).unresolvedIds).toEqual([A]);
    s.setRoster([{ ...roster(A, 'Mike R.'), overridden: true }]); // what the REST refetch yields after an admin override
    const st = s.snapshot(0);
    expect(st.unresolvedIds).toEqual([]);
    expect(st.athletes[0]!.name).toBe('Mike R.');
  });

  it('final results mark the class completed', () => {
    const s = new TelemetryStore();
    s.apply({ v: 1, type: 'class.state', data: { status: 'completed' } });
    expect(s.snapshot(0).classStatus).toBe('completed');
  });
});

describe('branding', () => {
  it('rejects non-https logos and falls back on malicious colours', () => {
    expect(safeLogoUrl('javascript:alert(1)')).toBeNull();
    expect(safeLogoUrl('http://x.com/a.png')).toBeNull();
    expect(safeLogoUrl('https://x.com/a.png')).toBe('https://x.com/a.png');
    const vars = brandingToCssVars({ club_name: 'x', logo_url: 'https://x/y.png', accent_color: 'red;}body{display:none' });
    expect(vars['--brand-accent']).toBe('#FF6B00');
  });
});
