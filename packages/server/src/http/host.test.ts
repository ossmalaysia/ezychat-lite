import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHostHook, hostAllowed, isLoopbackHost, splitHost, type HostPolicy } from './host.js';

const policy = (p: Partial<HostPolicy> = {}): HostPolicy => ({
  tunnelHosts: () => [],
  allowAnyTunnelHost: () => false,
  ...p,
});

describe('splitHost', () => {
  it('parses host, port and ipv6 brackets', () => {
    expect(splitHost('LocalHost:7420')).toBe('localhost');
    expect(splitHost('[::1]:7420')).toBe('::1');
    expect(splitHost('example.com')).toBe('example.com');
    expect(splitHost('')).toBeNull();
    expect(splitHost(undefined)).toBeNull();
  });
});

describe('hostAllowed', () => {
  it('allows loopback names and IP literals on any port', () => {
    for (const h of [
      '127.0.0.1:7420',
      'localhost:7420',
      '[::1]:7420',
      'localhost',
      '192.168.1.20:7420',
      '[fe80::1]:7420',
    ]) {
      expect(hostAllowed(h, policy())).toBe(true);
    }
  });
  it('allows single-label and .local LAN names', () => {
    expect(hostAllowed('office-pc:7420', policy())).toBe(true);
    expect(hostAllowed('office-pc.local:7420', policy())).toBe(true);
  });
  it('rejects arbitrary domains (DNS rebinding)', () => {
    expect(hostAllowed('evil.com:7420', policy())).toBe(false);
    expect(hostAllowed('127.0.0.1.nip.io:7420', policy())).toBe(false);
    expect(hostAllowed('', policy())).toBe(false);
    expect(hostAllowed(undefined, policy())).toBe(false);
  });
  it('allows the current tunnel hostnames only', () => {
    const p = policy({ tunnelHosts: () => ['abc-def.trycloudflare.com', 'inbox.example.com'] });
    expect(hostAllowed('abc-def.trycloudflare.com', p)).toBe(true);
    expect(hostAllowed('Inbox.Example.com', p)).toBe(true);
    expect(hostAllowed('other.trycloudflare.com', p)).toBe(false);
  });
  it('does not allow arbitrary direct hosts when a named tunnel has no configured hostname', () => {
    expect(hostAllowed('whatever.example.org', policy({ allowAnyTunnelHost: () => true }))).toBe(
      false,
    );
  });
});

describe('isLoopbackHost', () => {
  it('accepts only loopback names', () => {
    expect(isLoopbackHost('127.0.0.1:7420')).toBe(true);
    expect(isLoopbackHost('localhost:5173')).toBe(true);
    expect(isLoopbackHost('[::1]:7420')).toBe(true);
    expect(isLoopbackHost('evil.com:7420')).toBe(false);
    expect(isLoopbackHost('192.168.1.2:7420')).toBe(false);
  });
});

describe('host hook', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.addHook('onRequest', createHostHook(policy()));
    app.post('/api/setup/admin', async () => ({ ok: true }));
    await app.ready();
  });
  afterAll(() => app.close());

  it('blocks a DNS-rebound request even when Origin matches Host', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      headers: { host: 'evil.com:7420', origin: 'http://evil.com:7420' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('bad_origin');
  });
  it('allows localhost', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      headers: { host: '127.0.0.1:7420' },
    });
    expect(r.statusCode).toBe(200);
  });
  it('allows unknown named hosts only through a loopback Cloudflare proxy with a valid client IP', async () => {
    const named = Fastify();
    named.addHook('onRequest', createHostHook(policy({ allowAnyTunnelHost: () => true })));
    named.get('/api/test', async () => ({ ok: true }));
    try {
      for (const [remoteAddress, cfIp, expected] of [
        ['127.0.0.1', undefined, 403],
        ['10.0.0.5', '203.0.113.9', 403],
        ['127.0.0.1', 'not-an-ip', 403],
        ['127.0.0.1', '203.0.113.9, 203.0.113.10', 403],
        ['127.0.0.1', '203.0.113.9', 200],
        ['::1', '2001:db8::1', 200],
      ] as const) {
        const response = await named.inject({
          method: 'GET',
          url: '/api/test',
          remoteAddress,
          headers: { host: 'inbox.example.com', ...(cfIp ? { 'cf-connecting-ip': cfIp } : {}) },
        });
        expect(response.statusCode, `${remoteAddress} / ${cfIp}`).toBe(expected);
      }
    } finally {
      await named.close();
    }
  });
});
