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
  // No-op when the persisted mode is 'off' (e.g. fresh test data dirs). Never block startup on cloudflared.
  setup.restore().catch(() => ctx.log.warn({ mod: 'tunnel' }, 'Tunnel restore failed'));
}
