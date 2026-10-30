// Shared helpers of the Dev Build check scripts: PASS/FAIL lines and a cookie-keeping API client.
// Never calls a model or a real WhatsApp number; the scripts point it at a local Dev Build.

/** One line of text for a log: control characters (new lines included) become spaces. */
export const oneLine = (value) => String(value).replace(/\p{Cc}+/gu, ' ');

/** PASS/FAIL lines and the number of failures. */
export function checker() {
  let failed = 0;
  const check = (ok, step, detail = '') => {
    if (!ok) failed++;
    const extra = detail === '' ? '' : '  (' + oneLine(detail) + ')';
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
  };
  const finish = () => {
    console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
    process.exit(failed ? 1 : 0);
  };
  return { check, finish };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `api(method, '/path', body)` against `<base>/api`, keeping the session cookie; `reset()` signs out. */
export function apiClient(base) {
  let cookie = '';
  async function api(method, path, body) {
    const res = await fetch(base + '/api' + path, {
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
  }
  api.reset = () => {
    cookie = '';
  };
  return api;
}

/** Calls `probe` once a second until it returns a truthy value or `ms` passes; returns the last value. */
export async function poll(probe, ms) {
  const end = Date.now() + ms;
  let value = await probe();
  while (!value && Date.now() < end) {
    await wait(1000);
    value = await probe();
  }
  return value;
}
