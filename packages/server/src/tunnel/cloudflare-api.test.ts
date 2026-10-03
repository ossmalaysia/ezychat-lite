import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { silentLogger } from '../logger.js';
import { CloudflareApi, decodeCloudflareCertificate } from './cloudflare-api.js';

const credentials = {
  accountID: 'a'.repeat(32),
  zoneID: 'b'.repeat(32),
  apiToken: 'private-cloudflare-api-token',
};
const certificate = (value: unknown) =>
  `-----BEGIN ARGO TUNNEL TOKEN-----\n${Buffer.from(JSON.stringify(value)).toString('base64')}\n-----END ARGO TUNNEL TOKEN-----`;

describe('Cloudflare certificate', () => {
  it('extracts only the API credentials from certificates containing legacy keys', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\nlegacy-key\n-----END PRIVATE KEY-----\n${certificate(credentials)}`;
    expect(decodeCloudflareCertificate(pem)).toEqual(credentials);
  });

  it.each([
    ['missing token', 'invalid'],
    ['multiple tokens', `${certificate(credentials)}\n${certificate(credentials)}`],
    [
      'missing account',
      certificate({ zoneID: credentials.zoneID, apiToken: credentials.apiToken }),
    ],
    ['custom API endpoint', certificate({ ...credentials, endpoint: 'https://evil.example' })],
    ['oversized certificate', 'x'.repeat(65537)],
  ])('rejects %s without revealing certificate content', (_name, pem) => {
    expect(() => decodeCloudflareCertificate(pem)).toThrow(/valid sign-in certificate/);
    try {
      decodeCloudflareCertificate(pem);
    } catch (error) {
      expect(String(error)).not.toContain(credentials.apiToken);
      expect(String(error)).not.toContain('evil.example');
    }
  });
});

describe('Cloudflare API', () => {
  it('uses the official API, bearer authentication, a timeout and no redirects', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          success: true,
          result: { id: 'safe-id' },
          result_info: { total_pages: 3 },
        }),
      );
    const api = new CloudflareApi(credentials, silentLogger(), fetcher);
    await expect(
      api.request('/zones', z.object({ id: z.string() }), 'list domains'),
    ).resolves.toEqual({
      result: { id: 'safe-id' },
      pages: 3,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('redacts provider messages and credentials from errors and structured logs', async () => {
    const log = silentLogger();
    const warn = vi.spyOn(log, 'warn');
    const providerSecret = 'provider-internal-secret';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          success: false,
          result: null,
          errors: [{ code: 9109, message: `${providerSecret} ${credentials.apiToken}` }],
        },
        { status: 403 },
      ),
    );
    const api = new CloudflareApi(credentials, log, fetcher);
    let caught: unknown;
    try {
      await api.request('/zones', z.unknown(), 'list domains');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 502, code: 'cloudflare_api', upstreamStatus: 403 });
    expect(String(caught)).toContain('permission');
    const output = JSON.stringify(warn.mock.calls) + String(caught);
    expect(output).not.toContain(providerSecret);
    expect(output).not.toContain(credentials.apiToken);
    expect(warn).toHaveBeenCalledWith(
      { operation: 'list domains', status: 403, codes: [9109] },
      expect.any(String),
    );
  });

  it.each([
    ['malformed envelope', new Response('private malformed body')],
    ['invalid result', Response.json({ success: true, result: { token: 'private-result' } })],
  ])('rejects %s with a safe error', async (_name, response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const api = new CloudflareApi(credentials, silentLogger(), fetcher);
    await expect(
      api.request('/zones', z.object({ id: z.string() }), 'list domains'),
    ).rejects.toThrow('Cloudflare could not list domains. Please try again.');
  });

  it('redacts network exception text', async () => {
    const log = silentLogger();
    const warn = vi.spyOn(log, 'warn');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(credentials.apiToken));
    const api = new CloudflareApi(credentials, log, fetcher);
    await expect(api.request('/zones', z.unknown(), 'list domains')).rejects.toThrow(
      'Cloudflare could not list domains. Please try again.',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(credentials.apiToken);
  });
});
