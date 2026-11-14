import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDeletePreview, type Message } from '@ezychat/shared';
import type { WaIncomingMessage } from '@ezychat/wa';
import { makeTestApp, type TestApp } from './helpers.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { getAliases } from '../src/chats/aliases.js';
import { chatDeletedAt, DELETE_PLAN } from '../src/chats/delete.js';
import { avatarFileName } from '../src/avatars/store.js';
import { chatMediaDir } from '../src/messages/media-store.js';

const enc = encodeURIComponent;
const A = '60111000001@s.whatsapp.net';
const B = '60111000002@s.whatsapp.net';
const G = '120363000000000001@g.us';

let t: TestApp;
let admin: { cookie: string; id: number };

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A live inbound message through the fake phone; returns the stored message. */
async function incoming(
  chatJid: string,
  body: string,
  extra: Partial<Parameters<TestApp['wa']['simulateIncoming']>[0]> = {},
): Promise<Message> {
  const got = new Promise<Message>((resolve) => {
    const on = (m: Message) => {
      if (m.body === body && !m.fromMe) {
        t.ctx.bus.off('message:new', on);
        resolve(m);
      }
    };
    t.ctx.bus.on('message:new', on);
  });
  t.wa.simulateIncoming({ chatJid, body, senderName: 'Customer', ...extra });
  return got;
}

const history = (
  chatJid: string,
  id: string,
  timestamp: number,
  body = 'old',
): WaIncomingMessage => ({
  id,
  chatJid,
  senderJid: chatJid,
  senderName: 'Customer',
  fromMe: false,
  type: 'text',
  body,
  quotedId: null,
  timestamp,
  media: null,
});

const count = (table: string, where: string, ...args: unknown[]) =>
  (
    t.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args) as {
      n: number;
    }
  ).n;
const mediaPathOf = (id: string) =>
  (
    t.ctx.db.prepare('SELECT media_path FROM messages WHERE id = ?').get(id) as {
      media_path: string | null;
    }
  ).media_path;
const mediaAbs = (rel: string) => join(t.ctx.config.dataDir, 'media', rel);
const audits = () =>
  (
    t.ctx.db
      .prepare("SELECT user_id, meta FROM audit_log WHERE action = 'chat.deleted' ORDER BY id")
      .all() as Array<{ user_id: number; meta: string }>
  ).map((r) => ({ userId: r.user_id, meta: JSON.parse(r.meta) as Record<string, unknown> }));

const del = (cookie: string, jid: string, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'DELETE',
    url: `/api/chats/${enc(jid)}`,
    headers: { ...authHeaders(cookie), ...headers },
  });

