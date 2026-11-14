// Dev Build check for dream mode (docs/superpowers/specs/2026-11-14-dream-mode-design.md) against
// e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data). Lite runner.
// Usage: node e2e/devbuild-dream-check.mjs <port>
// A customer asks DREAMQ (the mock hands over), a teammate answers with MARK-DREAM; in a second chat the team's
// only reply is a forwarded message (MARK-FWD). Dream mode runs now: one change, learned from the real reply only,
// passes the replay (the mock now answers DREAMQ), and Apply / Undo write setup versions.
// Prints PASS/FAIL per step; never calls a model or a real WhatsApp number.
import { devbuildClient, poll } from './devbuild-client.mjs';

const ANN = '60177700051@s.whatsapp.net';
const BEN = '60177700052@s.whatsapp.net';
const CAT = '60177700053@s.whatsapp.net';
const client = await devbuildClient(Number(process.argv[2] ?? 7491));
const { api, check, finish } = client;
const enc = encodeURIComponent;

await client.signInAdmin();
await api('PUT', '/ai', {
  displayName: 'Aina',
  enabled: false,
  instructions: '',
  handoffRules: '',
});
await api('POST', '/ai/documents/text', { name: 'Menu', text: 'MARK-KOPI Kopi O RM2.50' });
const agent = (await api('GET', '/ai')).json.agents[0];
const on = await api('PUT', `/ai/agents/${agent.id}`, {
  displayName: 'Aina',
  enabled: true,
  instructions: '',
  handoffRules: '',
});
check(on.status === 200, 'the agent turns on', on.status);
const settings = await api('PUT', `/ai/agents/${agent.id}/dream`, { enabled: true });
check(settings.json?.enabled === true, 'dream mode turns on', JSON.stringify(settings.json));

const messages = async (jid) =>
  (await api('GET', `/chats/${enc(jid)}/messages`)).json?.messages ?? [];
const handedOver = async (jid) =>
  poll(
    async () => (await messages(jid)).some((m) => m.fromMe && /team member/.test(m.body ?? '')),
    20_000,
  );

// 1. A hand-off, then the teammate's reply with the fact.
await api('POST', '/dev/fake-incoming', {
  chatJid: ANN,
  text: 'DREAMQ are you open on Saturday?',
  senderName: 'Ann',
});
check(await handedOver(ANN), 'the AI hands the Saturday question over');
await api('POST', `/chats/${enc(ANN)}/messages`, {
  text: 'MARK-DREAM Yes, Saturday 9 am to 1 pm.',
  clientId: 'd-1',
});

// 2. A hand-off where the team's only reply is a forwarded message: never a learning source.
await api('POST', '/dev/fake-incoming', {
  chatJid: BEN,
  text: 'DREAMQ send me your price list',
  senderName: 'Ben',
});
check(await handedOver(BEN), 'the AI hands the price list question over');
// The price list comes from a third chat nobody took over (a supplier's message), forwarded to Ben.
await api('POST', '/dev/fake-incoming', {
  chatJid: CAT,
  text: 'MARK-FWD price list Basic RM 99',
  senderName: 'Cat',
});
const fwdSource = await poll(
  async () => (await messages(CAT)).find((m) => /MARK-FWD/.test(m.body ?? '')),
  10_000,
);
const fwd = await api('POST', `/messages/${enc(fwdSource.id)}/forward`, {
  to: [BEN],
  clientRequestId: 'd-fwd',
});
check(fwd.status === 200, 'the team forwards the price list to Ben', fwd.status);

// 3. Dream mode runs now.
const run = await api('POST', '/dev/dream-run', { agentId: agent.id });
check(typeof run.json?.runId === 'number', 'dream mode runs', JSON.stringify(run.json));
const history = (await api('GET', `/ai/agents/${agent.id}/dream`)).json;
const night = history.runs[0];
check(
  night?.status === 'done' && night.takeovers === 1,
  'one take-over read (the forwarded one is left out)',
  JSON.stringify(night),
);
const change = night?.changes?.[0];
check(
  night?.changes?.length === 1 && change.status === 'waiting',
  'one change waits for the admin',
  JSON.stringify(night?.changes),
);
const detail = (await api('GET', `/ai/agents/${agent.id}/dream/changes/${change.id}`)).json;
check(
  /MARK-DREAM/.test(detail.after) && !/MARK-FWD/.test(detail.after),
  'learned from the real reply, never the forwarded one',
  detail.after,
);
check(
  detail.checks.every((c) => c.ok) && detail.checks.some((c) => c.name === 'replay'),
  'every check passed, replay included',
  JSON.stringify(detail.checks),
);
check(
  detail.sources.some((s) => s.role === 'team' && /MARK-DREAM/.test(s.text)),
  'See change quotes the team reply',
);

// 4. Apply, then Undo.
const applied = await api('POST', `/ai/agents/${agent.id}/dream/changes/${change.id}/apply`);
const items = async () =>
  (await api('GET', `/ai/agents/${agent.id}`)).json.documents.map((d) => d.name);
check(
  applied.json?.status === 'applied' && (await items()).includes('Learned from the team'),
  'Apply adds the Business context item',
);
const undone = await api('POST', `/ai/agents/${agent.id}/dream/changes/${change.id}/undo`);
check(
  undone.json?.status === 'undone' && !(await items()).includes('Learned from the team'),
  'Undo removes it again',
);

finish();
