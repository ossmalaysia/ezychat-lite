import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
