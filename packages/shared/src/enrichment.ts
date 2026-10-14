import { z } from 'zod';

export const ENRICHMENT_FIELDS = ['name', 'company', 'email', 'address'] as const;
export const EnrichmentField = z.enum(ENRICHMENT_FIELDS);
export const ENRICHMENT_WEIGHTS = {
  ownership: 30,
  clarity: 25,
  context: 20,
  validation: 15,
  freshness: 10,
} as const;
export const ENRICHMENT_POLICY = 'evidence-v1';
export const ENRICHMENT_ADD_THRESHOLD = 90;
export const ENRICHMENT_REPLACE_THRESHOLD = 95;
export const EnrichmentPoints = z.object({
  ownership: z.number().int().min(0).max(30),
  clarity: z.number().int().min(0).max(25),
  context: z.number().int().min(0).max(20),
  validation: z.number().int().min(0).max(15),
  freshness: z.number().int().min(0).max(10),
});
export const EnrichmentSettingBody = z.object({ enabled: z.boolean() }).strict();
export type EnrichmentSettingBody = z.infer<typeof EnrichmentSettingBody>;
export const EnrichmentStatus = z.object({ enabled: z.boolean(), connected: z.boolean() });
export type EnrichmentStatus = z.infer<typeof EnrichmentStatus>;
/** Provider proposals are private: raw values/evidence never go into Audit or logs. */
export const EnrichmentExtraction = z.object({
  fields: z
    .array(
      z.object({
        field: EnrichmentField,
        value: z.string().max(300),
        evidence: z.string().min(1).max(2000),
        ownership: z.enum(['self', 'third_party', 'unclear']),
        statement: z.enum(['explicit', 'correction', 'inferred', 'unclear']),
        current: z.boolean(),
        points: EnrichmentPoints,
      }),
    )
    .max(4),
});
export type EnrichmentExtraction = z.infer<typeof EnrichmentExtraction>;
export const EnrichmentReason = z.enum(['self_reported', 'correction']);
export const EnrichmentAudit = z.object({
  average: z.number().min(0).max(100),
  messageId: z.string().min(1).max(256),
  policy: z.string().min(1).max(64),
  fields: z
    .array(
      z.object({
        field: EnrichmentField,
        score: z.number().int().min(0).max(100),
        points: EnrichmentPoints,
        operation: z.enum(['added', 'replaced']),
        threshold: z.number().int().min(0).max(100),
        reason: EnrichmentReason,
        messageId: z.string().min(1).max(256).optional(),
      }),
    )
    .min(1)
    .max(4),
});
export type EnrichmentAudit = z.infer<typeof EnrichmentAudit>;
