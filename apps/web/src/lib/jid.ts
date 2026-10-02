/** Helpers for WhatsApp JIDs (e.g. `60123456789@s.whatsapp.net`, `12345-678@g.us`). */

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** The user part before `@` and before any `:device` suffix. */
export function jidUser(jid: string): string {
  const at = jid.indexOf('@');
  const user = at === -1 ? jid : jid.slice(0, at);
  const colon = user.indexOf(':');
  return colon === -1 ? user : user.slice(0, colon);
}

/** Human-readable phone (`+60123456789`) for user JIDs, the raw id for groups/others. */
export function formatJid(jid: string): string {
  if (isGroupJid(jid)) return 'Group';
  const user = jidUser(jid);
  if (/^\d{5,}$/.test(user) && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')))
    return `+${user}`;
  return user;
}

/** For use in route paths: `/chats/${encodeJid(jid)}`. */
export function encodeJid(jid: string): string {
  return encodeURIComponent(jid);
}

export function decodeJid(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}
