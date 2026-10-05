import type { TFunction } from 'i18next';

/** Audit action → translation key in the `admin` namespace. */
const LABEL_KEYS = {
  'auth.login': 'audit.actions.authLogin',
  'auth.login_failed': 'audit.actions.authLoginFailed',
  'auth.logout': 'audit.actions.authLogout',
  'auth.change_password': 'audit.actions.authChangePassword',
  'auth.reset_admin_cli': 'audit.actions.authResetAdminCli',
  'setup.admin': 'audit.actions.setupAdmin',
  'user.create': 'audit.actions.userCreate',
  'user.update': 'audit.actions.userUpdate',
  'user.reset_password': 'audit.actions.userResetPassword',
  'user.revoke_sessions': 'audit.actions.userRevokeSessions',
  'quick_reply.create': 'audit.actions.quickReplyCreate',
  'quick_reply.update': 'audit.actions.quickReplyUpdate',
  'quick_reply.delete': 'audit.actions.quickReplyDelete',
  'wa.logout': 'audit.actions.waLogout',
  'wa.relink': 'audit.actions.waRelink',
  'wa.takeover': 'audit.actions.waTakeover',
  'wa.pairing_code': 'audit.actions.waPairingCode',
  'tunnel.start': 'audit.actions.tunnelStart',
  'tunnel.stop': 'audit.actions.tunnelStop',
  'cloudflare.login': 'audit.actions.cloudflareLogin',
  'cloudflare.create': 'audit.actions.cloudflareCreate',
  'settings.update': 'audit.actions.settingsUpdate',
  'chats.resolve_all': 'audit.actions.chatsResolveAll',
  'logs.download': 'audit.actions.logsDownload',
} as const;

type KnownAction = keyof typeof LABEL_KEYS;

const isKnown = (action: string): action is KnownAction => Object.hasOwn(LABEL_KEYS, action);

/** Human label for an audit action; unknown actions are shown as their raw identifier. */
export function auditActionLabel(action: string, t: TFunction<'admin'>): string {
  return isKnown(action) ? t(LABEL_KEYS[action]) : action;
}
