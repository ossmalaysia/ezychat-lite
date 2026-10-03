import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatFilters } from './ChatFilters';

afterEach(cleanup);

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
});
