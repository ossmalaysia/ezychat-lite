import { z } from 'zod';
import { UserSchema } from './models.js';

export const AiSettingsBody = z.object({
  displayName: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  mode: z.enum(['api', 'chatgpt']),
  model: z.string().trim().max(128),
  instructions: z.string().max(8000),
  notes: z.string().max(30000),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(500),
        answer: z.string().trim().min(1).max(4000),
      }),
    )
    .max(100),
  apiKey: z.string().trim().min(10).max(512).optional(),
});
export type AiSettingsBody = z.infer<typeof AiSettingsBody>;
export const AiSettings = AiSettingsBody.omit({ apiKey: true });
export type AiSettings = z.infer<typeof AiSettings>;
/** One connection/model shared by every current and future AI member. */
export const AiConnectionBody = AiSettingsBody.pick({ mode: true, model: true, apiKey: true });
export type AiConnectionBody = z.infer<typeof AiConnectionBody>;
export const AiMemberBody = AiSettings.omit({ mode: true, model: true });
export type AiMemberBody = z.infer<typeof AiMemberBody>;

export const AiDocument = z.object({
  id: z.number().int(),
  name: z.string(),
  size: z.number(),
  characters: z.number(),
  createdAt: z.number(),
});
export type AiDocument = z.infer<typeof AiDocument>;
export const AiConnection = z.object({
  state: z.enum(['unavailable', 'signed_out', 'signing_in', 'connected', 'error']),
  loginUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type AiConnection = z.infer<typeof AiConnection>;
export const AiMemberStatus = z.object({
  member: UserSchema.nullable(),
  settings: AiSettings,
  hasApiKey: z.boolean(),
  connection: AiConnection,
  documents: z.array(AiDocument),
});
export type AiMemberStatus = z.infer<typeof AiMemberStatus>;

/** Structured decisions are checked by the server before sending or changing ownership. */
export const AiDecision = z.object({
  reply: z.string().trim().min(1).max(4096),
  action: z.enum(['answer', 'ask_resolution', 'resolve', 'handoff']),
});
export type AiDecision = z.infer<typeof AiDecision>;
