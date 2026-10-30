// Real upgrade: a data folder made by a released server (npm @ezychat/server, e.g. 0.1.65 = migrations to
// 025), then this branch's server on the same folder (migration 026: resolution_check per agent).
// Fake WhatsApp, temp data, no model calls. Usage (install the release in a scratch folder first:
// `npm i @ezychat/server@0.1.65` there):
//   node e2e/devbuild-upgrade-026-check.mjs <scratch folder with node_modules/@ezychat/server> [releaseVersion]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiClient, checker, oneLine, poll } from './devbuild-client.mjs';

const usage = 'Usage: devbuild-upgrade-026-check.mjs <release folder> [version]';
if (!process.argv[2]) throw new Error(usage);
// The release folder must hold an installed @ezychat/server: nothing else is ever started from it.
const RELEASE_DIR = realpathSync(resolve(process.argv[2]));
const RELEASE_CLI = join(RELEASE_DIR, 'node_modules', '@ezychat', 'server', 'dist', 'cli.js');
const releasePkg = join(RELEASE_DIR, 'node_modules', '@ezychat', 'server', 'package.json');
if (
  !existsSync(RELEASE_CLI) ||
  JSON.parse(readFileSync(releasePkg, 'utf8')).name !== '@ezychat/server'
)
  throw new Error(usage + ' (no installed @ezychat/server there)');
const RELEASE = /^\d+\.\d+\.\d+$/.test(process.argv[3] ?? '') ? process.argv[3] : '0.1.65';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = mkdtempSync(join(tmpdir(), 'ezychat-upgrade-026-'));
const PORT = 7495;
const BASE = 'http://127.0.0.1:' + PORT;
const flags = [
  '--data',
  DATA,
  '--port',
  String(PORT),
  '--fake-wa',
  '--mode',
  'dev',
  '--max-inboxes',
  '2',
];
const { check, finish } = checker();
const api = apiClient(BASE);
const listening = () =>
  fetch(BASE + '/api/health').then(
    (r) => r.ok,
    () => false,
  );
async function start(cmd, args, cwd) {
  // A server left on the port would be checked instead of the one started here.
  if (await listening()) throw new Error('port ' + PORT + ' is already in use');
  // Own process group, so stop() also ends npx's tsx child.
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  if (await poll(listening, 90_000)) return p;
  throw new Error('server did not start: ' + oneLine(err.slice(-500)));
}
const stop = (p) =>
  new Promise((r) => {
    p.once('exit', () => poll(async () => !(await listening()), 30_000).then(r));
    process.kill(-p.pid, 'SIGTERM');
  });
const RULES = 'Never hand over on:\n- A consultation, meeting, demo or "book a call" request.';
// 1. The release.
let p = await start('node', [RELEASE_CLI, ...flags], RELEASE_DIR);
const h1 = (await api('GET', '/health')).json;
check(
  h1.version === RELEASE,
  `release server ${RELEASE} runs on a new temp data folder`,
  h1.version,
);
await api('POST', '/setup/admin', {
  username: 'checker',
  displayName: 'Checker',
  password: 'check-pass-123',
});
await api('POST', '/auth/login', { username: 'checker', password: 'check-pass-123' });
const sales = await api('POST', '/ai/agents', {
  displayName: 'Anchor Sprint AI',
  enabled: false,
  preset: 'sales',
  inboxId: 1,
  instructions: 'Be brief',
  handoffRules: RULES,
});
await api('POST', '/inboxes', { name: 'Clinic', memberIds: [] });
await api('POST', '/dev/fake-link', { inboxId: 2 });
const faq = await api('POST', '/ai/agents', {
  displayName: 'Clinic Desk',
  enabled: false,
  preset: 'faq',
  inboxId: 2,
  instructions: '',
  handoffRules: '',
});
check(
  sales.status === 200 && faq.status === 200,
  'release: a sales and an FAQ agent saved',
  `${sales.status}/${faq.status}`,
);
check(
  sales.json?.agent?.resolutionCheck === undefined,
  'release: agents have no resolutionCheck yet',
);
await stop(p);
// 2. This branch on the same folder.
api.reset();
p = await start(
  'npx',
  ['tsx', '--conditions=ezychat-source', 'packages/server/src/cli.ts', ...flags],
  REPO,
);
const h2 = (await api('GET', '/health')).json;
check(
  h2.app === 'wa-team-inbox',
  'branch server starts on the upgraded folder',
  JSON.stringify({ v: h2.version }),
);
check(
  (await api('POST', '/auth/login', { username: 'checker', password: 'check-pass-123' })).status ===
    200,
  'the admin from the release still signs in',
);
const agentsRes = (await api('GET', '/ai/agents')).json;
const agents = agentsRes.agents ?? agentsRes;
const s = agents.find((a) => a.preset === 'sales'),
  f = agents.find((a) => a.preset === 'faq');
check(
  s?.resolutionCheck === false,
  'migration 026: the existing sales agent asks no resolution question',
  s?.resolutionCheck,
);
check(
  f?.resolutionCheck === true,
  'migration 026: the existing FAQ agent keeps asking',
  f?.resolutionCheck,
);
const st = (await api('GET', `/ai/agents/${s.id}`)).json;
check(
  st.settings.handoffRules === RULES && st.settings.instructions === 'Be brief',
  'the saved instructions and hand-off rules are untouched',
);
const put = await api('PUT', `/ai/agents/${s.id}/resolution-check`, { enabled: true });
check(
  put.status === 200 && put.json.agent.resolutionCheck === true,
  'the switch saves on the upgraded folder',
);
await stop(p);
// 3. Restart: the migration does not run twice and the saved switch stays.
api.reset();
p = await start(
  'npx',
  ['tsx', '--conditions=ezychat-source', 'packages/server/src/cli.ts', ...flags],
  REPO,
);
await api('POST', '/auth/login', { username: 'checker', password: 'check-pass-123' });
const againRes = (await api('GET', '/ai/agents')).json;
const again = (againRes.agents ?? againRes).find((a) => a.preset === 'sales');
check(
  again?.resolutionCheck === true,
  'after a restart the saved switch stays (migration not re-run)',
);
await stop(p);
console.log('data: ' + DATA);
finish();
