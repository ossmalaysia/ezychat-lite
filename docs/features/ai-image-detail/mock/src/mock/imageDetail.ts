// Proposed (ai-image-detail): mock-only store for the "Images from customers" setting. Production keeps
// it on the server (setting `ai_image_detail`, admin-only, audited); this mock keeps it in the browser.
import { useSyncExternalStore } from 'react';

/** `detailed` = OpenAI `detail: 'high'`, `fast` = `detail: 'low'`. Claude always reads in detail. */
export type ImageDetail = 'detailed' | 'fast';

const KEY = 'mock.imageDetail.v1';
let state: ImageDetail = initial();
const listeners = new Set<() => void>();

function initial(): ImageDetail {
  try {
    return localStorage.getItem(KEY) === 'fast' ? 'fast' : 'detailed';
  } catch {
    // Private window or blocked storage: the default.
    return 'detailed';
  }
}

export function setMockImageDetail(next: ImageDetail) {
  state = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked: keep it for this page only.
  }
  for (const l of listeners) l();
}

export function useMockImageDetail(): ImageDetail {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
