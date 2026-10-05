import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
let dir: string;
let t: TestApp | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-identity-'));
});
afterEach(async () => {
  await t?.close();
  t = null;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** Writes app.db as the previous build left it (schema already at the latest version). */
function seed(sql: string): void {
  const db = openDb(join(dir, 'app.db'));
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
/** What Baileys' multi-file auth state stores for a PN↔LID pair (plus the linked account). */
function lidMapping(pnUser: string, lidUser: string): void {
  mkdirSync(join(dir, 'wa-auth'), { recursive: true });
  // the linked number's own id: mappings are read only when creds.json names the account
  writeFileSync(
    join(dir, 'wa-auth', 'creds.json'),
    JSON.stringify({ me: { id: '60999999999:1@s.whatsapp.net' } }),
  );
  writeFileSync(join(dir, 'wa-auth', `lid-mapping-${pnUser}.json`), JSON.stringify(lidUser));
  writeFileSync(
    join(dir, 'wa-auth', `lid-mapping-${lidUser}_reverse.json`),
    JSON.stringify(pnUser),
  );
}
/** A server start on `dir` (initializers run before WhatsApp connects, like startServer). */
async function start(): Promise<TestApp> {
  t = await makeTestApp({ config: { dataDir: dir } });
  return t;
}
async function restart(): Promise<TestApp> {
  await t?.close();
  t = null;
  return start();
}
const jids = (app: TestApp) =>
  (app.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
    (r) => r.jid,
  );
const premerge = (): string[] => {
  try {
    return readdirSync(join(dir, 'backups')).filter((n) => n.startsWith('app-premerge-'));
  } catch {
    return [];
  }
};
const merges = (app: TestApp) =>
  app.ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chat.merge'").get();

const TWO_CHATS = `
  INSERT INTO chats (jid, type, name, unread_count, last_message_at, last_message_preview, status, updated_at) VALUES
    ('${PN}', 'dm', 'Aisyah', 2, 1063, 'pn last', 'resolved', 1),
    ('${LID}', 'dm', 'Aisyah', 1, 2004, 'lid last', 'open', 1);
  INSERT INTO messages (id, chat_jid, from_me, type, body, timestamp, created_at, wa_remote_jid) VALUES
    ('P-1', '${PN}', 0, 'text', 'old', 1063, 1063, '${PN}'),
    ('L-1', '${LID}', 0, 'text', 'new', 2004, 2004, '${LID}');
`;

describe('startup identity migration', () => {
  it('merges a phone-number chat into its WhatsApp ID chat before WhatsApp connects, after one backup', async () => {
    seed(`${TWO_CHATS}
      INSERT INTO ai_chat_state (chat_jid, paused, awaiting_confirmation, last_customer_message_id, due_at)
        VALUES ('${PN}', 0, 0, 'P-1', NULL);`);
    lidMapping('60111111111', '123456789');
    const app = await start();
    expect(jids(app)).toEqual([LID]);
    expect(getChats(app.ctx).get(LID)).toMatchObject({
      unreadCount: 3,
      phone: '60111111111',
      status: 'open',
      lastMessagePreview: 'lid last',
    });
    expect(app.ctx.db.prepare('SELECT chat_jid FROM ai_chat_state').all()).toEqual([
      { chat_jid: LID },
    ]);
    expect(premerge()).toHaveLength(1);
    expect(merges(app)).toEqual({ n: 1 });
    // history chats.upsert for the merged number never recreates its chat
    expect(getChats(app.ctx).upsertFromWa({ jid: PN, type: 'dm', name: 'Aisyah' }).jid).toBe(LID);
    expect(jids(app)).toEqual([LID]);
    expect(getChats(app.ctx).get(PN)?.jid).toBe(LID);
  });

  it('is a no-op on the next start: no backup and no second merge', async () => {
    seed(TWO_CHATS);
    lidMapping('60111111111', '123456789');
    await start();
    rmSync(join(dir, 'backups'), { recursive: true, force: true });
    const app = await restart();
    expect(jids(app)).toEqual([LID]);
    expect(premerge()).toEqual([]);
    expect(merges(app)).toEqual({ n: 1 });
  });

  it('re-keys a phone-number-only chat to its WhatsApp ID; the phone number still finds it', async () => {
    seed(`
      INSERT INTO chats (jid, type, name, unread_count, status, assigned_to, updated_at)
        VALUES ('${PN}', 'dm', 'Aisyah', 1, 'open', NULL, 1);
      INSERT INTO messages (id, chat_jid, from_me, type, body, timestamp, created_at, wa_remote_jid)
        VALUES ('P-1', '${PN}', 0, 'text', 'hi', 10, 10, '${PN}');`);
    lidMapping('60111111111', '123456789');
    const app = await start();
    expect(jids(app)).toEqual([LID]);
    expect(getChats(app.ctx).resolveJid(PN)).toBe(LID);
    expect(getChats(app.ctx).get(LID)).toMatchObject({ name: 'Aisyah', phone: '60111111111' });
  });

  it('starts and merges nothing when wa-auth is missing', async () => {
    seed(TWO_CHATS);
    const app = await start();
    expect(jids(app)).toEqual([LID, PN]);
    expect(premerge()).toEqual([]);
    expect(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });

  it('an unreadable wa-auth still starts, and saved aliases still merge', async () => {
    seed(`${TWO_CHATS}
      INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at) VALUES ('${PN}', '${LID}', 'message', 1);`);
    writeFileSync(join(dir, 'wa-auth'), 'not a directory');
    const app = await start();
    expect(jids(app)).toEqual([LID]);
    expect(premerge()).toHaveLength(1);
  });

  it('leaves chats separate when the pre-merge backup fails; both keep working; a later start merges', async () => {
    seed(TWO_CHATS);
    lidMapping('60111111111', '123456789');
    writeFileSync(join(dir, 'backups'), 'not a directory');
    const app = await start();
    expect(jids(app)).toEqual([LID, PN]);
    expect(merges(app)).toEqual({ n: 0 });
    expect(getChats(app.ctx).resolveJid(PN)).toBe(PN);
    await getMessages(app.ctx).ingest(
      {
        id: 'P-2',
        chatJid: PN,
        senderJid: PN,
        senderName: 'Aisyah',
        fromMe: false,
        type: 'text',
        body: 'still here',
        quotedId: null,
        timestamp: 3000,
        media: null,
      },
      'live',
    );
    expect(app.ctx.db.prepare("SELECT chat_jid FROM messages WHERE id = 'P-2'").get()).toEqual({
      chat_jid: LID,
    });

    rmSync(join(dir, 'backups'), { force: true });
    const next = await restart();
    expect(jids(next)).toEqual([LID]);
    expect(premerge()).toHaveLength(1);
  });
});
