import { describe, expect, it } from 'vitest';
import {
  CustomerProfileBody,
  customerTagKey,
  normalizeTag,
  ChatListQuery,
  ChatSchema,
  CustomerProfileSchema,
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

  it('rejects mail-header tricks, control characters and invisible direction marks', () => {
    const ok = (body: unknown) => CustomerProfileBody.safeParse(body).success;
    expect(ok({ email: 'orders@shop.my?bcc=evil%40x.com' })).toBe(false);
    expect(ok({ email: 'a&b@shop.my' })).toBe(false);
    expect(ok({ email: 'a#b@shop.my' })).toBe(false);
    expect(ok({ tags: ['VIP\u001fBlocked'] })).toBe(false);
    expect(ok({ address: 'Lebuh\u0000Chulia' })).toBe(false);
    expect(ok({ name: 'Farah\u202Eheknab' })).toBe(false);
    expect(ok({ name: 'Far\u200Bah' })).toBe(false);
    expect(ok({ company: 'Co\u2066' })).toBe(false);
    expect(ok({ name: 'Farah 🌸 陈伟杰', address: 'Line one, George Town' })).toBe(true);
  });

  it('caps the inbox search length and exposes a stable profile id', () => {
    expect(ChatListQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(
      CustomerProfileSchema.parse({
        id: null,
        name: null,
        company: null,
        email: null,
        otherPhone: null,
        address: null,
        tags: [],
        updatedAt: null,
        updatedBy: null,
      }).id,
    ).toBeNull();
  });
});
