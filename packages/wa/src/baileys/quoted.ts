import type { WAMessage } from 'baileys';
import type { WaQuotedRef } from '../types.js';

/** Shown in the quote when the quoted media had no caption (WhatsApp still links it by id). */
const MEDIA_LABEL: Record<string, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎤 Voice message',
  document: '📄 Document',
  sticker: 'Sticker',
};

/**
 * A cached message re-pointed at the chat the reply goes to. One person can be reached by a phone
 * number and a WhatsApp ID (LID); a message cached under the old address would otherwise make
 * Baileys mark the quote as coming from another chat (`contextInfo.remoteJid`).
 */
export function quotedForChat(cached: WAMessage, chatJid: string): WAMessage {
  if (cached.key.remoteJid === chatJid) return cached;
  return { ...cached, key: { ...cached.key, remoteJid: chatJid } };
}

/**
 * A minimal WAMessage for Baileys' `quoted` option, rebuilt from the saved message when the live one
 * is no longer cached. Baileys reads `key.id` (stanzaId), `key.fromMe`, `key.remoteJid` (must be the
 * chat the reply goes to, or it adds a foreign remoteJid), `key.participant` (group sender) and the
 * message content (the preview recipients see).
 */
export function quotedFromRef(ref: WaQuotedRef, chatJid: string): WAMessage {
  const isGroup = chatJid.endsWith('@g.us');
  return {
    key: {
      remoteJid: chatJid,
      id: ref.id,
      fromMe: ref.fromMe,
      ...(isGroup && !ref.fromMe && ref.senderJid ? { participant: ref.senderJid } : {}),
    },
    message: { conversation: ref.text?.trim() ? ref.text : (MEDIA_LABEL[ref.type] ?? '') },
  };
}
