// Every signed-in screen of the inbox app. One list for every screen test (screens.smoke.mjs,
// electron-links.smoke.mjs): add a new screen here and all of them cover it.
export const SMOKE_ADMIN = {
  username: 'smoke',
  displayName: 'Smoke Admin',
  password: 'smoke-pass-123',
};
export const SMOKE_CHAT = '60123456789@s.whatsapp.net';
export const SCREEN_ROUTES = [
  ['inbox', '/'],
  ['conversation', `/chats/${encodeURIComponent(SMOKE_CHAT)}`],
  ['conversation-customer', `/chats/${encodeURIComponent(SMOKE_CHAT)}?customer=1`],
  ['admin-members', '/admin/members'],
  ['admin-members-ai', '/admin/members/ai'],
  ['admin-quick-replies', '/admin/quick-replies'],
  ['admin-whatsapp', '/admin/whatsapp'],
  ['admin-tunnel', '/admin/tunnel'],
  ['admin-settings', '/admin/settings'],
  ['admin-settings-ai', '/admin/settings/ai'],
  ['admin-settings-integrations', '/admin/settings/integrations'],
  ['admin-settings-device', '/admin/settings/device'],
  ['admin-settings-maintenance', '/admin/settings/maintenance'],
  ['admin-audit', '/admin/audit'],
  ['change-password', '/change-password'],
];
