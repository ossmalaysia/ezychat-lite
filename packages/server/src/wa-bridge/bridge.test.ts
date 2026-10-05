import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Message } from '@wa-team-inbox/shared';
import type { WaIncomingMessage } from '@wa-team-inbox/wa';
import { makeTestApp, type TestApp } from '../../test/helpers.js';
import { createUserAndLogin } from '../../test/auth-helpers.js';
import { getAliases } from '../chats/aliases.js';
import { runIdentityMigration } from '../chats/identity-migration.js';
import { getChats, getMessages } from './index.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const JID = '60123456789@s.whatsapp.net';
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

function incoming(p: Partial<WaIncomingMessage> & { id: string }): WaIncomingMessage {
  return {
    chatJid: JID,
    senderJid: JID,
    senderName: 'Alice',
    fromMe: false,
    type: 'text',
    body: 'hello',
    quotedId: null,
    timestamp: Date.now(),
    media: null,
    ...p,
  };
}

function rowCount(id: string): number {
  return (t.ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = ?').get(id) as { n: number }).n;
}

describe('wa bridge / ingest', () => {
  it('ingest is idempotent: same id via live twice + history → one row, unread 1', async () => {
    const msgs = getMessages(t.ctx);
    const m = incoming({ id: 'DUP-1' });
    const first = await msgs.ingest(m, 'live');
    expect(first).not.toBeNull();
    expect(await msgs.ingest(m, 'live')).toBeNull();
    expect(await msgs.ingest(m, 'history')).toBeNull();
    expect(rowCount('DUP-1')).toBe(1);
    expect(getChats(t.ctx).get(JID)!.unreadCount).toBe(1);
  });

  it('adapter events flow through the bridge (simulateIncoming) without duplicates', async () => {
    const seen: Message[] = [];
    t.ctx.bus.on('message:new', (m) => seen.push(m));
    t.wa.simulateIncoming({ id: 'BR-1', chatJid: JID, body: 'hi', senderName: 'Alice' });
    t.wa.emit('message', incoming({ id: 'BR-1' }), { source: 'history' });
    await settle();
    expect(rowCount('BR-1')).toBe(1);
    expect(seen.filter((m) => m.id === 'BR-1').length).toBe(1);
    const chat = getChats(t.ctx).get(JID)!;
    expect(chat.unreadCount).toBe(1);
    expect(chat.name).toBe('Alice');
    expect(chat.lastMessagePreview).toBe('hi');
  });

  it('inbound on a resolved chat reopens it and keeps the assignee', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    const msgs = getMessages(t.ctx);
    const chats = getChats(t.ctx);
    await msgs.ingest(incoming({ id: 'R-1' }), 'live');
    chats.patch(JID, { assignedTo: user.id, status: 'resolved' }, user.id);
    expect(chats.get(JID)!.status).toBe('resolved');
    await msgs.ingest(incoming({ id: 'R-2' }), 'live');
    const chat = chats.get(JID)!;
    expect(chat.status).toBe('open');
    expect(chat.assignedTo).toBe(user.id);
    expect(chats.events(JID).some((e) => e.type === 'reopened')).toBe(true);
  });

  it('fromMe message sent from the phone has sentByUserId null and no unread', async () => {
    const msg = await getMessages(t.ctx).ingest(incoming({ id: 'PH-1', fromMe: true, senderJid: null }), 'live');
    expect(msg!.fromMe).toBe(true);
    expect(msg!.sentByUserId).toBeNull();
    expect(getChats(t.ctx).get(JID)!.unreadCount).toBe(0);
  });

  it('history messages do not increment unread nor reopen', async () => {
    const msgs = getMessages(t.ctx);
    const chats = getChats(t.ctx);
    await msgs.ingest(incoming({ id: 'H-0' }), 'live');
    chats.markRead(JID, 1).catch(() => undefined);
    await settle();
    chats.patch(JID, { status: 'resolved' }, null);
    await msgs.ingest(incoming({ id: 'H-1' }), 'history');
    const chat = chats.get(JID)!;
    expect(chat.unreadCount).toBe(0);
    expect(chat.status).toBe('resolved');
  });

  it('new live inbound emits inbound:notify; history does not', async () => {
    const notified: string[] = [];
    t.ctx.bus.on('inbound:notify', ({ message }) => notified.push(message.id));
    const msgs = getMessages(t.ctx);
    await msgs.ingest(incoming({ id: 'N-1' }), 'live');
    await msgs.ingest(incoming({ id: 'N-2' }), 'history');
    await msgs.ingest(incoming({ id: 'N-1' }), 'live');
    expect(notified).toEqual(['N-1']);
  });

  it('incoming media is downloaded; download failure → mediaStatus failed', async () => {
    const msgs = getMessages(t.ctx);
    const ok = await msgs.ingest(
      incoming({
        id: 'M-1',
        type: 'image',
        body: 'pic',
        media: { mime: 'image/png', fileName: null, download: async () => Buffer.from('png-bytes') },
      }),
      'live',
    );
    expect(ok!.mediaStatus).toBe('ok');
    expect(ok!.mediaUrl).toBe('/api/media/M-1');
    expect(msgs.mediaPath('M-1')!.mime).toBe('image/png');
    const bad = await msgs.ingest(
      incoming({
        id: 'M-2',
        type: 'document',
        body: null,
        media: {
          mime: 'application/pdf',
          fileName: 'x.pdf',
          download: async () => {
            throw new Error('gone');
          },
        },
      }),
      'live',
    );
    expect(bad!.mediaStatus).toBe('failed');
    expect(getChats(t.ctx).get(JID)!.lastMessagePreview).toBe('[Document] x.pdf');
  });

  it('history media is not downloaded during import: saved as pending with mime/name kept', async () => {
    let calls = 0;
    const msg = await getMessages(t.ctx).ingest(
      incoming({
        id: 'HM-1',
        type: 'document',
        body: null,
        media: {
          mime: 'application/pdf',
          fileName: 'old.pdf',
          download: async () => {
            calls++;
            return Buffer.from('pdf');
          },
        },
      }),
      'history',
    );
    expect(calls).toBe(0);
    expect(msg!.mediaStatus).toBe('pending');
    expect(msg!.mediaMime).toBe('application/pdf');
    expect(msg!.mediaName).toBe('old.pdf');
  });

  it('status updates are monotonic and wa status is relayed to the bus', async () => {
    const statuses: string[] = [];
    t.ctx.bus.on('wa:status', (s) => statuses.push(s.state));
    const msgs = getMessages(t.ctx);
    await msgs.ingest(incoming({ id: 'S-1', fromMe: true }), 'live');
    msgs.applyStatus({ id: 'S-1', chatJid: JID, status: 'read' });
    msgs.applyStatus({ id: 'S-1', chatJid: JID, status: 'delivered' });
    const row = t.ctx.db.prepare('SELECT status FROM messages WHERE id = ?').get('S-1') as { status: string };
    expect(row.status).toBe('read');
    t.wa.setConnected(false);
    expect(statuses).toContain('disconnected');
  });
});

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
const chatJids = () =>
  (t.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
    (r) => r.jid,
  );

