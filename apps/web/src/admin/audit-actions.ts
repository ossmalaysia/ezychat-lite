const LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.change_password': 'Password changed',
  'auth.reset_admin_cli': 'Admin password reset',
  'setup.admin': 'Admin account created',
  'user.create': 'Member added',
  'user.update': 'Member updated',
  'user.reset_password': 'Member password reset',
  'user.revoke_sessions': 'Member signed out of all devices',
  'quick_reply.create': 'Quick reply created',
  'quick_reply.update': 'Quick reply updated',
  'quick_reply.delete': 'Quick reply deleted',
  'wa.logout': 'WhatsApp unlinked',
  'wa.relink': 'WhatsApp linking restarted',
  'wa.takeover': 'WhatsApp session taken over',
  'wa.pairing_code': 'WhatsApp pairing code requested',
  'tunnel.start': 'Tunnel started',
  'tunnel.stop': 'Tunnel stopped',
  'cloudflare.login': 'Cloudflare sign-in started',
  'cloudflare.create': 'Cloudflare inbox address configured',
  'settings.update': 'Settings updated',
  'chats.resolve_all': 'All open chats resolved',
  'logs.download': 'Logs downloaded',
};

export function auditActionLabel(action: string): string {
  return LABELS[action] ?? action;
}
