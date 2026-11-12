import type { AthleteIdentity, ClassSession } from '@lmclub/contracts';

export type WorkoutType = ClassSession['workout_type'];
export type AuthState = AthleteIdentity['auth_state'];
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface ClubRecord {
  club_id: string;
  club_name: string;
  logo_url: string;
  accent_color: string;
  secondary_color?: string;
  /** Mirrors Stripe subscription state (written by the billing webhook, not implemented here). */
  subscription_status: SubscriptionStatus;
}

export interface ClassRecord {
  class_id: string;
  club_id: string;
  coach_id: string;
  workout_type: WorkoutType;
  title: string;
  status: ClassSession['status'];
  starts_at: string;
  ended_at: string | null;
  /** Current check-in PIN (see PinRecord). Null once revoked. */
  pin: string | null;
  pin_expires_at: number | null;
}

/** Internal roster row. `account_id` is the identity-plane link and NEVER leaves the backend. */
export interface RosterRecord {
  class_id: string;
  athlete_id: string;
  auth_state: AuthState;
  auth_provider: AthleteIdentity['auth_provider'];
  account_id: string | null;
  display_name: string;
  display_name_override: string | null;
  override_by: string | null;
  override_at: string | null;
  joined_at: string;
  /** DynamoDB TTL (epoch seconds): roster rows are deleted after 90 days. */
  ttl: number;
}

export interface PinRecord {
  pin: string;
  class_id: string;
  club_id: string;
  /** Epoch seconds. DynamoDB TTL deletion is lazy (up to ~48h), so readers MUST re-check this. */
  expires_at: number;
}

export interface MinuteBin {
  athleteId: string;
  /** ISO-8601, start of the minute. */
  minute: string;
  avgBpm: number;
  maxBpm: number;
  avgEffortPct: number;
}
