import type { EventBridgeEvent } from 'aws-lambda';
import { computeResults } from '../domain/results';
import type { ClassCompletedDetail } from '../domain/ports';
import { container } from '../infra/container';
import { EVENT_CLASS_COMPLETED, EVENT_SOURCE } from '../infra/events';

/**
 * EventBridge -> Lambda. Queries Timestream, computes awards, writes long-retention per-minute
 * aggregates + authenticated athletes' history, then publishes the final JSON to the class topic.
 * Idempotent: EventBridge is at-least-once and failures are retried / dead-lettered.
 */
export const handler = async (event: EventBridgeEvent<typeof EVENT_CLASS_COMPLETED, ClassCompletedDetail>): Promise<void> => {
  if (event.source !== EVENT_SOURCE) throw new Error('unexpected event source');
  const { club_id: clubId, class_id: classId, workout_type: workoutType } = event.detail;
  const c = container();

  const bins = await c.telemetry.queryMinuteBins(clubId, classId);
  const results = computeResults({ classId, clubId, workoutType, bins, now: new Date() });

  await c.telemetry.writeMinuteAggregates(clubId, classId, bins);

  const roster = await c.roster.list(classId);
  const byAthlete = new Map(results.athletes.map((a) => [a.athlete_id, a]));
  const awardsFor = (id: string) => results.awards.filter((a) => a.athlete_id === id).map((a) => a.award);
  await Promise.all(
    roster
      .filter((r) => r.account_id && byAthlete.has(r.athlete_id))
      .map((r) =>
        c.history.put(r.account_id!, classId, {
          club_id: clubId,
          workout_type: workoutType,
          completed_at: results.generated_at,
          stats: byAthlete.get(r.athlete_id),
          awards: awardsFor(r.athlete_id),
        }),
      ),
  );

  // Retained so a TV that reconnects after the class ended still renders the final podium.
  await c.control.publish(clubId, classId, { v: 1, type: 'class.results', data: results }, { retain: true });
};
