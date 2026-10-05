import { describe, expect, it } from 'vitest';
import {
  AiMemberBody,
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
  const member = { displayName: 'Sales Agent', enabled: false, instructions: '', context: '' };
  it('accepts one Business context text up to 40,000 characters', () => {
    expect(AiMemberBody.safeParse({ ...member, context: 'Open 9am-5pm' }).success).toBe(true);
    expect(AiMemberBody.safeParse({ ...member, context: 'x'.repeat(40_000) }).success).toBe(true);
    expect(AiMemberBody.safeParse({ ...member, context: 'x'.repeat(40_001) }).success).toBe(false);
  });
  it('Try it sends name, instructions and context only', () => {
    const parsed = AiTryBody.parse({
      question: 'Delivery?',
      knowledge: { displayName: 'A', instructions: 'Be brief', context: 'RM10', notes: 'old' },
    });
    expect(parsed.knowledge).toEqual({
      displayName: 'A',
      instructions: 'Be brief',
      context: 'RM10',
    });
    expect(
      AiTryBody.safeParse({ question: 'x', knowledge: { displayName: 'A', instructions: '' } })
        .success,
    ).toBe(false);
  });
});
