// Upgrade check for AI agents: data written by an INSTALLED older release, then opened by this branch.
// 1. ELECTRON_RUN_AS_NODE=1 "<install>/EzyChat Lite.exe" <install>/resources/app.asar.unpacked/dist/server/server.cjs
//      --data <temp dir> --port 7433 --fake-wa          (never the real data folder)
//    node e2e/devbuild-agents-upgrade-check.mjs 7433 seed
// 2. stop it, start this branch on the SAME temp dir (cli.ts --data <temp dir> --port 7434 --fake-wa --mode dev)
//    node e2e/devbuild-agents-upgrade-check.mjs 7434 verify
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { cookieSession } from './devbuild-client.mjs';
const [port = '7433', phase = 'seed'] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${port}`;
let failed = 0;
/** Server values in log lines: letters, digits, dot and dash only (no log injection). */
const clean = (value) => String(value).replace(/[^\w.-]/g, '');
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  const extra = detail ? '  (' + String(detail).replace(/\s+/g, ' ') + ')' : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + step + extra);
};
const api = cookieSession(BASE);

const ADMIN = { username: 'owner', displayName: 'Owner', password: 'upgrade-pass-123' };
const INSTRUCTIONS = 'Reply in short Malay or English. Kopi Apong sells coffee and kaya toast.';
const MENU = 'Kopi O RM2.50, Kopi C RM3.00, kaya toast RM3.50. Open 7am to 3pm daily.';

if (phase === 'seed') {
  const health = (await api('GET', '/health')).json;
  console.log(`seeding on ${clean(health.app)} ${clean(health.version)}`);
  if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', ADMIN);
  check((await api('POST', '/auth/login', ADMIN)).status === 200, 'admin signs in (old release)');
  // Saved instructions and a saved BLANK hand-over list: both must survive the upgrade as they are.
  const saved = await api('PUT', '/ai', {
    displayName: 'Kopi Apong AI',
    enabled: false,
    instructions: INSTRUCTIONS,
    handoffRules: '',
  });
  check(saved.status === 200, 'the old release saves the AI member', saved.status);
  await api('PUT', '/ai', {
    displayName: 'Kopi Apong AI',
    enabled: false,
    instructions: `${INSTRUCTIONS} Be friendly.`,
    handoffRules: '',
  });
  const menu = await api('POST', '/ai/documents/text', { name: 'Menu', text: MENU });
  const hours = await api('POST', '/ai/documents/text', { name: 'Delivery', text: 'No delivery.' });
  check(menu.status === 200 && hours.status === 200, 'the old release saves two context items');
} else {
  const health = (await api('GET', '/health')).json;
  console.log(`verifying on ${clean(health.app)} ${clean(health.version)}`);
  check(
    (await api('POST', '/auth/login', ADMIN)).status === 200,
    'the same admin signs in (branch)',
  );
  const status = (await api('GET', '/ai')).json;
  const [agent] = status.agents;
  check(
    status.agents.length === 1 && agent.inboxId === 1 && agent.preset === 'sales',
    'the AI member is now agent 1, Sales, on inbox 1',
    JSON.stringify(agent),
  );
  check(agent.displayName === 'Kopi Apong AI' && !agent.enabled, 'its name and off state are kept');
  const full = (await api('GET', `/ai/agents/${agent.id}`)).json;
  check(
    full.settings.instructions === `${INSTRUCTIONS} Be friendly.`,
    'its latest instructions are kept',
    full.settings.instructions,
  );
  check(full.settings.handoffRules === '', 'its saved blank hand-over rules stay blank');
  const names = full.documents.map((d) => d.name).sort();
  check(
    names.join() === 'Delivery,Menu' && full.documents.every((d) => d.internal === false),
    'both context items are kept, customer-facing',
    names.join(),
  );
  const menu = full.documents.find((d) => d.name === 'Menu');
  const item = (await api('GET', `/ai/agents/${agent.id}/documents/${menu.id}`)).json;
  check(item.text === MENU, 'the item text is unchanged');
  // The old route still answers in its old shape for older clients.
  check(
    status.settings.instructions === `${INSTRUCTIONS} Be friendly.` &&
      status.documents.length === 2,
    'GET /api/ai (old shape) shows the same agent',
  );
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
