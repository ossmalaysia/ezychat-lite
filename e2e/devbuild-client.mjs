// Shared client for the Dev Build checks against e2e/agents-devbuild.ts (mock model, fake WhatsApp).
// One cookie session, PASS/FAIL lines (detail kept on one line so a reply cannot fake a result line)
// and the final summary.
export async function devbuildClient(port) {
  const BASE = `http://127.0.0.1:${port}`;
  const health = await fetch(BASE + '/api/health');
  if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
    throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');
  let failed = 0;
  const api = cookieSession(BASE);
  const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
  return {
    BASE,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    check(ok, step, detail = '') {
      if (!ok) failed++;
      const extra = detail ? '  (' + oneLine(detail) + ')' : '';
      console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
    },
    api,
    code: (r) => r.json?.error?.code ?? r.json?.error,
    /** First-run admin `checker` (created when the install has none), signed in. */
    async signInAdmin() {
      const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
      if ((await api('GET', '/setup/status')).json.needsSetup)
        await api('POST', '/setup/admin', admin);
      const login = await api('POST', '/auth/login', {
        username: admin.username,
        password: admin.password,
      });
      this.check(login.status === 200, 'admin signs in');
    },
    /** Prints the summary and exits 1 when a step failed. */
    finish() {
      console.log(failed ? `${failed} FAILED` : 'ALL PASS');
      process.exit(failed ? 1 : 0);
    },
  };
}

/**
 * `api(method, path, body)` for one browser-like session (its own cookie) against the local Dev Build
 * at `base`: plain path segments only, never a URL outside it. Answers `{ status, json }`.
 */
export function cookieSession(base) {
  let cookie = '';
  return async (method, path, body) => {
    if (!/^(\/[\w%@.:?=&-]+)+$/.test(path) || path.split('/').some((p) => p === '..' || p === '.'))
      throw new Error(`Unexpected API path: ${path}`);
    const url = new URL(`/api${path}`, base);
    if (url.origin !== base) throw new Error('Refusing a link outside the local Dev Build');
    const res = await fetch(url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
}
