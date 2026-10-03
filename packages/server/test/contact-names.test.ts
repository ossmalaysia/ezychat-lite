import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaContactAlias } from '@wa-team-inbox/wa';
import { ChatRepo } from '../src/chats/repo.js';
import { createChatService } from '../src/chats/service.js';
import { getChats } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
let t: TestApp;
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(async () => {
  t = await makeTestApp();
  await settle();
});
afterEach(async () => {
  await t.close();
});

describe('contact names and explicit WhatsApp identities', () => {
  it.each(['before', 'after'])(
    'uses a saved name when the contact arrives %s its chat',
    (order) => {
      const chats = getChats(t.ctx);
      const contact = () =>
        chats.upsertContacts([{ jid: PN, savedName: 'Saved Alice', pushName: 'Push Alice' }]);
      if (order === 'before') contact();
      chats.upsertFromWa({ jid: PN, type: 'dm', name: null });
      if (order === 'after') contact();
      expect(chats.get(PN)?.name).toBe('Saved Alice');
    },
  );

  it('uses a stored saved name when the first message supplies a different push name', async () => {
    const chats = getChats(t.ctx);
    chats.upsertContacts([{ jid: PN, savedName: 'Saved Alice', pushName: 'Old push' }]);
    t.wa.simulateIncoming({ id: 'CONTACT-FIRST', chatJid: PN, body: 'hi', senderName: 'New push' });
    await settle();
    expect(chats.get(PN)?.name).toBe('Saved Alice');
  });

  it('retains saved names through null and whitespace partial updates', () => {
    const chats = getChats(t.ctx);
    chats.upsertContacts([{ jid: PN, savedName: 'Saved Alice', pushName: null }]);
    chats.upsertContacts([{ jid: PN, savedName: null, pushName: 'New push' }]);
    chats.upsertContacts([{ jid: PN, savedName: '  ', pushName: null }]);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: 'Chat push' });
    expect(chats.get(PN)?.name).toBe('Saved Alice');
  });

  it('updates a push name the chat follows, without treating other human names as push names', () => {
    const chats = getChats(t.ctx);
    chats.upsertContacts([{ jid: PN, savedName: null, pushName: 'Old push' }]);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: null });
    chats.upsertContacts([{ jid: PN, savedName: null, pushName: 'New push' }]);
    expect(chats.get(PN)?.name).toBe('New push');
    new ChatRepo(t.ctx.db).setName(PN, 'Independent human name', Date.now());
    chats.upsertContacts([{ jid: PN, savedName: null, pushName: 'Newest push' }]);
    expect(chats.get(PN)?.name).toBe('Independent human name');
  });

  it('prefers meaningful incoming chat names over a stored push name for fallback chats', () => {
    const repo = new ChatRepo(t.ctx.db);
    repo.ensure(PN, { name: null }, Date.now());
    repo.upsertContact({ jid: PN, savedName: null, pushName: 'Stored push' });
    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: 'Business profile' });
    expect(chats.get(PN)?.name).toBe('Business profile');
  });

  it('does not create chats from contacts or aliases, and handles mappings arriving before names', () => {
    const chats = getChats(t.ctx);
    chats.upsertContactAliases([{ jid: LID, alias: PN }]);
    chats.upsertContacts([{ jid: PN, savedName: 'Saved Alice', pushName: null }]);
    expect(chats.get(PN)).toBeNull();
    expect(chats.get(LID)).toBeNull();
    chats.upsertFromWa({ jid: LID, type: 'dm', name: null });
    expect(chats.get(LID)?.name).toBe('Saved Alice');
    expect(chats.list({ assigned: 'any', limit: 10 }, 1).chats).toHaveLength(1);
  });

  it('repairs an existing LID chat when its mapping arrives late and propagates future renames', () => {
    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid: LID, type: 'dm', name: null });
    chats.upsertContacts([{ jid: PN, savedName: 'Saved Alice', pushName: null }]);
    const events = vi.fn();
    t.ctx.bus.on('chat:updated', events);
    t.wa.emit('contactAliases', [{ jid: LID, alias: PN }]);
    expect(chats.get(LID)?.name).toBe('Saved Alice');
    expect(events).toHaveBeenCalledOnce();
    chats.upsertContacts([{ jid: PN, savedName: 'Alice Company', pushName: null }]);
    chats.upsertContacts([{ jid: LID, savedName: null, pushName: 'Untrusted push' }]);
    expect(chats.get(LID)?.name).toBe('Alice Company');
    expect(
      chats.list({ assigned: 'any', limit: 10, q: '60111111111' }, 1).chats.map((c) => c.jid),
    ).toEqual([LID]);
  });

  it('applies aliases included with a contact in either direction', () => {
    const chats = getChats(t.ctx);
    chats.upsertContacts([{ jid: PN, aliases: [LID], savedName: 'Saved Alice', pushName: null }]);
    chats.upsertFromWa({ jid: LID, type: 'dm', name: null });
    chats.upsertContacts([{ jid: LID, aliases: [PN], savedName: 'Alice Updated', pushName: null }]);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: null });
    expect(chats.get(PN)?.name).toBe('Alice Updated');
    expect(chats.get(LID)?.name).toBe('Alice Updated');
  });

  it('rejects conflicting and malformed mappings without combining different people', () => {
    const chats = getChats(t.ctx);
    const otherPN = '60222222222@s.whatsapp.net';
    const otherLID = '987654321@lid';
    chats.upsertContacts([
      { jid: PN, savedName: 'Alice', pushName: null },
      { jid: otherPN, savedName: 'Bob', pushName: null },
    ]);
    chats.upsertContactAliases([
      { jid: PN, alias: LID },
      { jid: otherPN, alias: otherLID },
    ]);
    chats.upsertContactAliases([
      { jid: LID, alias: otherPN },
      { jid: PN, alias: otherLID },
      { jid: PN, alias: 'letters@lid' },
    ]);
    chats.upsertFromWa({ jid: LID, type: 'dm', name: null });
    chats.upsertFromWa({ jid: otherLID, type: 'dm', name: null });
    chats.upsertContacts([{ jid: PN, savedName: 'Alice Updated', pushName: null }]);
    expect(chats.get(LID)?.name).toBe('Alice Updated');
    expect(chats.get(otherLID)?.name).toBe('Bob');
    expect(new ChatRepo(t.ctx.db).getContact('letters@lid')).toBeNull();
  });

  it('keeps human chat names against push-name updates and preserves group names', () => {
    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: 'Established name' });
    chats.upsertContacts([{ jid: PN, savedName: null, pushName: 'Push name' }]);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: 'Other push' });
    const group = '123@g.us';
    chats.upsertFromWa({ jid: group, type: 'group', name: 'Team' });
    chats.upsertContacts([{ jid: group, savedName: 'Member', pushName: 'Wrong' }]);
    chats.upsertContactAliases([{ jid: group, alias: PN }]);
    expect(chats.get(PN)?.name).toBe('Established name');
    expect(chats.get(group)?.name).toBe('Team');
    chats.upsertContacts([{ jid: PN, savedName: 'Authoritative saved', pushName: null }]);
    expect(chats.get(PN)?.name).toBe('Authoritative saved');
  });

  it('backfills fallback names at startup without altering chat state or existing human names', () => {
    const repo = new ChatRepo(t.ctx.db);
    repo.ensure(PN, { name: '60111111111' }, 10);
    repo.update(PN, { status: 'resolved', unread_count: 7 });
    repo.upsertContact({ jid: PN, savedName: 'Saved Alice', pushName: null });
    repo.ensure(LID, { name: 'Established name' }, 10);
    repo.upsertContact({ jid: LID, savedName: null, pushName: 'Another push' });
    const restarted = createChatService(t.ctx);
    expect(restarted.get(PN)).toMatchObject({
      name: 'Saved Alice',
      status: 'resolved',
      unreadCount: 7,
    });
    expect(restarted.get(LID)?.name).toBe('Established name');
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toEqual({ n: 2 });
  });

  it('recovers local mappings on reconnect and ignores results after disconnection', async () => {
    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid: LID, type: 'dm', name: null });
    chats.upsertContacts([{ jid: PN, savedName: 'Saved Alice', pushName: null }]);
    let finish!: (pairs: WaContactAlias[]) => void;
    const lookup = vi.spyOn(t.wa, 'getContactAliases').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    t.wa.setConnected(false);
    t.wa.setConnected(true);
    expect(lookup).toHaveBeenCalledWith(expect.arrayContaining([PN, LID]));
    t.wa.setConnected(false);
    finish([{ jid: LID, alias: PN }]);
    await settle();
    expect(chats.get(LID)?.name).toBe('123456789');
    lookup.mockResolvedValue([{ jid: LID, alias: PN }]);
    t.wa.setConnected(true);
    await settle();
    expect(chats.get(LID)?.name).toBe('Saved Alice');
  });

  it('does not lose connection readiness if local mapping recovery rejects', async () => {
    vi.spyOn(t.wa, 'getContactAliases').mockRejectedValue(new Error('fixture unavailable'));
    t.wa.setConnected(false);
    t.wa.setConnected(true);
    await settle();
    expect(t.ctx.services.waStatus?.state).toBe('open');
  });

  it('contains synchronous local-mapping lookup errors as well', async () => {
    vi.spyOn(t.wa, 'getContactAliases').mockImplementation(() => {
      throw new Error('synchronous fixture failure');
    });
    t.wa.setConnected(false);
    expect(() => t.wa.setConnected(true)).not.toThrow();
    await settle();
    expect(t.ctx.services.waStatus?.state).toBe('open');
  });
});
