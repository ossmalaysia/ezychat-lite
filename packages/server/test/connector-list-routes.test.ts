import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorGallery } from '@ezychat/shared';
import {
  createConnectorListService,
  REFRESH_MIN_INTERVAL_MS,
} from '../src/connectors/list/service.js';
import { REFRESH_WAIT_MS } from '../src/routes/connector-list.js';
import { authHeaders, createUserAndLogin } from './auth-helpers.js';
import {
  BASE,
  entry,
  FakeListServer,
  iconRef,
  keyPair,
  PNG,
  SVG,
} from './connector-list-fixtures.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  vi.useRealTimers();
  await t?.close();
});

const key = keyPair();

async function setUp(server: FakeListServer, clock = { now: 0 }) {
  t = await makeTestApp({
    config: { version: '0.1.62' },
    beforeBuild: (ctx) => {
      ctx.services.connectorList!.shutdown();
      ctx.services.connectorList = createConnectorListService(ctx, {
        fetch: server.fetch,
        now: () => clock.now,
        keys: [key.publicKey],
        baseUrl: BASE,
      });
    },
  });
  const admin = await createUserAndLogin(t, { role: 'admin' });
  const agent = await createUserAndLogin(t, { role: 'agent' });
  return { admin: admin.cookie, agent: agent.cookie, clock };
}

const get = (url: string, cookie: string) =>
  t.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string) =>
  t.app.inject({ method: 'POST', url, headers: authHeaders(cookie), payload: {} });

function publishWithIcons(server: FakeListServer, sequence = 1) {
  const svg = SVG();
  server.publish({
    sequence,
    key: key.privateKey,
    entries: [
      entry('alpha', { icon: iconRef('alpha.svg', svg) }),
      entry('beta', { icon: iconRef('beta.png', PNG) }),
    ],
    icons: { 'alpha.svg': svg, 'beta.png': PNG },
  });
  return svg;
}

describe('connector list routes', () => {
  it('list and refresh are admin only; icons need a session', async () => {
    const { agent } = await setUp(new FakeListServer());
    for (const [method, url] of [
      ['GET', '/api/connectors/list'],
      ['POST', '/api/connectors/list/refresh'],
    ] as const) {
      const anonymous = await t.app.inject({
        method,
        url,
        headers: { origin: 'http://localhost', host: 'localhost' },
        payload: method === 'GET' ? undefined : {},
      });
      expect(anonymous.statusCode, url).toBe(401);
      const asAgent = await t.app.inject({
        method,
        url,
        headers: authHeaders(agent),
        payload: method === 'GET' ? undefined : {},
      });
      expect(asAgent.statusCode, url).toBe(403);
    }
    const icon = await t.app.inject({ method: 'GET', url: '/api/connectors/icons/alpha.svg' });
    expect(icon.statusCode).toBe(401);
  });

  it('GET shows the built-in list; refresh downloads and answers with the new gallery', async () => {
    const server = new FakeListServer();
    const { admin, clock } = await setUp(server);
    const first = ConnectorGallery.parse((await get('/api/connectors/list', admin)).json());
    expect(first.status.state).toBe('builtin');
    expect(first.connectors.map((c) => c.entry.id)).toContain('google-calendar');

    publishWithIcons(server);
    const refreshed = await post('/api/connectors/list/refresh', admin);
    expect(refreshed.statusCode).toBe(200);
    const gallery = ConnectorGallery.parse(refreshed.json());
    expect(gallery.status).toMatchObject({ state: 'loaded', sequence: 1, checkedAt: 0 });
    expect(gallery.connectors.map((c) => c.entry.id)).toEqual(['alpha', 'beta']);

    // Within 30 s: no new download, the current gallery.
    const calls = server.calls.length;
    publishWithIcons(server, 2);
    clock.now += REFRESH_MIN_INTERVAL_MS - 1;
    const again = (await post('/api/connectors/list/refresh', admin)).json() as ConnectorGallery;
    expect(again.status.sequence).toBe(1);
    expect(server.calls.length).toBe(calls);
    clock.now += 1;
    const later = (await post('/api/connectors/list/refresh', admin)).json() as ConnectorGallery;
    expect(later.status.sequence).toBe(2);
  });

  it('refresh answers after 12 s even when the download hangs', async () => {
    const server = new FakeListServer();
    const { admin } = await setUp(server);
    publishWithIcons(server);
    server.hold();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = post('/api/connectors/list/refresh', admin);
    await vi.waitFor(() => expect(server.calls.length).toBe(2));
    await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect((res.json() as ConnectorGallery).status.state).toBe('builtin');
    server.release();
  });

  it('serves listed icons as plain images with strict headers', async () => {
    const server = new FakeListServer();
    const { admin, agent } = await setUp(server);
    const svg = publishWithIcons(server);
    await post('/api/connectors/list/refresh', admin);

    const res = await get('/api/connectors/icons/alpha.svg', agent);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(svg);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    const png = await get('/api/connectors/icons/beta.png', agent);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload).toEqual(PNG);

    // Unknown, not named by the list, or not a valid name: 404.
    writeFileSync(join(t.ctx.config.dataDir, 'connectors', 'icons', 'stray.svg'), svg);
    for (const file of ['gamma.svg', 'stray.svg', '..%2Flist-v1.json', 'ALPHA.svg', 'alpha.gif']) {
      const missing = await get(`/api/connectors/icons/${file}`, agent);
      expect(missing.statusCode, file).toBe(404);
    }
  });
});
