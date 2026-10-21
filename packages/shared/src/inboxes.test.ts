import { describe, expect, it } from 'vitest';
import {
  ChatSchema,
  CreateInboxBody,
  DirectoryUserSchema,
  InboxListResponse,
  InboxSchema,
  InboxStatusPayload,
  InboxTone,
  SetUserInboxesBody,
  UpdateInboxBody,
  UserSchema,
} from './index.js';

const status = { state: 'open', me: null, qr: null, lastError: null } as const;

describe('inbox contract', () => {
  it('trims a new inbox name and rejects an empty or too long one', () => {
    expect(CreateInboxBody.parse({ name: '  Catering  ' })).toEqual({
      name: 'Catering',
      memberIds: [],
    });
    expect(CreateInboxBody.safeParse({ name: '' }).success).toBe(false);
    expect(CreateInboxBody.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateInboxBody.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(CreateInboxBody.parse({ name: 'x'.repeat(40), memberIds: [2, 3] }).memberIds).toEqual([
      2, 3,
    ]);
    expect(CreateInboxBody.safeParse({ name: 'A', memberIds: [0] }).success).toBe(false);
  });

  it('needs at least one field to update an inbox', () => {
    expect(UpdateInboxBody.safeParse({}).success).toBe(false);
    expect(UpdateInboxBody.parse({ name: ' Sales ' })).toEqual({ name: 'Sales' });
    expect(UpdateInboxBody.parse({ memberIds: [] })).toEqual({ memberIds: [] });
    expect(UpdateInboxBody.safeParse({ name: '' }).success).toBe(false);
  });

  it('describes an inbox, the list and its status event', () => {
    const inbox = {
      id: 2,
      name: 'Catering',
      tone: 'warning',
      number: null,
      status,
      removed: false,
    } as const;
    expect(InboxSchema.parse(inbox)).toEqual(inbox);
    expect(InboxSchema.safeParse({ ...inbox, id: 0 }).success).toBe(false);
    expect(InboxSchema.safeParse({ ...inbox, tone: 'danger' }).success).toBe(false);
    expect(InboxSchema.parse({ ...inbox, memberIds: [4] }).memberIds).toEqual([4]);
    expect(
      InboxListResponse.parse({ inboxes: [inbox], maxInboxes: 1, canAdd: false }).inboxes,
    ).toHaveLength(1);
    expect(InboxListResponse.safeParse({ inboxes: [], maxInboxes: 0, canAdd: false }).success).toBe(
      false,
    );
    expect(InboxStatusPayload.parse({ inboxId: 2, status })).toEqual({ inboxId: 2, status });
    expect(InboxTone.options).toEqual(['primary', 'warning', 'info', 'success']);
  });

  it('sets the inboxes of a user', () => {
    expect(SetUserInboxesBody.parse({ inboxIds: [1, 2] })).toEqual({ inboxIds: [1, 2] });
    expect(SetUserInboxesBody.safeParse({ inboxIds: [-1] }).success).toBe(false);
    expect(SetUserInboxesBody.safeParse({}).success).toBe(false);
  });

  it('adds the inbox to a chat and the inbox access to users', () => {
    const chat = {
      jid: '6012@s.whatsapp.net#2',
      waJid: '6012@s.whatsapp.net',
      inboxId: 2,
      type: 'dm',
      name: 'A',
      avatarUrl: null,
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      status: 'open',
      assignedTo: null,
      updatedAt: 1,
      phone: null,
    } as const;
    expect(ChatSchema.parse(chat)).toMatchObject({ inboxId: 2, waJid: '6012@s.whatsapp.net' });
    expect(ChatSchema.safeParse({ ...chat, inboxId: undefined }).success).toBe(false);

    const user = {
      id: 3,
      username: 'a',
      displayName: 'A',
      role: 'agent',
      mustChangePassword: false,
      disabled: false,
      createdAt: 1,
      locale: null,
    } as const;
    expect(UserSchema.parse(user).inboxIds).toBeUndefined();
    expect(UserSchema.parse({ ...user, inboxIds: [1] }).inboxIds).toEqual([1]);

    const dir = { id: 3, displayName: 'A', role: 'agent', disabled: false } as const;
    expect(DirectoryUserSchema.parse({ ...dir, inboxIds: 'all' }).inboxIds).toBe('all');
    expect(DirectoryUserSchema.parse({ ...dir, inboxIds: [2] }).inboxIds).toEqual([2]);
    expect(DirectoryUserSchema.safeParse({ ...dir, inboxIds: 'some' }).success).toBe(false);
  });
});
