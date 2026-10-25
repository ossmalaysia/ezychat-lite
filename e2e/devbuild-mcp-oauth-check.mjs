// Dev Build check: an AI app signs in to MCP with OAuth (no token copy), the way claude.ai or
// ChatGPT does: discovery from the 401, app registration, the admin's approval, the code swap and
// tool calls with the issued token. With --tunnel it starts a Quick Tunnel first and runs every
// step through the public https address (stopped again at the end).
// Usage: node e2e/devbuild-mcp-oauth-check.mjs <port> [--tunnel] [--keep]
//   --keep leaves AI assistant access on and the tunnel running (for a real claude.ai check).
// Needs demo data (node e2e/marketing-screenshots.mjs <port> <dir>): signs in as aisyah.
import { createHash, randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] ?? 7490);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('usage: <port>');
const useTunnel = process.argv.includes('--tunnel');
const keep = process.argv.includes('--keep');
const local = `http://127.0.0.1:${PORT}`;
/** A Quick Tunnel address, rebuilt from its checked name (never a raw server value). */
const QUICK_TUNNEL = /^https:\/\/([a-z0-9-]{1,80})\.trycloudflare\.com\/?$/;
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  const suffix = detail ? '  (' + detail + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + suffix); // NOSONAR (jssecurity:S5145): local check output
};

/**
 * Every request of this check: this machine's Dev Build (checked numeric port) or its own Quick
 * Tunnel (address rebuilt from a checked trycloudflare name).
 */
const request = (url, init) => fetch(url, init); // NOSONAR (jssecurity:S5144): own server and own tunnel only, see above

async function signIn(base) {
  const res = await request(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ username: 'aisyah', password: 'demo-pass-123' }),
  });
  if (!res.ok) throw new Error(`login ${res.status} at ${base}`);
  const sid = /sid=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0];
  if (!sid) throw new Error('no session cookie');
  return sid;
}

const adminCall = (base, cookie, path, init = {}) =>
  request(`${base}/api${path}`, {
    ...init,
    headers: {
      cookie,
      origin: base,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

const localCookie = await signIn(local);
await adminCall(local, localCookie, '/integrations/mcp', {
  method: 'PATCH',
  body: JSON.stringify({ enabled: true }),
});

let base = local;
if (useTunnel) {
  await adminCall(local, localCookie, '/tunnel/start', {
    method: 'POST',
    body: JSON.stringify({ mode: 'quick' }),
  });
  for (let i = 0; i < 60 && base === local; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await (await adminCall(local, localCookie, '/tunnel')).json();
    const name = s.state === 'running' ? QUICK_TUNNEL.exec(s.url ?? '')?.[1] : undefined;
    if (name) base = `https://${name}.trycloudflare.com`;
  }
  step('Quick Tunnel running', base !== local, base);
  // A fresh trycloudflare name can take a few seconds to resolve.
  for (let i = 0; i < 30; i++) {
    const ok = await request(`${base}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const mcpUrl = `${base}/mcp`;
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'check', version: '1' },
  },
};
const mcp = (token, body) =>
  request(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

// The addresses an app must find; the check calls these, after comparing them with the metadata.
const expected = {
  resourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
  authorization: `${base}/oauth/authorize`,
  token: `${base}/mcp/oauth/token`,
  registration: `${base}/mcp/oauth/register`,
};

// 1. The 401 points at the metadata.
const unauth = await mcp(null, initialize);
const wwwAuth = unauth.headers.get('www-authenticate') ?? '';
step(
  '401 names resource_metadata',
  unauth.status === 401 && wwwAuth.includes(`resource_metadata="${expected.resourceMetadata}"`),
);
const prm = await (await request(expected.resourceMetadata)).json();
step(
  'protected resource is this /mcp, on this server',
  prm.resource === mcpUrl && prm.authorization_servers?.[0] === base,
);
const as = await (await request(`${base}/.well-known/oauth-authorization-server`)).json();
step(
  'authorization server metadata on the same origin, S256',
  as.issuer === base &&
    as.authorization_endpoint === expected.authorization &&
    as.token_endpoint === expected.token &&
    as.registration_endpoint === expected.registration &&
    as.code_challenge_methods_supported?.includes('S256'),
);

// 2. The app registers itself (as claude.ai does).
const redirect = 'https://claude.ai/api/mcp/auth_callback';
const reg = await request(expected.registration, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Dev Build check',
    redirect_uris: [redirect],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code'],
  }),
});
const client = await reg.json();
step('app registered', reg.status === 201 && Boolean(client.client_secret), client.client_id);

// 3. The admin approves on the approval page (its API, signed in on the same address).
const verifier = randomBytes(40).toString('base64url');
const params = new URLSearchParams({
  response_type: 'code',
  client_id: client.client_id,
  redirect_uri: redirect,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  code_challenge_method: 'S256',
  state: 'check-state',
  resource: mcpUrl,
});
const page = await request(`${expected.authorization}?${params}`);
step('approval page is served', page.ok && (await page.text()).includes('<div id="root"'));
const cookie = base === local ? localCookie : await signIn(base);
const info = await (await adminCall(base, cookie, `/oauth/request?${params}`)).json();
step('page shows app and return host', info.redirectHost === 'claude.ai', JSON.stringify(info));
const decision = await adminCall(base, cookie, '/oauth/decision', {
  method: 'POST',
  body: JSON.stringify({ ...Object.fromEntries(params), approve: true }),
});
const back = new URL((await decision.json()).redirectTo);
step(
  'approve returns to the app with code and state',
  Boolean(back.searchParams.get('code')) && back.searchParams.get('state') === 'check-state',
);

// 4. The app swaps the code (from its server, no browser).
const tokenRes = await request(expected.token, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: back.searchParams.get('code'),
    redirect_uri: redirect,
    code_verifier: verifier,
    client_id: client.client_id,
    client_secret: client.client_secret,
    resource: mcpUrl,
  }),
});
const tokens = await tokenRes.json();
step('token issued', tokenRes.ok && tokens.access_token?.startsWith('ezc_pat_'));

// 5. Tool calls with the issued token.
const init = await mcp(tokens.access_token, initialize);
step('initialize with the token', init.status === 200);
const list = await mcp(tokens.access_token, {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'list_chats', arguments: { limit: 3 } },
});
const listed = await list.json();
step(
  'list_chats returns demo chats',
  list.ok && !listed.result?.isError,
  listed.result?.content?.[0]?.text?.slice(0, 80),
);

// 6. The connection shows in Settings and revoking it stops the app.
const all = (await (await adminCall(local, localCookie, '/integrations/tokens')).json()).tokens;
const row = all.find((t) => t.name === 'Dev Build check');
step('token listed in Settings, no send, no expiry', row && !row.canSend && row.expiresAt === null);
await adminCall(local, localCookie, `/integrations/tokens/${row.id}`, { method: 'DELETE' });
step('revoked token is refused', (await mcp(tokens.access_token, initialize)).status === 401);

if (!keep) {
  if (useTunnel)
    await adminCall(local, localCookie, '/tunnel/stop', { method: 'POST', body: '{}' });
  await adminCall(local, localCookie, '/integrations/mcp', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  });
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
if (keep) console.log(`connector address: ${mcpUrl}`); // NOSONAR (jssecurity:S5145): local check output
process.exitCode = failed ? 1 : 0;
