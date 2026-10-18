import { spawn } from 'node:child_process';
import type { AppContext } from '../context.js';
import { resolveCloudflaredPath } from './binary.js';
import { TunnelManager, type TunnelService } from './manager.js';
import { CloudflareSetup, type CloudflareSetupService } from './cloudflare-setup.js';

export { parseQuickTunnelUrl, isNamedTunnelRegistered } from './parse.js';
export { resolveCloudflaredPath, cloudflaredBinaryName } from './binary.js';
export { TunnelManager, type TunnelService, type TunnelManagerDeps } from './manager.js';

declare module '../context.js' {
  interface Services {
    tunnel?: TunnelService;
    cloudflareSetup?: CloudflareSetupService;
  }
}

/**
 * Directory holding bundled extraResources (contains `cloudflared/<platform>-<arch>/`).
 * Desktop passes WATI_RESOURCES_DIR; inside Electron, process.resourcesPath is used as a fallback.
 */
function resourcesDir(): string | undefined {
  return process.env.WATI_RESOURCES_DIR ?? (process as { resourcesPath?: string }).resourcesPath;
}

/**
 * Phone access (tunnel) public addresses while the tunnel is running, e.g. for OAuth redirect
 * addresses. Read-only; empty when the tunnel is off, starting or failed. A Quick Tunnel address
 * changes on every start: listen to the `tunnel:status` bus event to follow it.
 */
export function tunnelPublicUrls(ctx: AppContext): string[] {
  const status = ctx.services.tunnel?.status();
  if (!status || status.state !== 'running' || !status.url) return [];
  try {
    const url = new URL(status.url);
    return url.protocol === 'https:' ? [url.origin] : [];
  } catch {
    return [];
  }
}

/** Service initializer: creates the tunnel manager and resumes the previously persisted tunnel mode. */
export function initTunnel(ctx: AppContext): void {
  const manager = new TunnelManager({
    spawn,
    binPath: () => resolveCloudflaredPath(process.env, resourcesDir()),
    port: () => ctx.config.port,
    settings: ctx.settings,
    bus: ctx.bus,
    log: ctx.log.child({ mod: 'tunnel' }),
  });
  ctx.services.tunnel = manager;
  const setup = new CloudflareSetup({
    ctx,
    tunnel: manager,
    binPath: () => resolveCloudflaredPath(process.env, resourcesDir()),
  });
  ctx.services.cloudflareSetup = setup;
  // Access gate: an edition turning the app off also takes it off the internet (mode is kept).
  const log = ctx.log.child({ mod: 'tunnel' });
  ctx.bus.on('access:closed', () => {
    manager.pause().catch((err: unknown) => log.warn({ err }, 'tunnel pause failed'));
  });
  ctx.bus.on('access:opened', () => {
    manager.resume().catch((err: unknown) => log.warn({ err }, 'tunnel resume failed'));
  });
  if (!ctx.access.state().open) void manager.pause();
  // No-op when the persisted mode is 'off' (e.g. fresh test data dirs). Never block startup on cloudflared.
  setup.restore().catch(() => ctx.log.warn({ mod: 'tunnel' }, 'Tunnel restore failed'));
}
