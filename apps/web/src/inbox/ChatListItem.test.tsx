import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Chat } from '@wa-team-inbox/shared';
import { ChatListItem } from './ChatListItem';

const lidChat: Chat = {
  jid: '123456789012345@lid',
  type: 'dm',
  name: '',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: null,
  lastMessagePreview: 'hello',
  status: 'open',
  assignedTo: null,
  updatedAt: 0,
  phone: null,
};

afterEach(cleanup);

describe('ChatListItem identity', () => {
  it('never shows WhatsApp ID digits as the chat name', () => {
    const view = render(
      <MemoryRouter>
        <ChatListItem chat={lidChat} active={false} assigneeName={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Unknown contact')).toBeTruthy();
    expect(view.container.textContent).not.toContain('123456789012345');
  });

  it('uses +phone when the chat has no name', () => {
    render(
      <MemoryRouter>
        <ChatListItem
          chat={{ ...lidChat, phone: '60123456789' }}
          active={false}
          assigneeName={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('+60123456789')).toBeTruthy();
  });
});

describe('ChatListItem tags', () => {
  it('shows up to two tags and a +N count', () => {
    render(
      <MemoryRouter>
        <ChatListItem
          chat={{ ...lidChat, name: 'Farah', tags: ['VIP', 'Wholesale', 'Halal', 'Repeat'] }}
          active={false}
          assigneeName={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('Wholesale')).toBeTruthy();
    expect(screen.queryByText('Halal')).toBeNull();
    // A wide row: two tags and "+2" (narrow rows: one tag and "+3").
    const more = screen.getAllByText('+2').find((el) => !el.className.includes('@sm:hidden'))!;
    expect(more.getAttribute('title')).toBe('Halal, Repeat');
  });

  it('shows one tag in a narrow row and two in a wide one (row width, not screen width)', () => {
    render(
      <MemoryRouter>
        <ChatListItem
          chat={{ ...lidChat, name: 'Farah', tags: ['VIP', 'Wholesale', 'Halal'] }}
          active={false}
          assigneeName={null}
        />
      </MemoryRouter>,
    );
    // The inbox list is a narrow column on desktop too: the row's own width decides (container
    // query), so the preview keeps its room and tags never squeeze to "V…".
    const second = screen.getByText('Wholesale').closest('[data-slot="badge"]')!;
    expect(second.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(second.className).toMatch(/(^|\s)@sm:inline-flex(\s|$)/);
    expect(second.closest('[class~="@container"]')).not.toBeNull();
    const narrowMore = screen.getByText('+2');
    expect(narrowMore.className).toMatch(/(^|\s)@sm:hidden(\s|$)/);
    expect(narrowMore.getAttribute('title')).toBe('Wholesale, Halal');
    const wideMore = screen.getByText('+1');
    expect(wideMore.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(wideMore.className).toMatch(/(^|\s)@sm:inline-flex(\s|$)/);
  });

  it('tells the assignee apart from tags: person icon on the assignee, filled tag chips', () => {
    render(
      <MemoryRouter>
        <ChatListItem
          chat={{ ...lidChat, name: 'Farah', tags: ['VIP'] }}
          active={false}
          assigneeName="Mei Ling"
        />
      </MemoryRouter>,
    );
    const assignee = screen.getByTitle('Assigned to Mei Ling');
    expect(assignee.querySelector('svg')).toBeTruthy();
    expect(assignee.className).toMatch(/(^|\s)text-xs(\s|$)/);
    const tag = screen.getByText('VIP').closest('[data-slot="badge"]')!;
    expect(tag.getAttribute('data-variant')).toBe('secondary');
    expect(tag.className).toMatch(/(^|\s)text-xs(\s|$)/);
  });

  it('shows no tag chips without tags', () => {
    const view = render(
      <MemoryRouter>
        <ChatListItem chat={{ ...lidChat, name: 'Farah' }} active={false} assigneeName={null} />
      </MemoryRouter>,
    );
    expect(view.container.textContent).not.toContain('+');
  });
});
