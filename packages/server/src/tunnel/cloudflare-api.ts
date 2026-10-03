import { z } from 'zod';
import type { Logger } from 'pino';
import { HttpError } from '../http/errors.js';

const CloudflareId = z.string().regex(/^[a-f0-9]{32}$/i);
export const CloudflareCredentials = z.object({
  accountID: CloudflareId,
  zoneID: CloudflareId,
  apiToken: z.string().min(10).max(8192),
  endpoint: z.literal('').optional(),
});
export type CloudflareCredentials = z.infer<typeof CloudflareCredentials>;
const Envelope = z.object({
  success: z.boolean(),
  result: z.unknown(),
  errors: z.array(z.object({ code: z.number().optional() }).passthrough()).optional(),
  result_info: z.object({ total_pages: z.number().int().min(0).max(10000).optional() }).optional(),
});

/** Decode cloudflared's certificate without retaining legacy PEM private-key blocks. */
export function decodeCloudflareCertificate(pem: string): CloudflareCredentials {
  const blocks = [
    ...pem.matchAll(
      /-----BEGIN ARGO TUNNEL TOKEN-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END ARGO TUNNEL TOKEN-----/g,
    ),
  ];
  try {
    if (pem.length > 65536 || blocks.length !== 1) throw new Error();
    return CloudflareCredentials.parse(
      JSON.parse(Buffer.from(blocks[0]![1]!.replace(/\s/g, ''), 'base64').toString('utf8')),
    );
  } catch {
    throw new HttpError(
      502,
      'cloudflare_certificate',
      'Cloudflare did not return a valid sign-in certificate. Please sign in again.',
    );
  }
}

export class CloudflareApiError extends HttpError {
  constructor(
    public readonly upstreamStatus: number,
    operation: string,
  ) {
    super(
      502,
      'cloudflare_api',
      upstreamStatus === 401 || upstreamStatus === 403
        ? 'Cloudflare needs permission for this domain. Sign in again with an account that can manage its DNS and tunnels.'
        : upstreamStatus === 429
          ? 'Cloudflare is busy. Please wait a moment and try again.'
          : `Cloudflare could not ${operation}. Please try again.`,
    );
  }
}

/** Fixed API origin and redacted errors: credentials and provider bodies never reach logs or clients. */
export class CloudflareApi {
  constructor(
    private readonly credentials: CloudflareCredentials,
    private readonly log: Logger,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async request<T extends z.ZodType>(
    path: string,
    schema: T,
    operation: string,
    method = 'GET',
    body?: unknown,
  ): Promise<{ result: z.infer<T>; pages: number }> {
    try {
      const response = await this.fetcher(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.credentials.apiToken}`,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new CloudflareApiError(502, operation);
      let envelope: z.infer<typeof Envelope>;
      try {
        envelope = Envelope.parse(JSON.parse(text));
      } catch {
        throw new CloudflareApiError(response.status, operation);
      }
      if (!response.ok || !envelope.success) {
        this.log.warn(
          {
            operation,
            status: response.status,
            codes: envelope.errors?.map((e) => e.code).filter((c) => typeof c === 'number'),
          },
          'Cloudflare API rejected an operation',
        );
        throw new CloudflareApiError(response.status, operation);
      }
      const parsed = schema.safeParse(envelope.result);
      if (!parsed.success) throw new CloudflareApiError(502, operation);
      return { result: parsed.data, pages: envelope.result_info?.total_pages ?? 1 };
    } catch (err) {
      if (err instanceof CloudflareApiError) throw err;
      this.log.warn({ operation }, 'Cloudflare API request failed');
      throw new CloudflareApiError(502, operation);
    }
  }
}