describe('one chat per person at runtime (routing only, never merging)', () => {
  it('a WhatsApp ID message joins the existing phone-number chat; the next start re-keys it', async () => {
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'first', senderName: 'Aisyah' });
    await settle();
    t.wa.simulateIncoming({
      id: 'L-1',
      chatJid: LID,
      chatJidAlt: PN,
      body: 'second',
      senderName: 'Aisyah',
    });
    await settle();
    expect(chatJids()).toEqual([PN]);
    expect(getChats(t.ctx).get(PN)).toMatchObject({ unreadCount: 2 });
    expect(
      t.ctx.db.prepare('SELECT id, chat_jid, wa_remote_jid FROM messages ORDER BY id').all(),
    ).toEqual([
      { id: 'L-1', chat_jid: PN, wa_remote_jid: LID },
      { id: 'P-1', chat_jid: PN, wa_remote_jid: PN },
    ]);
    // what the next server start does
    expect(runIdentityMigration(t.ctx)).toMatchObject({ merged: 1, rekeyed: 1, result: 'merged' });
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)).toMatchObject({ unreadCount: 2, phone: '60111111111' });
  });

  it('a first message on the WhatsApp ID opens one LID chat; later phone-number messages follow it (and the AI trigger names it)', async () => {
    const received: string[] = [];
    t.ctx.bus.on('message:received', ({ chat, message }) =>
      received.push(`${chat.jid}/${message.chatJid}`),
    );
    const notified: string[] = [];
    t.ctx.bus.on('inbound:notify', ({ chat }) => notified.push(chat.jid));
    t.wa.simulateIncoming({
      id: 'L-1',
      chatJid: LID,
      chatJidAlt: PN,
      body: 'hi',
      senderName: 'Aisyah',
    });
    await settle();
    t.wa.simulateIncoming({ id: 'P-2', chatJid: PN, body: 'again' });
    await settle();
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)).toMatchObject({
      unreadCount: 2,
      phone: '60111111111',
      name: 'Aisyah',
    });
    expect(received).toEqual([`${LID}/${LID}`, `${LID}/${LID}`]);
    expect(notified).toEqual([LID, LID]);
    expect(
      t.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE id = 'P-2'").get(),
    ).toEqual({
      chat_jid: LID,
      wa_remote_jid: PN,
    });
  });

  it('a pair learned while both chats exist routes new messages to the LID chat and merges nothing until the next start', async () => {
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'old', senderName: 'Aisyah' });
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, body: 'new', senderName: 'Aisyah' });
    await settle();
    t.wa.simulateContactAliases([{ jid: PN, alias: LID }]);
    await settle();
    expect(chatJids()).toEqual([LID, PN]);
    t.wa.simulateIncoming({ id: 'P-2', chatJid: PN, body: 'again' });
    await settle();
    expect(
      t.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE id = 'P-2'").get(),
    ).toEqual({
      chat_jid: LID,
      wa_remote_jid: PN,
    });
    expect(getChats(t.ctx).resolveJid(PN)).toBe(PN);
    expect(getAliases(t.ctx).pendingMerges()).toEqual([{ from: PN, to: LID }]);
    expect(runIdentityMigration(t.ctx)).toMatchObject({ merged: 1, rekeyed: 0 });
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)!.unreadCount).toBe(3);
  });

  it('history chats.upsert for a known phone number does not create a phone-number row', async () => {
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, chatJidAlt: PN, body: 'hi' });
    await settle();
    t.wa.emit('chats', [{ jid: PN, type: 'dm', name: 'Aisyah' }]);
    await settle();
    expect(chatJids()).toEqual([LID]);
  });

  it('never learns an alternate address for a group', async () => {
    t.wa.simulateIncoming({
      id: 'G-1',
      chatJid: '1203@g.us',
      chatJidAlt: PN,
      senderJid: PN,
      body: 'group',
    });
    await settle();
    expect(getAliases(t.ctx).resolve(PN)).toBe(PN);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });
});
