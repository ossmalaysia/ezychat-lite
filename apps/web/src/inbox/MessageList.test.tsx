import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Message } from '@ezychat/shared';
import { HIGHLIGHT_MS, MessageList, type MessageListProps } from './MessageList';
import type { TimelineItem } from './timeline';
import type { Directory } from './useDirectory';
import { NavigationGuardProvider, useNavigationGuardRef } from './navigation-guard';

const base: Message = {
  id: 'M-0',
  chatJid: '60123456789@s.whatsapp.net',
  senderJid: '60123456789@s.whatsapp.net',
  senderName: 'Gus',
  fromMe: false,
  sentByUserId: null,
  type: 'text',
  body: 'hello',
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  mediaStatus: 'none',
  quotedId: null,
  status: 'delivered',
  error: null,
  timestamp: 1_700_000_000_000,
  clientId: null,
  reactions: [],
};
const item = (id: string, i: number): TimelineItem => ({
  kind: 'message',
  key: id,
  at: base.timestamp + i,
  message: { ...base, id, body: `body ${id}`, timestamp: base.timestamp + i },
});
const directory = { me: null, nameOf: () => '' } as unknown as Directory;

function props(over: Partial<MessageListProps>): MessageListProps {
  const items = over.items ?? [item('M-1', 1), item('M-2', 2)];
  return {
    items,
    messagesById: new Map(),
    isGroup: false,
    directory,
    loading: false,
    hasOlder: false,
    loadingOlder: false,
    onLoadOlder: vi.fn(),
    onRetry: vi.fn(),
    retryingId: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MessageList jump to a quoted message', () => {
  it('centres, focuses and briefly highlights the original once it is rendered', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container, rerender } = render(
      <MessageList {...props({ jumpTo: { id: 'M-9', seq: 1 } })} />,
    );
    // not rendered yet (an older page is still loading): nothing happens
    expect(scrollIntoView).not.toHaveBeenCalled();
    const items = [item('M-9', 0), item('M-1', 1), item('M-2', 2)];
    rerender(<MessageList {...props({ items, jumpTo: { id: 'M-9', seq: 1 } })} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    const target = container.querySelector('[data-message-id="M-9"]');
    expect(target?.getAttribute('data-highlighted')).toBe('true');
    expect(document.activeElement).toBe(target);
    // the same request is handled once, even when items change again
    rerender(<MessageList {...props({ items: [...items], jumpTo: { id: 'M-9', seq: 1 } })} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HIGHLIGHT_MS));
    expect(container.querySelector('[data-highlighted]')).toBeNull();
  });

  it('jumps without smooth scrolling for people who prefer reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<MessageList {...props({ jumpTo: { id: 'M-2', seq: 3 } })} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });

  it('passes the quote handler to each bubble', () => {
    const onOpenQuote = vi.fn();
    const quoting = { ...item('M-3', 3) } as Extract<TimelineItem, { kind: 'message' }>;
    quoting.message = { ...quoting.message, quotedId: 'M-1' };
    const { getByTestId } = render(
      <MessageList {...props({ items: [item('M-1', 1), quoting], onOpenQuote })} />,
    );
    act(() => getByTestId('quote-jump').click());
    expect(onOpenQuote).toHaveBeenCalledWith('M-1');
  });
});

describe('MessageList AI agent link', () => {
  const agentMsg = (): TimelineItem => ({
    kind: 'message',
    key: 'A-1',
    at: base.timestamp,
    message: { ...base, id: 'A-1', fromMe: true, sentByUserId: 7 },
  });
  const dir = (isAdmin: boolean, row: Record<string, unknown>) =>
    ({
      me: null,
      isAdmin,
      byId: new Map([
        [7, { id: 7, kind: 'ai', aiAgentId: 3, displayName: 'Workshop assistant', ...row }],
      ]),
      // the real directory adds the "(AI)" mark to an AI user's name
      nameOf: () => 'Workshop assistant (AI)',
    }) as unknown as Directory;
  const view = (d: Directory) =>
    render(
      <MemoryRouter>
        <MessageList {...props({ items: [agentMsg()], directory: d })} />
      </MemoryRouter>,
    );

  it('links the agent name to its page for admins', () => {
    const { container } = view(dir(true, {}));
    const link = container.querySelector('a[href="/admin/members/ai/3"]');
    expect(link?.textContent).toBe('Workshop assistant (AI)');
    // the screen-reader label names the agent once, without the visible "(AI)" mark
    expect(link?.getAttribute('aria-label')).toBe('Open Workshop assistant settings');
    expect(link?.getAttribute('title')).toBe('Open Workshop assistant settings');
  });
  it('asks the navigation guard before leaving the chat', () => {
    const guard = vi.fn();
    function GuardSlot() {
      useNavigationGuardRef().current = guard;
      return null;
    }
    render(
      <MemoryRouter>
        <NavigationGuardProvider>
          <GuardSlot />
          <MessageList {...props({ items: [agentMsg()], directory: dir(true, {}) })} />
        </NavigationGuardProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: /Workshop assistant/ }));
    expect(guard).toHaveBeenCalledTimes(1);
  });
  it('ignores the click a long press leaves behind and blocks the touch link menu', () => {
    vi.useFakeTimers();
    const guard = vi.fn();
    function GuardSlot() {
      useNavigationGuardRef().current = guard;
      return null;
    }
    render(
      <MemoryRouter>
        <NavigationGuardProvider>
          <GuardSlot />
          <MessageList
            {...props({ items: [agentMsg()], directory: dir(true, {}), onReply: vi.fn() })}
          />
        </NavigationGuardProvider>
      </MemoryRouter>,
    );
    const link = screen.getByTestId('agent-link');
    fireEvent.pointerDown(link, { pointerType: 'touch', pointerId: 1, clientX: 5, clientY: 5 });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(link, { pointerType: 'touch', pointerId: 1 });
    // the touch browser's link menu is suppressed
    expect(fireEvent.contextMenu(link)).toBe(false);
    // the trailing click neither opens the agent page nor asks the guard
    expect(fireEvent.click(link)).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    // a plain tap afterwards still works
    fireEvent.pointerDown(link, { pointerType: 'touch', pointerId: 2, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(link, { pointerType: 'touch', pointerId: 2 });
    fireEvent.click(link);
    expect(guard).toHaveBeenCalledTimes(1);
  });
  it('keeps the context menu for a mouse', () => {
    view(dir(true, {}));
    const link = screen.getByTestId('agent-link');
    fireEvent.pointerDown(link, { pointerType: 'mouse', pointerId: 1 });
    expect(fireEvent.contextMenu(link)).toBe(true);
  });
  it('stays plain text for non-admins and deleted agents', () => {
    expect(view(dir(false, {})).container.querySelector('a')).toBeNull();
    cleanup();
    const deleted = view(dir(true, { aiDeleted: true }));
    expect(deleted.container.querySelector('a')).toBeNull();
    expect(deleted.container.textContent).toContain('Workshop assistant');
  });
});
