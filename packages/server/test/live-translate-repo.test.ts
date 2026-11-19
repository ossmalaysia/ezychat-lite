// Live translate rows follow their message and chat: the optimistic id becoming WhatsApp's id, an
// alias merge of two chats of one person, and the prompt's fixed parts.
import { afterEach, describe, expect, it } from 'vitest';
import {
  TRANSLATE_RULES,
  detectedLanguage,
  keepWords,
  translateInput,
} from '../src/ai/translate-prompt.js';
import { mergeChat } from '../src/chats/merge.js';
import { LiveTranslateRepo, renameTranslateRows } from '../src/live-translate/repo.js';
import { getChats } from '../src/wa-bridge/index.js';
import { createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const PN = '60123000111@s.whatsapp.net';
const LID = '99887766554433@lid';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

describe('Live translate rows', () => {
  it('rename with their message, and the surviving chat keeps its own languages in a merge', async () => {
    t = await makeTestApp();
    const user = (await createUserAndLogin(t, { role: 'agent' })).user;
    const other = (await createUserAndLogin(t, { role: 'agent' })).user;
    const repo = new LiveTranslateRepo(t.ctx.db);
    repo.putTyped({
      message_id: 'local-1',
      user_id: user.id,
      typed_text: 'Hai',
      typed_lang: 'ms',
      sent_lang: 'zh',
      edited: 0,
      sent_original: 0,
      created_at: 1,
    });
    repo.putTranslation({
      message_id: 'local-1',
      revision: 0,
      target: 'en',
      source: 'zh',
      text: 'Hi',
      status: 'ok',
      model: 'm',
      created_at: 1,
    });
    renameTranslateRows(t.ctx.db, 'local-1', 'WA-1');
    expect([...repo.typed(['WA-1']).keys()]).toEqual(['WA-1']);
    expect(repo.translations([{ id: 'WA-1', revision: 0 }], 'en').get('WA-1')?.text).toBe('Hi');
    expect(repo.typed(['local-1']).size).toBe(0);

    const chats = getChats(t.ctx);
    chats.upsertFromWa({ jid: PN, type: 'dm', name: 'Mei' }, 1);
    chats.upsertFromWa({ jid: LID, type: 'dm', name: 'Mei' }, 2);
    repo.setChatLanguage(PN, { chosen: 'en', detected: 'zh' }, 1);
    repo.setChatLanguage(LID, { detected: 'zh' }, 2);
    repo.setOn(user.id, PN, true, 1);
    repo.setOn(other.id, PN, true, 1);
    repo.setOn(user.id, LID, true, 2);
    mergeChat(t.ctx.db, PN, LID, { now: 5 });
    expect(repo.chatLanguage(PN)).toBeNull();
    expect(repo.chatLanguage(LID)).toMatchObject({ detected: 'zh', chosen: 'en' });
    expect(repo.isOn(other.id, LID)).toBe(true);
    expect(repo.isOn(user.id, LID)).toBe(true);
    expect(repo.isOn(user.id, PN)).toBe(false);
    // a missing chat row moves over whole
    repo.setChatLanguage('a@s.whatsapp.net', { chosen: 'ta' }, 3);
    expect(repo.chatLanguage('a@s.whatsapp.net')?.chosen).toBe('ta');
  });

  it('counts usage per day and prunes older days', async () => {
    t = await makeTestApp();
    const repo = new LiveTranslateRepo(t.ctx.db);
    repo.addUsage(1, '2026-11-18', 3);
    repo.addUsage(1, '2026-11-19', 2);
    repo.addUsage(1, '2026-11-19', 2);
    repo.addUsage(2, '2026-11-19', 0);
    expect(repo.used(1, '2026-11-19')).toBe(4);
    expect(repo.usageOn('2026-11-19')).toEqual({ people: 1, translations: 4 });
    repo.pruneUsage('2026-11-19');
    expect(repo.used(1, '2026-11-18')).toBe(0);
  });
});

describe('translate prompt', () => {
  it('has fixed rules and puts every per-call value in the input JSON', () => {
    expect(TRANSLATE_RULES).not.toMatch(/\$\{/);
    expect(
      JSON.parse(
        translateInput({
          items: [{ id: 'a', text: 'x' }],
          target: 'zh',
          source: 'ms',
          keep: ['Kopi O'],
        }),
      ),
    ).toEqual({
      target: { code: 'zh', name: '中文' },
      source: { code: 'ms', name: 'Bahasa Melayu' },
      keep: ['Kopi O'],
      items: [{ id: 'a', text: 'x' }],
    });
    expect(JSON.parse(translateInput({ items: [], target: 'en' }))).toEqual({
      target: { code: 'en', name: 'English' },
      keep: [],
      items: [],
    });
  });

  it('reads only our language codes and keeps team words found in the texts', () => {
    expect(detectedLanguage(' ZH ')).toBe('zh');
    expect(detectedLanguage('fr')).toBeNull();
    expect(detectedLanguage(null)).toBeNull();
    expect(keepWords(['Kopi O', 'x', 'Teh Tarik'], ['Satu kopi o panas'])).toEqual(['Kopi O']);
  });
});
