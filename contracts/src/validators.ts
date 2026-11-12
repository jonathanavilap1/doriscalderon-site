import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import heartRate from '../schemas/heart-rate-payload.schema.json';
import classSession from '../schemas/class-session.schema.json';
import athleteIdentity from '../schemas/athlete-identity.schema.json';
import rosterEntry from '../schemas/roster-entry.schema.json';
import classResults from '../schemas/class-results.schema.json';
import controlMessage from '../schemas/control-message.schema.json';
import branding from '../schemas/branding.schema.json';
import joinReceipt from '../schemas/join-receipt.schema.json';
import type {
  AthleteIdentity,
  Branding,
  ClassResults,
  ClassSession,
  ControlMessage,
  HeartRatePayload,
  JoinReceipt,
  RosterEntry,
} from './types.generated';

const ajv = new Ajv({ allErrors: false, strict: true });
addFormats(ajv);
const schemas = [heartRate, classSession, athleteIdentity, rosterEntry, classResults, controlMessage, branding, joinReceipt];
for (const s of schemas) ajv.addSchema(s);

function guard<T>(schema: { $id: string }): (value: unknown) => value is T {
  const validate = ajv.getSchema<T>(schema.$id)!;
  return (value: unknown): value is T => validate(value) as boolean;
}

export const isHeartRatePayload = guard<HeartRatePayload>(heartRate);
export const isClassSession = guard<ClassSession>(classSession);
export const isAthleteIdentity = guard<AthleteIdentity>(athleteIdentity);
export const isJoinReceipt = guard<JoinReceipt>(joinReceipt);
export const isRosterEntry = guard<RosterEntry>(rosterEntry);
export const isClassResults = guard<ClassResults>(classResults);
export const isControlMessage = guard<ControlMessage>(controlMessage);
export const isBranding = guard<Branding>(branding);
