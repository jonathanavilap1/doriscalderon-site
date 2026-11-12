import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomInt } from 'node:crypto';
import { config } from './config';
import type {
  ClassRepository, ClubRepository, HistoryRepository, PinRepository, RosterRepository,
} from '../domain/ports';
import type { ClassRecord, ClubRecord, PinRecord, RosterRecord } from '../domain/types';

export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const isConditionFailure = (e: unknown): boolean => e instanceof ConditionalCheckFailedException;

export class DynamoClubRepository implements ClubRepository {
  async get(clubId: string): Promise<ClubRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: config.clubsTable, Key: { club_id: clubId } }));
    return (r.Item as ClubRecord | undefined) ?? null;
  }
  async put(club: ClubRecord): Promise<void> {
    await doc.send(new PutCommand({ TableName: config.clubsTable, Item: club }));
  }
}

export class DynamoClassRepository implements ClassRepository {
  async get(classId: string): Promise<ClassRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: config.classesTable, Key: { class_id: classId } }));
    return (r.Item as ClassRecord | undefined) ?? null;
  }
  async put(record: ClassRecord): Promise<void> {
    await doc.send(new PutCommand({ TableName: config.classesTable, Item: record, ConditionExpression: 'attribute_not_exists(class_id)' }));
  }
  async setPin(classId: string, pin: string, expiresAtSec: number): Promise<void> {
    await doc.send(
      new UpdateCommand({
        TableName: config.classesTable,
        Key: { class_id: classId },
        UpdateExpression: 'SET pin = :p, pin_expires_at = :e',
        ConditionExpression: 'attribute_exists(class_id)',
        ExpressionAttributeValues: { ':p': pin, ':e': expiresAtSec },
      }),
    );
  }
  async markCompleted(classId: string, endedAt: string): Promise<ClassRecord | null> {
    try {
      const r = await doc.send(
        new UpdateCommand({
          TableName: config.classesTable,
          Key: { class_id: classId },
          UpdateExpression: 'SET #s = :done, ended_at = if_not_exists(ended_at, :at)',
          ConditionExpression: 'attribute_exists(class_id)',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':done': 'completed', ':at': endedAt },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return r.Attributes as ClassRecord;
    } catch (e) {
      if (isConditionFailure(e)) return null;
      throw e;
    }
  }
}

export class DynamoRosterRepository implements RosterRepository {
  async get(classId: string, athleteId: string): Promise<RosterRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: config.rosterTable, Key: { class_id: classId, athlete_id: athleteId } }));
    return (r.Item as RosterRecord | undefined) ?? null;
  }
  async list(classId: string): Promise<RosterRecord[]> {
    const items: RosterRecord[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const r = await doc.send(
        new QueryCommand({
          TableName: config.rosterTable,
          KeyConditionExpression: 'class_id = :c',
          ExpressionAttributeValues: { ':c': classId },
          ExclusiveStartKey: key,
        }),
      );
      items.push(...((r.Items ?? []) as RosterRecord[]));
      key = r.LastEvaluatedKey;
    } while (key);
    return items;
  }
  async putIfAbsent(record: RosterRecord): Promise<RosterRecord> {
    try {
      await doc.send(new PutCommand({ TableName: config.rosterTable, Item: record, ConditionExpression: 'attribute_not_exists(athlete_id)' }));
      return record;
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      return (await this.get(record.class_id, record.athlete_id))!;
    }
  }
  async setOverride(classId: string, athleteId: string, name: string | null, by: string, at: string): Promise<RosterRecord | null> {
    try {
      const r = await doc.send(
        new UpdateCommand({
          TableName: config.rosterTable,
          Key: { class_id: classId, athlete_id: athleteId },
          UpdateExpression: 'SET display_name_override = :n, override_by = :b, override_at = :a',
          ConditionExpression: 'attribute_exists(athlete_id)',
          ExpressionAttributeValues: { ':n': name, ':b': by, ':a': at },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return r.Attributes as RosterRecord;
    } catch (e) {
      if (isConditionFailure(e)) return null;
      throw e;
    }
  }
}

const RATE_LIMIT_PREFIX = 'rl#';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 300;

export class DynamoPinRepository implements PinRepository {
  /** 4 digits => 10k global namespace: collisions are resolved by conditional writes, expired rows are reusable. */
  async allocate(classId: string, clubId: string, ttlSeconds: number, nowSec: number): Promise<PinRecord> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const record: PinRecord = { pin: String(randomInt(0, 10_000)).padStart(4, '0'), class_id: classId, club_id: clubId, expires_at: nowSec + ttlSeconds };
      try {
        await doc.send(
          new PutCommand({
            TableName: config.pinsTable,
            Item: record,
            ConditionExpression: 'attribute_not_exists(pin) OR expires_at <= :now',
            ExpressionAttributeValues: { ':now': nowSec },
          }),
        );
        return record;
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
      }
    }
    throw new Error('PIN space exhausted');
  }
  async resolve(pin: string, nowSec: number): Promise<PinRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: config.pinsTable, Key: { pin }, ConsistentRead: true }));
    const item = r.Item as PinRecord | undefined;
    return item && item.expires_at > nowSec ? item : null; // TTL deletion lags; always compare explicitly
  }
  async revoke(pin: string): Promise<void> {
    await doc.send(new DeleteCommand({ TableName: config.pinsTable, Key: { pin } }));
  }
  async isBlocked(sourceIp: string, nowSec: number): Promise<boolean> {
    const r = await doc.send(new GetCommand({ TableName: config.pinsTable, Key: { pin: RATE_LIMIT_PREFIX + sourceIp } }));
    const item = r.Item as { attempts: number; expires_at: number } | undefined;
    return !!item && item.expires_at > nowSec && item.attempts >= RATE_LIMIT_MAX;
  }
  async recordFailure(sourceIp: string, nowSec: number): Promise<void> {
    const key = { pin: RATE_LIMIT_PREFIX + sourceIp };
    const r = await doc.send(
      new UpdateCommand({
        TableName: config.pinsTable,
        Key: key,
        UpdateExpression: 'SET attempts = if_not_exists(attempts, :zero) + :one, expires_at = if_not_exists(expires_at, :exp)',
        ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':exp': nowSec + RATE_LIMIT_WINDOW_SEC },
        ReturnValues: 'ALL_NEW',
      }),
    );
    if ((r.Attributes?.expires_at as number) <= nowSec) {
      await doc.send(new PutCommand({ TableName: config.pinsTable, Item: { ...key, attempts: 1, expires_at: nowSec + RATE_LIMIT_WINDOW_SEC } }));
    }
  }
}

export class DynamoHistoryRepository implements HistoryRepository {
  async put(accountId: string, classId: string, entry: Record<string, unknown>): Promise<void> {
    await doc.send(new PutCommand({ TableName: config.historyTable, Item: { account_id: accountId, class_id: classId, ...entry } }));
  }
}
