import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiEditField, AiEditResult } from '@wa-team-inbox/shared';
import { AiEditDialog } from './AiEditDialog';

function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}

function Harness({
  field,
  current,
  onApply,
}: {
  field: AiEditField;
  current: string;
  onApply: (text: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <output data-testid="open">{String(open)}</output>
      <AiEditDialog
        field={field}
        current={current}
        open={open}
        onOpenChange={setOpen}
        onApply={onApply}
      />
    </>
  );
}

function setup({
  field = 'handoffRules' as AiEditField,
  current = 'Hand off complaints.\nHand off bulk orders.',
  respond = (): Response =>
    json({
      ok: true,
      text: 'Hand off complaints.\nHand off refund requests.',
      error: null,
    } satisfies AiEditResult),
} = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/ai/edit' && init?.method === 'POST') return respond();
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const onApply = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <Harness field={field} current={current} onApply={onApply} />
    </QueryClientProvider>,
  );
  return { fetchMock, onApply, user: userEvent.setup() };
}

beforeAll(() => {
  // The phone drawer (vaul) captures the pointer; jsdom has no pointer capture.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Edit with AI dialog', () => {
  it('names the field and keeps Suggest disabled until a request is typed', async () => {
    const { user } = setup();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit hand-off rules with AI')).toBeTruthy();
    expect(
      within(dialog).getByText('Describe the change. You review it before anything is applied.'),
    ).toBeTruthy();
    const suggest = within(dialog).getByRole('button', { name: 'Suggest' }) as HTMLButtonElement;
    expect(suggest.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText('What should change?'), '   ');
    expect(suggest.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText('What should change?'), 'Refunds');
    expect(suggest.disabled).toBe(false);
    // Nothing to apply before a suggestion: only Cancel.
    expect(within(dialog).queryByRole('button', { name: 'Apply to hand-off rules' })).toBeNull();
    expect(
      within(dialog).queryByText('Applying fills the box; press Save on the page to keep it.'),
    ).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('sends the field, the current text and the request, then shows a line diff', async () => {
    const { fetchMock, user } = setup();
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('What should change?'),
      '  Hand refund requests to a person ',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    expect(await within(dialog).findByText('Suggested hand-off rules')).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/ai/edit');
    expect(JSON.parse(String(call![1]!.body))).toEqual({
      field: 'handoffRules',
      current: 'Hand off complaints.\nHand off bulk orders.',
      request: 'Hand refund requests to a person',
    });
    const lines = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(lines).toEqual([
      ' Hand off complaints.',
      '−Removed: Hand off bulk orders.',
      '+Added: Hand off refund requests.',
    ]);
    expect(within(dialog).getByRole('button', { name: 'Suggest again' })).toBeTruthy();
    // Only the removed text is struck through, never the − sign.
    const removed = within(dialog).getAllByRole('listitem')[1]!;
    expect(removed.className).not.toContain('line-through');
    expect(within(removed).getByText('Hand off bulk orders.').className).toContain('line-through');
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('Apply passes the suggested text and closes', async () => {
    const { onApply, user } = setup();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What should change?'), 'Refunds');
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    await within(dialog).findByText('Suggested hand-off rules');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to hand-off rules' }));
    expect(onApply).toHaveBeenCalledWith('Hand off complaints.\nHand off refund requests.');
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
  });

  it('Discard closes without applying', async () => {
    const { onApply, user } = setup({ field: 'instructions', current: 'Be kind.' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit AI instructions with AI')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('What should change?'), 'Be brief');
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    await within(dialog).findByText('Suggested AI instructions');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
  });

  it('shows the error of a failed suggestion and keeps Apply disabled', async () => {
    const { onApply, user } = setup({
      respond: () => json({ ok: false, text: null, error: 'The AI is not connected.' }),
    });
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What should change?'), 'Refunds');
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'The AI is not connected.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Apply to hand-off rules' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows a request failure inside the dialog', async () => {
    const { user } = setup({
      respond: () =>
        json({ error: { code: 'validation', message: 'Too long for this field' } }, 400),
    });
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What should change?'), 'Refunds');
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Too long for this field',
    );
  });

  it('says when the suggestion changes nothing and keeps Apply disabled', async () => {
    const { user } = setup({
      current: 'Hand off complaints.',
      respond: () => json({ ok: true, text: 'Hand off complaints.\n', error: null }),
    });
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What should change?'), 'Nothing');
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    expect(
      await within(dialog).findByText('No change suggested — try describing it differently.'),
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Apply to hand-off rules' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows a long text as its changes with one line around each, folding the rest', async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Rule ${i + 1}.`).join('\n');
    const { user } = setup({
      current: long,
      respond: () => json({ ok: true, text: long.replace('Rule 6.', 'Rule six.'), error: null }),
    });
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What should change?'), 'Rename rule 6');
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }));
    await within(dialog).findByText('Suggested hand-off rules');
    const lines = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(lines).toEqual([
      '⋯ 4 unchanged lines',
      ' Rule 5.',
      '−Removed: Rule 6.',
      '+Added: Rule six.',
      ' Rule 7.',
      '⋯ 5 unchanged lines',
    ]);
  });
});
