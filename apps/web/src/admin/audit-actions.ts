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
  'chat.merge': 'audit.actions.chatMerge',
  'logs.download': 'audit.actions.logsDownload',
  'customer.profile_update': 'audit.actions.customerProfileUpdate',
} as const;

type KnownAction = keyof typeof LABEL_KEYS;

const isKnown = (action: string): action is KnownAction => Object.hasOwn(LABEL_KEYS, action);

/** Human label for an audit action; unknown actions are shown as their raw identifier. */
export function auditActionLabel(action: string, t: TFunction<'admin'>): string {
  return isKnown(action) ? t(LABEL_KEYS[action]) : action;
}

/** Customer profile fields, as the server lists them in `meta.changed`. */
const CUSTOMER_FIELD_KEYS = {
  name: 'audit.customerFields.name',
  company: 'audit.customerFields.company',
  email: 'audit.customerFields.email',
  otherPhone: 'audit.customerFields.otherPhone',
  address: 'audit.customerFields.address',
  tags: 'audit.customerFields.tags',
} as const;

function genericSummary(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

/**
 * Readable "Details" cell. Customer edits list the changed fields and the customer's phone number
 * when the chat is keyed by it; an opaque WhatsApp ID (`@lid`) is never shown.
 */
export function auditDetails(
  action: string,
  meta: Record<string, unknown>,
  t: TFunction<'admin'>,
): string {
  if (action === 'customer.profile_update') {
    const changed = Array.isArray(meta.changed) ? meta.changed : [];
    const fields = changed
      .map((f) =>
        typeof f === 'string' && Object.hasOwn(CUSTOMER_FIELD_KEYS, f)
          ? t(CUSTOMER_FIELD_KEYS[f as keyof typeof CUSTOMER_FIELD_KEYS])
          : String(f),
      )
      .join(t('audit.listSeparator'));
    const jid = typeof meta.chatJid === 'string' ? meta.chatJid : '';
    const phone = /^(\d{5,})@(s\.whatsapp\.net|c\.us)$/.exec(jid)?.[1];
    const summary = t('audit.details.customerChanged', { fields });
    return phone ? `${summary} · +${phone}` : summary;
  }
  return genericSummary(meta);
}
