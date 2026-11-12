import { describe, expect, it } from 'vitest';
import { isClassResults } from '@lmclub/contracts';
import { computeResults } from '../src/domain/results';
import type { MinuteBin } from '../src/domain/types';

const CLASS = '5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

/** `pcts[i]` becomes minute i of the class for the athlete. */
const bins = (athleteId: string, pcts: number[]): MinuteBin[] =>
  pcts.map((p, i) => ({
    athleteId,
    minute: new Date(Date.UTC(2026, 10, 14, 12, i)).toISOString(),
    avgBpm: Math.round(p * 1.9),
    maxBpm: Math.round(p * 1.9) + 5,
    avgEffortPct: p,
  }));

const run = (workoutType: 'hyrox' | 'indoor_cycling' | 'hiit', all: MinuteBin[]) =>
  computeResults({ classId: CLASS, clubId: 'iron-house', workoutType, bins: all, now: new Date('2026-11-14T13:00:00Z') });

describe('computeResults', () => {
  it('ranks by points and produces a contract-valid payload', () => {
    const r = run('hyrox', [...bins(A, [95, 95, 95, 95, 95, 95]), ...bins(B, [75, 75, 75, 75]), ...bins(C, [50, 50, 50, 50])]);
    expect(isClassResults(r)).toBe(true);
    expect(r.podium.map((p) => p.athlete_id)).toEqual([A, B]); // C scored 0 -> no podium
    expect(r.podium[0]!.points).toBe(24); // 6 min * 4 ppm
    expect(r.awards.map((a) => a.award)).toEqual(['podium_gold', 'podium_silver', 'redline_warrior']);
  });

  it('excludes athletes below the minimum participation from podium and awards', () => {
    const r = run('hiit', [...bins(A, [95, 95]), ...bins(B, [75, 75, 75])]);
    expect(r.podium.map((p) => p.athlete_id)).toEqual([B]);
    expect(r.athletes).toHaveLength(2); // still reported
  });

  it('tailors the bonus award to workout_type', () => {
    const interval = [95, 60, 95, 60, 95, 60, 95];
    const steady = [75, 75, 75, 75, 75, 75, 75];
    const hiit = run('hiit', [...bins(A, interval), ...bins(B, steady)]);
    expect(hiit.awards.find((a) => a.award === 'peak_performer')?.athlete_id).toBe(A); // 4 red entries
    const cycling = run('indoor_cycling', [...bins(A, interval), ...bins(B, steady)]);
    expect(cycling.awards.find((a) => a.award === 'consistency_king')?.athlete_id).toBe(B);
  });

  it('is deterministic on ties', () => {
    const r = run('hyrox', [...bins(B, [80, 80, 80]), ...bins(A, [80, 80, 80])]);
    expect(r.podium.map((p) => p.athlete_id)).toEqual([A, B]);
  });

  it('handles an empty class', () => {
    const r = run('hyrox', []);
    expect(r.podium).toEqual([]);
    expect(r.awards).toEqual([]);
  });
});
