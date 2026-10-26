// Dev Build check for Admin → Reports (docs/dev-build-checks.md): on a Dev Build seeded by
// e2e/marketing-screenshots.mjs (fake WhatsApp, temp data), a message from a new number counts as a
// new customer and a message from customers, a quick team reply keeps it from being "missed", agents
// get 403, and the page renders at 1280 / 360 px in light and dark with no page errors or sideways
// scroll. Screenshots go to <outDir>.
// Usage: node e2e/devbuild-reports-check.mjs <port> <outDir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [port, outDir] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? '') || !outDir)
  throw new Error('usage: devbuild-reports-check.mjs <port> <outDir>');
const BASE = `http://127.0.0.1:${port}`;
mkdirSync(outDir, { recursive: true });

async function signIn(username) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ username, password: 'demo-pass-123' }),
  });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  return r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
const admin = await signIn('aisyah');
const call = async (method, path, body, cookie = admin) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { origin: BASE, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: r.headers.get('content-type')?.includes('json') ? await r.json() : null,
  };
};

let failed = 0;
/** Server values on one line (a line break could fake an extra result line). */
const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ');
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  const suffix = detail ? `: ${oneLine(detail)}` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${suffix}`); // NOSONAR (jssecurity:S5145): local check output, line breaks removed
};

const before = (await call('GET', '/reports?days=7')).body;
check('admin gets the report', before?.days === 7, JSON.stringify(before?.totals));
const jid = `6019${String(Date.now()).slice(-7)}@s.whatsapp.net`;
await call('POST', '/dev/fake-incoming', {
  chatJid: jid,
  senderName: 'Report Check',
  text: 'Hi, how much?',
});
await call('POST', `/chats/${encodeURIComponent(jid)}/messages`, {
  text: 'Hi! It is RM12.',
  clientId: `report-check-${Date.now()}`,
});
await new Promise((r) => setTimeout(r, 2500)); // the send queue waits ≥1 s and sends "composing" first
const after = (await call('GET', '/reports?days=7')).body;
check(
  'a new number is one more new customer',
  after.totals.newCustomers === before.totals.newCustomers + 1,
  `${before.totals.newCustomers} → ${after.totals.newCustomers}`,
);
check(
  'its message counts as one more from customers',
  after.totals.messagesIn === before.totals.messagesIn + 1,
  `${before.totals.messagesIn} → ${after.totals.messagesIn}`,
);
check(
  'the quick reply counts as sent',
  after.totals.messagesOut === before.totals.messagesOut + 1,
  `${before.totals.messagesOut} → ${after.totals.messagesOut}`,
);
check(
  'a quick reply is not a missed customer',
  after.totals.missedLeads === before.totals.missedLeads,
);
check(
  'today has the new customer',
  after.daily.at(-1).newCustomers >= 1,
  JSON.stringify(after.daily.at(-1)),
);
const agent = await signIn('daniel');
check('an agent gets 403', (await call('GET', '/reports', undefined, agent)).status === 403);
check('a wrong period is 400', (await call('GET', '/reports?days=14')).status === 400);

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];
for (const scheme of ['light', 'dark'])
  for (const [name, size] of Object.entries({
    desktop: { viewport: { width: 1280, height: 860 } },
    mobile: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
  })) {
    const ctx = await browser.newContext({ ...size, baseURL: BASE, colorScheme: scheme });
    await ctx.addCookies(
      admin.split('; ').map((c) => {
        const [k, v] = c.split('=');
        return { name: k, value: v, url: BASE };
      }),
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}-${scheme}: ${e.message}`));
    await page.goto('/admin/reports');
    await page.getByTestId('report-totals').waitFor();
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => {
      const root = globalThis.document.documentElement;
      return root.scrollWidth > root.clientWidth + 1;
    });
    if (overflow) problems.push(`${name}-${scheme}: horizontal overflow`);
    await page.screenshot({ path: join(outDir, `reports-${name}-${scheme}.png`), fullPage: true });
    if (scheme === 'light') {
      await page
        .getByTestId('card-weekdays')
        .getByRole('button', { name: 'Show as table' })
        .click();
      await page
        .getByTestId('card-weekdays')
        .screenshot({ path: join(outDir, `reports-table-${name}.png`) });
    }
    await ctx.close();
  }
await browser.close();
check('page renders without errors or sideways scroll', problems.length === 0, problems.join('; '));
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
