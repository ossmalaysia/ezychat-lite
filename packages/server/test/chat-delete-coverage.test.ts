import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { DELETE_PLAN } from '../src/chats/delete.js';

/** Tables that hold a chat key or a message id but are deliberately left (with the reason). */
const KEPT: Readonly<Record<string, string>> = {};

describe('Delete chat table coverage', () => {
  it('deletes from every table of the migrated schema that holds a chat key or a message id', () => {
    const db = openDb(':memory:');
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    const keyed = tables.filter((table) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
        (c) => c.name === 'chat_jid' || /(^|_)message_id$/.test(c.name),
      ),
    );
    db.close();
    const planned = new Set(DELETE_PLAN.map((p) => p.table));
    // A new migration added a table keyed by chat or message: add it to DELETE_PLAN (chats/delete.ts).
    expect(keyed.filter((t) => !planned.has(t) && !(t in KEPT))).toEqual([]);
    // and the plan names no table that does not exist (a renamed table would hide here)
    expect([...planned].filter((t) => !tables.includes(t))).toEqual([]);
    // the chat row goes last, after everything that points at it
    expect(DELETE_PLAN.at(-1)?.table).toBe('chats');
    expect(DELETE_PLAN.findIndex((p) => p.table === 'messages')).toBeGreaterThan(
      DELETE_PLAN.findIndex((p) => p.table === 'media_thumbs'),
    );
  });
});
