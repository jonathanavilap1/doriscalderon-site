import { pointsFor, zoneFor, ZONE_NAMES, type ClassResults, type Zone } from '@lmclub/contracts';
import type { MinuteBin, WorkoutType } from './types';

type Award = ClassResults['awards'][number]['award'];
type AthleteStats = ClassResults['athletes'][number];

/** Athletes with fewer recorded minutes are listed but cannot win podium/awards. */
export const MIN_MINUTES_FOR_AWARDS = 3;

interface Analysed {
  stats: AthleteStats;
  minutes: number;
  zones: Zone[]; // chronological, one per minute bin
}

function analyse(athleteId: string, bins: MinuteBin[]): Analysed {
  const sorted = [...bins].sort((a, b) => a.minute.localeCompare(b.minute));
  const minutes_in_zone = Object.fromEntries(ZONE_NAMES.map((z) => [z, 0])) as Record<Zone, number>;
  const zones: Zone[] = sorted.map((b) => zoneFor(b.avgEffortPct));
  let points = 0;
  for (const z of zones) {
    minutes_in_zone[z] += 1;
    points += pointsFor(z, 60);
  }
  const avg = sorted.reduce((s, b) => s + b.avgBpm, 0) / Math.max(sorted.length, 1);
  return {
    stats: {
      athlete_id: athleteId,
      avg_bpm: Math.round(avg),
      peak_bpm: Math.round(Math.max(0, ...sorted.map((b) => b.maxBpm))),
      points,
      minutes_in_zone,
    },
    minutes: sorted.length,
    zones,
  };
}

const redEntries = (zones: Zone[]): number =>
  zones.reduce((n, z, i) => (z === 'red' && zones[i - 1] !== 'red' ? n + 1 : n), 0);

/** Highest scoring eligible athlete; ties broken by athlete_id so the output is deterministic. */
function best(list: Analysed[], score: (a: Analysed) => number, threshold: number): string | null {
  const ranked = list
    .map((a) => ({ id: a.stats.athlete_id, s: score(a) }))
    .filter((x) => x.s >= threshold)
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  return ranked[0]?.id ?? null;
}

/** Strategy per workout_type: the gamification layer the coach picked decides the bonus award. */
const WORKOUT_AWARD: Record<WorkoutType, (list: Analysed[]) => { award: Award; athlete: string | null }> = {
  hyrox: (l) => ({ award: 'redline_warrior' as const, athlete: best(l, (a) => a.stats.minutes_in_zone.red, 5) }),
  indoor_cycling: (l) => ({
    award: 'consistency_king' as const,
    athlete: best(l, (a) => a.zones.filter((z) => z !== 'gray' && z !== 'blue').length / a.minutes, 0.6),
  }),
  hiit: (l) => ({ award: 'peak_performer' as const, athlete: best(l, (a) => redEntries(a.zones), 3) }),
};

export function computeResults(input: {
  classId: string;
  clubId: string;
  workoutType: WorkoutType;
  bins: MinuteBin[];
  now: Date;
}): ClassResults {
  const byAthlete = new Map<string, MinuteBin[]>();
  for (const b of input.bins) {
    const list = byAthlete.get(b.athleteId) ?? [];
    list.push(b);
    byAthlete.set(b.athleteId, list);
  }

  const analysed = [...byAthlete].map(([id, bins]) => analyse(id, bins));
  const eligible = analysed.filter((a) => a.minutes >= MIN_MINUTES_FOR_AWARDS);

  const podium = [...eligible]
    .filter((a) => a.stats.points > 0)
    .sort((a, b) => b.stats.points - a.stats.points || a.stats.athlete_id.localeCompare(b.stats.athlete_id))
    .slice(0, 3)
    .map((a, i) => ({ rank: i + 1, athlete_id: a.stats.athlete_id, points: a.stats.points }));

  const podiumAwards: Award[] = ['podium_gold', 'podium_silver', 'podium_bronze'];
  const awards: ClassResults['awards'] = podium.map((p, i) => ({ award: podiumAwards[i]!, athlete_id: p.athlete_id }));

  const bonus = WORKOUT_AWARD[input.workoutType](eligible);
  if (bonus.athlete) awards.push({ award: bonus.award, athlete_id: bonus.athlete });

  return {
    class_id: input.classId,
    club_id: input.clubId,
    workout_type: input.workoutType,
    generated_at: input.now.toISOString(),
    podium,
    athletes: analysed.map((a) => a.stats).sort((a, b) => a.athlete_id.localeCompare(b.athlete_id)),
    awards,
  };
}
