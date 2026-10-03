import type { CloudflareSetupStatus, TunnelStatus } from '@wa-team-inbox/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudflareSetupService } from '../src/tunnel/cloudflare-setup.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import { makeTestApp, type TestApp } from './helpers.js';

const setupStatus: CloudflareSetupStatus = {
  state: 'awaiting_approval',
  loginUrl: 'https://dash.cloudflare.com/argotunnel?aud=private-state',
  error: null,
  domains: [],
  busy: false,
  managed: null,
};
const tunnelStatus: TunnelStatus = {
  mode: 'named',
  state: 'starting',
  url: 'https://inbox.example.com',
  hostname: 'inbox.example.com',
  lastError: null,
  logTail: [],
};
const createBody = { domainId: 'a'.repeat(32), subdomain: 'inbox', tunnelName: 'Team inbox' };
const paths = [
  '/api/tunnel/cloudflare',
  '/api/tunnel/cloudflare/login',
  '/api/tunnel/cloudflare/login/cancel',
  '/api/tunnel/cloudflare/refresh',
  '/api/tunnel/cloudflare/create',
];
let t: TestApp;
let service: CloudflareSetupService;

beforeEach(async () => {
  t = await makeTestApp();
  await t.ctx.services.cloudflareSetup!.shutdown();
  service = {
    status: vi.fn(() => ({ ...setupStatus })),
    login: vi.fn().mockResolvedValue(setupStatus),
    cancelLogin: vi.fn().mockResolvedValue({ ...setupStatus, state: 'signed_out', loginUrl: null }),
    refresh: vi.fn().mockResolvedValue(setupStatus),
    create: vi.fn().mockResolvedValue(tunnelStatus),
    reconcileOrigin: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  t.ctx.services.cloudflareSetup = service;
});
afterEach(async () => {
  await t.close();
});

describe('Cloudflare admin routes', () => {
  it('keeps all setup actions and the login URL private to admins', async () => {
    const agent = await createUserAndLogin(t);
    for (const url of paths) {
      const method = url === paths[0] ? 'GET' : 'POST';
      const guest = await t.app.inject({
        method,
        url,
        headers: { host: 'localhost', origin: 'http://localhost' },
        ...(method === 'POST' ? { payload: createBody } : {}),
      });
      expect(guest.statusCode).toBe(401);
      const forbidden = await t.app.inject({
        method,
        url,
        headers: authHeaders(agent.cookie),
        ...(method === 'POST' ? { payload: createBody } : {}),
      });
      expect(forbidden.statusCode).toBe(403);
      expect(guest.body + forbidden.body).not.toContain('private-state');
    }
    expect(service.login).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('serves admin sign-in status without caching and records only safe audit metadata', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    for (const url of paths.slice(0, 4)) {
      const method = url === paths[0] ? 'GET' : 'POST';
      const response = await t.app.inject({
        method,
        url,
        headers: authHeaders(admin.cookie),
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const create = await t.app.inject({
      method: 'POST',
      url: paths[4]!,
      headers: authHeaders(admin.cookie),
      payload: createBody,
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toEqual(tunnelStatus);
    expect(service.create).toHaveBeenCalledWith(createBody, admin.user.id);
    const audit = t.ctx.db
      .prepare("SELECT action, meta FROM audit_log WHERE action LIKE 'cloudflare.%'")
      .all();
    expect(JSON.stringify(audit)).not.toContain('private-state');
    expect(audit).toHaveLength(2);
  });

  it('rejects foreign origins and untrusted hosts before any Cloudflare action', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    for (const url of paths.slice(1)) {
      const response = await t.app.inject({
        method: 'POST',
        url,
        headers: { ...authHeaders(admin.cookie), origin: 'https://evil.example' },
        payload: createBody,
      });
      expect(response.statusCode).toBe(403);
    }
    const rebind = await t.app.inject({
      method: 'GET',
      url: paths[0]!,
      headers: { cookie: admin.cookie, host: 'evil.example' },
    });
    expect(rebind.statusCode).toBe(403);
    expect(service.login).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('validates create input before calling Cloudflare', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    for (const payload of [
      {},
      { ...createBody, subdomain: 'https://evil.example' },
      { ...createBody, tunnelName: '../tunnel' },
    ]) {
      const response = await t.app.inject({
        method: 'POST',
        url: paths[4]!,
        headers: authHeaders(admin.cookie),
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.create).not.toHaveBeenCalled();
  });

  it('prevents manual start/stop from racing a guided setup', async () => {
    const admin = await createUserAndLogin(t, { role: 'admin' });
    vi.mocked(service.status).mockReturnValue({ ...setupStatus, busy: true });
    const start = vi.spyOn(t.ctx.services.tunnel!, 'start');
    const stop = vi.spyOn(t.ctx.services.tunnel!, 'stop');
    for (const url of ['/api/tunnel/start', '/api/tunnel/stop']) {
      const response = await t.app.inject({
        method: 'POST',
        url,
        headers: authHeaders(admin.cookie),
        payload: { mode: 'quick' },
      });
      expect(response.statusCode).toBe(409);
    }
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});