/** One row in `table` for `jid` with every NOT NULL column filled (checks and keys off). */
function seedRow(table: string, jid: string, ids: { message: string; task: number; item: number }) {
  const cols = t.ctx.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dflt_value: unknown;
  }>;
  const row: Record<string, unknown> = {};
  const rowid = cols.filter((c) => c.pk > 0).length === 1;
  for (const c of cols) {
    if (rowid && c.pk === 1 && c.type.toUpperCase() === 'INTEGER') continue;
    if (c.name === 'chat_jid' || (table === 'avatars' && c.name === 'key')) row[c.name] = jid;
    else if (c.name === 'message_id') row[c.name] = ids.message;
    else if (c.name === 'task_id') row[c.name] = ids.task;
    else if (c.name === 'item_id') row[c.name] = ids.item;
    else if (c.notnull || c.pk) {
      const type = c.type.toUpperCase();
      row[c.name] = type.includes('INT')
        ? 1
        : type.includes('BLOB')
          ? Buffer.from('x')
          : `x-${jid}`;
    }
  }
  const names = Object.keys(row);
  return t.ctx.db
    .prepare(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`,
    )
    .run(row).lastInsertRowid as number;
}

/** A row in every table of the delete plan for `jid` (its message `messageId` must exist). */
function seedEverything(jid: string, messageId: string) {
  const db = t.ctx.db;
  db.pragma('foreign_keys = OFF');
  db.pragma('ignore_check_constraints = ON');
  try {
    const task = seedRow('ai_scheduled_tasks', jid, { message: messageId, task: 0, item: 0 });
    const item = seedRow('safety_items', jid, { message: messageId, task: 0, item: 0 });
    for (const { table } of DELETE_PLAN) {
      if (['messages', 'chats', 'ai_scheduled_tasks', 'safety_items'].includes(table)) continue;
      if (table === 'ai_chat_state' && count(table, 'chat_jid = ?', jid)) continue;
      seedRow(table, jid, { message: messageId, task, item });
    }
  } finally {
    db.pragma('ignore_check_constraints = OFF');
    db.pragma('foreign_keys = ON');
  }
}

beforeEach(async () => {
  t = await makeTestApp();
  const a = await createUserAndLogin(t, { role: 'admin' });
  admin = { cookie: a.cookie, id: a.user.id };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

describe('DELETE /api/chats/:jid', () => {
  it('deletes every row and file of the chat, keeps other chats and shared tables, and audits counts only', async () => {
    const photo = Buffer.from('a photo of the menu');
    const text = await incoming(A, 'my secret order text');
    const pic = await incoming(A, 'menu photo', {
      type: 'image',
      media: { mime: 'image/jpeg', fileName: null, download: async () => photo },
    });
    await waitFor(() => mediaPathOf(pic.id) !== null);
    const other = await incoming(B, 'hello from B');
    // a copy of the photo in B (its own hard link)
    const fw = await t.app.inject({
      method: 'POST',
      url: `/api/messages/${enc(pic.id)}/forward`,
      headers: authHeaders(admin.cookie),
      payload: { to: [B], clientRequestId: 'fw-1' },
    });
    expect(fw.statusCode).toBe(200);
    const copyPath = (
      t.ctx.db
        .prepare('SELECT media_path FROM messages WHERE chat_jid = ? AND media_path IS NOT NULL')
        .get(B) as { media_path: string }
    ).media_path;
    seedEverything(A, text.id);
    seedEverything(B, other.id);
    // a leftover file in A's folder no message points at, and A's photo
    const leftover = `${chatMediaDir(A)}/leftover.bin`;
    writeFileSync(mediaAbs(leftover), 'x');
    const avatarDir = join(t.ctx.config.dataDir, 'avatars');
    mkdirSync(avatarDir, { recursive: true });
    writeFileSync(join(avatarDir, avatarFileName(A)), 'jpeg');
    const contactsBefore = count('contacts', '1 = 1');

    const preview = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(A)}/delete-preview`,
      headers: authHeaders(admin.cookie),
    });
    expect(ChatDeletePreview.parse(preview.json())).toEqual({ messages: 2, files: 1 });

    const deleted: string[] = [];
    t.ctx.bus.on('chat:deleted', (p) => deleted.push(p.jid));
    const r = await del(admin.cookie, A);
    expect(r.statusCode).toBe(204);
    expect(deleted).toEqual([A]);

    for (const { table } of DELETE_PLAN) {
      const where =
        table === 'chats'
          ? 'jid = ?'
          : table === 'avatars'
            ? 'key = ?'
            : ['message_reactions', 'message_edits', 'media_refs', 'media_thumbs'].includes(table)
              ? 'message_id IN (?, ?)'
              : table === 'ai_scheduled_runs' || table === 'safety_downloads'
                ? '1 = 1'
                : 'chat_jid = ?';
      const args = where.includes('IN') ? [text.id, pic.id] : where === '1 = 1' ? [] : [A];
      // runs and downloads: only B's are left
      expect(count(table, where, ...args), table).toBe(where === '1 = 1' ? 1 : 0);
    }
    // B keeps everything, its copy of the photo included
    for (const { table } of DELETE_PLAN)
      if (!['ai_scheduled_runs', 'safety_downloads', 'avatars', 'chats'].includes(table))
        if (!['message_reactions', 'message_edits', 'media_refs', 'media_thumbs'].includes(table))
          expect(count(table, 'chat_jid = ?', B), table).toBeGreaterThan(0);
    expect(count('chats', 'jid = ?', B)).toBe(1);
    expect(existsSync(mediaAbs(copyPath))).toBe(true);
    // A's files, folder and photo are gone
    expect(existsSync(mediaAbs(chatMediaDir(A)))).toBe(false);
    expect(existsSync(join(avatarDir, avatarFileName(A)))).toBe(false);
    // shared tables are never touched
    expect(count('contacts', '1 = 1')).toBe(contactsBefore);
    expect(chatDeletedAt(t.ctx.db, 1, [A])).toBeGreaterThan(0);
    expect(audits()).toEqual([{ userId: admin.id, meta: { chatJid: A, messages: 2, files: 1 } }]);
    expect(JSON.stringify(audits())).not.toContain('secret');
    // the chat is gone for every route
    const get = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(A)}`,
      headers: authHeaders(admin.cookie),
    });
    expect(get.statusCode).toBe(404);
  });

  it('removes a quarantined file and keeps a file another chat still points at', async () => {
    const first = await incoming(A, 'one');
    await incoming(B, 'two');
    const dir = chatMediaDir(A);
    mkdirSync(mediaAbs(dir), { recursive: true });
    mkdirSync(mediaAbs(`quarantine/${dir}`), { recursive: true });
    // A's file was quarantined; a merge left B's file in A's folder
    writeFileSync(mediaAbs(`quarantine/${dir}/bad.zip.bin`), 'zip');
    writeFileSync(mediaAbs(`${dir}/b-file.jpg`), 'b');
    t.ctx.db
      .prepare('UPDATE messages SET media_path = ? WHERE id = ?')
      .run(`${dir}/bad.zip`, first.id);
    t.ctx.db
      .prepare('UPDATE messages SET media_path = ? WHERE chat_jid = ?')
      .run(`${dir}/b-file.jpg`, B);

    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    expect(existsSync(mediaAbs(`quarantine/${dir}/bad.zip.bin`))).toBe(false);
    expect(readdirSync(mediaAbs(dir))).toEqual(['b-file.jpg']);
  });

  it('deletes a group; its next message starts a new empty chat', async () => {
    await incoming(G, 'group hello', { senderJid: A });
    expect((await del(admin.cookie, G)).statusCode).toBe(204);
    expect(count('chats', 'jid = ?', G)).toBe(0);
    await incoming(G, 'group again', { senderJid: A });
    expect(count('messages', 'chat_jid = ?', G)).toBe(1);
  });

  it('answers 403 to a non-admin, 404 for an unknown chat, 403 for another origin, 429 past 30 a minute', async () => {
    await incoming(A, 'hi');
    const agent = await createUserAndLogin(t);
    expect((await del(agent.cookie, A)).statusCode).toBe(403);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/chats/${enc(A)}/delete-preview`,
          headers: authHeaders(agent.cookie),
        })
      ).statusCode,
    ).toBe(403);
    expect((await del(admin.cookie, A, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect(count('chats', 'jid = ?', A)).toBe(1);
    expect((await del(admin.cookie, '69999@s.whatsapp.net')).statusCode).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/chats/${enc('69999@s.whatsapp.net')}/delete-preview`,
          headers: authHeaders(admin.cookie),
        })
      ).statusCode,
    ).toBe(404);

    const chats = getChats(t.ctx);
    for (let i = 0; i < 31; i++)
      chats.upsertFromWa({ jid: `6012300${i}@s.whatsapp.net`, type: 'dm', name: null });
    for (let i = 0; i < 30; i++)
      expect((await del(admin.cookie, `6012300${i}@s.whatsapp.net`)).statusCode).toBe(204);
    const limited = await del(admin.cookie, '601230030@s.whatsapp.net');
    expect(limited.statusCode).toBe(429);
    expect(count('chats', 'jid = ?', '601230030@s.whatsapp.net')).toBe(1);
  });

  it('drops queued sends and stops the AI for the chat before deleting', async () => {
    await incoming(A, 'hi');
    t.wa.setConnected(false);
    getMessages(t.ctx).sendText(A, { text: 'queued reply', clientId: 'q-1' }, admin.id);
    expect(getMessages(t.ctx).queue.size).toBe(1);
    const cancel = vi.spyOn(t.ctx.services.ai!, 'cancelChat');
    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    expect(cancel).toHaveBeenCalledWith(A);
    expect(getMessages(t.ctx).queue.size).toBe(0);
    t.wa.setConnected(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.wa.sent.filter((s) => JSON.stringify(s).includes('queued reply'))).toEqual([]);
  });
});

describe('deleted chat tombstone', () => {
  it('history never brings the chat back; a live message starts a clean chat; newer history is kept', async () => {
    const old = Date.now() - 60_000;
    await incoming(A, 'before delete');
    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    const messages = getMessages(t.ctx);
    const chats = getChats(t.ctx);

    // history sync: neither the message nor the chat comes back
    expect(await messages.ingest(history(A, 'H1', old), 'history')).toBeNull();
    expect(chats.syncFromWa({ jid: A, type: 'dm', name: 'Customer' })).toBeNull();
    expect(count('chats', 'jid = ?', A)).toBe(0);

    // the customer writes again: a new, empty chat with only that message
    await incoming(A, 'after delete');
    expect(count('messages', 'chat_jid = ?', A)).toBe(1);
    expect(chats.syncFromWa({ jid: A, type: 'dm', name: 'Customer' })?.jid).toBe(A);
    // older history still stays out; history newer than the delete is imported
    expect(await messages.ingest(history(A, 'H2', old), 'history')).toBeNull();
    expect(await messages.ingest(history(A, 'H3', Date.now() + 1000), 'history')).not.toBeNull();
    expect(count('messages', 'chat_jid = ?', A)).toBe(2);
    // the tombstone stays
    expect(chatDeletedAt(t.ctx.db, 1, [A])).not.toBeNull();
  });

  it('matches the other address of the same person (phone number and LID)', async () => {
    const LID = '99887766@lid';
    await incoming(LID, 'from lid', { chatJidAlt: A });
    expect((await del(admin.cookie, LID)).statusCode).toBe(204);
    const old = Date.now() - 60_000;
    expect(
      await getMessages(t.ctx).ingest({ ...history(A, 'H1', old), chatJidAlt: LID }, 'history'),
    ).toBeNull();
    expect(count('chats', '1 = 1')).toBe(0);
    // a deliberate start (New chat, Group info) still creates the chat
    getChats(t.ctx).upsertFromWa({ jid: A, type: 'dm', name: null });
    expect(count('chats', '1 = 1')).toBe(1);
    expect(chatDeletedAt(t.ctx.db, 1, [])).toBeNull();
    expect(chatDeletedAt(t.ctx.db, 2, [LID])).toBeNull();
  });

  it('a second delete of the same chat moves the tombstone', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await incoming(A, 'one');
    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    expect(chatDeletedAt(t.ctx.db, 1, [A])).toBe(1_000);
    now = 5_000;
    await incoming(A, 'two');
    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    expect(chatDeletedAt(t.ctx.db, 1, [A])).toBe(5_000);
  });

  it('the chat list never brings back a deleted phone-number chat reported under its LID', async () => {
    const LID = '99887766@lid';
    await incoming(A, 'from the phone number');
    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    // WhatsApp tells the pair only later, then lists the chat under the LID
    getAliases(t.ctx).learn({ jid: A, alias: LID }, 'contacts');
    expect(getChats(t.ctx).syncFromWa({ jid: LID, type: 'dm', name: 'Customer' })).toBeNull();
    expect(count('chats', '1 = 1')).toBe(0);
  });

  it('history reactions, edits and deletes of a deleted chat write nothing; live ones still apply', async () => {
    const old = Date.now() - 60_000;
    await incoming(A, 'before delete');
    expect((await del(admin.cookie, A)).statusCode).toBe(204);
    const messages = getMessages(t.ctx);
    messages.applyReaction(
      {
        targetId: 'OLD-1',
        chatJid: A,
        senderJid: A,
        senderName: null,
        fromMe: false,
        emoji: '👍',
        timestamp: old,
      },
      'history',
    );
    const change = { targetId: 'OLD-2', chatJid: A, senderJid: A, fromMe: false, timestamp: old };
    messages.applyRemoteEdit({ ...change, body: 'edited' }, 'history');
    messages.applyRemoteDelete({ ...change, targetId: 'OLD-3' }, 'history');
    expect(count('message_reactions', '1 = 1')).toBe(0);
    expect(count('message_changes_pending', '1 = 1')).toBe(0);
    // a live reaction is the customer's own new action: kept (it waits for its message)
    messages.applyReaction(
      {
        targetId: 'NEW-1',
        chatJid: A,
        senderJid: A,
        senderName: null,
        fromMe: false,
        emoji: '👍',
        timestamp: Date.now(),
      },
      'live',
    );
    expect(count('message_reactions', '1 = 1')).toBe(1);
  });

  it('the preview counts every message the delete removes, hidden ones too', async () => {
    const one = await incoming(A, 'one');
    await incoming(A, 'two');
    t.ctx.db.prepare('UPDATE messages SET hidden_at = 1 WHERE id = ?').run(one.id);
    const preview = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(A)}/delete-preview`,
      headers: authHeaders(admin.cookie),
    });
    expect(ChatDeletePreview.parse(preview.json())).toEqual({ messages: 2, files: 0 });
  });
});
