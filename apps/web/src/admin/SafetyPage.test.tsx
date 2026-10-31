import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SafetyItemView, SafetyState } from '@ezychat/shared';
import { SafetyPage } from './SafetyPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item = (over: Partial<SafetyItemView> = {}): SafetyItemView => ({
  id: 1,
  messageId: 'M1',
  chatJid: '601123456789@s.whatsapp.net',
  inboxId: 1,
  senderName: 'Accounts Dept',
  phone: '601123456789',
  group: false,
  at: Date.UTC(2026, 9, 31, 8),
  text: 'Please forward this statement of account.',
  file: { name: 'Statement.zip', inside: ['Statement.pdf.vbs'] },
  rules: ['exeInZip', 'financeUrgency'],
  score: 20,
  ruleLevel: 'high',
  critical: true,
  ai: {
    level: 'high',
    category: 'malware_lure',
    reason: 'A fake statement that installs malware.',
  },
  level: 'high',
  status: 'open',
  existingCustomer: false,
  quarantined: true,
  released: false,
  deleted: null,
  autoBlocked: false,
  scam: false,
  blocked: false,
  canBlock: true,
  downloads: [
    { name: 'Daniel', at: Date.UTC(2026, 9, 31, 8, 5), allowed: false },
    { name: 'Aisyah', at: Date.UTC(2026, 9, 31, 8, 6), allowed: true },
  ],
  ...over,
});

let state: SafetyState;
let calls: Array<{ url: string; method: string; body: unknown }>;
let client: QueryClient;
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  if (url === '/api/safety') return json(state);
  if (url === '/api/inboxes')
    return json({
      inboxes: [
        {
          id: 1,
          name: 'Kopi Apong',
          capabilities: {
            qrLink: true,
            history: true,
            groups: true,
            replyWindowHours: null,
            templates: false,
            needsPublicUrl: false,
          },
        },
      ],
      maxInboxes: 1,
    });
  if (url === '/api/safety/settings') {
    state = { ...state, settings: { ...state.settings, ...(body as object) } };
    return json(state.settings);
  }
  const m = /^\/api\/safety\/items\/(\d+)\/(\w+)$/.exec(url);
  if (m) {
    const action = m[2]!;
    state = {
      ...state,
      items: state.items.map((i) =>
        i.id === Number(m[1])
          ? {
              ...i,
              ...(action === 'safe' ? { status: 'safe' as const } : {}),
              ...(action === 'release' ? { released: true } : {}),
              ...(action === 'delete' ? { deleted: { by: 'Aisyah', at: 1 } } : {}),
              ...(action === 'report'
                ? {
                    scam: true,
                    status: (body as { block?: boolean }).block
                      ? ('blocked' as const)
                      : ('reported' as const),
                    blocked: !!(body as { block?: boolean }).block,
                  }
                : {}),
              ...(action === 'unblock' ? { blocked: false, status: 'reported' as const } : {}),
            }
          : i,
      ),
    };
    return json(state);
  }
  throw new Error(`unexpected ${method} ${url}`);
});

