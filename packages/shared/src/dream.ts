import { z } from 'zod';

/**
 * Dream mode (design docs/superpowers/specs/2026-11-14-dream-mode-design.md, approved 2026-11-14). Each night, at the
 * admin's time (business time zone `ai_timezone`), an AI agent reads the take-over chats of its inbox, learns from the
 * team's replies and saves checked setup changes. "Apply by itself" applies Business context changes only.
 */
export const DREAM_TAKEOVERS_MAX = 30;
export const DREAM_MESSAGES_PER_CHAT = 20;
export const DREAM_LESSONS_PER_CHAT = 3;
export const DREAM_CHANGES_PER_RUN = 5;
export const DREAM_REGRESSION_QUESTIONS = 10;
export const DREAM_PREVIEWS_PER_RUN = 40;
/** A run starts at most this long after its time; later the night is recorded as missed. */
export const DREAM_GRACE_MS = 60 * 60_000;
/** A waiting change expires after this long. */
export const DREAM_WAITING_TTL_MS = 14 * 24 * 60 * 60_000;
export const DREAM_RUNS_SHOWN = 30;

/** HH:MM, 00:00 … 23:59. */
export const DreamTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const DreamSettings = z.object({
  enabled: z.boolean(),
  runTime: DreamTime,
  autoApply: z.boolean(),
});
export type DreamSettings = z.infer<typeof DreamSettings>;

export const DREAM_DEFAULT_SETTINGS: DreamSettings = { enabled: false, runTime: '02:00', autoApply: false };

export const DreamSettingsBody = DreamSettings.partial();
export type DreamSettingsBody = z.infer<typeof DreamSettingsBody>;

export const DreamTarget = z.enum(['context_text', 'instructions', 'handoff_rules']);
export type DreamTarget = z.infer<typeof DreamTarget>;

export const DreamChangeStatus = z.enum(['waiting', 'applied', 'dismissed', 'undone', 'stale', 'expired']);
export type DreamChangeStatus = z.infer<typeof DreamChangeStatus>;

export const DreamRunStatus = z.enum(['running', 'done', 'skipped', 'missed', 'failed']);
export type DreamRunStatus = z.infer<typeof DreamRunStatus>;

export const DreamRunReason = z.enum(['ai_unavailable', 'access_closed', 'agent_off']).nullable();
export type DreamRunReason = z.infer<typeof DreamRunReason>;

export const DreamCheck = z.object({
  name: z.enum(['privacy', 'leak', 'grounding', 'replay', 'regression']),
  ok: z.boolean(),
  detail: z.string().optional(),
});
export type DreamCheck = z.infer<typeof DreamCheck>;

export const DreamChange = z.object({
  id: z.number().int(),
  runId: z.number().int(),
  target: DreamTarget,
  itemId: z.number().int().nullable(),
  itemName: z.string().nullable(),
  summary: z.string(),
  status: DreamChangeStatus,
  /** Applied by itself ("Apply by itself"), not by an admin. */
  auto: z.boolean(),
  sourceCount: z.number().int(),
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
});
export type DreamChange = z.infer<typeof DreamChange>;

export const DreamRun = z.object({
  id: z.number().int(),
  slot: z.number(),
  status: DreamRunStatus,
  reason: DreamRunReason,
  chatsRead: z.number().int(),
  takeovers: z.number().int(),
  saved: z.number().int(),
  /** Changes the checks dropped (never stored). */
  dropped: z.number().int(),
  changes: z.array(DreamChange),
});
export type DreamRun = z.infer<typeof DreamRun>;

export const DreamHistory = z.object({
  settings: DreamSettings,
  runs: z.array(DreamRun),
  /** Pass as `before` for the next page; null = no older runs. */
  nextBefore: z.number().int().nullable(),
  /** The AI connection can answer now (else dream mode is paused). */
  aiReady: z.boolean(),
});
export type DreamHistory = z.infer<typeof DreamHistory>;

export const DreamSource = z.object({
  role: z.enum(['customer', 'team']),
  name: z.string().nullable(),
  at: z.number(),
  text: z.string(),
});
export type DreamSource = z.infer<typeof DreamSource>;

export const DreamChangeDetail = DreamChange.extend({
  before: z.string(),
  after: z.string(),
  checks: z.array(DreamCheck),
  /** The team replies (and the customer questions before them) the change came from, read live. */
  sources: z.array(DreamSource),
});
export type DreamChangeDetail = z.infer<typeof DreamChangeDetail>;
