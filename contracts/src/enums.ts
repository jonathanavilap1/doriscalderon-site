import classSession from '../schemas/class-session.schema.json';
import type { ClassSession } from './types.generated';

export type WorkoutType = ClassSession['workout_type'];

/** Derived from the schema so the enum can never drift. */
export const WORKOUT_TYPES = classSession.properties.workout_type.enum as readonly WorkoutType[];
