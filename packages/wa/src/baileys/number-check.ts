import { jidNormalizedUser } from 'baileys';

type OnWhatsApp = (jid: string) => Promise<Array<{ jid: string; exists: boolean }> | undefined>;

/**
 * The phone JID of a number that has WhatsApp, or null when it has none (or is not a number). `lookup`
 * is the socket's `onWhatsApp`; it answers only for numbers with an account, so an empty list is "no".
 */
export async function checkedNumberJid(phone: string, lookup: OnWhatsApp): Promise<string | null> {
  if (!/^\d{6,15}$/.test(phone)) return null;
  const [hit] = (await lookup(`${phone}@s.whatsapp.net`)) ?? [];
  return hit?.exists ? jidNormalizedUser(hit.jid) : null;
}
