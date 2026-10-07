import type {
  Chat,
  ChatEvent,
  ChatEventType,
  ChatStatus,
  ChatType,
  Note,
} from '@wa-team-inbox/shared';
import { customerTagKey } from '@wa-team-inbox/shared';
import {
  PROFILE_JOIN,
  PROFILE_NAME_COLUMN,
  PROFILE_SEARCH,
  TAG_FILTER,
  tagsByChat,
} from '../customers/sql.js';
import type { DB } from '../db/index.js';

/** Columns of the `chats` table itself (e.g. `SELECT * FROM chats`). */
export interface ChatColumns {
  jid: string;
  type: ChatType;
  name: string;
  avatar_path: string | null;
  unread_count: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  status: ChatStatus;
  assigned_to: number | null;
  updated_at: number;
  phone: string | null;
}

/**
 * A chat as the read model needs it: its columns plus the customer profile name and tags. Only
 * `ChatRepo.get()`/`list()` build these (profile join + one batched tag query), so a raw
 * `SELECT * FROM chats` row cannot reach rowToChat by mistake.
 */
export interface ChatRow extends ChatColumns {
  /** customer_profiles.name (null when none). */
  profile_name: string | null;
  /** Customer tags in saved order. */
  profile_tags: string[];
}

/** Chat columns plus the customer profile name; FROM `chats c`. Tags are attached by withTags(). */
const CHAT_SELECT = `SELECT c.*, ${PROFILE_NAME_COLUMN} FROM chats c ${PROFILE_JOIN}`;

export interface ChatEventRow {
  id: number;
  chat_jid: string;
  type: ChatEventType;
  actor_id: number | null;
  payload: string;
  at: number;
}

export interface NoteRow {
  id: number;
  chat_jid: string;
  user_id: number;
  body: string;
  created_at: number;
}

export interface ContactRow {
  jid: string;
  push_name: string | null;
  saved_name: string | null;
  phone: string | null;
}

export function rowToChat(r: ChatRow): Chat {
  // A LID is an opaque WhatsApp ID, never a phone number: do not show its digits as a name.
  const lidDigits = r.jid.endsWith('@lid') && r.name === jidUser(r.jid);
  const waName =
    (r.name && !lidDigits ? r.name : null) ||
    r.phone ||
    (r.jid.endsWith('@lid') ? '' : jidUser(r.jid));
  const dm = r.type === 'dm';
  // A customer profile name wins; a cleared (NULL/blank) one falls back to the WhatsApp name.
  const profileName = dm ? r.profile_name?.trim() || null : null;
  return {
    jid: r.jid,
    type: r.type,
    name: profileName ?? waName,
    avatarUrl: `/api/chats/${encodeURIComponent(r.jid)}/avatar`,
    unreadCount: r.unread_count,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    status: r.status,
    assignedTo: r.assigned_to,
    updatedAt: r.updated_at,
    phone: r.phone ?? null,
    tags: dm ? r.profile_tags : [],
    whatsappName: dm ? waName || null : null,
  };
}

export function rowToEvent(r: ChatEventRow): ChatEvent {
  let payload: Record<string, unknown> = {};
  try {
    const p = JSON.parse(r.payload) as unknown;
    if (p && typeof p === 'object' && !Array.isArray(p)) payload = p as Record<string, unknown>;
  } catch {
    // ignore malformed payload
  }
  return { id: r.id, chatJid: r.chat_jid, type: r.type, actorId: r.actor_id, payload, at: r.at };
}

export function rowToNote(r: NoteRow): Note {
  return {
    id: r.id,
    chatJid: r.chat_jid,
    userId: r.user_id,
    body: r.body,
    createdAt: r.created_at,
  };
}

/** User part of a jid ("60123@s.whatsapp.net" → "60123"); used as a fallback display name. */
export function jidUser(jid: string): string {
  const at = jid.indexOf('@');
  const user = at >= 0 ? jid.slice(0, at) : jid;
  const colon = user.indexOf(':');
  return colon >= 0 ? user.slice(0, colon) : user;
}

