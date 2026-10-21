import { z } from 'zod';
import { Role } from './enums.js';
import { WaStatusSchema } from './models.js';

/** Colour of an inbox chip, given by creation order (primary, warning, info, success, then again). */
export const InboxTone = z.enum(['primary', 'warning', 'info', 'success']);
export type InboxTone = z.infer<typeof InboxTone>;

const InboxId = z.number().int().positive();
const UserId = z.number().int().positive();
const InboxName = z.string().trim().min(1).max(40);

/** One linked WhatsApp number (an inbox). Inbox 1 is the number linked before multi-inbox. */
export const InboxSchema = z.object({
  id: InboxId,
  name: z.string().min(1).max(40),
  tone: InboxTone,
  /** Phone-number digits of the linked account; null until a phone is linked. */
  number: z.string().nullable(),
  status: WaStatusSchema,
  /** Removed inboxes keep their chats, read only, for admins. */
  removed: z.boolean(),
  /** Agents who may open the inbox (admins always may); in admin responses only. */
  memberIds: z.array(UserId).optional(),
});
export type Inbox = z.infer<typeof InboxSchema>;

export const InboxListResponse = z.object({
  inboxes: z.array(InboxSchema),
  maxInboxes: z.number().int().positive(),
  canAdd: z.boolean(),
});
export type InboxListResponse = z.infer<typeof InboxListResponse>;

export const CreateInboxBody = z.object({
  name: InboxName,
  memberIds: z.array(UserId).default([]),
});
export type CreateInboxBody = z.infer<typeof CreateInboxBody>;
export type CreateInboxBodyInput = z.input<typeof CreateInboxBody>;

export const UpdateInboxBody = z
  .object({ name: InboxName.optional(), memberIds: z.array(UserId).optional() })
  .refine((b) => b.name !== undefined || b.memberIds !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateInboxBody = z.infer<typeof UpdateInboxBody>;

/** Members → Inbox access: the inboxes an agent may open. */
export const SetUserInboxesBody = z.object({ inboxIds: z.array(InboxId) });
export type SetUserInboxesBody = z.infer<typeof SetUserInboxesBody>;

/** Socket `inbox:status`: the connection status of one inbox. */
export const InboxStatusPayload = z.object({ inboxId: InboxId, status: WaStatusSchema });
export type InboxStatusPayload = z.infer<typeof InboxStatusPayload>;

/** `GET /api/users/directory` row: public team-member fields plus the inboxes they may open. */
export const DirectoryUserSchema = z.object({
  id: z.number(),
  displayName: z.string(),
  role: Role,
  disabled: z.boolean(),
  kind: z.enum(['human', 'ai']).optional(),
  aiRole: z.literal('sales').optional(),
  inboxIds: z.union([z.literal('all'), z.array(InboxId)]),
});
export type DirectoryUser = z.infer<typeof DirectoryUserSchema>;
