import { z } from 'zod';

/**
 * WhatsApp Safety (design: docs/features/whatsapp-safety/design.md): local rules and an optional AI
 * check flag risky files and scam messages; High-risk files are locked for agents; admins review
 * them on Admin → Safety and in Reports.
 */

/** What the local rules can find. `critical` ones make a message High whatever else is found. */
export const SAFETY_RULES = {
  exeInZip: { points: 0, critical: true },
  executable: { points: 0, critical: true },
  doubleExtension: { points: 0, critical: true },
  scamNumber: { points: 0, critical: true },
  cantInspect: { points: 40, critical: false },
  macroFile: { points: 40, critical: false },
  passwordInMessage: { points: 25, critical: false },
  openOnComputer: { points: 25, critical: false },
  lookalikeLink: { points: 25, critical: false },
  financeUrgency: { points: 20, critical: false },
  firstFile: { points: 15, critical: false },
} as const;

export const SafetyRule = z.enum([
  'exeInZip',
  'executable',
  'doubleExtension',
  'scamNumber',
  'cantInspect',
  'macroFile',
  'passwordInMessage',
  'openOnComputer',
  'lookalikeLink',
  'financeUrgency',
  'firstFile',
]);
export type SafetyRule = z.infer<typeof SafetyRule>;

export const SafetyLevel = z.enum(['none', 'warning', 'high']);
export type SafetyLevel = z.infer<typeof SafetyLevel>;

/** Score at or above which the rules alone say High / Warning. */
export const SAFETY_HIGH_SCORE = 60;
export const SAFETY_WARNING_SCORE = 30;

export const SafetyAiCategory = z.enum([
  'malware_lure',
  'phishing',
  'impersonation',
  'payment_fraud',
  'none',
]);
export type SafetyAiCategory = z.infer<typeof SafetyAiCategory>;

/** The AI check's structured answer; `reason` is one plain sentence in the team's language. */
export const SafetyAiAnswer = z.object({
  level: SafetyLevel,
  category: SafetyAiCategory,
  reason: z.string().trim().max(200),
});
export type SafetyAiAnswer = z.infer<typeof SafetyAiAnswer>;

export const SafetyStatus = z.enum(['open', 'safe', 'reported', 'blocked', 'cleared']);
export type SafetyStatus = z.infer<typeof SafetyStatus>;

/** What a chat bubble needs: attached to `Message.safety` by the message service. */
export const MessageSafety = z.object({
  itemId: z.number().int().positive(),
  level: SafetyLevel,
  rules: z.array(SafetyRule),
  aiReason: z.string().nullable(),
  /** Agents cannot download the file (High, not released, not marked safe). */
  locked: z.boolean(),
  deletedBy: z.string().nullable(),
  status: SafetyStatus,
});
export type MessageSafety = z.infer<typeof MessageSafety>;

export const SafetySettings = z.object({
  enabled: z.boolean(),
  ai: z.boolean(),
  autoBlock: z.boolean(),
  deleteAfterDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
export type SafetySettings = z.infer<typeof SafetySettings>;

/** `PUT /api/safety/settings` */
export const SafetySettingsBody = SafetySettings.partial();
