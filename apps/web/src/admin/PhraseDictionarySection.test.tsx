import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhraseDictionarySection } from './PhraseDictionarySection';

type Phrase = {
  id: number;
  text: string;
  language: 'en' | 'ms' | 'zh';
  source: 'context' | 'team' | 'admin';
  uses: number;
  fact: boolean;
};
let client: QueryClient;
let phrases: Phrase[];
let state: 'ready' | 'empty' | 'building' | 'error';
let suggestState: 'on' | 'off';
let agents: { id: number; displayName: string }[];
const calls: { method: string; url: string; body?: unknown }[] = [];
const json = (body: unknown, code = 200) =>
  new Response(code === 204 ? null : JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const status = () => ({
  state,
  count: phrases.length,
  languages: (['en', 'ms', 'zh'] as const)
    .map((language) => ({ language, count: phrases.filter((p) => p.language === language).length }))
    .filter((l) => l.count > 0),
  updatedAt: state === 'empty' ? null : Date.now() - 12 * 60_000,
  trigger: state === 'empty' ? null : 'replies',
  newReplies: 18,
  nextAfterReplies: 30,
  aiCallsToday: 4,
  aiCallsLimit: 24,
});
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  if (url === '/api/reply-suggestions')
    return json({
      enabled: suggestState === 'on',
      connected: true,
      state: suggestState,
      upgraded: false,
    });
  if (url === '/api/ai/agents')
    return json({
      agents: agents.map((a) => ({
        ...a,
        userId: a.id + 10,
        enabled: true,
        preset: 'sales',
        inboxId: a.id,
        documentCount: 1,
      })),
      maxAgents: agents.length,
    });
  if (url.startsWith('/api/ai/phrases') && method === 'GET')
    return json({ agentId: agents[0]!.id, status: status(), phrases });
  if (url === '/api/ai/phrases/rebuild') {
    state = 'building';
    return json(status());
  }
  if (url === '/api/ai/phrases' && method === 'POST') {
    const added = { id: 99, source: 'admin', uses: 0, fact: /\d/.test(body.text), ...body };
    phrases = [...phrases, added];
    return json(added);
  }
  const id = Number(url.split('/').at(-1));
  if (method === 'PUT') {
    phrases = phrases.map((p) => (p.id === id ? { ...p, ...body, source: 'admin' } : p));
    return json(phrases.find((p) => p.id === id));
  }
  if (method === 'DELETE') {
    phrases = phrases.filter((p) => p.id !== id);
    return json(null, 204);
  }
  throw new Error(`unexpected ${method} ${url}`);
});

beforeAll(() => {
  // Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  phrases = [
    {
      id: 1,
      text: 'Thank you for your message!',
      language: 'en',
      source: 'team',
      uses: 41,
      fact: false,
    },
    {
      id: 2,
      text: 'Our opening hours are 8am to 10pm daily.',
      language: 'en',
      source: 'context',
      uses: 18,
      fact: true,
    },
    {
      id: 3,
      text: 'Terima kasih atas mesej anda!',
      language: 'ms',
      source: 'team',
      uses: 22,
      fact: false,
    },
  ];
  state = 'ready';
  suggestState = 'on';
  agents = [{ id: 1, displayName: 'Aina' }];
  calls.length = 0;
  fetcher.mockClear();
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
const setup = () =>
  render(
    <QueryClientProvider client={client}>
      <PhraseDictionarySection />
    </QueryClientProvider>,
  );

it('shows the count per language, the last and next update, and the AI calls today', async () => {
  setup();
  expect(await screen.findByText('Phrases: 3')).toBeTruthy();
  expect(screen.getByText('English · 2')).toBeTruthy();
  expect(screen.getByText('Bahasa Melayu · 1')).toBeTruthy();
  expect(screen.getByText(/Updated 12 minutes ago after new team replies\./)).toBeTruthy();
  expect(screen.getByText(/Next update after 12 more team replies/)).toBeTruthy();
  expect(screen.getByText('AI calls for the list today: 4 of at most 24.')).toBeTruthy();
  // One agent: no agent choice.
  expect(screen.queryByRole('combobox', { name: 'AI agent' })).toBeNull();
});

it('rebuilds now and shows building; says the list does not update while suggestions are off', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: 'Rebuild now' }));
  expect(await screen.findByText(/Building the phrase list/)).toBeTruthy();
  expect(calls.find((c) => c.url === '/api/ai/phrases/rebuild')?.body).toEqual({ agentId: 1 });
  cleanup();
  client.clear();
  suggestState = 'off';
  state = 'ready';
  setup();
  expect(await screen.findByText(/Reply suggestions are off/)).toBeTruthy();
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Rebuild now' }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
});

