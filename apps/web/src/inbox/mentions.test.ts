import { describe, expect, it } from 'vitest';
import type { GroupMember } from '@ezychat/shared';
import {
  MAX_TAGS,
  filterMembers,
  insertTag,
  memberLabel,
  mentionQuery,
  toWhatsApp,
} from './mentions';

const m = (over: Partial<GroupMember> & Pick<GroupMember, 'jid'>): GroupMember => ({
  phone: null,
  lid: null,
  name: null,
  username: null,
  role: 'member',
  isMe: false,
  chatJid: null,
  ...over,
});

describe('mentionQuery', () => {
  it('reads the @query before the caret at the start or after a space only', () => {
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('Hi @fa', 6)).toEqual({ start: 3, query: 'fa' });
    expect(mentionQuery('Hi @fa there', 6)).toEqual({ start: 3, query: 'fa' });
    expect(mentionQuery('a@fa', 4)).toBeNull();
    expect(mentionQuery('Hi @fa there', 12)).toBeNull();
    expect(mentionQuery('@@', 2)).toBeNull();
  });
});

describe('memberLabel and filterMembers', () => {
  const members = [
    m({ jid: '1@s.whatsapp.net', phone: '601111', name: 'Mei Ling Tan' }),
    m({ jid: '2@lid', username: 'kopi.boss' }),
    m({ jid: '3@s.whatsapp.net', phone: '603333' }),
    m({ jid: '4@lid' }),
    m({ jid: '5@s.whatsapp.net', name: 'Me', isMe: true }),
  ];

  it('names a member by name, username, +number, else the address digits', () => {
    expect(members.map(memberLabel)).toEqual(['Mei Ling Tan', 'kopi.boss', '+603333', '4', 'Me']);
  });

  it('matches any word of the name, the username or the number; never the linked number', () => {
    expect(filterMembers(members, 'tan').map((x) => x.jid)).toEqual(['1@s.whatsapp.net']);
    expect(filterMembers(members, 'KOPI').map((x) => x.jid)).toEqual(['2@lid']);
    expect(filterMembers(members, '+6033').map((x) => x.jid)).toEqual(['3@s.whatsapp.net']);
    expect(filterMembers(members, 'me')).toHaveLength(1);
    expect(filterMembers(members, '').map((x) => x.jid)).toEqual([
      '2@lid',
      '1@s.whatsapp.net',
      '3@s.whatsapp.net',
      '4@lid',
    ]);
  });
});

describe('insertTag and toWhatsApp', () => {
  const mei = m({ jid: '601111:3@s.whatsapp.net', phone: '601111', name: 'Mei Ling' });
  const meiTan = m({ jid: '602222@s.whatsapp.net', phone: '602222', name: 'Mei Ling Tan' });

  it('replaces the @query (and the rest of a word under the caret) with @Name and a space', () => {
    expect(insertTag('Hi @me', 3, 6, mei)).toEqual({
      text: 'Hi @Mei Ling ',
      caret: 13,
      tag: { label: 'Mei Ling', jid: mei.jid },
    });
    expect(insertTag('Hi @mexx ok', 3, 6, mei).text).toBe('Hi @Mei Ling ok');
  });

  it('turns whole tags into @<number> + addresses, longest names first, once per member', () => {
    const tags = [
      { label: 'Mei Ling', jid: mei.jid },
      { label: 'Mei Ling Tan', jid: meiTan.jid },
    ];
    expect(toWhatsApp('@Mei Ling Tan and @Mei Ling, @Mei Ling!', tags)).toEqual({
      text: '@602222 and @601111, @601111!',
      mentions: [meiTan.jid, mei.jid],
    });
    // An edited name or a longer word is not the tag.
    expect(toWhatsApp('@Mei Lingo and email@Mei Ling', tags)).toEqual({
      text: '@Mei Lingo and email@Mei Ling',
      mentions: [],
    });
    expect(toWhatsApp('(@Mei Ling)', [{ label: 'Mei Ling', jid: mei.jid }]).text).toBe('(@601111)');
  });

  it(`tags at most ${MAX_TAGS} members`, () => {
    const tags = Array.from({ length: MAX_TAGS + 2 }, (_, i) => ({
      label: `P${String(i).padStart(3, '0')}`,
      jid: `${1000 + i}@s.whatsapp.net`,
    }));
    const out = toWhatsApp(tags.map((t) => `@${t.label}`).join(' '), tags);
    expect(out.mentions).toHaveLength(MAX_TAGS);
  });
});
