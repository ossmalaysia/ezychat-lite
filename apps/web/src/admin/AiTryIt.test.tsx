import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiTryResult } from '@ezychat/shared';
import { AiTryIt } from './AiTryIt';

const draft = { displayName: 'Clinic Helper', instructions: 'Answer politely.', handoffRules: '' };
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}
const answer = (patch: Partial<AiTryResult> = {}): AiTryResult => ({
  ok: true,
  reply: 'We open at 9am.',
  action: 'answer',
  handoffReason: null,
  model: 'gpt-6.1-sol',
  error: null,
  ...patch,
});
function setup(props: Partial<Parameters<typeof AiTryIt>[0]> = {}, result: AiTryResult = answer()) {
  const fetchMock = vi.fn(async () => json(result));
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AiTryIt draft={draft} {...props} />
    </QueryClientProvider>,
  );
  return { fetchMock };
}
const ask = async (question = 'When do you open?') => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Customer question'), question);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Try it', () => {
  it("asks the agent's own route with its id and the unsaved draft", async () => {
    const { fetchMock } = setup({ agentId: 5 });
    expect(screen.getByText(/The answer uses this page's texts/)).toBeTruthy();
    await ask();
    await screen.findByText('We open at 9am.');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ai/agents/5/try');
    expect(JSON.parse(String(init.body))).toEqual({
      question: 'When do you open?',
      knowledge: draft,
      agentId: 5,
    });
    expect(screen.getByText('Answered as Clinic Helper')).toBeTruthy();
    expect(screen.getByText('Model: gpt-6.1-sol')).toBeTruthy();
  });

  it('uses the old route without an agent', async () => {
    const { fetchMock } = setup();
    await ask();
    await screen.findByText('We open at 9am.');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/ai/try');
  });

  it('says a reply that quoted an Internal item would be held back', async () => {
    setup(
      { agentId: 5 },
      answer({
        action: 'handoff',
        handoffReason: 'confidential_leak',
        reply: 'A team member will help you shortly.',
      }),
    );
    await ask('What is your lowest price?');
    expect(await screen.findByText('Would hand off')).toBeTruthy();
    expect(screen.getByText(/the reply quoted an Internal item/)).toBeTruthy();
    expect(screen.queryByText(/^Reason:/)).toBeNull();
  });

  it('notes a blank role', () => {
    setup({ agentId: 5, draft: { ...draft, instructions: '  ' } });
    expect(screen.getByText(/The role is blank/)).toBeTruthy();
  });

  it('asks to connect the AI first and keeps Ask disabled', async () => {
    const { fetchMock } = setup({ agentId: 5, ready: false });
    expect(screen.getByText('Connect AI under Settings → AI to try the agent.')).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Customer question'), 'Hi{Enter}');
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists look-ups: calendar checks, a booking Try it did not make, and other tools', async () => {
    const start = new Date(2026, 9, 30, 19, 30).toISOString();
    const end = new Date(2026, 9, 30, 21, 0).toISOString();
    const lookup = { tool: 'calendar', source: 'core', ms: 5, sourceLabel: 'Google Calendar' };
    setup(
      { agentId: 5 },
      answer({
        lookups: [
          { ...lookup, title: 'Check free times', ok: true, calendar: { action: 'checked' } },
          {
            ...lookup,
            title: 'Book',
            ok: true,
            notRun: true,
            calendar: { action: 'booked', start, end },
          },
          { ...lookup, title: 'Book', ok: true, notRun: true, calendar: { action: 'booked' } },
          { ...lookup, title: 'Add a lead', sourceLabel: 'CRM', ok: true, notRun: true },
          { ...lookup, title: 'Order status', sourceLabel: 'Shop', ok: true },
          { ...lookup, title: 'Order status', sourceLabel: 'Shop', ok: false },
        ],
      }),
    );
    await ask();
    const items = (
      await screen.findByRole('list', { name: 'What the AI looked up' })
    ).querySelectorAll('li');
    const lines = [...items].map((li) => li.textContent);
    expect(lines[0]).toBe('AI checked free times · Google Calendar');
    expect(lines[1]).toMatch(
      /^AI would book Fri,? 30 Oct, 19:30–21:00 · Google Calendar \(Try it doesn't book\)$/,
    );
    expect(lines.slice(2)).toEqual([
      "AI would book the chosen time · Google Calendar (Try it doesn't book)",
      "AI would use Add a lead · CRM (Try it doesn't change data)",
      'AI looked up Order status · Shop',
      'Could not look up Order status · Shop',
    ]);
  });
});
