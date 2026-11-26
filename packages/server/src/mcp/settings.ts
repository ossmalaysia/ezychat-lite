import type { McpSettingsResponse, User } from '@ezychat/shared';
import type { AppContext } from '../context.js';
import { canStartNewChats } from '../chats/new-chat.js';

export const MCP_ENABLED_SETTING = 'mcp_enabled';
/** Admin switch: team members (role `agent`) may hold their own access tokens. Off by default. */
export const MCP_MEMBERS_SETTING = 'mcp_members_enabled';
export const MCP_PATH = '/mcp';
/** Binary or multipart file uploads for the send tools (`uploadId`). */
export const MCP_UPLOADS_PATH = '/mcp/uploads';

/** AI assistant (MCP) access is off until an admin turns it on. */
export function isMcpEnabled(ctx: AppContext): boolean {
  return ctx.settings.get<boolean>(MCP_ENABLED_SETTING, false) === true;
}

export function setMcpEnabled(ctx: AppContext, enabled: boolean): void {
  ctx.settings.set(MCP_ENABLED_SETTING, enabled);
}

export function isMcpMembersEnabled(ctx: Pick<AppContext, 'settings'>): boolean {
  return ctx.settings.get<boolean>(MCP_MEMBERS_SETTING, false) === true;
}

export function setMcpMembersEnabled(ctx: AppContext, enabled: boolean): void {
  ctx.settings.set(MCP_MEMBERS_SETTING, enabled);
}

type Holder = Pick<User, 'role' | 'kind' | 'disabled' | 'mustChangePassword'>;

/** Why a token of this person can not be used right now (role and switches only), or null. */
export type McpHolderRefusal =
  'user_inactive' | 'not_allowed' | 'members_off' | 'must_change_password';

/**
 * The single rule for who may hold and use an AI assistant (MCP) token, read live on every call: an
 * active human admin, or an active human team member (`agent`) while the members switch is on. Never
 * the AI member, a disabled person or one who must change their password; never another role.
 */
export function mcpHolderRefusal(
  ctx: Pick<AppContext, 'settings'>,
  user: Holder | null | undefined,
): McpHolderRefusal | null {
  if (!user || user.disabled || user.kind === 'ai') return 'user_inactive';
  if (user.role !== 'admin') {
    if (user.role !== 'agent') return 'not_allowed';
    if (!isMcpMembersEnabled(ctx)) return 'members_off';
  }
  if (user.mustChangePassword) return 'must_change_password';
  return null;
}

/** HTTPS base URL of the running tunnel, which remote MCP clients connect through. */
function publicUrl(ctx: AppContext): string | null {
  const status = ctx.services.tunnel?.status();
  if (!status || status.state !== 'running') return null;
  if (status.url) return status.url.replace(/\/+$/, '');
  return status.hostname ? `https://${status.hostname}` : null;
}

/** The settings as the signed-in person sees them (`canConnect`: they may create tokens now). */
export function mcpSettings(ctx: AppContext, viewer: User): McpSettingsResponse {
  const enabled = isMcpEnabled(ctx);
  return {
    enabled,
    endpointPath: MCP_PATH,
    publicUrl: publicUrl(ctx),
    // config.port is the port actually listened on (a saved port change applies after a restart).
    localUrl: `http://127.0.0.1:${ctx.config.port}`,
    membersEnabled: isMcpMembersEnabled(ctx),
    canConnect: viewer.role === 'admin' || (enabled && mcpHolderRefusal(ctx, viewer) === null),
    canMessageNewNumbers: canStartNewChats(ctx, viewer),
  };
}
