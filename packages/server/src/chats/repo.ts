import type {
  Chat,
  ChatEvent,
  ChatEventType,
  ChatStatus,
  ChatType,
  Note,
} from '@wa-team-inbox/shared';
import type { DB } from '../db/index.js';

export interface ChatRow {
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
}

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
  return {
    jid: r.jid,
    type: r.type,
    name: r.name || jidUser(r.jid),
    avatarUrl: `/api/chats/${encodeURIComponent(r.jid)}/avatar`,
    unreadCount: r.unread_count,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    status: r.status,
    assignedTo: r.assigned_to,
    updatedAt: r.updated_at,
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

export class ChatRepo {
  constructor(private readonly db: DB) {}

  get(jid: string): ChatRow | null {
    return (
      (this.db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid) as ChatRow | undefined) ?? null
    );
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
        `INSERT INTO chats (jid, type, name, unread_count, status, updated_at)
         VALUES (?, ?, ?, 0, 'open', ?) ON CONFLICT(jid) DO NOTHING`,
      )
      .run(jid, type, name, now);
    return this.get(jid)!;
  }

  setName(jid: string, name: string, now: number): void {
    this.db.prepare('UPDATE chats SET name = ?, updated_at = ? WHERE jid = ?').run(name, now, jid);
  }

  update(jid: string, fields: Partial<Omit<ChatRow, 'jid'>>): void {
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
    const q = f.q?.trim();
    if (q) {
      params.q = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push(
        `(c.name LIKE @q ESCAPE '\\' OR c.jid LIKE @q ESCAPE '\\'
          OR ct.push_name LIKE @q ESCAPE '\\' OR ct.saved_name LIKE @q ESCAPE '\\' OR ct.phone LIKE @q ESCAPE '\\')`,
      );
    }
    if (f.cursor) {
      where.push(
        '(COALESCE(c.last_message_at, 0) < @cts OR (COALESCE(c.last_message_at, 0) = @cts AND c.jid > @cjid))',
      );
      params.cts = f.cursor.ts;
      params.cjid = f.cursor.jid;
    }
    const sql = `SELECT c.* FROM chats c LEFT JOIN contacts ct ON ct.jid = c.jid
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(c.last_message_at, 0) DESC, c.jid ASC LIMIT @limit`;
    return this.db.prepare(sql).all(params) as ChatRow[];
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

  directChats(): ChatRow[] {
    return this.db.prepare("SELECT * FROM chats WHERE type = 'dm'").all() as ChatRow[];
  }
}
