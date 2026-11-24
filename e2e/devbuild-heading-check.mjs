// Dev Build check for L-30 (docs/DEBT.md): an AI reply with a Markdown heading on one very long line is
// formatted for WhatsApp quickly (the old heading pattern took seconds to minutes and blocked the server).
// Against e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data):
//   npx tsx --conditions=ezychat-source e2e/agents-devbuild.ts --fake-wa --port 7491
//   node e2e/devbuild-heading-check.mjs 7491
// The mock model repeats a scheduled task's instruction (and, for "LEAK", the Internal items) as its reply,
// and every reply passes through toWhatsAppText. Prints PASS/FAIL per step; never calls a model or WhatsApp.
import { devbuildClient } from './devbuild-client.mjs';

const STAFF = '120363088800002@g.us';
const client = await devbuildClient(Number(process.argv[2] ?? 7491));
const { api, check, finish } = client;

await client.signInAdmin();
await api('PUT', '/ai', {
  displayName: 'Aina',
  enabled: false,
  instructions: '',
  handoffRules: '',
});
await api('POST', '/ai/documents/text', { name: 'Menu', text: 'MARK-KOPI Kopi O RM2.50' });
// An Internal item of 9,000 characters whose second line is a heading with the blanks in the middle.
const internal = `Supplier code KOPI-SECRET-2026 is for staff only\n# a${' '.repeat(8_900)}b`;
await api('POST', '/ai/documents/text', { name: 'Internal', text: internal, internal: true });
const agent = (await api('GET', '/ai')).json.agents[0];
const on = await api('PUT', `/ai/agents/${agent.id}`, {
  displayName: 'Aina',
  enabled: true,
  instructions: '',
  handoffRules: '',
});
check(on.status === 200, 'the agent turns on', on.status);
await api('POST', '/dev/fake-group', { groupJid: STAFF, name: 'Kopi Staff', generated: 2 });

const base = `/ai/agents/${agent.id}/scheduled-tasks`;
const timed = async (body) => {
  const started = performance.now();
  const res = await api('POST', `${base}/preview`, body);
  return { res, ms: Math.round(performance.now() - started) };
};

// The longest instruction (1,000 characters): a heading line of 980 blanks between two words.
const blanks = ' '.repeat(980);
const heading = await timed({ chatJid: STAFF, instruction: `Specials\n# Kopi${blanks}today` });
const text = heading.res.json?.text ?? '';
check(
  heading.res.status === 200 && heading.res.json.result === 'sent',
  'the preview answers',
  heading.res.status,
);
check(
  text.includes(`\nKopi${blanks}today`) && !text.includes('# Kopi'),
  'the heading mark is removed and the line keeps its words',
  JSON.stringify(text.slice(0, 40)),
);
check(heading.ms < 2_000, 'the 1,000-character heading is formatted quickly', `${heading.ms} ms`);

// The mock repeats the 9,000-character Internal items: formatted first, then the leak check stops it.
const leak = await timed({ chatJid: STAFF, instruction: 'LEAK it' });
check(
  leak.res.json?.reason === 'confidential_leak',
  'the Internal item is never sent',
  leak.res.json?.reason,
);
check(leak.ms < 2_000, 'a 9,000-character heading line is formatted quickly', `${leak.ms} ms`);

const health = await api('GET', '/health');
check(health.status === 200, 'the server still answers afterwards', health.status);
finish();
