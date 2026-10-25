import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Message, MessageTemplate } from '@ezychat/shared';
import { replyWindowEnding, replyWindowLeft, useWindowClosed } from './reply-window';
import {
  ReplyWindowNote,
  TEMPLATES_MANAGER_URL,
  WindowClosedPanel,
  fillTemplate,
} from './ReplyWindow';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const HOUR = 3_600_000;
const MIN = 60_000;
const jid = '60123@s.whatsapp.net';

describe('reply window helpers', () => {
  it('has no window without hours, is closed before any inbound message, and counts down', () => {
    const now = 1_000 * HOUR;
    expect(replyWindowLeft(now - HOUR, null, now)).toBeNull();
    expect(replyWindowLeft(null, 24, now)).toBe(0);
    expect(replyWindowLeft(now - HOUR, 24, now)).toBe(23 * HOUR);
    expect(replyWindowLeft(now - 25 * HOUR, 24, now)).toBe(0);
    expect(replyWindowEnding(59 * MIN)).toBe(true);
    expect(replyWindowEnding(61 * MIN)).toBe(false);
    expect(replyWindowEnding(0)).toBe(false);
  });

  it('fills {{n}} with the values and keeps the placeholder of an empty one', () => {
    expect(fillTemplate('Hi {{1}}, your order {{2}} is ready.', ['Bob', ' '])).toBe(
      'Hi Bob, your order {{2}} is ready.',
    );
  });
});

describe('ReplyWindowNote', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the hours and minutes left in a quiet tone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * HOUR);
    render(<ReplyWindowNote lastInboundAt={100 * HOUR - 24 * HOUR + 312 * MIN} windowHours={24} />);
    const note = screen.getByTestId('reply-window');
    expect(note.textContent).toBe('Reply window: 5 h 12 min left');
    expect(note.className).toContain('text-muted-foreground');
    expect(note.getAttribute('data-ending')).toBeNull();
    expect(note.getAttribute('title')).toBe(
      "You can write freely for 24 hours after the customer's last message. After that WhatsApp accepts only an approved template.",
    );
  });

  it('turns to the warning tone in the last hour and ticks each minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * HOUR);
    render(<ReplyWindowNote lastInboundAt={100 * HOUR - 24 * HOUR + 45 * MIN} windowHours={24} />);
    const note = screen.getByTestId('reply-window');
    expect(note.textContent).toBe('Reply window: 45 min left');
    expect(note.getAttribute('data-ending')).toBe('true');
    expect(note.className).toContain('text-warning');
    act(() => vi.advanceTimersByTime(MIN));
    expect(screen.getByTestId('reply-window').textContent).toBe('Reply window: 44 min left');
  });

  it('shows nothing once the window has closed', () => {
    render(<ReplyWindowNote lastInboundAt={Date.now() - 25 * HOUR} windowHours={24} />);
    expect(screen.queryByTestId('reply-window')).toBeNull();
  });

  it('useWindowClosed flips to closed when the window runs out', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * HOUR);
    const initialProps: { at: number | null; hours: number | null } = {
      at: 100 * HOUR - 24 * HOUR + 2 * MIN,
      hours: 24,
    };
    const { result, rerender } = renderHook(({ at, hours }) => useWindowClosed(at, hours), {
      initialProps,
    });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(2 * MIN + 100));
    expect(result.current).toBe(true);
    // The customer writes again: the window reopens.
    rerender({ at: Date.now(), hours: 24 });
    expect(result.current).toBe(false);
    rerender({ at: Date.now(), hours: null });
    expect(result.current).toBeNull();
  });
});

const template = (over: Partial<MessageTemplate>): MessageTemplate => ({
  name: 'order_ready',
  language: 'en',
  category: 'utility',
  body: 'Hi {{1}}, your order {{2}} is ready.',
  variables: 2,
  examples: ['Aisyah', '#1024'],
  header: null,
  buttons: false,
  sendable: true,
  ...over,
});
const TEMPLATES: MessageTemplate[] = [
  template({}),
  template({
    name: 'promo_raya',
    language: 'ms',
    category: 'marketing',
    body: 'Salam {{1}}! Diskaun Raya.',
    variables: 1,
    examples: ['Aisyah'],
  }),
  template({ name: 'catalogue', header: 'image', sendable: false, body: 'See our catalogue.' }),
  template({ name: 'book_now', buttons: true, sendable: false, body: 'Tap to book.' }),
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setupPanel({
  templates = TEMPLATES,
  afterSync = TEMPLATES,
  sendStatus = 201,
  disabled = false,
}: {
  templates?: MessageTemplate[];
  afterSync?: MessageTemplate[];
  sendStatus?: number;
  disabled?: boolean;
} = {}) {
  const sent: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/inboxes/2/templates') return json({ templates });
    if (url === '/api/inboxes/2/templates?refresh=1') return json({ templates: afterSync });
    if (url === `/api/chats/${encodeURIComponent(jid)}/template` && init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)));
      if (sendStatus !== 201)
        return json(
          { error: { code: 'template_params', message: 'Fill in every variable.' } },
          sendStatus,
        );
      const m: Partial<Message> = { id: 'wamid.1', chatJid: jid, fromMe: true, body: 'Hi Bob' };
      return json(m, 201);
    }
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <WindowClosedPanel jid={jid} inboxId={2} customerName="Bob Tan" disabled={disabled} />
    </QueryClientProvider>,
  );
  return { sent, fetchMock, user: userEvent.setup() };
}