it('shows the empty and error states', async () => {
  phrases = [];
  state = 'empty';
  setup();
  expect(await screen.findByText(/No phrase list yet/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Build now' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'View phrases' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  cleanup();
  client.clear();
  state = 'error';
  setup();
  expect(await screen.findByText(/could not be built/)).toBeTruthy();
});

it('lists, filters, searches, adds, edits and deletes phrases', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: 'View phrases' }));
  const dialog = await screen.findByTestId('phrase-list');
  expect(within(dialog).getAllByTestId('phrase-row')).toHaveLength(3);
  expect(within(dialog).getByText('Used 41 times')).toBeTruthy();
  expect(within(dialog).getByText('Fact checked against the business context')).toBeTruthy();
  await user.click(within(dialog).getByRole('radio', { name: 'Bahasa Melayu' }));
  expect(
    within(dialog)
      .getAllByTestId('phrase-row')
      .map((r) => r.textContent),
  ).toEqual([expect.stringContaining('Terima kasih')]);
  await user.click(within(dialog).getByRole('radio', { name: 'All' }));
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search phrases' }), 'opening');
  expect(within(dialog).getAllByTestId('phrase-row')).toHaveLength(1);
  await user.clear(within(dialog).getByRole('searchbox', { name: 'Search phrases' }));

  await user.click(within(dialog).getByRole('button', { name: 'Add phrase' }));
  const editor = within(dialog).getByTestId('phrase-editor');
  await user.type(
    within(editor).getByRole('textbox', { name: 'Add phrase' }),
    'We close on the first Monday.',
  );
  await user.click(within(editor).getByRole('button', { name: 'Save phrase' }));
  await waitFor(() =>
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/ai/phrases')).toBe(true),
  );
  expect(calls.find((c) => c.url === '/api/ai/phrases' && c.method === 'POST')?.body).toEqual({
    text: 'We close on the first Monday.',
    language: 'en',
    agentId: 1,
  });

  await user.click(within(dialog).getAllByRole('button', { name: 'Edit phrase' })[0]!);
  const box = within(dialog).getByRole('textbox', { name: 'Edit phrase' });
  await user.clear(box);
  await user.type(box, 'Thanks a lot for your message!');
  await user.click(within(dialog).getByRole('button', { name: 'Save phrase' }));
  await waitFor(() => expect(phrases[0]!.text).toBe('Thanks a lot for your message!'));

  await user.click(within(dialog).getAllByRole('button', { name: 'Delete phrase' })[0]!);
  await waitFor(() => expect(phrases.some((p) => p.id === 1)).toBe(false));
});

it('picks the agent when there are several', async () => {
  agents = [
    { id: 1, displayName: 'Aina' },
    { id: 2, displayName: 'Ben' },
  ];
  const user = userEvent.setup();
  setup();
  const picker = await screen.findByRole('combobox', { name: 'AI agent' });
  await user.click(picker);
  await user.click(await screen.findByRole('option', { name: 'Ben' }));
  await waitFor(() => expect(calls.some((c) => c.url === '/api/ai/phrases?agentId=2')).toBe(true));
});
