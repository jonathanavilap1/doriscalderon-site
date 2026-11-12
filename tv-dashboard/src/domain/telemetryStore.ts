import {
  pointsFor, zoneFor, type ClassResults, type ControlMessage, type HeartRatePayload, type RosterEntry, type Zone,
} from '@lmclub/contracts/core';

/** No frame for this long => the athlete's strap/watch dropped; tile goes gray and stops earning points. */
export const STALE_AFTER_MS = 5_000;
/** Cap on the time credited per frame, so a reconnect gap cannot award minutes of points. */
const MAX_CREDIT_MS = 3_000;

interface LiveAthlete {
  bpm: number;
  effortPct: number;
  zone: Zone;
  points: number;
  seq: number;
  deviceTs: number;
  arrivedAt: number;
}

export interface AthleteView {
  athleteId: string;
  name: string;
  resolved: boolean;
  bpm: number;
  effortPct: number;
  zone: Zone;
  points: number;
  rank: number;
  stale: boolean;
}

export interface DashboardState {
  athletes: AthleteView[];
  podium: AthleteView[];
  /** Athletes seen in telemetry that the roster cannot resolve yet (drives roster refetch). */
  unresolvedIds: string[];
  classStatus: 'live' | 'completed' | 'unknown';
  results: ClassResults | null;
}

/** Cheap structural guard for the hot path (Ajv would require `unsafe-eval`). Contract tests keep it honest. */
export function parseTelemetry(raw: string): HeartRatePayload | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = v as Partial<HeartRatePayload> | null;
  if (!o || typeof o !== 'object' || o.v !== 1) return null;
  const ok =
    Number.isInteger(o.bpm) && o.bpm! >= 30 && o.bpm! <= 240 &&
    typeof o.effort_pct === 'number' && o.effort_pct >= 0 && o.effort_pct <= 150 &&
    Number.isInteger(o.ts) && Number.isInteger(o.seq) && o.seq! >= 0 &&
    (o.source === 'apple_watch' || o.source === 'ble_strap');
  return ok ? (o as HeartRatePayload) : null;
}

export function parseControl(raw: string): ControlMessage | null {
  try {
    const m = JSON.parse(raw) as Partial<ControlMessage> | null;
    if (!m || m.v !== 1 || typeof m.data !== 'object') return null;
    return m.type === 'roster.changed' || m.type === 'class.state' || m.type === 'class.results' ? (m as ControlMessage) : null;
  } catch {
    return null;
  }
}

type Listener = () => void;

/**
 * Framework-free live model. Mutated on every MQTT frame (cheap, O(1)); the UI reads immutable
 * snapshots at display rate, so message rate and render rate are fully decoupled.
 */
export class TelemetryStore {
  private readonly live = new Map<string, LiveAthlete>();
  private readonly roster = new Map<string, RosterEntry>();
  private status: DashboardState['classStatus'] = 'unknown';
  private results: ClassResults | null = null;
  private version = 0;
  private cached: { version: number; state: DashboardState } | null = null;
  private readonly listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  ingest(athleteId: string, p: HeartRatePayload, nowMs: number): void {
    const prev = this.live.get(athleteId);
    // Drop duplicates/reordering, but accept a restarted publisher (seq reset with a newer device clock).
    if (prev && p.seq <= prev.seq && p.ts <= prev.deviceTs) return;

    const zone = zoneFor(p.effort_pct);
    const creditMs = prev ? Math.min(Math.max(nowMs - prev.arrivedAt, 0), MAX_CREDIT_MS) : 0;
    this.live.set(athleteId, {
      bpm: p.bpm,
      effortPct: p.effort_pct,
      zone,
      points: (prev?.points ?? 0) + pointsFor(zone, creditMs / 1000),
      seq: p.seq,
      deviceTs: p.ts,
      arrivedAt: nowMs,
    });
    this.bump();
  }

  setRoster(entries: readonly RosterEntry[]): void {
    this.roster.clear();
    for (const e of entries) this.roster.set(e.athlete_id, e);
    this.bump();
  }

  apply(msg: ControlMessage): void {
    if (msg.type === 'roster.changed') return; // names are fetched over REST by the controller, never pushed
    if (msg.type === 'class.state') this.status = msg.data.status === 'completed' ? 'completed' : 'live';
    else {
      this.results = msg.data;
      this.status = 'completed';
    }
    this.bump();
  }

  /** Forces a new snapshot (used by a 1 Hz timer so staleness is time-driven, not message-driven). */
  touch(): void {
    this.bump();
  }

  snapshot(nowMs: number): DashboardState {
    if (this.cached?.version === this.version) return this.cached.state;

    const views: AthleteView[] = [];
    const unresolved: string[] = [];
    for (const [id, a] of this.live) {
      const entry = this.roster.get(id);
      if (!entry) unresolved.push(id);
      const stale = nowMs - a.arrivedAt > STALE_AFTER_MS;
      views.push({
        athleteId: id,
        name: entry?.display_name ?? 'Athlete',
        resolved: !!entry,
        bpm: a.bpm,
        effortPct: a.effortPct,
        zone: stale ? 'gray' : a.zone,
        points: Math.round(a.points * 10) / 10,
        rank: 0,
        stale,
      });
    }
    views.sort((x, y) => y.points - x.points || x.athleteId.localeCompare(y.athleteId));
    views.forEach((v, i) => (v.rank = i + 1));

    const state: DashboardState = {
      athletes: views,
      podium: views.slice(0, 3),
      unresolvedIds: unresolved,
      classStatus: this.status,
      results: this.results,
    };
    this.cached = { version: this.version, state };
    return state;
  }
}
