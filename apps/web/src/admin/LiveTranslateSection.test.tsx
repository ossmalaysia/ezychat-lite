import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveTranslateSection } from './LiveTranslateSection';

type Status = {
  enabled: boolean;
  dailyLimit: number;
  connected: boolean;
  usedToday: number;
  peopleToday?: number;
  translationsToday?: number;
};
let status: Status;
const puts: unknown[] = [];
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    expect(url).toBe('/api/live-translate/settings');
    const body = JSON.parse(String(init.body)) as Partial<Status>;
    puts.push(body);
    status = { ...status, ...body };
  } else expect(url).toBe('/api/live-translate');
  return json(status);
});

beforeEach(() => {
  status = {
    enabled: true,
    dailyLimit: 200,
    connected: true,
    usedToday: 0,
    peopleToday: 3,
    translationsToday: 41,
  };
  puts.length = 0;
  fetcher.mockClear();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LiveTranslateSection />
    </QueryClientProvider>,
  );

it("is on for everyone by default, with a daily limit of 200, and shows today's use", async () => {
  setup();
  const toggle = await screen.findByRole('switch', { name: 'Live translate for everyone' });
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect((screen.getByLabelText('Daily limit per person') as HTMLInputElement).value).toBe('200');
  expect(screen.getByTestId('live-translate-usage').textContent).toBe(
    'Today: 41 translations by 3 people',
  );
  expect(screen.getByText(/never the text/)).toBeTruthy();
});

it('saves the limit only on Save, as a number', async () => {
  setup();
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Daily limit per person');
  await user.clear(input);
  await user.type(input, '0');
  expect(puts).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts).toEqual([{ enabled: true, dailyLimit: 0 }]));
});

it('turns it off for everyone, and hides the limit', async () => {
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('switch', { name: 'Live translate for everyone' }));
  expect(screen.queryByLabelText('Daily limit per person')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts).toEqual([{ enabled: false, dailyLimit: 200 }]));
});

it('refuses a limit that is not a number', async () => {
  setup();
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Daily limit per person');
  await user.clear(input);
  await user.type(input, 'abc');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(
    (screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('says AI must be connected first when it is not', async () => {
  status.connected = false;
  setup();
  expect(await screen.findByText(/Connect AI above first/)).toBeTruthy();
});
