// Shared by the fetch scripts (cloudflared, WinSW). The callers verify the SHA-256 before they write.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Default output: the Lite repository's resources/ (this file is apps/desktop/scripts/). Another edition
 * runs the scripts from node_modules/@ezychat/desktop and passes --out <its resources folder>.
 */
export const DEFAULT_RESOURCES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'resources',
);

/** Downloads `url` (redirects followed) and returns its bytes; retries twice on any failure. */
export async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'wa-team-inbox-build' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`  download failed (${err.message}); retrying…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
