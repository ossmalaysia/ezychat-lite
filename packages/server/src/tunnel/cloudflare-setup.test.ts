import type { spawn, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { pino } from 'pino';
import { FakeWaAdapter } from '@wa-team-inbox/wa';
import type { TunnelStatus } from '@wa-team-inbox/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../bus.js';
import type { AppContext } from '../context.js';
import { SecretBox } from '../crypto/secret.js';
import { openDb } from '../db/index.js';
import { SettingsStore } from '../db/settings.js';
import { silentLogger } from '../logger.js';
import {
  CLOUDFLARE_AUTH_KEY,
  CLOUDFLARE_DOMAINS_KEY,
  CLOUDFLARE_MANAGED_KEY,
  CLOUDFLARE_OWNED_KEY,
  CloudflareSetup,
} from './cloudflare-setup.js';
import type { TunnelService } from './manager.js';

const accountID = 'a'.repeat(32);
const zoneID = 'b'.repeat(32);
const tunnelID = '11111111-1111-4111-8111-111111111111';
const otherID = '22222222-2222-4222-8222-222222222222';
const credentials = { accountID, zoneID, apiToken: 'private-account-api-token' };
const runtimeToken = 'private-runtime-tunnel-token';
const zone = {
  id: zoneID,
  name: 'example.com',
  status: 'active',
  account: { id: accountID, name: 'Test account' },
};
const domain = { id: zoneID, name: 'example.com', accountName: 'Test account' };
const tunnel = { id: tunnelID, name: 'Team inbox', config_src: 'cloudflare', deleted_at: null };
const record = {
  id: 'dns-id',
  name: 'inbox.example.com',
  type: 'CNAME',
  content: `${tunnelID}.cfargotunnel.com`,
  proxied: true,
};
const body = { domainId: zoneID, subdomain: 'inbox', tunnelName: 'Team inbox' };
const status: TunnelStatus = {
  mode: 'named',
  state: 'starting',
  url: 'https://inbox.example.com',
  hostname: 'inbox.example.com',
  logTail: [],
  lastError: null,
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  kill() {
    this.killed = true;
    queueMicrotask(() => this.exit(null, 'SIGTERM'));
    return true;
  }
  exit(code: number | null, signal: string | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('close', code, signal);
  }
  line(value: string) {
    this.stderr.write(value + '\n');
  }
}

type ApiCall = { path: string; method: string; body?: unknown };
let ctx: AppContext;
let children: FakeChild[];
let spawnCalls: { bin: string; args: string[]; options: SpawnOptions }[];
let apiCalls: ApiCall[];
let dnsRecords: (typeof record)[];
let existingTunnels: (typeof tunnel)[];
let failConfiguration: boolean;
let handler: ((call: ApiCall) => Response | undefined | Promise<Response | undefined>) | undefined;
let services: CloudflareSetup[];
let manager: TunnelService;
let fetcher: typeof fetch;

beforeEach(() => {
  const dataDir = mkdtempSync(join(tmpdir(), 'wati-cloudflare-'));
  const db = openDb(join(dataDir, 'app.db'));
  const secret = SecretBox.loadOrCreate(join(dataDir, 'secret.key'));
  ctx = {
    config: {
      dataDir,
      port: 7462,
      host: '127.0.0.1',
      mode: 'dev',
      fakeWa: true,
      webDistDir: null,
      version: 'test',
    },
    db,
    secret,
    settings: new SettingsStore(db, secret),
    log: silentLogger(),
    bus: new Bus(),
    wa: new FakeWaAdapter(),
    services: {},
  };
  children = [];
  spawnCalls = [];
  apiCalls = [];
  services = [];
  dnsRecords = [];
  existingTunnels = [];
  failConfiguration = false;
  handler = undefined;
  manager = {
    status: () => status,
    start: vi.fn().mockResolvedValue(status),
    stop: vi.fn().mockResolvedValue(status),
    restore: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const call: ApiCall = {
      path: parsed.pathname.replace('/client/v4', '') + parsed.search,
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    apiCalls.push(call);
    const override = await handler?.(call);
    if (override) return override;
    let result: unknown;
    if (call.path === `/zones/${zoneID}`) result = zone;
    else if (call.path.startsWith('/zones?')) result = [zone];
    else if (call.path.includes('/dns_records?')) result = [...dnsRecords];
    else if (call.path === `/zones/${zoneID}/dns_records` && call.method === 'POST') {
      dnsRecords = [record];
      result = record;
    } else if (call.path.startsWith(`/accounts/${accountID}/cfd_tunnel?`))
      result = [...existingTunnels];
    else if (call.path === `/accounts/${accountID}/cfd_tunnel` && call.method === 'POST') {
      existingTunnels = [tunnel];
      result = tunnel;
    } else if (call.path === `/accounts/${accountID}/cfd_tunnel/${tunnelID}`)
      result = existingTunnels.find((t) => t.id === tunnelID) ?? tunnel;
    else if (call.path.endsWith('/token')) result = runtimeToken;
    else if (call.path.endsWith('/configurations')) {
      if (failConfiguration)
        return Response.json(
          {
            success: false,
            result: null,
            errors: [{ code: 1000, message: 'private provider detail' }],
          },
          { status: 500 },
        );
      result = call.body;
    } else return Response.json({ success: false, result: null }, { status: 404 });
    return Response.json({ success: true, result });
  }) as typeof fetch;
});

afterEach(async () => {
  for (const service of services) await service.shutdown();
  vi.unstubAllEnvs();
  ctx.db.close();
  rmSync(ctx.config.dataDir, { recursive: true, force: true, maxRetries: 3 });
});

function makeService(bin: string | null = resolve(ctx.config.dataDir, 'cloudflared.exe')) {
  const spawnFake = ((command: string, args: string[], options: SpawnOptions) => {
    spawnCalls.push({ bin: command, args, options });
    const child = new FakeChild();
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
  const service = new CloudflareSetup({
    ctx,
    tunnel: manager,
    binPath: () => bin,
    spawn: spawnFake,
    fetch: fetcher,
  });
  services.push(service);
  return service;
}
function authorize() {
  ctx.settings.setSecret(CLOUDFLARE_AUTH_KEY, JSON.stringify(credentials));
  ctx.settings.set(CLOUDFLARE_DOMAINS_KEY, [domain]);
}
async function finishCertificate(value: unknown = credentials) {
  const dir = String(spawnCalls[0]!.options.cwd);
  await mkdir(join(dir, '.cloudflared'));
  const pem = `-----BEGIN ARGO TUNNEL TOKEN-----\n${Buffer.from(JSON.stringify(value)).toString('base64')}\n-----END ARGO TUNNEL TOKEN-----`;
  await writeFile(join(dir, '.cloudflared', 'cert.pem'), pem);
  children[0]!.exit(0);
}

describe('Cloudflare sign-in', () => {
  it('isolates child home/config/browser launch, only accepts an official login URL and stores encrypted credentials', async () => {
    vi.stubEnv('TUNNEL_TOKEN', 'unrelated-runtime-token');
    vi.stubEnv('TUNNEL_ORIGIN_CERT', 'unrelated-cert.pem');
    vi.stubEnv('TUNNEL_CONFIG', 'unrelated-config.yml');
    vi.stubEnv('TUNNEL_LOGIN_URL', 'https://evil.example');
    const logs: string[] = [];
    ctx.log = pino({ level: 'info' }, { write: (message: string) => logs.push(message) });
    const service = makeService();
    await service.login();
    const { args, options } = spawnCalls[0]!;
    const dir = String(options.cwd);
    expect(dir.startsWith(join(ctx.config.dataDir, 'cloudflare', 'login-'))).toBe(true);
    expect(args).toEqual(['tunnel', '--config=', '--no-autoupdate', 'login']);
    expect(options).toMatchObject({
      windowsHide: true,
      env: { HOME: dir, USERPROFILE: dir, PATH: dir },
    });
    for (const key of ['TUNNEL_TOKEN', 'TUNNEL_ORIGIN_CERT', 'TUNNEL_CONFIG', 'TUNNEL_LOGIN_URL'])
      expect(options.env?.[key]).toBeUndefined();
    children[0]!.line('https://dash.cloudflare.com.evil.example/argotunnel?private=secret');
    expect(service.status().loginUrl).toBeNull();
    const loginUrl = 'https://dash.cloudflare.com/argotunnel?aud=test&callback=private-login-state';
    children[0]!.line(`Open ${loginUrl}`);
    expect(service.status()).toMatchObject({ state: 'awaiting_approval', loginUrl, busy: true });
    await finishCertificate();
    await vi.waitFor(() =>
      expect(service.status()).toMatchObject({
        state: 'connected',
        busy: false,
        domains: [domain],
        loginUrl: null,
      }),
    );
    expect(existsSync(dir)).toBe(false);
    expect(JSON.parse(ctx.settings.getSecret(CLOUDFLARE_AUTH_KEY)!)).toEqual(credentials);
    const raw = ctx.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(CLOUDFLARE_AUTH_KEY) as { value: string };
    expect(raw.value).not.toContain(credentials.apiToken);
    expect(JSON.stringify(service.status())).not.toContain(credentials.apiToken);
    expect(logs.join('')).not.toContain('private-login-state');
    expect(logs.join('')).not.toContain(credentials.apiToken);
  });

  it('deduplicates simultaneous starts and cancels a start before it can spawn', async () => {
    const service = makeService();
    const first = service.login();
    const second = service.login();
    expect(second).toBe(first);
    const cancelled = service.cancelLogin();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.every((result) => result.status === 'rejected')).toBe(true);
    await cancelled;
    expect(spawnCalls).toHaveLength(0);
    expect(service.status()).toMatchObject({ state: 'signed_out', busy: false });
    expect(readdirSync(join(ctx.config.dataDir, 'cloudflare'))).toEqual([]);
  });

  it('cancels the login child while preserving previous credentials and an active tunnel', async () => {
    authorize();
    const service = makeService();
    await service.login();
    const dir = String(spawnCalls[0]!.options.cwd);
    await service.cancelLogin();
    expect(children[0]!.killed).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(service.status()).toMatchObject({ state: 'connected', busy: false, loginUrl: null });
    expect(ctx.settings.getSecret(CLOUDFLARE_AUTH_KEY)).toBe(JSON.stringify(credentials));
    expect(manager.stop).not.toHaveBeenCalled();
  });

  it('rejects invalid certificates and cleans temporary credentials', async () => {
    const service = makeService();
    await service.login();
    await finishCertificate({ ...credentials, endpoint: 'https://evil.example' });
    await vi.waitFor(() => expect(service.status()).toMatchObject({ state: 'error', busy: false }));
    expect(ctx.settings.getSecret(CLOUDFLARE_AUTH_KEY)).toBeNull();
    expect(readdirSync(join(ctx.config.dataDir, 'cloudflare'))).toEqual([]);
    expect(apiCalls).toEqual([]);
  });

  it('uses the selected authorised domain when Cloudflare forbids listing zones', async () => {
    authorize();
    handler = (call) =>
      call.path.startsWith('/zones?')
        ? Response.json({ success: false, result: null }, { status: 403 })
        : undefined;
    const service = makeService();
    await service.refresh();
    expect(service.status()).toMatchObject({ state: 'connected', domains: [domain], busy: false });
    expect(apiCalls.some((call) => call.path.includes(`account.id=${accountID}`))).toBe(true);
  });
});

describe('Cloudflare provisioning', () => {
  it('creates a proxied address, configures the actual server port and starts the existing manager last', async () => {
    authorize();
    const service = makeService();
    await expect(service.create(body, 7)).resolves.toEqual(status);
    const writeCalls = apiCalls.filter((call) => call.method !== 'GET');
    expect(writeCalls.map((call) => call.method)).toEqual(['POST', 'POST', 'PUT']);
    expect(writeCalls[0]!.body).toEqual({ name: body.tunnelName, config_src: 'cloudflare' });
    expect(writeCalls[1]!.body).toEqual({
      type: 'CNAME',
      name: record.name,
      content: record.content,
      proxied: true,
      ttl: 1,
    });
    expect(writeCalls[2]!.body).toEqual({
      config: {
        ingress: [
          { hostname: record.name, service: 'http://127.0.0.1:7462', originRequest: {} },
          { service: 'http_status:404' },
        ],
      },
    });
    expect(manager.start).toHaveBeenCalledWith(
      { mode: 'named', token: runtimeToken, hostname: record.name },
      7,
    );
    expect(service.status().managed).toEqual({
      id: tunnelID,
      name: tunnel.name,
      hostname: record.name,
    });
    expect(JSON.stringify(service.status())).not.toContain(runtimeToken);
    expect(JSON.stringify(ctx.settings.get(CLOUDFLARE_MANAGED_KEY, null))).not.toContain(
      runtimeToken,
    );
  });

  it('preserves foreign DNS records without writing to Cloudflare or stopping the active tunnel', async () => {
    authorize();
    dnsRecords = [{ ...record, type: 'A', content: '192.0.2.1' }];
    await expect(makeService().create(body, 1)).rejects.toThrow(/address is already in use/);
    expect(apiCalls.every((call) => call.method === 'GET')).toBe(true);
    expect(manager.start).not.toHaveBeenCalled();
    expect(manager.stop).not.toHaveBeenCalled();
  });

  it('rejects a foreign locally managed tunnel name before any write', async () => {
    authorize();
    existingTunnels = [{ ...tunnel, id: otherID, config_src: 'local' }];
    await expect(makeService().create(body, 1)).rejects.toThrow(/tunnel name is already in use/);
    expect(apiCalls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('persists an app-created ID after failure and resumes without duplicate tunnels or DNS records', async () => {
    authorize();
    failConfiguration = true;
    const service = makeService();
    await expect(service.create(body, 1)).rejects.toThrow(/connect the address/);
    expect(ctx.settings.get(CLOUDFLARE_OWNED_KEY, [])).toEqual([
      { id: tunnelID, name: tunnel.name, accountID },
    ]);
    expect(service.status().busy).toBe(false);
    expect(manager.start).not.toHaveBeenCalled();
    failConfiguration = false;
    await service.create(body, 1);
    expect(
      apiCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/cfd_tunnel')),
    ).toHaveLength(1);
    expect(
      apiCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/dns_records')),
    ).toHaveLength(1);
    expect(manager.start).toHaveBeenCalledTimes(1);
  });

  it('detects a DNS record appearing between the initial check and publishing', async () => {
    authorize();
    let checks = 0;
    handler = (call) => {
      if (call.path.includes('/dns_records?') && ++checks === 2)
        return Response.json({
          success: true,
          result: [{ ...record, content: 'foreign.example.com' }],
        });
      return undefined;
    };
    await expect(makeService().create(body, 1)).rejects.toThrow(/address is already in use/);
    expect(apiCalls.filter((call) => call.method !== 'GET')).toHaveLength(1);
    expect(manager.start).not.toHaveBeenCalled();
  });

  it('blocks provision when a binary or an authorised domain is missing', async () => {
    authorize();
    await expect(makeService(null).create(body, 1)).rejects.toThrow(/restore Cloudflare access/);
    await expect(makeService().create({ ...body, domainId: 'c'.repeat(32) }, 1)).rejects.toThrow(
      /Choose a domain/,
    );
    expect(apiCalls).toEqual([]);
  });

  it('blocks changes while login is pending', async () => {
    authorize();
    const service = makeService();
    await service.login();
    await expect(service.create(body, 1)).rejects.toMatchObject({ status: 409 });
    await expect(service.refresh()).rejects.toMatchObject({ status: 409 });
    expect(apiCalls).toEqual([]);
  });

  it('waits for the original provision during shutdown even after rejecting overlapping requests', async () => {
    authorize();
    let release!: (response: Response) => void;
    const domainResponse = new Promise<Response>((resolveResponse) => {
      release = resolveResponse;
    });
    handler = (call) => (call.path === `/zones/${zoneID}` ? domainResponse : undefined);
    const service = makeService();
    const creating = service.create(body, 1);
    await vi.waitFor(() => expect(apiCalls).toHaveLength(1));
    await expect(service.create(body, 1)).rejects.toMatchObject({ status: 409 });
    await expect(service.refresh()).rejects.toMatchObject({ status: 409 });
    let stopped = false;
    const shutdown = service.shutdown().then(() => {
      stopped = true;
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    expect(stopped).toBe(false);
    release(Response.json({ success: true, result: zone }));
    await creating;
    await shutdown;
    expect(stopped).toBe(true);
    await expect(service.login()).rejects.toMatchObject({ status: 409 });
  });

  it('reconciles an app-managed tunnel port and ignores a manually replaced token', async () => {
    authorize();
    ctx.settings.set(CLOUDFLARE_MANAGED_KEY, {
      id: tunnelID,
      name: tunnel.name,
      accountID,
      zoneID,
      hostname: record.name,
      port: 7420,
      tokenHash: createHash('sha256').update(runtimeToken).digest('hex'),
    });
    ctx.settings.set('tunnel_mode', 'named');
    ctx.settings.set('named_tunnel_hostname', record.name);
    ctx.settings.setSecret('tunnel_token', 'manual-replacement-token');
    const service = makeService();
    await service.reconcileOrigin();
    expect(apiCalls).toEqual([]);
    ctx.settings.setSecret('tunnel_token', runtimeToken);
    await service.reconcileOrigin();
    expect(apiCalls.map((call) => call.method)).toEqual(['GET', 'PUT']);
    expect(apiCalls[1]!.body).toMatchObject({
      config: {
        ingress: [
          { hostname: record.name, service: 'http://127.0.0.1:7462', originRequest: {} },
          { service: 'http_status:404' },
        ],
      },
    });
    expect(ctx.settings.get<{ port: number } | null>(CLOUDFLARE_MANAGED_KEY, null)?.port).toBe(
      7462,
    );
    expect(manager.start).not.toHaveBeenCalled();
  });
});
