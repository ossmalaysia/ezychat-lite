import { z } from 'zod';

/** A member of a WhatsApp group as the team sees it. Only what WhatsApp shared; nothing inferred. */
export const GroupMemberSchema = z.object({
  /** The member's address as the group lists it (phone-number JID or WhatsApp ID). */
  jid: z.string(),
  /** Phone number digits (e.g. "60123456789"), or null when WhatsApp hides it. */
  phone: z.string().nullable(),
  /** WhatsApp ID (`…@lid`), when known. */
  lid: z.string().nullable(),
  /** Saved or WhatsApp profile name we already know; null when the member never shared one with us. */
  name: z.string().nullable(),
  /** WhatsApp username, only when WhatsApp sends it. */
  username: z.string().nullable(),
  role: z.enum(['superadmin', 'admin', 'member']),
  /** This WhatsApp number (the linked account). */
  isMe: z.boolean(),
  /** The team's existing direct chat with this person, when there is one. */
  chatJid: z.string().nullable(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const GroupInfoResponse = z.object({
  group: z.object({
    jid: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    /** epoch ms */
    createdAt: z.number().nullable(),
    createdBy: z
      .object({ jid: z.string(), name: z.string().nullable(), phone: z.string().nullable() })
      .nullable(),
    /** Member count reported by WhatsApp. */
    size: z.number().int().nonnegative(),
    adminCount: z.number().int().nonnegative(),
  }),
  /** Me first, then admins, then named members A–Z, then the rest. */
  members: z.array(GroupMemberSchema),
  /** epoch ms when the list was read from WhatsApp */
  fetchedAt: z.number(),
});
export type GroupInfoResponse = z.infer<typeof GroupInfoResponse>;

export const GroupMemberAboutResponse = z.object({ about: z.string().nullable() });
export type GroupMemberAboutResponse = z.infer<typeof GroupMemberAboutResponse>;

/** POST /chats/:jid/members/:member/chat: the direct chat to open (created when needed). */
export const StartMemberChatResponse = z.object({ chatJid: z.string() });
export type StartMemberChatResponse = z.infer<typeof StartMemberChatResponse>;

/** Fake WhatsApp only: create a group with generated members for tests and the Dev Build. */
export const FakeGroupBody = z.object({
  groupJid: z.string().regex(/@g\.us$/),
  name: z.string().min(1).max(200),
  /** How many generated members besides the linked number (and any `members` given). */
  generated: z.number().int().min(0).max(2000).default(0),
  members: z
    .array(
      z.object({
        phone: z
          .string()
          .regex(/^\d{6,15}$/)
          .optional(),
        lid: z
          .string()
          .regex(/^\d{6,20}$/)
          .optional(),
        name: z.string().max(200).optional(),
        username: z.string().max(100).optional(),
        about: z.string().max(500).optional(),
        role: z.enum(['superadmin', 'admin', 'member']).default('member'),
      }),
    )
    .max(200)
    .default([]),
});
export type FakeGroupBody = z.infer<typeof FakeGroupBody>;
