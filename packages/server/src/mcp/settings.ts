import type { McpSettingsResponse } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';

export const MCP_ENABLED_SETTING = 'mcp_enabled';
export const MCP_PATH = '/mcp';

/** AI assistant (MCP) access is off until an admin turns it on. */
export function isMcpEnabled(ctx: AppContext): boolean {
  return ctx.settings.get<boolean>(MCP_ENABLED_SETTING, false) === true;
}

export function setMcpEnabled(ctx: AppContext, enabled: boolean): void {
  ctx.settings.set(MCP_ENABLED_SETTING, enabled);
}

/** HTTPS base URL of the running tunnel, which remote MCP clients connect through. */
function publicUrl(ctx: AppContext): string | null {
  const status = ctx.services.tunnel?.status();
  if (!status || status.state !== 'running') return null;
  if (status.url) return status.url.replace(/\/+$/, '');
  return status.hostname ? `https://${status.hostname}` : null;
}

export function mcpSettings(ctx: AppContext): McpSettingsResponse {
  return { enabled: isMcpEnabled(ctx), endpointPath: MCP_PATH, publicUrl: publicUrl(ctx) };
}
