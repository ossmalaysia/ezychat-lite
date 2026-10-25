import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_INBOX_CAPABILITIES, type Inbox } from '@ezychat/shared';
import type { ChatFilters as Filters } from '../api/queries';
import { ChatFilters } from './ChatFilters';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockTags(tags: string[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ tags }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return urls;
}

function renderFilters({ value, onChange }: { value: Filters; onChange(next: Filters): void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatFilters value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
}

describe('ChatFilters', () => {
  it('keeps a long selected tag narrow on phones so the assignment tabs keep their room', () => {
    mockTags([]);
    renderFilters({
      value: { assigned: 'any', status: 'open', tag: 'Pelanggan borong utama' },
      onChange: vi.fn(),
    });
    const trigger = screen.getByRole('button', { name: 'Filter by tag' });
    const label = trigger.querySelector('span')!;
    expect(label.textContent).toBe('Pelanggan borong utama');
    expect(label.className).toMatch(/(^|\s)truncate(\s|$)/);
    expect(label.className).toMatch(/(^|\s)max-w-20(\s|$)/);
    expect(label.className).toMatch(/(^|\s)sm:max-w-none(\s|$)/);
    // Still a 44px touch target.
    expect(trigger.className).toMatch(/(^|\s)min-h-11(\s|$)/);
  });

  it('gives the assignment tabs their own row, with the Tag control beside the status tabs', () => {
    mockTags([]);
    renderFilters({ value: { assigned: 'any', status: 'open', tag: 'VIP' }, onChange: vi.fn() });
    const assignment = screen.getByRole('tablist', { name: 'Assignment' });
    const status = screen.getByRole('tablist', { name: 'Chat status' });
    const tag = screen.getByRole('button', { name: 'Filter by tag' });
    const clear = screen.getByRole('button', { name: 'Clear tag filter' });
    // Document order: assignment tabs, status tabs, then the tag controls.
    expect(
      assignment.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(status.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(assignment.parentElement!.contains(tag)).toBe(false);
    expect(status.parentElement!.parentElement!.contains(clear)).toBe(true);
    // A label that does not fit ellipsizes instead of being clipped on both sides.
    for (const name of ['Mine', 'Unassigned', 'All']) {
      const label = screen.getByRole('tab', { name }).querySelector('span');
      expect(label?.className).toMatch(/(^|\s)truncate(\s|$)/);
      expect(label?.className).toMatch(/(^|\s)min-w-0(\s|$)/);
    }
  });

  it('exposes both statuses and preserves assignment and search when switching', async () => {
    const onChange = vi.fn();
    render(
      <ChatFilters value={{ assigned: 'me', status: 'open', q: 'Alex' }} onChange={onChange} />,
    );
    expect(screen.getByRole('tab', { name: 'Open' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Resolved' }));
    expect(onChange).toHaveBeenCalledWith({ assigned: 'me', status: 'resolved', q: 'Alex' });
  });

  it('clears searches and synchronizes an external filter reset', async () => {
    const onChange = vi.fn();
    const view = render(
      <ChatFilters value={{ assigned: 'any', status: 'open', q: 'Alex' }} onChange={onChange} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear search chats' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ assigned: 'any', status: 'open', q: undefined }),
    );
    view.rerender(
      <ChatFilters value={{ assigned: 'any', status: 'open', q: 'Maya' }} onChange={onChange} />,
    );
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Maya');
    view.rerender(<ChatFilters value={{ assigned: 'any', status: 'open' }} onChange={onChange} />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });
  it('sets and clears the tag filter', async () => {
    const onChange = vi.fn();
    const urls = mockTags(['VIP', 'Wholesale']);
    const view = renderFilters({ value: { assigned: 'any' }, onChange });
    expect(urls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Filter by tag' }));
    await userEvent.click(await screen.findByRole('option', { name: 'VIP' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigned: 'any', tag: 'VIP' });
    expect(urls[0]).toBe('/api/customer-tags?q=');

    view.unmount();
    renderFilters({ value: { assigned: 'any', tag: 'VIP' }, onChange });
    expect(screen.getByRole('button', { name: 'Filter by tag' }).textContent).toContain('VIP');
    await userEvent.click(screen.getByRole('button', { name: 'Clear tag filter' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigned: 'any', tag: undefined });
  });

  it('says so when there are no tags yet', async () => {
    mockTags([]);
    renderFilters({ value: { assigned: 'any' }, onChange: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Filter by tag' }));
    expect(await screen.findByText('No tags yet')).toBeTruthy();
  });
});

function inbox(id: number, name: string, number: string | null): Inbox {
  return {
    id,
    name,
    tone: 'primary',
    number,
    removed: false,
    aiAgentId: null,
    type: 'linked_phone',
    capabilities: DEFAULT_INBOX_CAPABILITIES,
    status: { state: 'open', me: null, qr: null, lastError: null },
  };
}

const user = () => userEvent.setup();

function renderWithInboxes(value: Filters, onChange: (next: Filters) => void, inboxes: Inbox[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatFilters value={value} onChange={onChange} inboxes={inboxes} />
    </QueryClientProvider>,
  );
}

describe('ChatFilters inbox filter', () => {
  beforeAll(() => {
    const proto = Element.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
  });

  it('is hidden with no inbox list and with one inbox (Lite)', () => {
    renderFilters({ value: { assigned: 'any', status: 'open' }, onChange: vi.fn() });
    expect(screen.queryByTestId('inbox-filter')).toBeNull();
    cleanup();
    renderWithInboxes({ assigned: 'any', status: 'open' }, vi.fn(), [
      inbox(1, 'Kopi Apong', '60123456789'),
    ]);
    expect(screen.queryByTestId('inbox-filter')).toBeNull();
  });

  it('lists every visible inbox with the count, and sets and clears the inbox', async () => {
    const inboxes = [inbox(1, 'Kopi Apong', '60123456789'), inbox(2, 'Catering', null)];
    const onChange = vi.fn();
    const u = user();
    const view = renderWithInboxes({ assigned: 'me', status: 'open' }, onChange, inboxes);
    const trigger = screen.getByRole('combobox', { name: 'Inbox' });
    expect(trigger.textContent).toBe('All inboxes (2)');
    await u.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'All inboxes (2)',
      'Kopi Apong · +60123456789',
      'Catering',
    ]);
    await u.click(screen.getByRole('option', { name: 'Catering' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigned: 'me', status: 'open', inbox: 2 });

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ChatFilters
          value={{ assigned: 'me', status: 'open', inbox: 2 }}
          onChange={onChange}
          inboxes={inboxes}
        />
      </QueryClientProvider>,
    );
    const selected = screen.getByRole('combobox', { name: 'Inbox' });
    expect(selected.textContent).toBe('Catering');
    await u.click(selected);
    await u.click(await screen.findByRole('option', { name: 'All inboxes (2)' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigned: 'me', status: 'open', inbox: undefined });
  });

  it('shows "All inboxes" for a remembered inbox the user can no longer open', () => {
    renderWithInboxes({ assigned: 'any', status: 'open', inbox: 9 }, vi.fn(), [
      inbox(1, 'Kopi Apong', null),
      inbox(2, 'Catering', null),
    ]);
    expect(screen.getByRole('combobox', { name: 'Inbox' }).textContent).toBe('All inboxes (2)');
  });
});
