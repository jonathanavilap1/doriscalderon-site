import { useEffect, useMemo } from 'react';
import { useLiveClass } from '../hooks/useLiveClass';
import { brandingToCssVars } from '../domain/branding';
import { Dashboard } from './Dashboard';

/**
 * Pairing: the coach iPad opens `https://tv.example.com/?class=<uuid>#t=<display token>`.
 * The token rides in the URL fragment (never sent to servers or logged) and is scrubbed after reading.
 */
function readPairing(): { classId: string; token: string } | null {
  const classId = new URLSearchParams(location.search).get('class');
  const token = new URLSearchParams(location.hash.slice(1)).get('t');
  if (!classId || !token) return null;
  history.replaceState(null, '', `${location.pathname}?class=${encodeURIComponent(classId)}`);
  return { classId, token };
}

export function App() {
  const pairing = useMemo(readPairing, []);
  if (!pairing) return <p className="fatal">Open this screen from the coach app to pair it.</p>;
  return <Paired {...pairing} />;
}

function Paired({ classId, token }: { classId: string; token: string }) {
  const view = useLiveClass({ apiBaseUrl: import.meta.env.VITE_API_BASE_URL, classId, token });

  // White-label injection: validated hex colours only, applied as CSS custom properties.
  useEffect(() => {
    if (!view.session) return;
    for (const [k, v] of Object.entries(brandingToCssVars(view.session.branding))) document.documentElement.style.setProperty(k, v);
  }, [view.session]);

  if (view.error) return <p className="fatal">Cannot reach LM Club ({view.error}).</p>;
  if (!view.session) return <p className="fatal">Loading…</p>;
  return <Dashboard session={view.session} connection={view.connection} state={view.dashboard} />;
}
