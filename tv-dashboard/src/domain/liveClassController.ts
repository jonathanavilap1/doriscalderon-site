import { parseTopic, type ClassSession } from '@lmclub/contracts/core';
import type { ClassApi } from '../infra/api';
import type { ConnectionStatus, RealtimeTransport } from '../infra/realtime';
import { parseControl, parseTelemetry, TelemetryStore, type DashboardState } from './telemetryStore';

export interface LiveClassView {
  session: ClassSession | null;
  connection: ConnectionStatus;
  dashboard: DashboardState;
  error: string | null;
}

export interface ControllerDeps {
  classId: string;
  api: ClassApi;
  /** Built once the session reveals the IoT endpoint / authorizer. */
  createTransport: (session: ClassSession) => RealtimeTransport;
  /** Frame scheduler: requestAnimationFrame in the browser, a stub in tests. */
  schedule: (cb: () => void) => () => void;
  now: () => number;
  /** Minimum gap between roster refetches triggered by unknown athlete ids. */
  rosterRefetchMs?: number;
}

/**
 * Wires REST bootstrap + MQTT stream + the TelemetryStore, and publishes immutable view snapshots at most
 * once per animation frame (60fps ceiling), no matter how many MQTT frames arrive in between.
 */
export class LiveClassController {
  readonly store = new TelemetryStore();
  private view: LiveClassView;
  private readonly listeners = new Set<() => void>();
  private transport: RealtimeTransport | null = null;
  private cancelFrame: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private lastRosterFetch = 0;
  private rosterInFlight = false;
  private rosterDirty = false;
  private rosterTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly d: ControllerDeps) {
    this.view = { session: null, connection: 'idle', dashboard: this.store.snapshot(d.now()), error: null };
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getView = (): LiveClassView => this.view;

  async start(): Promise<void> {
    this.disposed = false; // React StrictMode runs effect -> cleanup -> effect on the same instance
    this.unsubscribeStore = this.store.subscribe(() => this.requestFrame());
    this.ticker = setInterval(() => this.store.touch(), 1000);
    try {
      const [session, roster] = await Promise.all([this.d.api.getSession(this.d.classId), this.d.api.getRoster(this.d.classId)]);
      if (this.disposed) return;
      this.store.setRoster(roster);
      this.patch({ session, error: null });

      this.transport = this.d.createTransport(session);
      this.transport.start({
        onMessage: (topic, payload) => this.onMessage(topic, payload),
        onStatus: (connection) => this.patch({ connection }),
      });
    } catch (e) {
      this.patch({ error: e instanceof Error ? e.message : 'bootstrap_failed' });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.transport?.stop();
    this.unsubscribeStore?.();
    this.cancelFrame?.();
    if (this.ticker) clearInterval(this.ticker);
    if (this.rosterTimer) clearTimeout(this.rosterTimer);
    this.rosterTimer = null;
    this.cancelFrame = null;
  }

  private onMessage(topic: string, payload: string): void {
    const parsed = parseTopic(topic);
    if (!parsed) return;
    if (parsed.kind === 'telemetry') {
      const p = parseTelemetry(payload);
      if (p) this.store.ingest(parsed.athleteId, p, this.d.now());
    } else {
      const msg = parseControl(payload);
      if (msg?.type === 'roster.changed') this.markRosterDirty();
      else if (msg) this.store.apply(msg);
    }
  }

  private patch(partial: Partial<LiveClassView>): void {
    this.view = { ...this.view, ...partial };
    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.cancelFrame || this.disposed) return;
    this.cancelFrame = this.d.schedule(() => {
      this.cancelFrame = null;
      const dashboard = this.store.snapshot(this.d.now());
      this.view = { ...this.view, dashboard };
      for (const l of this.listeners) l();
      if (dashboard.unresolvedIds.length) this.markRosterDirty();
    });
  }

  /**
   * Names never travel over IoT Core (zero PII in the real-time layer), so a `roster.changed` signal, or an
   * unknown UUID in telemetry, is reconciled via authenticated REST. Rate limited, but never dropped:
   * a change arriving inside the window is fetched by a trailing timer.
   */
  private markRosterDirty(): void {
    this.rosterDirty = true;
    void this.refreshRoster();
  }

  private async refreshRoster(): Promise<void> {
    if (!this.rosterDirty || this.rosterInFlight || this.disposed) return;
    const wait = (this.d.rosterRefetchMs ?? 2_000) - (this.d.now() - this.lastRosterFetch);
    if (wait > 0) {
      this.rosterTimer ??= setTimeout(() => {
        this.rosterTimer = null;
        void this.refreshRoster();
      }, wait);
      return;
    }
    this.rosterInFlight = true;
    this.rosterDirty = false;
    this.lastRosterFetch = this.d.now();
    try {
      this.store.setRoster(await this.d.api.getRoster(this.d.classId));
    } catch {
      this.rosterDirty = true; // retried on the next signal / unresolved frame
    } finally {
      this.rosterInFlight = false;
    }
  }
}
