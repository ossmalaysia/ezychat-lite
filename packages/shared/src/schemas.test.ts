import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_CHARACTERS,
  AI_CONTEXT_NAME_CHARACTERS,
  AiContextPatchBody,
  AiContextTextBody,
  AiDocument,
  AiDocumentView,
  AiMemberBody,
  codePointLength,
  AiTryBody,
  ApiErrorSchema,
  ChatEventSchema,
  ChatListQuery,
  CloudflareCreateBody,
  ErrorCode,
  HealthResponse,
  MessageSchema,
  QuickReplyBody,
  QuickReplySchema,
  SettingsPatchBody,
  SetupAdminBody,
  type Message,
} from './index.js';

describe('shared schemas', () => {
  it('normalises a Cloudflare address while rejecting unsafe DNS labels and names', () => {
    const body = { domainId: 'a'.repeat(32), subdomain: ' INBOX ', tunnelName: ' Team inbox ' };
    expect(CloudflareCreateBody.parse(body)).toEqual({
      ...body,
      subdomain: 'inbox',
      tunnelName: 'Team inbox',
    });
    for (const subdomain of ['-inbox', 'inbox-', 'a.b', 'http://evil', 'a'.repeat(64), '*']) {
      expect(CloudflareCreateBody.safeParse({ ...body, subdomain }).success).toBe(false);
    }
    expect(CloudflareCreateBody.safeParse({ ...body, tunnelName: '--token secret' }).success).toBe(
      false,
    );
  });
  it('SetupAdminBody rejects a 7-char password', () => {
    const r = SetupAdminBody.safeParse({
      username: 'admin',
      displayName: 'Admin',
      password: '1234567',
    });
    expect(r.success).toBe(false);
  });

  it('SetupAdminBody accepts a valid body', () => {
    const r = SetupAdminBody.safeParse({
      username: 'admin',
      displayName: 'Admin',
      password: '12345678',
    });
    expect(r.success).toBe(true);
  });

  it('QuickReply shortcut rejects "Hello World"', () => {
    expect(QuickReplyBody.safeParse({ shortcut: 'Hello World', body: 'hi' }).success).toBe(false);
    expect(QuickReplySchema.shape.shortcut.safeParse('hello_world-1').success).toBe(true);
  });

  it('ChatListQuery coerces limit and defaults assigned to any', () => {
    const q = ChatListQuery.parse({ limit: '10' });
    expect(q.limit).toBe(10);
    expect(q.assigned).toBe('any');
    expect(ChatListQuery.parse({}).limit).toBe(50);
    expect(ChatListQuery.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('MessageSchema parses a full sample', () => {
    const sample: Message = {
      id: 'ABC123',
      chatJid: '60123456789@s.whatsapp.net',
      senderJid: '60123456789@s.whatsapp.net',
      senderName: 'Ali',
      fromMe: false,
      sentByUserId: null,
      type: 'image',
      body: 'caption',
      mediaUrl: '/api/media/ABC123',
      mediaMime: 'image/jpeg',
      mediaName: null,
      mediaStatus: 'ok',
      quotedId: null,
      status: 'delivered',
      error: null,
      timestamp: 1_700_000_000_000,
      clientId: null,
    };
    expect(MessageSchema.parse(sample)).toEqual(sample);
    expect(MessageSchema.safeParse({ ...sample, type: 'gif' }).success).toBe(false);
  });

  it('ChatEventSchema accepts record payloads', () => {
    const e = ChatEventSchema.parse({
      id: 1,
      chatJid: 'x@g.us',
      type: 'assigned',
      actorId: 2,
      payload: { to: 3 },
      at: 1,
    });
    expect(e.payload).toEqual({ to: 3 });
  });

  it('SettingsPatchBody is partial and excludes hasTunnelToken', () => {
    expect(SettingsPatchBody.parse({ lanEnabled: true })).toEqual({ lanEnabled: true });
    expect(SettingsPatchBody.safeParse({ port: 80 }).success).toBe(false);
    expect('hasTunnelToken' in SettingsPatchBody.shape).toBe(false);
  });

  it('HealthResponse and ApiErrorSchema', () => {
    expect(
      HealthResponse.safeParse({ app: 'wa-team-inbox', version: '0.1.0', mode: 'dev' }).success,
    ).toBe(true);
    expect(
      ApiErrorSchema.safeParse({ error: { code: ErrorCode.NOT_FOUND, message: 'x' } }).success,
    ).toBe(true);
  });
});

describe('AI member knowledge', () => {
  const member = { displayName: 'Sales Agent', enabled: false, instructions: '' };
  it('keeps no Business context text on the member (context is a list of items)', () => {
    const parsed = AiMemberBody.parse({ ...member, context: 'Open 9am-5pm' });
    expect(parsed).toEqual(member);
    expect(parsed).not.toHaveProperty('context');
  });
  it('accepts a text context item: name 1-120, text 1-100,000 code points', () => {
    const item = { name: 'Price list', text: 'Cake RM50' };
    expect(AiContextTextBody.parse({ ...item, name: '  Price list  ' }).name).toBe('Price list');
    expect(AiContextTextBody.safeParse({ ...item, name: '   ' }).success).toBe(false);
    expect(AiContextTextBody.safeParse({ ...item, name: 'n'.repeat(120) }).success).toBe(true);
    expect(AiContextTextBody.safeParse({ ...item, name: 'n'.repeat(121) }).success).toBe(false);
    expect(AiContextTextBody.safeParse({ ...item, text: '' }).success).toBe(false);
    expect(AiContextTextBody.safeParse({ ...item, text: ' \n ' }).success).toBe(false);
    expect(AiContextTextBody.safeParse({ ...item, text: 'x'.repeat(100_000) }).success).toBe(true);
    expect(AiContextTextBody.safeParse({ ...item, text: 'x'.repeat(100_001) }).success).toBe(false);
    // An emoji is one character for the limit, although it is two UTF-16 units.
    expect(AiContextTextBody.safeParse({ ...item, text: '😀'.repeat(100_000) }).success).toBe(true);
    expect(AI_CONTEXT_CHARACTERS).toBe(100_000);
    expect(AI_CONTEXT_NAME_CHARACTERS).toBe(120);
    expect(codePointLength('a😀b')).toBe(3);
  });
  it('edits a text item by name and/or text, but needs at least one', () => {
    expect(AiContextPatchBody.safeParse({ name: 'Hours' }).success).toBe(true);
    expect(AiContextPatchBody.safeParse({ text: 'Open 9am' }).success).toBe(true);
    expect(AiContextPatchBody.safeParse({ name: 'Hours', text: 'Open 9am' }).success).toBe(true);
    expect(AiContextPatchBody.safeParse({}).success).toBe(false);
    expect(AiContextPatchBody.safeParse({ text: '' }).success).toBe(false);
    expect(AiContextPatchBody.safeParse({ text: 'x'.repeat(100_001) }).success).toBe(false);
  });
  it('lists items with kind, size and dates; the view adds the text', () => {
    const doc = {
      id: 1,
      name: 'Business context',
      kind: 'text',
      size: 9,
      characters: 9,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(AiDocument.parse(doc)).toEqual(doc);
    expect(AiDocument.safeParse({ ...doc, kind: 'note' }).success).toBe(false);
    expect(AiDocumentView.parse({ ...doc, text: 'Cake RM50', truncated: false })).toMatchObject({
      kind: 'text',
      text: 'Cake RM50',
      truncated: false,
    });
  });
  it('Try it sends name and instructions only; the server adds the saved items', () => {
    const parsed = AiTryBody.parse({
      question: 'Delivery?',
      knowledge: { displayName: 'A', instructions: 'Be brief', context: 'RM10', notes: 'old' },
    });
    expect(parsed.knowledge).toEqual({ displayName: 'A', instructions: 'Be brief' });
    expect(AiTryBody.safeParse({ question: 'x', knowledge: { displayName: 'A' } }).success).toBe(
      false,
    );
  });
});
