import { z } from 'zod';

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ErrorCode = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  RATE_LIMITED: 'rate_limited',
  CONFLICT: 'conflict',
  WA_UNAVAILABLE: 'wa_unavailable',
  BAD_ORIGIN: 'bad_origin',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