export function chatTypeOf(jid: string): ChatType {
  return jid.endsWith('@g.us') ? 'group' : 'dm';
}

type JoinedRow = Omit<ChatRow, 'profile_tags'>;

export class ChatRepo {
  constructor(private readonly db: DB) {}

  /** Attaches each chat's customer tags with one batched query. */
  private withTags(rows: JoinedRow[]): ChatRow[] {
    const tags = tagsByChat(
      this.db,
      rows.filter((r) => r.type === 'dm').map((r) => r.jid),
    );
    return rows.map((r) => ({ ...r, profile_tags: tags.get(r.jid) ?? [] }));
  }

  get(jid: string): ChatRow | null {
    const r = this.db.prepare(`${CHAT_SELECT} WHERE c.jid = ?`).get(jid) as JoinedRow | undefined;
    return r ? this.withTags([r])[0]! : null;
  }

  /** PN digits for a DM: from a PN JID itself, or from the newest phone number aliased to a LID. */
  phoneFor(jid: string): string | null {
    if (jid.endsWith('@s.whatsapp.net')) return jidUser(jid);
    if (!jid.endsWith('@lid')) return null;
    const row = this.db
      .prepare(
        'SELECT alias_jid FROM jid_aliases WHERE canonical_jid = ? ORDER BY learned_at DESC LIMIT 1',
      )
      .get(jid) as { alias_jid: string } | undefined;
    return row ? jidUser(row.alias_jid) : null;
  }

