import { downloadMediaMessage, normalizeMessageContent, type proto, type WAMessage } from 'baileys';
import type { MessageType } from '@wa-team-inbox/shared';
import type { WaIncomingMessage } from '../types.js';

export type JidKind = 'dm' | 'group' | 'other';

export function jidType(jid: string): JidKind {
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) return 'dm';
  // status@broadcast, @broadcast lists, @newsletter channels, anything unknown
  return 'other';
}

type LongLike = { toNumber(): number } | { low: number; high: number };

/** Convert a protobuf timestamp (number | Long | null) in seconds to epoch ms. */
export function toMs(ts: number | LongLike | null | undefined, fallback = Date.now()): number {
  if (ts == null) return fallback;
  if (typeof ts === 'number') return ts * 1000;
  if ('toNumber' in ts && typeof ts.toNumber === 'function') return ts.toNumber() * 1000;
  if ('low' in ts) return ((ts.high >>> 0) * 2 ** 32 + (ts.low >>> 0)) * 1000;
  return fallback;
}

/** Optional hook for media downloads that need a live socket (reupload of expired media). */
export type MediaDownloader = (msg: WAMessage) => Promise<Buffer>;

const defaultDownloader: MediaDownloader = async (msg) =>
  (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;

interface ContextCarrier {
  contextInfo?: proto.IContextInfo | null;
}

/**
 * Map a raw Baileys message to our adapter shape. Returns null for messages
 * that should not appear in the inbox (reactions, protocol, key distribution,
 * status/newsletter/broadcast, empty).
 */
export function mapWAMessage(
  msg: proto.IWebMessageInfo,
  download: MediaDownloader = defaultDownloader,
): WaIncomingMessage | null {
  const key = msg.key;
  const chatJid = key?.remoteJid;
  const id = key?.id;
  if (!key || !chatJid || !id) return null;
  if (jidType(chatJid) === 'other') return null;

  const content = normalizeMessageContent(msg.message);
  if (!content) return null;

  const fromMe = !!key.fromMe;
  const isGroup = jidType(chatJid) === 'group';
  const senderJid = fromMe ? null : isGroup ? (key.participant ?? null) : chatJid;
  const senderName = fromMe ? null : (msg.pushName ?? null);
  const timestamp = toMs(msg.messageTimestamp as number | LongLike | null | undefined);

  let type: MessageType;
  let body: string | null = null;
  let ctx: ContextCarrier | null | undefined;
  let media: { mime: string; fileName: string | null } | null = null;

  if (content.conversation != null) {
    type = 'text';
    body = content.conversation;
  } else if (content.extendedTextMessage) {
    type = 'text';
    body = content.extendedTextMessage.text ?? '';
    ctx = content.extendedTextMessage;
  } else if (content.imageMessage) {
    const m = content.imageMessage;
    type = 'image';
    body = m.caption ?? null;
    ctx = m;
    media = { mime: m.mimetype ?? 'image/jpeg', fileName: null };
  } else if (content.videoMessage) {
    const m = content.videoMessage;
    type = 'video';
    body = m.caption ?? null;
    ctx = m;
    media = { mime: m.mimetype ?? 'video/mp4', fileName: null };
  } else if (content.audioMessage) {
    const m = content.audioMessage;
    type = 'audio';
    ctx = m;
    media = { mime: m.mimetype ?? (m.ptt ? 'audio/ogg; codecs=opus' : 'audio/mpeg'), fileName: null };
  } else if (content.documentMessage) {
    const m = content.documentMessage;
    type = 'document';
    body = m.caption ?? null;
    ctx = m;
    media = { mime: m.mimetype ?? 'application/octet-stream', fileName: m.fileName ?? m.title ?? null };
  } else if (content.stickerMessage) {
    const m = content.stickerMessage;
    type = 'sticker';
    ctx = m;
    media = { mime: m.mimetype ?? 'image/webp', fileName: null };
  } else {
    // reactionMessage, protocolMessage, senderKeyDistributionMessage, polls, calls, etc.
    return null;
  }

  const quotedId = ctx?.contextInfo?.stanzaId ?? null;
  const raw = msg as WAMessage;

  return {
    id,
    chatJid,
    senderJid,
    senderName,
    fromMe,
    type,
    body,
    quotedId,
    timestamp,
    media: media ? { ...media, download: () => download(raw) } : null,
  };
}
