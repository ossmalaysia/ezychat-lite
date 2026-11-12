import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AskEzyAnswer, AskEzyBlock, AskEzyEvent } from '@ezychat/shared';
import { AskEzyProvider } from './AskEzyContext';
import { AskEzyPanel } from './AskEzyPanel';
import { AskEzyButton } from './AskEzyButton';

const auth = vi.hoisted(() => ({
  user: { id: 1, username: 'aisyah', displayName: 'Aisyah Rahman', role: 'admin' },
  isAdmin: true,
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= function () {};
  window.matchMedia ??= ((q: string) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

type Reply = { status?: number; events?: AskEzyEvent[]; json?: unknown };
let replies: Reply[];
const sent: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  replies = [];
  sent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/ask-ezy/status')
        return new Response(JSON.stringify({ connected: true }), {
          headers: { 'content-type': 'application/json' },
        });
      const next = replies.shift() ?? { events: [] };
      if (next.json !== undefined)
        return new Response(JSON.stringify(next.json), {
          status: next.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      return new Response((next.events ?? []).map((e) => JSON.stringify(e)).join('\n') + '\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (a: Partial<AskEzyAnswer>): AskEzyEvent => ({
  type: 'answer',
  answer: { text: 'Done.', blocks: [], steps: [], followUps: [], ...a },
});

async function start(question = 'Greet Jee Fong at 9am every day') {
  render(
    <MemoryRouter>
      <AskEzyProvider>
        <AskEzyButton />
        <AskEzyPanel />
      </AskEzyProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /ask ezy/i }));
  await user.type(await screen.findByRole('textbox'), `${question}{Enter}`);
  return user;
}

const agentCard: AskEzyBlock = {
  type: 'agent_proposal',
  id: 'agent-1',
  name: 'Morning greeter',
  preset: 'custom',
  inboxName: 'Anchor MY',
  note: 'Sends scheduled messages only.',
  status: 'proposed',
};
const taskCard: Extract<AskEzyBlock, { type: 'task_proposal' }> = {
  type: 'task_proposal',
  id: 'task-1',
  agent: 'Morning greeter',
  agentId: null,
  dependsOn: 'agent-1',
  name: 'Morning greeting',
  time: '09:00',
  dayRule: 'daily',
  days: [],
  chatName: 'Jee Fong',
  chatEnding: '0084',
  chatType: 'dm',
  instruction: 'Greet Jee Fong warmly.',
  timeZone: 'Asia/Kuala_Lumpur',
  preview: 'Good morning Jee Fong!',
  before: null,
  status: 'proposed',
};

describe('Ask Ezy setup', () => {
  it('sends a tapped choice as the next message, then marks it chosen', async () => {
    replies.push({
      events: [
        answer({
          text: 'I can do that with a scheduled task.',
          blocks: [
            {
              type: 'question',
              text: 'Should a new agent send it, or your Sales Agent?',
              choices: ['New agent', 'Sales Agent'],
            },
          ],
        }),
      ],
    });
    const user = await start();
    const question = await screen.findByTestId('ask-block-question');
    replies.push({ events: [answer({ text: 'Which Jee Fong?' })] });
    await user.click(within(question).getByRole('button', { name: 'New agent' }));
    await screen.findByText('Which Jee Fong?');
    const second = sent.filter((s) => s.url === '/api/ask-ezy')[1]!.body as {
      question: string;
      history: Array<{ role: string; text: string }>;
    };
    expect(second.question).toBe('New agent');
    // The server reads back what was asked, so the choice answers that question.
    expect(second.history.at(-1)!.text).toContain(
      '[Asked: Should a new agent send it, or your Sales Agent? Choices: New agent | Sales Agent]',
    );
    const chosen = within(question).getByRole('button', { name: 'New agent' });
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(chosen.hasAttribute('disabled')).toBe(true);
    expect(
      within(question).getByRole('button', { name: 'Sales Agent' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('prints a question once when the answer text repeats it', async () => {
    const text = 'Should a new agent send it, or your Sales Agent?';
    replies.push({
      events: [
        answer({
          text,
          blocks: [{ type: 'question', text, choices: ['New agent', 'Sales Agent'] }],
        }),
      ],
    });
    await start();
    await screen.findByTestId('ask-block-question');
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it('shows the Lite note and an error note above the question', async () => {
    replies.push({
      events: [
        answer({
          text: 'Your Sales Agent can send it instead.',
          blocks: [
            {
              type: 'question',
              text: 'Use Sales Agent?',
              choices: ['Use Sales Agent', 'Not now'],
              note: "EzyChat Lite has one AI agent, so I can't add a new one.",
              tone: 'warning',
            },
            {
              type: 'question',
              text: 'Which should I use?',
              choices: ['Another chat'],
              note: 'That group is on another number.',
              tone: 'error',
            },
          ],
        }),
      ],
    });
    await start();
    expect(
      await screen.findByText("EzyChat Lite has one AI agent, so I can't add a new one."),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('That group is on another number.');
  });

  it('applies a new agent and its task with one Apply both, then links to them', async () => {
    replies.push({
      events: [answer({ text: 'Here is the plan.', blocks: [agentCard, taskCard] })],
    });
    const user = await start();
    const agent = await screen.findByTestId('ask-block-agent-agent-1');
    expect(agent.textContent).toContain('New agent');
    expect(agent.textContent).toContain('Custom agent');
    expect(agent.textContent).toContain('Anchor MY');
    expect(agent.textContent).toContain('It starts switched off.');
    const task = screen.getByTestId('ask-block-task-task-1');
    expect(task.textContent).toContain('Morning greeter (new)');
    expect(task.textContent).toContain('Jee Fong (…0084)');
    expect(task.textContent).toContain('Asia/Kuala_Lumpur');
    expect(task.textContent).toContain('Preview (not sent)');
    expect(task.textContent).toContain('Good morning Jee Fong!');
    // One decision for both cards.
    expect(within(agent).queryByRole('button', { name: /^apply$/i })).toBeNull();
    expect(within(task).queryByRole('button', { name: /^apply$/i })).toBeNull();

    replies.push({
      json: {
        status: 'applied',
        related: [{ id: 'agent-1', status: 'applied' }],
        agentId: 7,
        taskId: 3,
        nextRunAt: Date.UTC(2026, 10, 13, 1, 0),
        agentOn: false,
      },
    });
    await user.click(screen.getByRole('button', { name: 'Apply both' }));
    await within(task).findByText('Saved. It sends once the agent is on.');
    expect(sent.at(-1)!.url).toBe('/api/ask-ezy/changes/task-1/apply');
    expect(agent.textContent).toContain('Created (switched off).');
    // The task card's Undo removes both: the agent card has none.
    expect(within(agent).queryByRole('button', { name: /undo/i })).toBeNull();
    expect(within(task).getByRole('link', { name: 'Open the agent' }).getAttribute('href')).toBe(
      '/admin/members/ai/7',
    );
    expect(
      within(task).getByRole('link', { name: 'Open scheduled tasks' }).getAttribute('href'),
    ).toBe('/admin/members/ai/7#scheduled-tasks');
    expect(screen.queryByRole('button', { name: 'Apply both' })).toBeNull();

    replies.push({
      json: { status: 'proposed', related: [{ id: 'agent-1', status: 'proposed' }] },
    });
    await user.click(within(task).getByRole('button', { name: /undo/i }));
    await screen.findByRole('button', { name: 'Apply both' });
    expect(sent.at(-1)!.url).toBe('/api/ask-ezy/changes/task-1/undo');
    expect(task.textContent).toContain('Morning greeter (new)');
  });

  it('says why the task was not saved while its new agent was made', async () => {
    replies.push({
      events: [answer({ text: 'Here is the plan.', blocks: [agentCard, taskCard] })],
    });
    const user = await start();
    await screen.findByTestId('ask-block-task-task-1');
    replies.push({
      json: {
        status: 'proposed',
        related: [{ id: 'agent-1', status: 'applied' }],
        agentId: 7,
        failed: { code: 'scheduled_task_limit', message: 'An agent can have at most 10' },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Apply both' }));
    const task = screen.getByTestId('ask-block-task-task-1');
    await within(task).findByText('An agent can have at most 10');
    const agent = screen.getByTestId('ask-block-agent-agent-1');
    expect(agent.textContent).toContain('Created (switched off).');
    // The agent stands on its own now: its own Undo and its page.
    expect(within(agent).getByRole('link', { name: 'Open the agent' }).getAttribute('href')).toBe(
      '/admin/members/ai/7',
    );
    replies.push({
      json: { status: 'proposed', related: [{ id: 'task-1', status: 'discarded' }] },
    });
    await user.click(within(agent).getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(sent.at(-1)!.url).toBe('/api/ask-ezy/changes/agent-1/undo'));
    // Its task waited for it: discarded with it.
    await within(task).findByText('Discarded');
  });

  it('in Lite, says the new agent stays (no Undo for it)', async () => {
    replies.push({
      events: [
        answer({
          text: 'Here is the plan.',
          blocks: [{ ...agentCard, removable: false }, taskCard],
        }),
      ],
    });
    const user = await start();
    replies.push({
      json: {
        status: 'applied',
        related: [{ id: 'agent-1', status: 'applied' }],
        agentId: 7,
        taskId: 3,
        nextRunAt: null,
        agentOn: false,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Apply both' }));
    const task = screen.getByTestId('ask-block-task-task-1');
    replies.push({
      json: { status: 'proposed', related: [{ id: 'agent-1', status: 'applied' }], agentId: 7 },
    });
    await user.click(await within(task).findByRole('button', { name: /undo/i }));
    const agent = screen.getByTestId('ask-block-agent-agent-1');
    await within(agent).findByText(/It stays, switched off/);
    expect(within(agent).queryByRole('button', { name: /undo/i })).toBeNull();
    expect(within(agent).getByRole('link', { name: 'Open the agent' })).toBeTruthy();
  });

  it('writes "Chat …6789" for a chat without a name', async () => {
    replies.push({
      events: [
        answer({
          text: 'Plan.',
          blocks: [
            { ...taskCard, chatName: null, chatEnding: '6789', dependsOn: null, agentId: 4 },
          ],
        }),
      ],
    });
    await start();
    const task = await screen.findByTestId('ask-block-task-task-1');
    expect(task.textContent).toContain('Chat …6789');
  });

  it('shows an edit with the saved time struck through and applies it alone', async () => {
    replies.push({
      events: [
        answer({
          text: 'Move it to 08:30?',
          blocks: [
            {
              ...taskCard,
              agent: 'Sales Agent',
              agentId: 4,
              dependsOn: null,
              time: '08:30',
              before: { time: '09:00' },
              taskId: 3,
              preview: null,
            },
          ],
        }),
      ],
    });
    const user = await start("Move Jee Fong's greeting to 8:30");
    const task = await screen.findByTestId('ask-block-task-task-1');
    expect(task.textContent).toContain('Change');
    expect(task.querySelector('.line-through')).not.toBeNull();
    expect(task.textContent).not.toContain('Preview (not sent)');
    replies.push({
      json: { status: 'applied', agentId: 4, taskId: 3, nextRunAt: null, agentOn: true },
    });
    await user.click(within(task).getByRole('button', { name: /^apply$/i }));
    await within(task).findByText('Saved.');
    expect(sent.at(-1)!.url).toBe('/api/ask-ezy/changes/task-1/apply');
  });
});
