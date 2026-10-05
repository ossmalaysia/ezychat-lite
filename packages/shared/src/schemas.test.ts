import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  ChatEventSchema,
  ChatSchema,
  ChatListQuery,
  CloudflareCreateBody,
  ErrorCode,
  FakeIncomingBody,
  HealthResponse,
  MessageSchema,
  QuickReplyBody,
  QuickReplySchema,
  SettingsPatchBody,
  SetupAdminBody,
  SendVoiceFields,
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MAX_SECONDS,
  VOICE_NOTE_MIME,
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

  it('a chat carries its phone number, or null when WhatsApp hides it', () => {
    const chat = {
      jid: '1@lid',
      type: 'dm',
      name: '',
      avatarUrl: null,
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      status: 'open',
      assignedTo: null,
      updatedAt: 1,
    };
    expect(ChatSchema.safeParse(chat).success).toBe(false);
    expect(ChatSchema.parse({ ...chat, phone: null }).phone).toBeNull();
    expect(ChatSchema.parse({ ...chat, phone: '60111' }).phone).toBe('60111');
    expect(
      FakeIncomingBody.parse({ chatJid: '60111@s.whatsapp.net', text: 'hi', chatJidAlt: '1@lid' })
        .chatJidAlt,
    ).toBe('1@lid');
  });
});

describe('voice notes', () => {
  const base: Message = {
    id: 'V1',
    chatJid: '60123456789@s.whatsapp.net',
    senderJid: null,
    senderName: null,
    fromMe: true,
    sentByUserId: 1,
    type: 'audio',
    body: null,
    mediaUrl: '/api/media/V1',
    mediaMime: VOICE_NOTE_MIME,
    mediaName: null,
    mediaStatus: 'ok',
    quotedId: null,
    status: 'pending',
    error: null,
    timestamp: 1_700_000_000_000,
    clientId: 'c-v',
  };

  it('MessageSchema carries an optional voice flag', () => {
    expect(MessageSchema.parse({ ...base, voice: true }).voice).toBe(true);
    expect(MessageSchema.parse(base).voice).toBeUndefined();
    expect(MessageSchema.safeParse({ ...base, voice: 'yes' }).success).toBe(false);
  });

  it('defines the WhatsApp voice-note format and limits', () => {
    expect(VOICE_NOTE_MIME).toBe('audio/ogg; codecs=opus');
    expect(VOICE_NOTE_MAX_SECONDS).toBe(300);
    expect(VOICE_NOTE_MAX_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(VOICE_NOTE_MAX_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it('SendVoiceFields requires a clientId and accepts an optional quotedId', () => {
    expect(SendVoiceFields.parse({ clientId: 'c-1' })).toEqual({ clientId: 'c-1' });
    expect(SendVoiceFields.parse({ clientId: 'c-1', quotedId: 'Q' }).quotedId).toBe('Q');
    expect(SendVoiceFields.safeParse({}).success).toBe(false);
    expect(SendVoiceFields.safeParse({ clientId: 'x'.repeat(65) }).success).toBe(false);
  });
});
