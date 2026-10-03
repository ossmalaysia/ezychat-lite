import type { WaContactAlias } from '../types.js';

/** Accept only numeric direct identities; normalize device IDs and legacy PN domains. */
export function normalizeContactJid(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/.exec(jid);
  return match ? `${match[1]}@${match[2] === 'lid' ? 'lid' : 's.whatsapp.net'}` : null;
}

/** Canonical orientation is PN -> LID, regardless of the event field orientation. */
export function contactAliasPair(first: unknown, second: unknown): WaContactAlias | null {
  const a = normalizeContactJid(first);
  const b = normalizeContactJid(second);
  if (!a || !b || a.endsWith('@lid') === b.endsWith('@lid')) return null;
  return a.endsWith('@lid') ? { jid: b, alias: a } : { jid: a, alias: b };
}
