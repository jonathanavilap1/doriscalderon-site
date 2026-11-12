import type { Branding } from '@lmclub/contracts/core';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const FALLBACK = { accent: '#FF6B00', secondary: '#111111' };

/** Returns the https logo URL or null. Branding comes from a tenant-controlled API, so it is re-validated here. */
export function safeLogoUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Only validated hex colours reach CSS custom properties; anything else falls back (no CSS injection). */
export function brandingToCssVars(b: Branding): Record<string, string> {
  return {
    '--brand-accent': HEX.test(b.accent_color) ? b.accent_color : FALLBACK.accent,
    '--brand-secondary': b.secondary_color && HEX.test(b.secondary_color) ? b.secondary_color : FALLBACK.secondary,
  };
}
