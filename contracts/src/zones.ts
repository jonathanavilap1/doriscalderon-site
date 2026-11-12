import zonesJson from '../zones.json';

export type Zone = 'gray' | 'blue' | 'green' | 'orange' | 'red';

export interface ZoneDefinition {
  readonly name: Zone;
  readonly min_pct: number;
  readonly color: string;
  readonly points_per_minute: number;
}

/** Ordered by ascending min_pct. */
export const ZONES: readonly ZoneDefinition[] = zonesJson.zones as ZoneDefinition[];

export const ZONE_NAMES: readonly Zone[] = ZONES.map((z) => z.name);

export function zoneFor(effortPct: number): Zone {
  let current: Zone = ZONES[0]!.name;
  for (const z of ZONES) {
    if (effortPct >= z.min_pct) current = z.name;
  }
  return current;
}

export function zoneDefinition(zone: Zone): ZoneDefinition {
  return ZONES.find((z) => z.name === zone)!;
}

export function pointsFor(zone: Zone, seconds: number): number {
  return (zoneDefinition(zone).points_per_minute * seconds) / 60;
}
