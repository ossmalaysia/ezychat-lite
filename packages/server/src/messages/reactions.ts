import type { Message, MessageReaction } from '@ezychat/shared';
import { normalizeContactJid, type WaReaction } from '@ezychat/wa';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { getAliases, type AliasStore } from '../chats/aliases.js';
import { jidUser } from '../chats/repo.js';
import { PRIMARY_INBOX_ID, chatKey, inboxOfKey, parseChatKey } from '../inboxes/keys.js';

/** The reactor key of the linked number itself (its phone or any other linked device). */
export const OWN_REACTOR = 'me';

export interface ReactionRow {
  /** stored message key of the reacted message (it may not be stored yet) */
  message_id: string;
  /** OWN_REACTOR or the reactor's canonical JID (alias store) */
  reactor: string;
  /** the chat WhatsApp delivered the reaction in (no inbox suffix) */
  chat_wa_jid: string;
  emoji: string;
  sender_jid: string | null;
  /** WhatsApp profile name delivered with the reaction, if any */
  sender_name: string | null;
  from_me: number;
  reacted_at: number;
}

/** SQL of table message_reactions (migration 016); one row per reacted message and person. */
export class ReactionRepo {
  private readonly getStmt;
  private readonly upsertStmt;
  private readonly deleteStmt;
  private readonly listStmt;