describe('WindowClosedPanel and the template dialog', () => {
  beforeAll(() => {
    const proto = Element.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
  });
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Send a template' }));
    return screen.findByRole('dialog', { name: 'Send a template' });
  }

  it('keeps Send a template disabled while WhatsApp is offline', () => {
    setupPanel({ disabled: true });
    const button = screen.getByRole('button', { name: 'Send a template' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('lists the templates and disables the ones EzyChat cannot send yet', async () => {
    const { user } = setupPanel();
    const dialog = await openDialog(user);
    const list = await within(dialog).findByTestId('template-list');
    const order = within(list).getByRole('button', { name: /order_ready/ });
    expect(within(order).getByText('en')).toBeTruthy();
    expect(within(order).getByText('Utility')).toBeTruthy();
    const promo = within(list).getByRole('button', { name: /promo_raya/ });
    expect(within(promo).getByText('Marketing')).toBeTruthy();
    const image = within(list).getByRole('button', { name: /catalogue/ }) as HTMLButtonElement;
    expect(image.disabled).toBe(true);
    expect(within(image).getByText('Image header: not supported yet')).toBeTruthy();
    const buttons = within(list).getByRole('button', { name: /book_now/ }) as HTMLButtonElement;
    expect(buttons.disabled).toBe(true);
    expect(within(buttons).getByText('Buttons: not supported yet')).toBeTruthy();
    // Nothing chosen yet: no Send.
    expect(within(dialog).queryByRole('button', { name: 'Send template' })).toBeNull();
  });

  it('prefills {{1}} with the first name, checks required values, previews and sends', async () => {
    const { user, sent } = setupPanel();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: /order_ready/ }));
    const first = within(dialog).getByLabelText('Variable 1') as HTMLInputElement;
    const second = within(dialog).getByLabelText('Variable 2') as HTMLInputElement;
    expect(first.value).toBe('Bob');
    expect(second.value).toBe('');
    expect(second.placeholder).toBe('#1024');
    expect(within(dialog).getByTestId('template-preview').textContent).toBe(
      'Hi Bob, your order {{2}} is ready.',
    );
    expect(within(dialog).queryByText(/Marketing templates may go only/)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Send template' }));
    expect(within(dialog).getByText('Fill this in.')).toBeTruthy();
    expect(second.getAttribute('aria-invalid')).toBe('true');
    expect(sent).toHaveLength(0);

    await user.type(second, '#2048');
    expect(within(dialog).getByTestId('template-preview').textContent).toBe(
      'Hi Bob, your order #2048 is ready.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send template' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      name: 'order_ready',
      language: 'en',
      params: ['Bob', '#2048'],
    });
    expect(typeof (sent[0] as { clientId: unknown }).clientId).toBe('string');
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Template sent. You can write freely once the customer replies.',
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the marketing note and the server refusal, and retries with the same clientId', async () => {
    const { user, sent } = setupPanel({ sendStatus: 400 });
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: /promo_raya/ }));
    expect(
      within(dialog).getByText(
        'Marketing templates may go only to customers who agreed to receive them.',
      ),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Send template' }));
    expect(await within(dialog).findByText('Fill in every variable.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Send template' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    const [a, b] = sent as { clientId: string }[];
    expect(a!.clientId).toBe(b!.clientId);
    expect(screen.getByRole('dialog', { name: 'Send a template' })).toBeTruthy();
  });

  it('without approved templates links to WhatsApp Manager and syncs', async () => {
    const { user, fetchMock } = setupPanel({ templates: [], afterSync: [template({})] });
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText('No approved templates yet')).toBeTruthy();
    const manager = within(dialog).getByRole('link', { name: 'Open WhatsApp Manager' });
    expect(manager.getAttribute('href')).toBe(TEMPLATES_MANAGER_URL);
    expect(manager.getAttribute('target')).toBe('_blank');
    await user.click(within(dialog).getByRole('button', { name: 'Sync' }));
    expect(await within(dialog).findByRole('button', { name: /order_ready/ })).toBeTruthy();
    expect(fetchMock.mock.calls.map(([u]) => u)).toContain('/api/inboxes/2/templates?refresh=1');
    expect(toast.success).toHaveBeenCalledWith('Templates synced from WhatsApp');
  });
});
