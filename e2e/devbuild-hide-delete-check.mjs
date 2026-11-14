// Dev Build check for Delete chat and hiding chats on Log out (docs/features/chat-hide-delete/design.md)
// against e2e/agents-devbuild.ts (fake WhatsApp, temp data). Usage: node e2e/devbuild-hide-delete-check.mjs <port>
// The fake phone keeps one number, so "a different number" is covered by unit tests only.
import { apiClient, checker, poll } from './devbuild-client.mjs';

const PORT = Number(process.argv[2] ?? 7491);
const BASE = 'http://127.0.0.1:' + PORT;
const { check, finish } = checker();
const api = apiClient(BASE);

const health = await fetch(BASE + '/api/health');
if (health.headers.get('x-agents-devbuild') !== 'mock-ai')
  throw new Error('Run this only against e2e/agents-devbuild.ts (fake WhatsApp, temp data)');

const admin = { username: 'checker', displayName: 'Checker', password: 'check-pass-123' };
if ((await api('GET', '/setup/status')).json.needsSetup) await api('POST', '/setup/admin', admin);
check(
  (await api('POST', '/auth/login', { username: admin.username, password: admin.password }))
    .status === 200,
  'admin signs in',
);

const enc = encodeURIComponent;
const customer = (jid, text, senderName) =>
  api('POST', '/dev/fake-incoming', { chatJid: jid, text, senderName });
const listed = async () => ((await api('GET', '/chats')).json?.chats ?? []).map((c) => c.jid);
const messages = async (jid) =>
  (await api('GET', `/chats/${enc(jid)}/messages`)).json?.messages ?? [];

const a = '60120000021@s.whatsapp.net';
const b = '60120000022@s.whatsapp.net';
await customer(a, 'Hi, I want a quote', 'Aisyah');
await customer(b, 'Do you deliver to Penang?', 'Lim');
await customer(b, 'Second question', 'Lim');
await poll(async () => (await listed()).length >= 2, 15_000);
check((await listed()).includes(a) && (await listed()).includes(b), 'two customer chats exist');

// 1. Delete chat
const preview = await api('GET', `/chats/${enc(a)}/delete-preview`);
check(
  preview.status === 200 && preview.json.messages === 1,
  'the delete preview counts 1 message',
  preview.json,
);
const del = await api('DELETE', `/chats/${enc(a)}`);
check(del.status === 204, 'DELETE answers 204', del.status);
check(!(await listed()).includes(a), 'the deleted chat leaves the list');
check((await api('GET', `/chats/${enc(a)}`)).status === 404, 'the deleted chat answers 404');
await customer(a, 'Hello again', 'Aisyah');
await poll(async () => (await listed()).includes(a), 15_000);
const fresh = await messages(a);
check(
  fresh.length === 1 && fresh[0].body === 'Hello again',
  'a new message starts a new empty chat (old messages gone)',
  fresh.map((m) => m.body),
);

// 2. Hide on Log out
const logout = await api('POST', '/wa/logout');
check(logout.status === 200, 'Log out answers 200', logout.status);
await poll(async () => (await listed()).length === 0, 15_000);
check((await listed()).length === 0, 'after Log out the inbox shows no chats');
const info = (await api('GET', '/inboxes/1/hidden-chats')).json;
check(info?.hidden === 2 && info?.visible === 0, 'the hidden count is 2', info);
check((await api('GET', `/chats/${enc(b)}`)).status === 404, 'a hidden chat answers 404');

// 3. Same number links again: only a chat WhatsApp reports comes back, with its history
const link = await api('POST', '/dev/fake-link', { inboxId: 1 });
check(link.status === 200, 'the fake phone links again with the same number', link.json);
check((await listed()).length === 0, 'nothing comes back before WhatsApp reports a chat');
await customer(b, 'Third question', 'Lim');
await poll(async () => (await listed()).includes(b), 15_000);
const back = await messages(b);
check(back.length === 3, 'the reported chat is back with its history (3 messages)', back.length);
check(!(await listed()).includes(a), 'a chat WhatsApp did not report stays hidden');
const after = (await api('GET', '/inboxes/1/hidden-chats')).json;
check(after?.hidden === 1 && after?.visible === 1, 'one hidden, one shown', after);

finish();
