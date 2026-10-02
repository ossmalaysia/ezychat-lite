import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuickReply } from '@wa-team-inbox/shared';
import { Composer } from './Composer';
import { QuickReplyPicker, filterQuickReplies } from './QuickReplyPicker';

// cmdk (Command) measures its list with ResizeObserver and scrolls the active row into view;
// jsdom implements neither.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

afterEach(() => cleanup());

const replies: QuickReply[] = [
  { id: 1, shortcut: 'hello', body: 'Hi! How can we help you today?', updatedAt: 1 },
  { id: 2, shortcut: 'price', body: 'Our pricing starts at RM 99/month.', updatedAt: 1 },
  { id: 3, shortcut: 'promo', body: 'Use code TEAM10 for 10% off.', updatedAt: 1 },
];

describe('filterQuickReplies', () => {
  it('filters by shortcut prefix, case-insensitively', () => {
    expect(filterQuickReplies(replies, 'pr').map((r) => r.shortcut)).toEqual(['price', 'promo']);
    expect(filterQuickReplies(replies, 'PRI').map((r) => r.shortcut)).toEqual(['price']);
    expect(filterQuickReplies(replies, '')).toHaveLength(3);
  });
});

describe('QuickReplyPicker', () => {
  it('lists matching shortcuts and reports a click', async () => {
    const onPick = vi.fn();
    render(<QuickReplyPicker replies={replies} query="pri" activeIndex={0} onPick={onPick} />);
    expect(screen.getByText('/price')).toBeTruthy();
    expect(screen.queryByText('/hello')).toBeNull();
    await userEvent.setup().click(screen.getByText('/price'));
    expect(onPick).toHaveBeenCalledWith(replies[1]);
  });

  it('typing /pr in the composer shows /price and Enter inserts its body', async () => {
    const onSend = vi.fn();
    render(<Composer quickReplies={replies} onSend={onSend} onAttach={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(box, '/pr');
    expect(screen.getByRole('listbox', { name: /quick replies/i })).toBeTruthy();
    expect(screen.getByText('/price')).toBeTruthy();
    expect(screen.queryByText('/hello')).toBeNull();
    await user.keyboard('{Enter}');
    expect(box.value).toBe('Our pricing starts at RM 99/month.');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: /quick replies/i })).toBeNull();
  });

  it('ArrowDown then Tab chooses the second match', async () => {
    render(<Composer quickReplies={replies} onSend={vi.fn()} onAttach={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(box, '/pr');
    await user.keyboard('{ArrowDown}{Tab}');
    expect(box.value).toBe('Use code TEAM10 for 10% off.');
  });
});
