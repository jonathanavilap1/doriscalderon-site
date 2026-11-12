import { describe, expect, it, vi } from 'vitest';
import type { ClassSession, RosterEntry } from '@lmclub/contracts/core';
import { LiveClassController } from '../src/domain/liveClassController';
import type { ClassApi } from '../src/infra/api';
import type { ConnectionStatus, RealtimeTransport } from '../src/infra/realtime';

const CLASS = '5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77';
const ATH = '0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10';
const session = { v: 1, class_id: CLASS, club_id: 'iron-house', workout_type: 'hiit', status: 'live', title: 't', starts_at: 'x', ended_at: null,
  branding: { club_name: 'c', logo_url: 'https://x/y.png', accent_color: '#FFFFFF' }, join: null,
  realtime: { iot_endpoint: 'e', authorizer: 'a' } } as ClassSession;

function harness(initialRoster: RosterEntry[] = [], rosterRefetchMs = 0) {
  let handlers!: { onMessage: (t: string, p: string) => void; onStatus: (s: ConnectionStatus) => void };
  const transport: RealtimeTransport = { start: (h) => (handlers = h), stop: vi.fn() };
  const getRoster = vi.fn(async () => initialRoster);
  const api: ClassApi = { getSession: async () => session, getRoster };
  let queued: (() => void) | null = null;
  let t = 0;
  const c = new LiveClassController({
    classId: CLASS, api, createTransport: () => transport, now: () => t, rosterRefetchMs,
    schedule: (cb) => { queued = cb; return () => { queued = null; }; },
  });
  const flush = () => { const f = queued; queued = null; f?.(); };
  return { c, getRoster, send: (topic: string, body: unknown) => handlers.onMessage(topic, JSON.stringify(body)), flush, tick: (ms: number) => (t += ms), status: (s: ConnectionStatus) => handlers.onStatus(s), transport };
}

const frame = (seq: number) => ({ v: 1, bpm: 150, effort_pct: 80, ts: seq, seq, source: 'ble_strap' });

describe('LiveClassController', () => {
  it('coalesces many MQTT frames into one snapshot per animation frame', async () => {
    const h = harness([{ athlete_id: ATH, display_name: 'Ana', auth_state: 'guest', overridden: false }]);
    await h.c.start();
    h.flush();
    const seen: unknown[] = [];
    h.c.subscribe(() => seen.push(h.c.getView()));
    for (let i = 1; i <= 50; i++) h.send(`iron-house/${CLASS}/${ATH}`, frame(i));
    h.flush();
    expect(seen).toHaveLength(1);
    expect(h.c.getView().dashboard.athletes[0]).toMatchObject({ name: 'Ana', zone: 'green' });
    h.c.dispose();
  });

  it('ignores malformed topics/payloads and handles the control topic', async () => {
    const h = harness();
    await h.c.start();
    h.send(`iron-house/${CLASS}/not-a-uuid`, frame(1));
    h.send(`iron-house/${CLASS}/${ATH}`, { nope: true });
    h.send(`iron-house/${CLASS}/_control/events`, { v: 1, type: 'class.state', data: { status: 'completed' } });
    h.flush();
    expect(h.c.getView().dashboard.athletes).toHaveLength(0);
    expect(h.c.getView().dashboard.classStatus).toBe('completed');
    h.c.dispose();
  });

  it('refetches the roster when telemetry arrives from an unknown athlete', async () => {
    const h = harness();
    await h.c.start();
    expect(h.getRoster).toHaveBeenCalledTimes(1);
    h.send(`iron-house/${CLASS}/${ATH}`, frame(1));
    h.flush();
    await Promise.resolve();
    expect(h.getRoster).toHaveBeenCalledTimes(2);
    h.c.dispose();
  });

  it('re-fetches names over REST on a PII-free roster.changed signal', async () => {
    const h = harness();
    await h.c.start();
    h.send(`iron-house/${CLASS}/_control/events`, { v: 1, type: 'roster.changed', data: { athlete_id: ATH } });
    await Promise.resolve();
    expect(h.getRoster).toHaveBeenCalledTimes(2);
    h.c.dispose();
  });

  it('never loses a roster.changed that arrives inside the rate-limit window (trailing refetch)', async () => {
    vi.useFakeTimers();
    try {
      const h = harness([], 1000);
      await h.c.start(); // fetch #1 at t=0
      h.tick(100);
      h.send(`iron-house/${CLASS}/_control/events`, { v: 1, type: 'roster.changed', data: { athlete_id: ATH } });
      await Promise.resolve();
      expect(h.getRoster).toHaveBeenCalledTimes(1); // deferred, not dropped
      h.tick(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.getRoster).toHaveBeenCalledTimes(2);
      h.c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes connection status and stops the transport on dispose', async () => {
    const h = harness();
    await h.c.start();
    h.status('connected');
    expect(h.c.getView().connection).toBe('connected');
    h.c.dispose();
    expect(h.transport.stop).toHaveBeenCalled();
  });
});
