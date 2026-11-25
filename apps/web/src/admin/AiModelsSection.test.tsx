import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiTaskModelsStatus, AiTaskModelState } from '@ezychat/shared';
import { AiModelsSection } from './AiModelsSection';

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
const row = (over: Partial<AiTaskModelState> = {}): AiTaskModelState => ({
  choice: 'fast',
  thinking: null,
  model: 'gpt-6-luna',
  effectiveThinking: 'low',
  unavailable: null,
  isDefault: true,
  ...over,
});
const chatgpt = (): AiTaskModelsStatus => ({
  mode: 'chatgpt',
  mainModel: 'gpt-6.1-sol',
  fastModel: 'gpt-6-luna',
  models: [
    { id: 'gpt-6.1-sol', thinking: true, tier: 'smart' },
    { id: 'gpt-6-luna', thinking: true, tier: 'fast' },
  ],
  tasks: {
    agentReplies: row({ choice: 'main', model: 'gpt-6.1-sol', effectiveThinking: 'medium' }),
    askEzy: row(),
    translate: row(),
    writing: row(),
    background: row(),
  },
  defaults: {
    agentReplies: { choice: 'main' },
    askEzy: { choice: 'fast' },
    translate: { choice: 'fast' },
    writing: { choice: 'fast' },
    background: { choice: 'fast' },
  },
});

let status: AiTaskModelsStatus;
let client: QueryClient;
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  expect(url).toBe('/api/ai/task-models');
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as {
      tasks: Record<string, { choice: string; thinking?: string } | null>;
    };
    for (const [task, value] of Object.entries(body.tasks)) {
      const key = task as keyof AiTaskModelsStatus['tasks'];
      status.tasks[key] = value
        ? row({
            choice: value.choice,
            thinking: (value.thinking as AiTaskModelState['thinking']) ?? null,
            model: value.choice === 'main' ? status.mainModel : value.choice,
            effectiveThinking: (value.thinking as AiTaskModelState['thinking']) ?? 'low',
            isDefault: false,
          })
        : row();
    }
  }
  return json(status);
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
  status = chatgpt();
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
      <AiModelsSection />
    </QueryClientProvider>,
  );
const puts = () => fetcher.mock.calls.filter((c) => c[1]?.method === 'PUT');

it('shows five rows with their defaults and the connection line', async () => {
  setup();
  expect(await screen.findByTestId('ai-models-connection')).toBeTruthy();
  expect(
    screen.getByText(/ChatGPT sign-in · main model gpt-6.1-sol · fast model gpt-6-luna/),
  ).toBeTruthy();
  for (const title of [
    'AI agent replies',
    'Ask Ezy',
    'Translate',
    'Writing help',
    'Background checks',
  ])
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  const agent = within(screen.getByTestId('ai-models-agentReplies'));
  expect(agent.getByRole('combobox').textContent).toContain(
    'Main model (recommended) · gpt-6.1-sol',
  );
  expect(agent.getByRole('radio', { name: 'Balanced' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText(/Edit with AI/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Use default' })).toBeNull();
});

it('saves a model and Speed and quality for one row only on Save, then returns it to the default', async () => {
  setup();
  const user = userEvent.setup();
  const writing = within(await screen.findByTestId('ai-models-writing'));
  await user.click(writing.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: /gpt-6.1-sol · smarter/ }));
  expect(screen.getByText(/may not appear in time/)).toBeTruthy();
  await user.click(writing.getByRole('radio', { name: 'Smarter' }));
  expect(puts()).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({
    tasks: { writing: { choice: 'gpt-6.1-sol', thinking: 'high' } },
  });
  await user.click(await screen.findByTestId('ai-models-writing-default'));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(2));
  expect(JSON.parse(String(puts()[1]![1]!.body))).toEqual({ tasks: { writing: null } });
});

it('warns about a saved model the connection no longer offers', async () => {
  status.tasks.translate = row({
    choice: 'gpt-5.6-terra',
    unavailable: 'gpt-5.6-terra',
    isDefault: false,
  });
  setup();
  expect(
    await screen.findByText(
      'gpt-5.6-terra is no longer offered by your AI connection. EzyChat uses Fast (gpt-6-luna) until you choose another model.',
    ),
  ).toBeTruthy();
});

it('shows no Speed and quality for a model without a level (Claude)', async () => {
  status = {
    ...chatgpt(),
    mode: 'claude',
    mainModel: 'claude-sonnet-5-5',
    fastModel: 'claude-haiku-5-5',
    models: [
      { id: 'claude-sonnet-5-5', thinking: false, tier: 'balanced' },
      { id: 'claude-haiku-5-5', thinking: false, tier: 'fast' },
    ],
  };
  setup();
  expect(await screen.findByText(/Claude API key/)).toBeTruthy();
  expect(screen.queryByText('Speed and quality')).toBeNull();
});

it('drops the level when the new model has none', async () => {
  status.models.push({ id: 'gpt-x', thinking: false, tier: null });
  status.tasks.askEzy = row({
    choice: 'fast',
    thinking: 'high',
    effectiveThinking: 'high',
    isDefault: false,
  });
  setup();
  const user = userEvent.setup();
  const askEzy = within(await screen.findByTestId('ai-models-askEzy'));
  await user.click(askEzy.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: 'gpt-x' }));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({
    tasks: { askEzy: { choice: 'gpt-x' } },
  });
});

