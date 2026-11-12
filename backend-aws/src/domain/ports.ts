import type { ControlMessage } from '@lmclub/contracts';
import type { ClassRecord, ClubRecord, MinuteBin, PinRecord, RosterRecord } from './types';

export interface ClubRepository {
  get(clubId: string): Promise<ClubRecord | null>;
  put(club: ClubRecord): Promise<void>;
}

export interface ClassRepository {
  get(classId: string): Promise<ClassRecord | null>;
  put(record: ClassRecord): Promise<void>;
  setPin(classId: string, pin: string, expiresAtSec: number): Promise<void>;
  /** Transitions to `completed`; returns the record, or null if the class does not exist. Idempotent. */
  markCompleted(classId: string, endedAt: string): Promise<ClassRecord | null>;
}

export interface RosterRepository {
  get(classId: string, athleteId: string): Promise<RosterRecord | null>;
  list(classId: string): Promise<RosterRecord[]>;
  /** Inserts, or returns the existing row if (classId, athleteId) already exists (idempotent re-join). */
  putIfAbsent(record: RosterRecord): Promise<RosterRecord>;
  setOverride(classId: string, athleteId: string, name: string | null, by: string, at: string): Promise<RosterRecord | null>;
}

export interface PinRepository {
  allocate(classId: string, clubId: string, ttlSeconds: number, nowSec: number): Promise<PinRecord>;
  resolve(pin: string, nowSec: number): Promise<PinRecord | null>;
  revoke(pin: string): Promise<void>;
  isBlocked(sourceIp: string, nowSec: number): Promise<boolean>;
  recordFailure(sourceIp: string, nowSec: number): Promise<void>;
}

export interface HistoryRepository {
  put(accountId: string, classId: string, entry: Record<string, unknown>): Promise<void>;
}

export interface ControlPublisher {
  publish(clubId: string, classId: string, message: ControlMessage, opts?: { retain?: boolean }): Promise<void>;
}

export interface ClassCompletedDetail {
  club_id: string;
  class_id: string;
  workout_type: ClassRecord['workout_type'];
  ended_at: string;
}

export interface EventPublisher {
  classCompleted(detail: ClassCompletedDetail): Promise<void>;
}

export interface TelemetryRepository {
  queryMinuteBins(clubId: string, classId: string): Promise<MinuteBin[]>;
  /** Writes the long-retention per-minute aggregates (the 30-day raw -> aggregate lifecycle). */
  writeMinuteAggregates(clubId: string, classId: string, bins: MinuteBin[]): Promise<void>;
}