  openCount(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS count FROM chats WHERE status = 'open'").get() as {
        count: number;
      }
    ).count;
  }

  openChats(): ChatColumns[] {
    return this.db
      .prepare("SELECT * FROM chats WHERE status = 'open' ORDER BY jid")
      .all() as ChatColumns[];
  }

  /** Inserts a chat if missing; returns the row. */
  ensure(jid: string, init: { type?: ChatType; name?: string | null }, now: number): ChatRow {
    const type = init.type ?? chatTypeOf(jid);
    const contact = type === 'dm' ? this.getContact(jid) : null;
    const supplied = init.name?.trim() || '';
    const meaningful = supplied && supplied !== jid && supplied !== jidUser(jid);
    const name = contact?.saved_name || (meaningful ? supplied : contact?.push_name || supplied);
    this.db
      .prepare(
        `INSERT INTO chats (jid, type, name, unread_count, status, updated_at, phone)
         VALUES (?, ?, ?, 0, 'open', ?, ?) ON CONFLICT(jid) DO NOTHING`,
      )
      .run(jid, type, name, now, type === 'dm' ? this.phoneFor(jid) : null);
    return this.get(jid)!;
  }

  setName(jid: string, name: string, now: number): void {
    this.db.prepare('UPDATE chats SET name = ?, updated_at = ? WHERE jid = ?').run(name, now, jid);
  }

  update(jid: string, fields: Partial<Omit<ChatColumns, 'jid'>>): void {
    const keys = Object.keys(fields) as Array<keyof typeof fields>;
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE chats SET ${sets} WHERE jid = @jid`).run({ ...fields, jid });
  }

  list(f: {
    status?: ChatStatus;
    assigned: 'me' | 'none' | 'any';
    userId: number;
    q?: string;
    /** Customer tag, matched by key (case-insensitive). */
    tag?: string;
    since?: number;
    cursor?: { ts: number; jid: string } | null;
    limit: number;
  }): ChatRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: f.limit };
    if (f.status) {
      where.push('c.status = @status');
      params.status = f.status;
    }
    if (f.assigned === 'me') {
      where.push('c.assigned_to = @userId');
      params.userId = f.userId;
    } else if (f.assigned === 'none') {
      where.push('c.assigned_to IS NULL');
    }
    if (f.since !== undefined) {
      where.push('c.updated_at > @since');
      params.since = f.since;
    }
    if (f.tag) {
      where.push(TAG_FILTER);
      params.tagKey = customerTagKey(f.tag);
    }
    const q = f.q?.trim();
    if (q) {
      params.q = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push(
        `(c.name LIKE @q ESCAPE '\\' OR c.jid LIKE @q ESCAPE '\\' OR c.phone LIKE @q ESCAPE '\\'
          OR ct.push_name LIKE @q ESCAPE '\\' OR ct.saved_name LIKE @q ESCAPE '\\' OR ct.phone LIKE @q ESCAPE '\\'
          OR ${PROFILE_SEARCH})`,
      );
    }
    if (f.cursor) {
      where.push(
        '(COALESCE(c.last_message_at, 0) < @cts OR (COALESCE(c.last_message_at, 0) = @cts AND c.jid > @cjid))',
      );
      params.cts = f.cursor.ts;
      params.cjid = f.cursor.jid;
    }
    const sql = `${CHAT_SELECT} LEFT JOIN contacts ct ON ct.jid = c.jid
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(c.last_message_at, 0) DESC, c.jid ASC LIMIT @limit`;
    return this.withTags(this.db.prepare(sql).all(params) as JoinedRow[]);
  }

  insertEvent(e: {
    chatJid: string;
    type: ChatEventType;
    actorId: number | null;
    payload: Record<string, unknown>;
    at: number;
  }): ChatEvent {
    const info = this.db
      .prepare(
        'INSERT INTO chat_events (chat_jid, type, actor_id, payload, at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(e.chatJid, e.type, e.actorId, JSON.stringify(e.payload), e.at);
    return {
      id: Number(info.lastInsertRowid),
      chatJid: e.chatJid,
      type: e.type,
      actorId: e.actorId,
      payload: e.payload,
      at: e.at,
    };
  }

  events(jid: string): ChatEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_events WHERE chat_jid = ? ORDER BY at ASC, id ASC')
      .all(jid) as ChatEventRow[];
    return rows.map(rowToEvent);
  }

  insertNote(chatJid: string, userId: number, body: string, at: number): Note {
    const info = this.db
      .prepare('INSERT INTO notes (chat_jid, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(chatJid, userId, body, at);
    return { id: Number(info.lastInsertRowid), chatJid, userId, body, createdAt: at };
  }

  notes(jid: string): Note[] {
    const rows = this.db
      .prepare('SELECT * FROM notes WHERE chat_jid = ? ORDER BY created_at ASC, id ASC')
      .all(jid) as NoteRow[];
    return rows.map(rowToNote);
  }

  upsertContact(c: { jid: string; pushName: string | null; savedName: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO contacts (jid, push_name, saved_name, phone) VALUES (@jid, @pushName, @savedName, @phone)
         ON CONFLICT(jid) DO UPDATE SET
           push_name = COALESCE(excluded.push_name, contacts.push_name),
           saved_name = COALESCE(excluded.saved_name, contacts.saved_name),
           phone = COALESCE(excluded.phone, contacts.phone)`,
      )
      .run({
        jid: c.jid,
        pushName: c.pushName?.trim() || null,
        savedName: c.savedName?.trim() || null,
        phone: c.jid.endsWith('@s.whatsapp.net') ? jidUser(c.jid) : null,
      });
  }

  getContact(jid: string): ContactRow | null {
    return (
      (this.db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid) as
        ContactRow | undefined) ?? null
    );
  }

  contactJids(): string[] {
    return (
      this.db
        .prepare("SELECT jid FROM contacts UNION SELECT jid FROM chats WHERE type = 'dm'")
        .all() as Array<{ jid: string }>
    ).map((r) => r.jid);
  }

  directChats(): ChatColumns[] {
    return this.db.prepare("SELECT * FROM chats WHERE type = 'dm'").all() as ChatColumns[];
  }
}
