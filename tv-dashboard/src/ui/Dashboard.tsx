import { ZONES, type ClassSession, type WorkoutType, type Zone } from '@lmclub/contracts/core';
import { safeLogoUrl } from '../domain/branding';
import type { AthleteView, DashboardState } from '../domain/telemetryStore';
import type { ConnectionStatus } from '../infra/realtime';

const ZONE_COLOR = Object.fromEntries(ZONES.map((z) => [z.name, z.color])) as Record<Zone, string>;

/** workout_type tailors which metric leads each tile. */
const LAYOUT: Record<WorkoutType, { headline: (a: AthleteView) => string; sub: (a: AthleteView) => string }> = {
  hiit: { headline: (a) => `${a.bpm}`, sub: (a) => `${a.points} pts` },
  hyrox: { headline: (a) => `${a.points}`, sub: (a) => `${a.bpm} bpm` },
  indoor_cycling: { headline: (a) => `${Math.round(a.effortPct)}%`, sub: (a) => `${a.bpm} bpm` },
};

export function Dashboard({ session, state, connection }: { session: ClassSession; state: DashboardState; connection: ConnectionStatus }) {
  const logo = safeLogoUrl(session.branding.logo_url);
  const layout = LAYOUT[session.workout_type];

  return (
    <main className="dash">
      <header>
        {logo && <img src={logo} alt={session.branding.club_name} />}
        <h1>{session.title}</h1>
        {session.join && state.classStatus !== 'completed' && <div className="pin">PIN {session.join.pin}</div>}
        <span className={`conn ${connection}`}>{connection}</span>
      </header>

      {state.results ? (
        <ol className="podium final">
          {state.results.podium.map((p) => (
            <li key={p.athlete_id}>
              #{p.rank} {state.athletes.find((a) => a.athleteId === p.athlete_id)?.name ?? 'Athlete'} · {p.points} pts
            </li>
          ))}
        </ol>
      ) : (
        <ol className="podium">
          {state.podium.map((a) => (
            <li key={a.athleteId}>
              #{a.rank} {a.name} · {a.points} pts
            </li>
          ))}
        </ol>
      )}

      <section className="grid">
        {state.athletes.map((a) => (
          <article key={a.athleteId} className={a.stale ? 'tile stale' : 'tile'} style={{ background: ZONE_COLOR[a.zone] }}>
            <span className="name">{a.name}</span>
            <strong>{layout.headline(a)}</strong>
            <span>{layout.sub(a)}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