  constructor(db: DB) {
    this.getStmt = db.prepare(
      'SELECT * FROM message_reactions WHERE message_id = ? AND reactor = ?',
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO message_reactions
         (message_id, reactor, chat_wa_jid, emoji, sender_jid, sender_name, from_me, reacted_at)
       VALUES (@message_id, @reactor, @chat_wa_jid, @emoji, @sender_jid, @sender_name, @from_me, @reacted_at)
       ON CONFLICT (message_id, reactor) DO UPDATE SET chat_wa_jid = excluded.chat_wa_jid,
         emoji = excluded.emoji, sender_jid = excluded.sender_jid,
         sender_name = COALESCE(excluded.sender_name, message_reactions.sender_name),
         from_me = excluded.from_me, reacted_at = excluded.reacted_at`,
    );
    this.deleteStmt = db.prepare(
      'DELETE FROM message_reactions WHERE message_id = ? AND reactor = ?',
    );
    this.listStmt = db.prepare(
      `SELECT r.* FROM json_each(?) ids JOIN message_reactions r ON r.message_id = ids.value
       ORDER BY r.reacted_at, r.reactor`,
    );
  }

  get(messageId: string, reactor: string): ReactionRow | null {
    return (this.getStmt.get(messageId, reactor) as ReactionRow | undefined) ?? null;
  }

  /**
   * Stores one reaction (`emoji` '' = removal) unless an equal or newer one is already stored, so a
   * replayed or older history reaction never undoes a newer live change. True when something changed.
   */
  apply(row: ReactionRow): boolean {
    const existing = this.get(row.message_id, row.reactor);
    if (existing && existing.reacted_at > row.reacted_at) return false;
    if (!row.emoji) {
      if (!existing) return false;
      this.deleteStmt.run(row.message_id, row.reactor);
      return true;
    }
    if (
      existing &&
      existing.emoji === row.emoji &&
      existing.chat_wa_jid === row.chat_wa_jid &&
      (row.sender_name === null || existing.sender_name === row.sender_name)
    )
      return false;
    this.upsertStmt.run(row);
    return true;
  }

  /** Reactions of many messages in one query per 500 ids, oldest first. */
  forMessages(ids: string[]): Map<string, ReactionRow[]> {
    const out = new Map<string, ReactionRow[]>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 500) {
      for (const row of this.listStmt.all(
        JSON.stringify(unique.slice(i, i + 500)),
      ) as ReactionRow[]) {
        const list = out.get(row.message_id) ?? [];
        list.push(row);
        out.set(row.message_id, list);
      }
    }
    return out;
  }
}

/** The row a WhatsApp reaction becomes; null when it names no reactor. */
export function reactionRow(
  r: WaReaction,
  messageId: string,
  aliases: Pick<AliasStore, 'resolve'>,
): ReactionRow | null {
  const sender = r.fromMe ? null : normalizeContactJid(r.senderJid);
  if (!r.fromMe && !sender) return null;
  return {
    message_id: messageId,
    reactor: sender ? aliases.resolve(sender) : OWN_REACTOR,
    chat_wa_jid: r.chatJid,
    emoji: r.emoji.trim() ? r.emoji : '',
    sender_jid: sender ? aliases.resolve(sender) : null,
    sender_name: r.fromMe ? null : r.senderName?.trim() || null,
    from_me: r.fromMe ? 1 : 0,
    reacted_at: r.timestamp,
  };
}

interface KnownName {
  jid: string;
  saved_name: string | null;
  push_name: string | null;
  chat_name: string | null;
  profile_name: string | null;
}

/**
 * Attaches reactions to presented messages with one batched query (plus one name query), never one
 * per message. A reaction shows only on a message of the chat it was delivered in. Reactors are
 * named from the team's customer profile, the saved contact, the direct chat or the WhatsApp name
 * delivered with the reaction; never inferred, and never from a number re-pointed to someone else.
 */
export function createReactionPresenter(ctx: AppContext) {
  const repo = new ReactionRepo(ctx.db);
  const names = ctx.db.prepare(`
    SELECT ids.value AS jid, c.saved_name, c.push_name, ch.name AS chat_name, p.name AS profile_name
    FROM json_each(?) ids
    LEFT JOIN contacts c ON c.jid = ids.value
    LEFT JOIN chats ch ON ch.jid = ids.value AND ch.type = 'dm'
    LEFT JOIN customer_profiles p ON p.chat_jid = ids.value
    WHERE c.jid IS NOT NULL OR ch.jid IS NOT NULL OR p.chat_jid IS NOT NULL
  `);

  /** The reaction was delivered in the message's own chat (either address of a direct chat). */
  const sameChat = (aliases: AliasStore, chatWaJid: string, messageChatKey: string): boolean => {
    const { inboxId, waJid } = parseChatKey(messageChatKey);
    if (chatWaJid === waJid) return true;
    if (waJid.endsWith('@g.us') || chatWaJid.endsWith('@g.us')) return false;
    return (
      aliases.resolve(chatWaJid) === aliases.resolve(waJid) ||
      aliases.route(inboxId, chatWaJid) === messageChatKey
    );
  };

  /** Each message's rows → its reactions; one name query for all of them. */
  const present = (
    groups: Array<{ rows: ReactionRow[]; chatKey: string }>,
  ): MessageReaction[][] => {
    const aliases = getAliases(ctx);
    const visibleGroups = groups.map(({ rows, chatKey: key }) => ({
      inboxId: inboxOfKey(key),
      rows: rows.filter((r) => sameChat(aliases, r.chat_wa_jid, key)),
    }));
    // Every address of every reactor, in its inbox's chat keys too (profiles live on chat keys).
    const lookupKey = (inboxId: number, jid: string) => `${inboxId}|${jid}`;
    const lookups = new Map<string, string[]>();
    for (const { inboxId, rows } of visibleGroups)
      for (const r of rows) {
        if (!r.sender_jid || lookups.has(lookupKey(inboxId, r.sender_jid))) continue;
        const ids = aliases.group(r.sender_jid).filter((id) => !aliases.movedAway(id));
        lookups.set(
          lookupKey(inboxId, r.sender_jid),
          ids.flatMap((id) => (inboxId === PRIMARY_INBOX_ID ? [id] : [id, chatKey(inboxId, id)])),
        );
      }
    const wanted = [...new Set([...lookups.values()].flat())];
    const known = new Map<string, KnownName>();
    for (let i = 0; i < wanted.length; i += 500)
      for (const row of names.all(JSON.stringify(wanted.slice(i, i + 500))) as KnownName[])
        known.set(row.jid, row);
    const meaningful = (name: string | null, id: string) => {
      const trimmed = name?.trim();
      const plain = id.split('#')[0]!;
      return trimmed && trimmed !== plain && trimmed !== jidUser(plain) ? trimmed : null;
    };
    const nameOf = (r: ReactionRow, inboxId: number): string | null => {
      if (!r.sender_jid) return null;
      const records = (lookups.get(lookupKey(inboxId, r.sender_jid)) ?? []).flatMap((id) =>
        known.get(id) ? [known.get(id)!] : [],
      );
      const best = (field: keyof Omit<KnownName, 'jid'>) =>
        records.map((row) => meaningful(row[field], row.jid)).find(Boolean);
      return (
        best('profile_name') ||
        best('saved_name') ||
        best('chat_name') ||
        best('push_name') ||
        (aliases.movedAway(r.sender_jid) ? null : r.sender_name) ||
        null
      );
    };
    return visibleGroups.map(({ inboxId, rows }) =>
      rows.map((r) => ({
        emoji: r.emoji,
        senderJid: r.sender_jid,
        senderName: nameOf(r, inboxId),
        fromMe: r.from_me === 1,
        at: r.reacted_at,
      })),
    );
  };

  return {
    repo,
    /** The current reactions of one stored message (for the `message:reactions` event). */
    forMessage(messageId: string, messageChatKey: string): MessageReaction[] {
      const rows = repo.forMessages([messageId]).get(messageId) ?? [];
      return present([{ rows, chatKey: messageChatKey }])[0]!;
    },
    /** Messages with their reactions; untouched objects when none of them has a reaction. */
    attach(messages: Message[]): Message[] {
      if (!messages.length) return messages;
      const byMessage = repo.forMessages(messages.map((m) => m.id));
      if (!byMessage.size) return messages;
      const reacted = messages.filter((m) => byMessage.has(m.id));
      const presented = present(
        reacted.map((m) => ({ rows: byMessage.get(m.id)!, chatKey: m.chatJid })),
      );
      const byId = new Map(reacted.map((m, i) => [m.id, presented[i]!]));
      return messages.map((m) => (byId.has(m.id) ? { ...m, reactions: byId.get(m.id)! } : m));
    },
  };
}

export type ReactionPresenter = ReturnType<typeof createReactionPresenter>;
