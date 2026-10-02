import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function cloudflaredBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Locates the cloudflared binary:
 * WATI_CLOUDFLARED env → <resourcesDir>/cloudflared/<platform>-<arch>/cloudflared(.exe) → PATH lookup → null.
 */
export function resolveCloudflaredPath(env: NodeJS.ProcessEnv, resourcesDir?: string): string | null {
  const explicit = env.WATI_CLOUDFLARED;
  if (explicit && isFile(explicit)) return explicit;

  const name = cloudflaredBinaryName();
  // Desktop shell always exports the directory it ships cloudflared in.
  if (env.WATI_CLOUDFLARED_DIR) {
    const inDir = join(env.WATI_CLOUDFLARED_DIR, name);
    if (isFile(inDir)) return inDir;
  }
  if (resourcesDir) {
    const bundled = join(resourcesDir, 'cloudflared', `${process.platform}-${process.arch}`, name);
    if (isFile(bundled)) return bundled;
  }

  // Windows env keys are case-insensitive in process.env but not in plain objects.
  const pathVar = env.PATH ?? env.Path ?? env.path ?? '';
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir.replace(/^"|"$/g, ''), name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}
