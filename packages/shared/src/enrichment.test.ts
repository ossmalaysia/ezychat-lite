import { expect, it } from 'vitest';
import {
  EnrichmentExtraction,
  EnrichmentPoints,
  EnrichmentSettingBody,
  EnrichmentStatus,
} from './enrichment.js';

it('rejects unknown settings and non-boolean on/off values', () => {
  expect(EnrichmentSettingBody.safeParse({ enabled: 'true' }).success).toBe(false);
  expect(EnrichmentSettingBody.safeParse({ enabled: true, apiKey: 'not-allowed' }).success).toBe(
    false,
  );
  expect(EnrichmentStatus.parse({ enabled: false, connected: false })).toEqual({
    enabled: false,
    connected: false,
  });
});
it('bounds evidence points and the number of proposals', () => {
  expect(
    EnrichmentPoints.safeParse({
      ownership: 31,
      clarity: 25,
      context: 20,
      validation: 15,
      freshness: 10,
    }).success,
  ).toBe(false);
  expect(EnrichmentExtraction.safeParse({ fields: Array(5).fill({}) }).success).toBe(false);
});
