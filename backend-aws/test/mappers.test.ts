import { describe, expect, it } from 'vitest';
import { isRosterEntry } from '@lmclub/contracts';
import { effectiveName, toIdentity, toRosterEntry } from '../src/domain/mappers';
import type { RosterRecord } from '../src/domain/types';

const row = (over: Partial<RosterRecord> = {}): RosterRecord => ({
  class_id: '5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77',
  athlete_id: '0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10',
  auth_state: 'authenticated',
  auth_provider: 'apple',
  account_id: 'cognito-sub-SECRET',
  display_name: 'xX_mike_Xx',
  display_name_override: null,
  override_by: null,
  override_at: null,
  joined_at: '2026-11-14T12:01:00.000Z',
  ttl: 1,
  ...over,
});

describe('Admin Override resolution', () => {
  it('override wins over the athlete-chosen name, and clearing it restores the original', () => {
    expect(effectiveName(row())).toBe('xX_mike_Xx');
    expect(effectiveName(row({ display_name_override: 'Mike R.' }))).toBe('Mike R.');
    expect(toRosterEntry(row({ display_name_override: 'Mike R.' }))).toMatchObject({ display_name: 'Mike R.', overridden: true });
    expect(toRosterEntry(row({ display_name_override: null }))).toMatchObject({ display_name: 'xX_mike_Xx', overridden: false });
  });

  it('the TV projection is contract-valid and never carries the account link', () => {
    const entry = toRosterEntry(row({ display_name_override: 'Mike R.' }));
    expect(isRosterEntry(entry)).toBe(true);
    expect(JSON.stringify(entry)).not.toContain('SECRET');
    expect(JSON.stringify(toIdentity(row()))).not.toContain('SECRET');
  });

  it('keeps the original name and audit fields on the identity record', () => {
    const id = toIdentity(row({ display_name_override: 'Mike R.', override_by: 'admin-1', override_at: '2026-11-14T12:03:00.000Z' }));
    expect(id).toMatchObject({ display_name: 'xX_mike_Xx', display_name_override: 'Mike R.', override_by: 'admin-1' });
  });
});
