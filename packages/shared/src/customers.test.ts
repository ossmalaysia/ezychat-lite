import { describe, expect, it } from 'vitest';
import {
  CustomerProfileBody,
  customerTagKey,
  normalizeTag,
  ChatListQuery,
  ChatSchema,
} from './index.js';

describe('customer profile contract', () => {
  it('trims fields and defaults missing ones to empty strings and no tags', () => {
    expect(CustomerProfileBody.parse({ name: '  Farah  ' })).toEqual({
      name: 'Farah',
      company: '',
      email: '',
      otherPhone: '',
      address: '',
      tags: [],
    });
  });

  it('enforces the field limits', () => {
    const ok = (body: unknown) => CustomerProfileBody.safeParse(body).success;
    expect(ok({ name: 'x'.repeat(121) })).toBe(false);
    expect(ok({ company: 'x'.repeat(121) })).toBe(false);
    expect(ok({ email: 'not-an-email' })).toBe(false);
    expect(ok({ email: 'farah@example.com' })).toBe(true);
    expect(ok({ otherPhone: '+60 12-345 (6789)' })).toBe(true);
    expect(ok({ otherPhone: '012345678x' })).toBe(false);
    expect(ok({ address: 'x'.repeat(301) })).toBe(false);
    expect(ok({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toBe(false);
    expect(ok({ tags: ['x'.repeat(31)] })).toBe(false);
    expect(ok({ tags: ['   '] })).toBe(false);
  });

  it('normalizes tags and derives a case-insensitive key', () => {
    expect(normalizeTag('  Halal   catering ')).toBe('Halal catering');
    expect(customerTagKey(' VIP ')).toBe('vip');
    expect(customerTagKey('Vip')).toBe(customerTagKey('vIP'));
  });

  it('accepts an optional tag filter and optional chat profile fields', () => {
    expect(ChatListQuery.parse({ tag: ' VIP ' }).tag).toBe('VIP');
    const chat = ChatSchema.parse({
      jid: '601@s.whatsapp.net',
      type: 'dm',
      name: 'Farah',
      avatarUrl: null,
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      status: 'open',
      assignedTo: null,
      updatedAt: 1,
      phone: '601',
    });
    expect(chat.tags).toBeUndefined();
  });
});
