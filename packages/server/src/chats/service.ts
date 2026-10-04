import type { Chat, ChatEvent, ChatListQuery, ChatPatchBody, Note } from '@wa-team-inbox/shared';
import type { WaChatInfo, WaContactInfo, WaContactAlias } from '@wa-team-inbox/wa';
import type { AppContext } from '../context.js';
import { errors } from '../http/errors.js';
import { ChatRepo, chatTypeOf, jidUser, rowToChat } from './repo.js';

export interface ChatService {
  list(q: ChatListQuery, userId: number): { chats: Chat[]; nextCursor: string | null };
  get(jid: string): Chat | null;
  events(jid: string): ChatEvent[];
  upsertFromWa(info: WaChatInfo): Chat;
  /** actorId null = system */
  patch(jid: string, body: ChatPatchBody, actorId: number | null): Chat;
  markRead(jid: string, userId: number): Promise<void>;
  addNote(jid: string, userId: number, body: string): Note;
  listNotes(jid: string): Note[];
  /** Contacts from WA: upserts contacts table and fills DM chat names that are still fallbacks. */
  upsertContacts(list: WaContactInfo[]): void;
  /** Explicit WhatsApp phone/LID identities; never infer a match from a name or number. */
  upsertContactAliases(list: WaContactAlias[]): void;
  contactJids(): string[];
}

export function encodeCursor(ts: number | null, jid: string): string {
  return Buffer.from(`${ts ?? 0}_${jid}`, 'utf8').toString('base64url');
}

export function decodeCursor(c: string): { ts: number; jid: string } | null {
  try {
    const s = Buffer.from(c, 'base64url').toString('utf8');
    const i = s.indexOf('_');
    if (i <= 0) return null;
    const ts = Number(s.slice(0, i));
    const jid = s.slice(i + 1);
    if (!Number.isFinite(ts) || !jid) return null;
    return { ts, jid };
  } catch {
    return null;
  }
}

/** A chat name counts as "fallback" (replaceable by a better one) when empty or equal to the jid's number. */
export function isFallbackName(name: string, jid: string): boolean {
  return !name.trim() || name === jidUser(jid) || name === jid;
}