beforeEach(() => {
  calls = [];
  state = {
    settings: { enabled: true, ai: true, autoBlock: false, deleteAfterDays: 30 },
    aiReady: true,
    items: [
      item(),
      item({
        id: 2,
        messageId: 'M2',
        chatJid: '60129001234@s.whatsapp.net',
        senderName: 'Jason Lim',
        phone: '60129001234',
        existingCustomer: true,
        downloads: [],
        ai: null,
      }),
      item({
        id: 3,
        messageId: 'M3',
        senderName: 'Siti Rahman',
        file: null,
        text: 'Urgent: please confirm my payment',
        rules: ['financeUrgency'],
        level: 'none',
        status: 'cleared',
        quarantined: false,
        ai: { level: 'none', category: 'none', reason: '' },
        downloads: [],
      }),
    ],
    blocked: [
      {
        waJid: '601199@s.whatsapp.net',
        phone: '601199',
        name: 'Finance Dept',
        by: null,
        at: 5,
        auto: true,
        itemId: 9,
      },
    ],
  };
  vi.stubGlobal('fetch', fetcher);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

const show = () =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SafetyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

it('lists what needs review with the number, new or existing customer, reason and downloads', async () => {
  show();
  const rows = await screen.findAllByTestId('safety-row');
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain('Accounts Dept');
  expect(rows[0]!.textContent).toContain('+601123456789 · New number');
  expect(rows[0]!.textContent).toContain('The ZIP hides a program, not a document.');
  expect(rows[0]!.textContent).toContain('Downloaded by Aisyah');
  expect(rows[1]!.textContent).toContain('Customer may be hacked');
  const stats = screen.getByTestId('safety-stats').textContent;
  expect(stats).toContain('To review2');
  expect(stats).toContain('Files locked2');
  expect(stats).toContain('Numbers blocked1');
  await userEvent.click(screen.getByText('All', { exact: true }));
  expect(await screen.findByText('Siti Rahman')).toBeTruthy();
  expect(screen.getByText('Cleared by AI')).toBeTruthy();
});

it('opens the details and reports, blocks, unlocks and marks safe', async () => {
  show();
  await userEvent.click((await screen.findAllByTestId('safety-row'))[0]!);
  const sheet = await screen.findByTestId('safety-sheet');
  expect(sheet.textContent).toContain('Inside the ZIP: Statement.pdf.vbs');
  expect(sheet.textContent).toContain(
    'AI check: High risk. A fake statement that installs malware.',
  );
  expect(sheet.textContent).toContain('Daniel tried to download it (locked)');
  expect(sheet.textContent).toContain('Aisyah downloaded it');

  await userEvent.click(within(sheet).getByTestId('safety-report'));
  const dialog = await screen.findByTestId('safety-report-dialog');
  expect(dialog.textContent).toContain('On the linked phone: open this chat');
  expect(dialog.textContent).toContain('997');
  await userEvent.click(screen.getByRole('button', { name: 'Report' }));
  await waitFor(() =>
    expect(calls.find((c) => c.url === '/api/safety/items/1/report')?.body).toEqual({
      block: true,
    }),
  );

  await userEvent.click(await within(sheet).findByRole('button', { name: 'Unblock' }));
  await waitFor(() =>
    expect(calls.some((c) => c.url === '/api/safety/items/1/unblock')).toBe(true),
  );

  await userEvent.click(within(sheet).getByRole('button', { name: 'Unlock file for team' }));
  await waitFor(() =>
    expect(calls.some((c) => c.url === '/api/safety/items/1/release')).toBe(true),
  );

  await userEvent.click(within(sheet).getByRole('checkbox'));
  await userEvent.click(within(sheet).getByRole('button', { name: 'Mark safe' }));
  await waitFor(() =>
    expect(calls.find((c) => c.url === '/api/safety/items/1/safe')?.body).toEqual({ trust: true }),
  );
});

it('deletes a locked file after confirming, and shows a hacked customer note', async () => {
  show();
  await userEvent.click((await screen.findAllByTestId('safety-row'))[1]!);
  const sheet = await screen.findByTestId('safety-sheet');
  expect(sheet.textContent).toContain('Their WhatsApp may be hacked');
  expect(sheet.textContent).toContain('No AI check for this message.');
  expect(sheet.textContent).toContain('Nobody downloaded it.');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Delete file' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Delete file' }));
  await waitFor(() => expect(calls.some((c) => c.url === '/api/safety/items/2/delete')).toBe(true));
});

it('lists blocked numbers with Unblock', async () => {
  show();
  await userEvent.click(await screen.findByRole('tab', { name: 'Blocked' }));
  const list = await screen.findByTestId('safety-blocked');
  expect(list.textContent).toContain('Finance Dept');
  expect(list.textContent).toContain('+601199 · Auto-blocked');
  await userEvent.click(within(list).getByRole('button', { name: 'Unblock' }));
  await waitFor(() =>
    expect(calls.some((c) => c.url === '/api/safety/items/9/unblock')).toBe(true),
  );
});

it('saves the settings and says when no AI is connected', async () => {
  state = {
    ...state,
    aiReady: false,
    blocked: [],
    settings: { ...state.settings, enabled: false },
  };
  show();
  expect(await screen.findByText('WhatsApp Safety is off. Messages are not checked.')).toBeTruthy();
  await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
  expect(await screen.findByText(/Connect an AI/)).toBeTruthy();
  await userEvent.click(screen.getByTestId('safety-enabled'));
  await waitFor(() =>
    expect(calls.find((c) => c.url === '/api/safety/settings')?.body).toEqual({ enabled: true }),
  );
  await userEvent.click(await screen.findByTestId('safety-auto-block'));
  await waitFor(() =>
    expect(calls.filter((c) => c.url === '/api/safety/settings').at(-1)?.body).toEqual({
      autoBlock: true,
    }),
  );
});

it('shows empty states', async () => {
  state = { ...state, items: [], blocked: [] };
  show();
  expect(await screen.findByTestId('safety-empty')).toBeTruthy();
  await userEvent.click(screen.getByRole('tab', { name: 'Blocked' }));
  expect(await screen.findByTestId('safety-blocked-empty')).toBeTruthy();
});