it('on a row whose model is gone, a new level saves the model the row runs on', async () => {
  status.tasks.translate = row({
    choice: 'gpt-5.6-terra',
    thinking: 'low',
    unavailable: 'gpt-5.6-terra',
    isDefault: false,
  });
  setup();
  const user = userEvent.setup();
  const translate = within(await screen.findByTestId('ai-models-translate'));
  await user.click(translate.getByRole('radio', { name: 'Smarter' }));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({
    tasks: { translate: { choice: 'fast', thinking: 'high' } },
  });
});

it('after Use default, a picked model starts from the default level', async () => {
  status.tasks.writing = row({
    choice: 'gpt-6.1-sol',
    thinking: 'high',
    model: 'gpt-6.1-sol',
    effectiveThinking: 'high',
    isDefault: false,
  });
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('ai-models-writing-default'));
  const writing = within(screen.getByTestId('ai-models-writing'));
  await user.click(writing.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: /gpt-6.1-sol · smarter/ }));
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({
    tasks: { writing: { choice: 'gpt-6.1-sol' } },
  });
});

it('drops unsaved edits when the AI connection changes', async () => {
  setup();
  const user = userEvent.setup();
  const writing = within(await screen.findByTestId('ai-models-writing'));
  await user.click(writing.getByRole('radio', { name: 'Smarter' }));
  expect(screen.getByRole('button', { name: 'Save settings' }).hasAttribute('disabled')).toBe(
    false,
  );
  status = {
    ...chatgpt(),
    mode: 'claude',
    mainModel: 'claude-sonnet-5-5',
    fastModel: 'claude-haiku-5-5',
    models: [{ id: 'claude-haiku-5-5', thinking: false, tier: 'fast' }],
  };
  await client.invalidateQueries();
  await screen.findByText(/Claude API key/);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save settings' }).hasAttribute('disabled')).toBe(
      true,
    ),
  );
});

it('picking the row default again from the list saves it as the default (null), not as a row', async () => {
  status.tasks.writing = {
    ...status.tasks.writing,
    choice: 'gpt-6.1-sol',
    model: 'gpt-6.1-sol',
    isDefault: false,
  };
  setup();
  const user = userEvent.setup();
  const writing = within(await screen.findByTestId('ai-models-writing'));
  await user.click(writing.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: /^Fast \(recommended\)/ }));
  expect(writing.queryByTestId('ai-models-writing-default')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({ tasks: { writing: null } });
});

it('shows a saved model the built-in list misses (account list not read yet) with its level', async () => {
  status.tasks.translate = {
    ...status.tasks.translate,
    choice: 'gpt-7-live',
    thinking: 'high',
    model: 'gpt-7-live',
    effectiveThinking: 'high',
    isDefault: false,
  };
  setup();
  const translate = within(await screen.findByTestId('ai-models-translate'));
  expect(translate.getByRole('combobox').textContent).toContain('gpt-7-live');
  expect(translate.getByRole('radio', { name: 'Smarter' }).getAttribute('aria-checked')).toBe(
    'true',
  );
});
