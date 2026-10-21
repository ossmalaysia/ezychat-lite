import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrationsDir } from '../src/db/migrate.js';
import { createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

/**
 * The desktop updater jumps straight to the newest release, never through the versions between
 * (docs/LEARNINGS.md). This opens a data folder as the first release left it (schema 1) with the
 * current server: every migration must run in one go and the old data must come back through the API.
 */
const CUSTOMER = '60123456789@s.whatsapp.net';
const CREDS = '{"me":{"id":"60111111111:1@s.whatsapp.net"}}';

function oldestDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wati-oldest-'));
  const db = new Database(join(dir, 'app.db'));
  db.exec(readFileSync(join(migrationsDir(), '001_init.sql'), 'utf8'));
  db.pragma('user_version = 1');
  const now = 1_700_000_000_000;
  db.prepare(
    "INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (1, 'aisyah', 'Aisyah', 'x', 'admin', ?)",
  ).run(now);
  db.prepare(
    "INSERT INTO chats (jid, type, name, last_message_at, last_message_preview, status, assigned_to, updated_at) VALUES (?, 'dm', 'Ahmad', ?, 'Kopi for two?', 'open', 1, ?)",
  ).run(CUSTOMER, now, now);
  db.prepare(
    "INSERT INTO messages (id, chat_jid, sender_jid, from_me, type, body, status, timestamp, created_at) VALUES ('OLD-1', ?, ?, 0, 'text', 'Kopi for two?', 'read', ?, ?)",
  ).run(CUSTOMER, CUSTOMER, now, now);
  db.prepare(
    "INSERT INTO notes (chat_jid, user_id, body, created_at) VALUES (?, 1, 'Regular customer', ?)",
  ).run(CUSTOMER, now);
  db.prepare(
    "INSERT INTO quick_replies (shortcut, body, created_by, updated_at) VALUES ('hi', 'Hello!', 1, ?)",
  ).run(now);
  db.close();
  mkdirSync(join(dir, 'wa-auth'));
  writeFileSync(join(dir, 'wa-auth', 'creds.json'), CREDS);
  return dir;
}

describe('upgrade from the oldest data folder', { timeout: 30_000 }, () => {
  let t: TestApp | null = null;
  let dir: string | null = null;
  afterEach(async () => {
    await t?.close();
    t = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    dir = null;
  });

  it('runs every migration in one start and keeps chats, messages, notes and quick replies', async () => {
    dir = oldestDataDir();
    t = await makeTestApp({ config: { dataDir: dir } });
    const latest = Math.max(
      ...readdirSync(migrationsDir())
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .map((f) => parseInt(f, 10)),
    );
    expect(t.ctx.db.pragma('user_version', { simple: true })).toBe(latest);

    const { cookie } = await createUserAndLogin(t, { role: 'admin' });
    const chats = (
      await t.app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } })
    ).json().chats as Array<{ jid: string; name: string; assignedTo: number | null }>;
    expect(chats.find((c) => c.jid === CUSTOMER)).toMatchObject({ name: 'Ahmad', assignedTo: 1 });

    const chatUrl = `/api/chats/${encodeURIComponent(CUSTOMER)}`;
    const messages = (
      await t.app.inject({ method: 'GET', url: `${chatUrl}/messages`, headers: { cookie } })
    ).json().messages as Array<{ id: string; body: string }>;
    expect(messages.map((m) => m.body)).toContain('Kopi for two?');
    const notes = (
      await t.app.inject({ method: 'GET', url: `${chatUrl}/notes`, headers: { cookie } })
    ).json() as unknown;
    expect(JSON.stringify(notes)).toContain('Regular customer');
    const replies = (
      await t.app.inject({ method: 'GET', url: '/api/quick-replies', headers: { cookie } })
    ).json() as unknown;
    expect(JSON.stringify(replies)).toContain('Hello!');

    // The linked WhatsApp session is left exactly as it was: no relink after an update.
    expect(readFileSync(join(dir, 'wa-auth', 'creds.json'), 'utf8')).toBe(CREDS);
  });
});
