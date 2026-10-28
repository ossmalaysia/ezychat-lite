import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FixEnglishStatus, TeamWord } from '@ezychat/shared';
import { loadSpeller } from '@/lib/dictionary';
import { FixEnglishSection } from './FixEnglishSection';

vi.mock('@/lib/dictionary', () => ({ loadSpeller: vi.fn() }));
const here = dirname(fileURLToPath(import.meta.url));
const dictionary = join(here, '../../public/dictionaries/en-GB');
const speller = nspell(
  readFileSync(join(dictionary, 'index.aff')),
  readFileSync(join(dictionary, 'index.dic')),
);

let client: QueryClient;
let status: FixEnglishStatus;
let words: TeamWord[];
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const list = () => json({ words, businessWords: ['nasi', 'lemak', 'menu', 'kopi', 'teow'] });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/fix-english') return json(status);
  if (url === '/api/ai/fix-english') {
    const { enabled } = JSON.parse(String(init!.body)) as { enabled: boolean };
    status = {
      ...status,
      enabled,
      spelling: enabled ? 'on' : 'off',
      grammar: !enabled ? 'off' : status.connected ? 'on' : 'none',
    };
    return json(status);
  }
  if (url === '/api/fix-english/words' && init?.method === 'POST') {
    const { word } = JSON.parse(String(init.body)) as { word: string };
    if (/\d/.test(word))
      return json({ error: { code: 'validation', message: 'Use letters only' } }, 400);
    words = [...words, { word, addedBy: 'Aisyah', createdAt: 1 }];
    return list();
  }
  if (url.startsWith('/api/fix-english/words/') && init?.method === 'DELETE') {
    const word = decodeURIComponent(url.split('/').pop()!);
    words = words.filter((w) => w.word !== word);
    return list();
  }
  if (url === '/api/fix-english/words') return list();
  throw new Error(`unexpected ${url}`);
});

beforeEach(() => {
  status = { enabled: true, connected: true, spelling: 'on', grammar: 'on', upgraded: false };
  words = [{ word: 'kopitiam', addedBy: 'Mei Ling', createdAt: 1 }];
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
  vi.mocked(loadSpeller).mockResolvedValue(speller);
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
      <FixEnglishSection />
    </QueryClientProvider>,
  );

it('saves the team switch', async () => {
  show();
  const toggle = await screen.findByRole('switch', { name: 'Check English for the team' });
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(status.enabled).toBe(false));
});

it('notes an update that started off, and spelling only without AI', async () => {
  status = { enabled: false, connected: false, spelling: 'off', grammar: 'off', upgraded: true };
  show();
  expect(await screen.findByText(/off after the update/)).toBeTruthy();
  await userEvent.click(screen.getByRole('switch', { name: 'Check English for the team' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText(/only spelling is checked/)).toBeTruthy();
});

it('lists, adds and removes team words, and shows the Business context words the dictionary lacks', async () => {
  show();
  const section = await screen.findByTestId('team-words');
  expect(await within(section).findByText('kopitiam')).toBeTruthy();
  expect(within(section).getByText(/added by Mei Ling/)).toBeTruthy();
  await userEvent.type(within(section).getByRole('textbox', { name: 'New team word' }), 'cendol');
  await userEvent.click(within(section).getByRole('button', { name: 'Add word' }));
  expect(await within(section).findByText('cendol')).toBeTruthy();
  await userEvent.click(within(section).getByRole('button', { name: 'Remove kopitiam' }));
  await waitFor(() => expect(within(section).queryByText('kopitiam')).toBeNull());
  // "menu" is in the dictionary; kopi, nasi and lemak are built-in Malaysian words.
  const business = await within(section).findByTestId('business-words');
  expect(business.textContent).toContain('1 word from your Business context');
  expect(business.textContent).toContain('teow');
  expect(business.textContent).not.toContain('menu');
});

it('shows why a word was refused', async () => {
  show();
  const section = await screen.findByTestId('team-words');
  await userEvent.type(within(section).getByRole('textbox', { name: 'New team word' }), 'RM12');
  await userEvent.click(within(section).getByRole('button', { name: 'Add word' }));
  expect(await within(section).findByText('Use letters only')).toBeTruthy();
});
