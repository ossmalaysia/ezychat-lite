// Shared client for the Dev Build checks against e2e/agents-devbuild.ts (mock model, fake WhatsApp).
// One cookie session, PASS/FAIL lines (detail kept on one line so a reply cannot fake a result line)
// and the final summary.
export async function devbuildClient(port) {
  const BASE = `http://127.0.0.1:${port}`;
  const health = await fetch(BASE + '/api/health');
  if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
    throw new Error('Run this only against e2e/agents-devbuild.ts (mock model)');
  let failed = 0;
  let cookie = '';
  const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
  return {
    BASE,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    check(ok, step, detail = '') {
      if (!ok) failed++;
      const extra = detail ? '  (' + oneLine(detail) + ')' : '';
      console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
    },
    async api(method, path, body) {
      const res = await fetch(BASE + '/api' + path, {
        method,
        headers: {
          origin: BASE,
          ...(cookie ? { cookie } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    },
    code: (r) => r.json?.error?.code ?? r.json?.error,
    /** Prints the summary and exits 1 when a step failed. */
    finish() {
      console.log(failed ? `${failed} FAILED` : 'ALL PASS');
      process.exit(failed ? 1 : 0);
    },
  };
}
