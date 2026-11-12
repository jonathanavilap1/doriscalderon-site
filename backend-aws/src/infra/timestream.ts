import { QueryCommand, TimestreamQueryClient, type Row } from '@aws-sdk/client-timestream-query';
import { TimestreamWriteClient, WriteRecordsCommand, type _Record } from '@aws-sdk/client-timestream-write';
import { assertIds } from '@lmclub/contracts';
import { config } from './config';
import type { TelemetryRepository } from '../domain/ports';
import type { MinuteBin } from '../domain/types';

/** Timestream's `2026-11-14 12:01:00.000000000` -> ISO-8601. */
export const toIso = (ts: string): string => `${ts.replace(' ', 'T').slice(0, 23)}Z`;

const num = (row: Row, i: number): number => Number(row.Data?.[i]?.ScalarValue ?? 0);
const str = (row: Row, i: number): string => row.Data?.[i]?.ScalarValue ?? '';

export class TimestreamTelemetryRepository implements TelemetryRepository {
  private readonly query = new TimestreamQueryClient({});
  private readonly write = new TimestreamWriteClient({});

  async queryMinuteBins(clubId: string, classId: string): Promise<MinuteBin[]> {
    // Timestream QL has no bind parameters for ad-hoc queries, so ids are validated against strict
    // patterns (slug / UUID) before interpolation. Never relax assertIds().
    assertIds(clubId, classId);
    const sql = `
      SELECT athlete_id, bin(time, 1m) AS minute, avg(bpm) AS avg_bpm, max(bpm) AS max_bpm, avg(effort_pct) AS avg_effort
      FROM "${config.tsDatabase}"."${config.tsRawTable}"
      WHERE club_id = '${clubId}' AND class_id = '${classId}' AND time > ago(14d)
      GROUP BY athlete_id, bin(time, 1m)
      ORDER BY athlete_id, minute`;

    const bins: MinuteBin[] = [];
    let next: string | undefined;
    do {
      const r = await this.query.send(new QueryCommand({ QueryString: sql, NextToken: next }));
      for (const row of r.Rows ?? []) {
        bins.push({ athleteId: str(row, 0), minute: toIso(str(row, 1)), avgBpm: num(row, 2), maxBpm: num(row, 3), avgEffortPct: num(row, 4) });
      }
      next = r.NextToken;
    } while (next);
    return bins;
  }

  async writeMinuteAggregates(clubId: string, classId: string, bins: MinuteBin[]): Promise<void> {
    const version = Date.now(); // monotonic upsert: EventBridge delivery is at-least-once
    const records: _Record[] = bins.map((b) => ({
      Dimensions: [
        { Name: 'club_id', Value: clubId },
        { Name: 'class_id', Value: classId },
        { Name: 'athlete_id', Value: b.athleteId },
      ],
      MeasureName: 'minute_aggregate',
      MeasureValueType: 'MULTI',
      MeasureValues: [
        { Name: 'avg_bpm', Value: b.avgBpm.toFixed(2), Type: 'DOUBLE' },
        { Name: 'max_bpm', Value: String(Math.round(b.maxBpm)), Type: 'BIGINT' },
        { Name: 'avg_effort_pct', Value: b.avgEffortPct.toFixed(2), Type: 'DOUBLE' },
      ],
      Time: String(Date.parse(b.minute)),
      TimeUnit: 'MILLISECONDS',
      Version: version,
    }));
    for (let i = 0; i < records.length; i += 100) {
      await this.write.send(
        new WriteRecordsCommand({ DatabaseName: config.tsDatabase, TableName: config.tsAggTable, Records: records.slice(i, i + 100) }),
      );
    }
  }
}
