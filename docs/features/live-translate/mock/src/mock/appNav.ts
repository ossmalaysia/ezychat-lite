// Proposed (app-navigation), mock only: a switch that makes a WhatsApp number "need attention" so the red dot on
// Settings can be shown without breaking the demo's real (fake) WhatsApp connection. `?attention=1` / `?attention=0`
// in the address sets it too (used by the screenshot script). The app reads the real number states instead.
import { useSyncExternalStore } from 'react';

const KEY = 'mock.appNav.attention.v1';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let attention = read();

export function setMockAttention(next: boolean) {
  attention = next;
  try {
    if (next) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: keep it for this page */
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  const param = new URLSearchParams(window.location.search).get('attention');
  if (param === '1' || param === '0') setMockAttention(param === '1');
}

export function useMockAttention(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => attention,
  );
}