export function createChatService(ctx: AppContext, deps?: { now?: () => number }): ChatService {
  const repo = new ChatRepo(ctx.db);
  const now = deps?.now ?? Date.now;
  const aliases = new Map<string, Set<string>>();
  const log = ctx.log.child({ mod: 'contacts' });

  const emitChat = (jid: string): Chat => {
    const chat = rowToChat(repo.get(jid)!);
    ctx.bus.emit('chat:updated', chat);
    return chat;
  };

  const link = ({ jid, alias }: WaContactAlias): Set<string> | null => {
    const direct = (id: string) => /^\d+@(?:s\.whatsapp\.net|lid)$/.test(id);
    if (!direct(jid) || !direct(alias) || jid.split('@')[1] === alias.split('@')[1]) return null;
    // These identities describe one person. A conflicting pair must not join two contacts.
    if (aliases.has(jid) && !aliases.get(jid)!.has(alias)) return null;
    if (aliases.has(alias) && !aliases.get(alias)!.has(jid)) return null;
    const group = new Set([...(aliases.get(jid) ?? [jid]), ...(aliases.get(alias) ?? [alias])]);
    for (const id of group) aliases.set(id, group);
    return group;
  };

  const syncNames = (ids: Iterable<string>, t: number, incoming?: WaContactInfo): Set<string> => {
    const group = [...ids];
    const stored = group.map((jid) => repo.getContact(jid));
    const savedName =
      incoming?.savedName?.trim() || stored.find((c) => c?.saved_name)?.saved_name || null;
    const pushName =
      incoming?.pushName?.trim() || stored.find((c) => c?.push_name)?.push_name || null;
    const phoneJid = group.find((jid) => jid.endsWith('@s.whatsapp.net'));
    const phone = stored.find((c) => c?.phone)?.phone || (phoneJid ? jidUser(phoneJid) : null);
    const renamed = new Set<string>();
    for (const [index, jid] of group.entries()) {
      repo.upsertContact({ jid, savedName, pushName });
      // Retain the phone-number search field on the opaque LID row as well.
      if (phone) ctx.db.prepare('UPDATE contacts SET phone = ? WHERE jid = ?').run(phone, jid);
      const best = savedName || pushName;
      const chat = repo.get(jid);
      const followsPushName = !!stored[index]?.push_name && chat?.name === stored[index]?.push_name;
      if (
        chat?.type === 'dm' &&
        best &&
        chat.name !== best &&
        (savedName || isFallbackName(chat.name, jid) || followsPushName)
      ) {
        repo.setName(jid, best, t);
        renamed.add(jid);
      }
    }
    return renamed;
  };

  // Older imports may have saved the contact before its chat and left a numeric name.
  // Saved address-book names are authoritative; a push name only replaces a fallback.
  const backfilled = ctx.db.transaction(() => {
    let count = 0;
    for (const chat of repo.directChats()) {
      const contact = repo.getContact(chat.jid);
      const best = contact?.saved_name || contact?.push_name;
      if (
        best &&
        (contact?.saved_name || isFallbackName(chat.name, chat.jid)) &&
        chat.name !== best
      ) {
        repo.setName(chat.jid, best, now());
        count++;
      }
    }
    return count;
  })();
  log.info({ renamedCount: backfilled }, 'contact name startup backfill');

  const svc: ChatService = {
    list(q, userId) {
      let cursor: { ts: number; jid: string } | null = null;
      if (q.cursor) {
        cursor = decodeCursor(q.cursor);
        if (!cursor) throw errors.validation('Invalid cursor');
      }
      const rows = repo.list({
        status: q.status,
        assigned: q.assigned ?? 'any',
        userId,
        q: q.q,
        since: q.since,
        cursor,
        limit: q.limit + 1,
      });
      const more = rows.length > q.limit;
      const page = more ? rows.slice(0, q.limit) : rows;
      const last = page[page.length - 1];
      return {
        chats: page.map(rowToChat),
        nextCursor: more && last ? encodeCursor(last.last_message_at, last.jid) : null,
      };
    },

    get(jid) {
      const r = repo.get(jid);
      return r ? rowToChat(r) : null;
    },

    events(jid) {
      return repo.events(jid);
    },

    upsertFromWa(info) {
      const t = now();
      const existing = repo.get(info.jid);
      if (!existing) {
        repo.ensure(info.jid, { type: info.type, name: info.name ?? '' }, t);
        return emitChat(info.jid);
      }
      const contact = existing.type === 'dm' ? repo.getContact(info.jid) : null;
      const supplied = info.name?.trim() || null;
      const best =
        contact?.saved_name ||
        (supplied && !isFallbackName(supplied, info.jid)
          ? supplied
          : contact?.push_name || supplied);
      if (
        best &&
        best !== existing.name &&
        (existing.type === 'group' ||
          !!contact?.saved_name ||
          isFallbackName(existing.name, info.jid))
      ) {
        repo.setName(info.jid, best, t);
        return emitChat(info.jid);
      }
      return rowToChat(existing);
    },

    patch(jid, body, actorId) {
      const cur = repo.get(jid);
      if (!cur) throw errors.notFound('Chat');
      const t = now();
      const events: ChatEvent[] = [];
      const fields: Partial<Parameters<ChatRepo['update']>[1]> = {};

      if (body.assignedTo !== undefined && body.assignedTo !== cur.assigned_to) {
        if (body.assignedTo !== null) {
          const user = ctx.services.auth?.getUser(body.assignedTo) ?? null;
          if (!user || user.disabled) throw errors.validation('Assignee must be an active user');
          fields.assigned_to = body.assignedTo;
          events.push(
            repo.insertEvent({
              chatJid: jid,
              type: 'assigned',
              actorId,
              payload: { assignedTo: body.assignedTo, previous: cur.assigned_to },
              at: t,
            }),
          );
        } else {
          fields.assigned_to = null;
          events.push(
            repo.insertEvent({
              chatJid: jid,
              type: 'unassigned',
              actorId,
              payload: { previous: cur.assigned_to },
              at: t,
            }),
          );
        }
      }
      if (body.status !== undefined && body.status !== cur.status) {
        fields.status = body.status;
        events.push(
          repo.insertEvent({
            chatJid: jid,
            type: body.status === 'resolved' ? 'resolved' : 'reopened',
            actorId,
            payload: {},
            at: t,
          }),
        );
        // Resolving hands the customer back to the team, unless this request also names an owner.
        if (
          body.status === 'resolved' &&
          body.assignedTo === undefined &&
          cur.assigned_to !== null
        ) {
          fields.assigned_to = null;
          events.push(
            repo.insertEvent({
              chatJid: jid,
              type: 'unassigned',
              actorId,
              payload: { previous: cur.assigned_to, reason: 'resolved' },
              at: t,
            }),
          );
        }
      }
      if (!events.length) return rowToChat(cur);
      fields.updated_at = t;
      repo.update(jid, fields);
      for (const e of events) ctx.bus.emit('chat:event', e);
      return emitChat(jid);
    },

    async markRead(jid, _userId) {
      const cur = repo.get(jid);
      if (!cur) throw errors.notFound('Chat');
      const ids = (
        ctx.db
          .prepare(
            'SELECT id FROM messages WHERE chat_jid = ? AND from_me = 0 ORDER BY timestamp DESC, id DESC LIMIT 20',
          )
          .all(jid) as Array<{ id: string }>
      ).map((r) => r.id);
      if (cur.unread_count !== 0) {
        repo.update(jid, { unread_count: 0, updated_at: now() });
        emitChat(jid);
      }
      if (ids.length && ctx.wa.status.state === 'open') {
        try {
          await ctx.wa.markRead(jid, ids.reverse());
        } catch (err) {
          ctx.log.debug({ err, jid }, 'wa markRead failed (ignored)');
        }
      }
    },

    addNote(jid, userId, body) {
      if (!repo.get(jid)) throw errors.notFound('Chat');
      const note = repo.insertNote(jid, userId, body, now());
      ctx.bus.emit('note:new', note);
      return note;
    },

    listNotes(jid) {
      return repo.notes(jid);
    },

    upsertContacts(list) {
      const t = now();
      const tx = ctx.db.transaction((items: WaContactInfo[]) => {
        const renamed = new Set<string>();
        for (const c of items) {
          if (chatTypeOf(c.jid) !== 'dm') continue;
          for (const alias of c.aliases ?? []) link({ jid: c.jid, alias });
          for (const jid of syncNames(aliases.get(c.jid) ?? [c.jid], t, c)) renamed.add(jid);
        }
        return renamed;
      });
      const renamed = tx(list);
      for (const jid of renamed) emitChat(jid);
      log.info(
        { contactCount: list.length, renamedCount: renamed.size },
        'contact names synchronized',
      );
    },

    upsertContactAliases(list) {
      const renamed = ctx.db.transaction(() => {
        const changed = new Set<string>();
        for (const pair of list) {
          const group = link(pair);
          if (group) for (const jid of syncNames(group, now())) changed.add(jid);
        }
        return changed;
      })();
      for (const jid of renamed) emitChat(jid);
      log.info(
        { aliasCount: list.length, renamedCount: renamed.size },
        'contact aliases synchronized',
      );
    },

    contactJids() {
      return repo.contactJids();
    },
  };
  return svc;
}
