import { HttpError } from './errors';

export const DISPLAY_NAME_MAX = 24;

// Control/format characters (incl. bidi overrides U+202A-202E, U+2066-2069, zero-width) are stripped so a
// name can neither spoof the TV layout nor hide content.
const INVISIBLES = /[\p{C}\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

/** Normalises user-supplied names shown on a public screen. Throws 400 if nothing printable remains. */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_display_name');
  const cleaned = raw.normalize('NFKC').replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  if (chars.length === 0 || chars.length > DISPLAY_NAME_MAX) throw new HttpError(400, 'invalid_display_name');
  return cleaned;
}
